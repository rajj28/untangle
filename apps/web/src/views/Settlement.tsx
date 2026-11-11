import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, ExcelStyle, GridApi, GridOptions, ValueFormatterParams, ValueGetterParams } from "ag-grid-community";
import type { CustomCellRendererProps } from "ag-grid-react";
import { ArrowRightLeft, BarChart3, Check, ChevronDown, CircleAlert, Copy, FileCheck2, GitBranch, History, Landmark, LoaderCircle, RotateCw, Send, ShieldCheck, Unplug, WalletCards } from "lucide-react";
import { api, ApiError } from "../api.ts";
import type { BusEvent, Config, NetworkSummary, ObligationView, RoundListItem, RoundView, StatementBody, TransferView } from "../types.ts";
import { formatMoney, calculateLeverage, formatLeverage } from "../money.ts";
import { roundRows, settlementRowId } from "../round-rows.ts";
import type { SettlementRow } from "../round-rows.ts";
import { StatusPill } from "../components/StatusPill.tsx";
import { Empty } from "../components/Empty.tsx";
import { Skeleton } from "../components/Skeleton.tsx";
import { Drawer } from "../components/Drawer.tsx";
import { darkGridTheme, lightGridTheme } from "../theme.ts";
import type { ThemeMode } from "../components/Header.tsx";
import type { ToastMessage } from "../components/Toasts.tsx";
import { Button } from "../ui/Button.tsx";
import { Dialog } from "../components/Dialog.tsx";
import { PayDialog } from "../paypal/PayDialog.tsx";
import { StatementExplanation } from "./me/StatementExplanation.tsx";
import { AnalysisPanel } from "./SettlementAnalysis.tsx";
import { NetProofVerifier } from "../components/NetProofVerifier.tsx";
import { PaypalSaysBadge } from "../components/PaypalSays.tsx";
import { CollapseGraph } from "./CollapseGraph.tsx";

type PushToast = (toast: Omit<ToastMessage, "id">) => void;

interface SettlementGridContext {
  currency: string;
  actingAs: string;
  roundStatus: string;
  mode: Config["mode"];
  busyTransferId: string | null;
  round: RoundView;
  onPay: (transferId: string) => void;
  onPayouts: (payerId: string) => void;
  onRefreshPayouts: () => void;
  onSimPayout: (transferId: string, status: "SUCCESS" | "FAILED") => void;
  onToast: PushToast;
}

function GroupInner(props: CustomCellRendererProps<SettlementRow, string, SettlementGridContext>) {
  const row = props.data;
  const context = props.context;
  if (!row) return <span className="truncate">{String(props.value ?? "")}</span>;
  const isLoops = row.rowType === "loops";
  const isChains = row.rowType === "chains";
  const isTransfer = row.rowType === "transfer";
  const label = isLoops
    ? `Loops — cleared with no money moving · ${context.round.setoffs.length} · ${formatMoney(row.amountMinor, context.currency)}`
    : isChains
      ? `Chains — settled by ${context.round.transfers.length} PayPal payments · ${formatMoney(row.amountMinor, context.currency)}`
      : row.label;
  const Icon = isLoops ? ArrowRightLeft : isChains || isTransfer ? Send : FileCheck2;
  return <span className={`flex min-w-0 items-center gap-2 ${isLoops || isChains ? "font-semibold" : ""}`}>
    <Icon size={13} className={isLoops ? "text-[var(--brand)]" : isChains || isTransfer ? "text-[var(--blue)]" : "text-muted"} />
    <span className="truncate">{label}</span>
  </span>;
}

function SettlementStatusCell(props: CustomCellRendererProps<SettlementRow>) {
  return props.data?.status ? <StatusPill status={props.data.status} /> : null;
}

function CopyReferenceCell(props: CustomCellRendererProps<SettlementRow, string | null, SettlementGridContext>) {
  const value = props.data?.paypalRef ?? null;
  if (!value) return <span className="text-muted">—</span>;
  const shortened = value.length > 16 ? `${value.slice(0, 9)}…${value.slice(-4)}` : value;
  return <button className="inline-flex items-center gap-1 font-mono text-[10px] text-muted hover:text-[var(--brand)]" title={value} onClick={(event) => {
    event.stopPropagation();
    void navigator.clipboard.writeText(value).then(() => props.context.onToast({ kind: "success", title: "PayPal reference copied.", code: null, debugId: null })).catch(() => props.context.onToast({ kind: "error", title: "Could not copy PayPal reference.", code: null, debugId: null }));
  }}>
    {shortened}<Copy size={10} />
  </button>;
}

function CopyInvoiceCell(props: CustomCellRendererProps<SettlementRow, string | null, SettlementGridContext>) {
  const value = props.data?.invoiceId ?? null;
  if (value === null) return <span className="text-muted">—</span>;
  return <button className="inline-flex items-center gap-1 font-mono text-[10px] text-muted hover:text-[var(--brand)]" title={value} onClick={(event) => {
    event.stopPropagation();
    void navigator.clipboard.writeText(value).then(() => props.context.onToast({ kind: "success", title: "Invoice id copied.", code: null, debugId: null })).catch(() => props.context.onToast({ kind: "error", title: "Could not copy the invoice id.", code: null, debugId: null }));
  }}>{short(value)}<Copy size={10} /></button>;
}

function ActionsCell(props: CustomCellRendererProps<SettlementRow, unknown, SettlementGridContext>) {
  const row = props.data;
  const context = props.context;
  if (!row || row.rowType !== "transfer" || row.transferId === null || row.payerId === null) return null;
  const transfer = context.round.transfers.find((item) => item.id === row.transferId);
  if (!transfer) return null;
  const permitted = context.actingAs === "" || context.actingAs === transfer.payerId;
  const busy = context.busyTransferId === transfer.id || context.busyTransferId === `payer:${transfer.payerId}` || context.busyTransferId === "refresh";
  if (transfer.status === "committed") {
    const reference = transfer.paypalCaptureId ? short(transfer.paypalCaptureId) : transfer.payoutItemId ? `payout item ${short(transfer.payoutItemId)}` : "PayPal";
    return <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-[var(--brand)]"><Check size={13} />Paid · {reference}</span>;
  }
  if (transfer.status === "failed" || transfer.status === "unwound") {
    const text = transfer.status === "unwound" ? "PayPal reversed the payment; invoice balances were restored." : "PayPal reported that the payment failed; the invoices remain open.";
    return <span className="flex items-center gap-1 text-[10px] text-[var(--red)]" title={text}><CircleAlert size={12} />{text}</span>;
  }
  if (context.roundStatus !== "settling") return <span className="text-[10px] text-muted">Waiting for set-offs</span>;
  if (transfer.status === "pending_paypal" && transfer.instrument === "payouts") {
    if (!permitted) return <span className="text-[10px] text-muted">Waiting for payer</span>;
    return <div className="flex items-center gap-1">
      <button className="desk-button h-7 min-h-7 px-2 text-[10px]" onClick={context.onRefreshPayouts} disabled={busy}>{busy ? <LoaderCircle size={11} className="animate-spin" /> : <RotateCw size={11} />}Refresh from PayPal</button>
      {context.mode === "sim" && <>
        <button className="desk-button h-7 min-h-7 px-2 text-[10px]" onClick={() => context.onSimPayout(transfer.id, "SUCCESS")} disabled={busy}>{busy ? <LoaderCircle size={11} className="animate-spin" /> : null}Simulate success</button>
        <button className="desk-button h-7 min-h-7 px-2 text-[10px]" onClick={() => context.onSimPayout(transfer.id, "FAILED")} disabled={busy}>{busy ? <LoaderCircle size={11} className="animate-spin" /> : null}Simulate failure</button>
      </>}
    </div>;
  }
  if (["ready", "awaiting_payer"].includes(transfer.status)) {
    if (!permitted) return <span className="text-[10px] text-muted">Waiting for payer</span>;
    return <div className="flex items-center gap-1">
      <button className="desk-button desk-button-paypal h-7 min-h-7 px-2 text-[10px]" onClick={() => context.onPay(transfer.id)} disabled={busy}><WalletCards size={12} />Pay {formatMoney(transfer.amountMinor, transfer.currency)} with PayPal</button>
      {(transfer.paypalOrderId === null || transfer.instrument === "payouts") && <button className="desk-button h-7 min-h-7 px-2 text-[10px]" title="Pays every eligible transfer for this payer in one PayPal batch." onClick={() => context.onPayouts(transfer.payerId)} disabled={busy}>{busy ? <LoaderCircle size={12} className="animate-spin" /> : <Landmark size={12} />}Send via Payouts</button>}
    </div>;
  }
  if (transfer.status === "pending_paypal") return <span className="inline-flex items-center gap-1 text-[10px] text-[var(--status-pending-fg)]"><LoaderCircle size={12} className="animate-spin" />Waiting for PayPal</span>;
  return <StatusPill status={transfer.status} />;
}

function CopyHash({ value, onToast }: { value: string; onToast: PushToast }) {
  const shortened = value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
  return <button className="inline-flex items-center gap-1 font-mono text-[10px] text-muted hover:text-[var(--brand)]" title={value} onClick={() => {
    void navigator.clipboard.writeText(value).then(() => onToast({ kind: "success", title: "Plan hash copied.", code: null, debugId: null })).catch(() => onToast({ kind: "error", title: "Could not copy the plan hash.", code: null, debugId: null }));
  }}>{shortened}<Copy size={10} /></button>;
}

function StatTile({ label, value, detail, accent = false }: { label: string; value: string; detail: string; accent?: boolean }) {
  return <div className="surface min-w-0 rounded-md border line px-3 py-2">
    <p className="truncate text-[9px] font-semibold uppercase tracking-[.1em] text-muted">{label}</p>
    <p className={`mt-1 truncate text-[16px] font-semibold tracking-tight tabular-nums ${accent ? "text-[var(--brand)]" : ""}`}>{value}</p>
    <p className="truncate text-[9px] text-muted">{detail}</p>
  </div>;
}

function stepState(round: RoundView, index: number): "done" | "current" | "future" {
  if (round.status === "failed") return index < 4 ? "done" : "current";
  const order: Record<string, number> = { consenting: 1, executing: 2, settling: 3, closed: 4, failed: 4 };
  const current = order[round.status] ?? 0;
  if (index < current) return "done";
  if (index === current) return "current";
  return "future";
}

function reasonForRound(events: BusEvent[], roundId: string): string | null {
  const event = [...events].reverse().find((item) => item.payload.roundId === roundId && (item.type === "round.failed" || item.type === "round.needs_attention"));
  const problems = event?.payload.problems;
  if (Array.isArray(problems)) return problems.map((item) => typeof item === "string" ? item : JSON.stringify(item)).join(" · ");
  if (typeof problems === "string") return problems;
  const error = event?.payload.error;
  return typeof error === "string" ? error : null;
}

export function Settlement({ networkId, summary, obligations, actingAs, names, config, theme, events, onToast }: {
  networkId: string;
  summary: NetworkSummary;
  obligations: ObligationView[];
  actingAs: string;
  names: Readonly<Record<string, string>>;
  config: Config;
  theme: ThemeMode;
  events: BusEvent[];
  onToast: PushToast;
}) {
  const queryClient = useQueryClient();
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null);
  const [payingTransfer, setPayingTransfer] = useState<TransferView | null>(null);
  const [statement, setStatement] = useState<{ roundId: string; businessId: string; statementHash: string; body: StatementBody } | null>(null);
  const [showCharts, setShowCharts] = useState(false);
  const [showCollapse, setShowCollapse] = useState(false);
  const [showExecute, setShowExecute] = useState(false);
  const [signingAll, setSigningAll] = useState(false);
  const [chaosDialogOpen, setChaosDialogOpen] = useState(false);
  const [chaosAfterRecords, setChaosAfterRecords] = useState("5");
  const [busyTransferId, setBusyTransferId] = useState<string | null>(null);
  const roundsQuery = useQuery({ queryKey: ["rounds", networkId], queryFn: () => api.rounds(networkId), staleTime: Infinity });
  const rounds = roundsQuery.data ?? [];

  useEffect(() => {
    if (selectedRoundId === null) setSelectedRoundId(summary.latestRound?.id ?? rounds[0]?.id ?? null);
  }, [rounds, selectedRoundId, summary.latestRound?.id]);

  const roundQuery = useQuery({ queryKey: ["round", selectedRoundId], queryFn: () => api.round(selectedRoundId ?? ""), enabled: selectedRoundId !== null, staleTime: Infinity });
  const round = roundQuery.data;

  useEffect(() => {
    if (roundsQuery.error) notifyError(roundsQuery.error, onToast);
    if (roundQuery.error) notifyError(roundQuery.error, onToast);
  }, [onToast, roundQuery.error, roundsQuery.error]);

  useEffect(() => {
    setShowExecute(false);
    if (round?.status !== "executing") return;
    const timeout = window.setTimeout(() => setShowExecute(true), 8000);
    return () => window.clearTimeout(timeout);
  }, [round?.id, round?.status]);

  const setRoundCache = useCallback((updated: RoundView) => {
    queryClient.setQueryData(["round", updated.id], updated);
    void queryClient.invalidateQueries({ queryKey: ["rounds", networkId] });
    void queryClient.invalidateQueries({ queryKey: ["network", networkId] });
  }, [networkId, queryClient]);

  const plan = useMutation({
    mutationFn: () => api.planRound(networkId),
    onSuccess: (created) => {
      setSelectedRoundId(created.id);
      setRoundCache(created);
      onToast({ kind: "success", title: "Settlement round planned. Businesses can review and sign their statements.", code: null, debugId: null });
    },
    onError: (error) => notifyError(error, onToast),
  });
  const consent = useMutation({
    mutationFn: (businessId: string) => api.consent(round?.id ?? "", businessId),
    onSuccess: setRoundCache,
    onError: (error) => notifyError(error, onToast),
  });
  const execute = useMutation({
    mutationFn: () => api.execute(round?.id ?? ""),
    onSuccess: setRoundCache,
    onError: (error) => notifyError(error, onToast),
  });
  const payouts = useMutation({
    mutationFn: (payerId: string) => api.payouts(round?.id ?? "", payerId),
    onSuccess: (updated) => { setRoundCache(updated); onToast({ kind: "success", title: "PayPal Payouts batch sent for eligible transfers.", code: null, debugId: null }); },
    onError: (error) => notifyError(error, onToast),
  });
  const refreshPayouts = useMutation({
    mutationFn: () => api.refreshPayouts(round?.id ?? ""),
    onSuccess: setRoundCache,
    onError: (error) => notifyError(error, onToast),
  });
  const simPayout = useMutation({
    mutationFn: ({ transferId, status }: { transferId: string; status: "SUCCESS" | "FAILED" }) => api.simPayout(transferId, status),
    onSuccess: setRoundCache,
    onError: (error) => notifyError(error, onToast),
  });
  const armChaos = useMutation({
    mutationFn: (afterRecords: number) => api.armChaos(afterRecords),
    onSuccess: ({ afterRecords }) => {
      setChaosDialogOpen(false);
      onToast({ kind: "success", title: `Armed. The server will crash after ${afterRecords} PayPal writes in the next round.`, code: null, debugId: null });
    },
    onError: (error) => notifyError(error, onToast),
  });

  const verify = useMutation({
    mutationFn: (roundId: string) => api.verifyRound(roundId),
    onSuccess: () => onToast({ kind: "success", title: "The Watchdog is re-reading every invoice in this round from PayPal. Follow it in Agents.", code: null, debugId: null }),
    onError: (error) => notifyError(error, onToast),
  });

  const eligibleCount = obligations.filter((item) => item.status !== "cancelled" && item.outstandingMinor > 0).length;
  const latestId = rounds[0]?.id ?? summary.latestRound?.id ?? null;
  const [reviewLatest, setReviewLatest] = useState(false);
  const showHero = round === undefined || (!reviewLatest && round.id === latestId && (round.status === "closed" || round.status === "failed"));
  const totalOutstanding = summary.totals.outstandingMinor;
  const rows = useMemo(() => round ? roundRows(round, names, obligations) : [], [names, obligations, round]);
  const currentFailure = round ? reasonForRound(events, round.id) : null;

  /** Rebuild the engine's plan shape for the collapse animation (G) from the round view. */
  const collapseData = useMemo(() => {
    if (!round) return null;
    const setoffs: Record<string, number> = {};
    for (const so of round.setoffs) { if (so.amountMinor > 0) setoffs[so.obligationId] = so.amountMinor; }
    const transfers = round.transfers.map((t) => ({ payer: t.payerId, payee: t.payeeId, amount: t.amountMinor, legs: t.legs.map((l) => ({ obligationId: l.obligationId, amount: l.amountMinor })) }));
    const engineObligations = obligations.filter((o) => o.paypalInvoiceId !== null).map((o) => ({ id: o.id, debtor: o.debtorId, creditor: o.creditorId, amount: o.amountMinor }));
    const stats = round.stats ? {
      totalOwed: round.stats.totalOwed,
      clearedByLoops: round.stats.clearedByLoops,
      settledByChains: round.stats.settledByChains,
      moneyMoved: round.stats.moneyMoved,
      leverage: typeof round.stats.leverage === "string" ? Number(round.stats.leverage) : round.stats.leverage,
    } : { totalOwed: 0, clearedByLoops: 0, settledByChains: 0, moneyMoved: 0, leverage: null as number | null };
    return { setoffs, transfers, stats, engineObligations };
  }, [round, obligations]);

  const onPay = useCallback((transferId: string) => {
    const transfer = round?.transfers.find((item) => item.id === transferId);
    if (transfer) setPayingTransfer(transfer);
  }, [round]);
  const onPayouts = useCallback((payerId: string) => {
    if (!round) return;
    setBusyTransferId(`payer:${payerId}`);
    payouts.mutate(payerId, { onSettled: () => setBusyTransferId(null) });
  }, [payouts, round]);
  const onRefreshPayouts = useCallback(() => {
    setBusyTransferId("refresh");
    refreshPayouts.mutate(undefined, { onSettled: () => setBusyTransferId(null) });
  }, [refreshPayouts]);
  const onSimPayout = useCallback((transferId: string, status: "SUCCESS" | "FAILED") => {
    setBusyTransferId(transferId);
    simPayout.mutate({ transferId, status }, { onSettled: () => setBusyTransferId(null) });
  }, [simPayout]);
  const currentRoundId = round?.id;
  const refreshPayDialogData = useCallback(() => {
    if (currentRoundId) void queryClient.invalidateQueries({ queryKey: ["round", currentRoundId] });
    void queryClient.invalidateQueries({ queryKey: ["network", networkId] });
    void queryClient.invalidateQueries({ queryKey: ["obligations", networkId] });
  }, [currentRoundId, networkId, queryClient]);
  const context = useMemo<SettlementGridContext | undefined>(() => round ? ({
    currency: summary.network.currency,
    actingAs,
    roundStatus: round.status,
    mode: config.mode,
    busyTransferId,
    round,
    onPay,
    onPayouts,
    onRefreshPayouts,
    onSimPayout,
    onToast,
  }) : undefined, [actingAs, busyTransferId, config.mode, onPay, onPayouts, onRefreshPayouts, onSimPayout, onToast, round, summary.network.currency]);

  const signAll = async () => {
    if (!round) return;
    setSigningAll(true);
    try {
      for (const businessId of round.pendingConsents) await consent.mutateAsync(businessId);
      onToast({ kind: "success", title: "All demo statements signed.", code: null, debugId: null });
    } catch {
      // The mutation already reported the specific server error.
    } finally {
      setSigningAll(false);
    }
  };

  const columnDefs = useMemo<ColDef<SettlementRow, unknown>[]>(() => [
    { field: "from", headerName: "From → To", minWidth: 165, flex: 1, valueGetter: (params) => params.data ? `${params.data.from} → ${params.data.to}` : "" },
    { field: "description", headerName: "Description", minWidth: 150, flex: 1.1 },
    { field: "invoiceId", headerName: "Invoice", minWidth: 135, width: 150, cellRenderer: CopyInvoiceCell },
    { field: "amountMinor", headerName: "Amount", minWidth: 105, width: 120, type: "rightAligned", valueFormatter: (params: ValueFormatterParams<SettlementRow, unknown, SettlementGridContext>) => params.data && typeof params.value === "number" ? formatMoney(params.value, params.context.currency) : "" },
    { field: "status", headerName: "Status", minWidth: 125, width: 145, enableCellChangeFlash: true, cellRenderer: SettlementStatusCell },
    { field: "paypalRef", headerName: "PayPal reference", minWidth: 118, width: 145, cellRenderer: CopyReferenceCell },
    { colId: "actions", headerName: "Actions", minWidth: 330, width: 380, sortable: false, filter: false, cellRenderer: ActionsCell },
  ], []);

  const gridOptions = useMemo<GridOptions<SettlementRow>>(() => ({
    context,
    treeData: true,
    getDataPath: (row) => row.path,
    getRowId: (params) => settlementRowId(params.data),
    groupDefaultExpanded: -1,
    rowHeight: 32,
    headerHeight: 34,
    cellSelection: true,
    defaultColDef: { sortable: true, resizable: true, filter: true },
    autoGroupColumnDef: {
      headerName: "Settlement flow",
      minWidth: 275,
      flex: 1.25,
      cellRendererParams: { innerRenderer: GroupInner, suppressCount: true },
    },
    rowClassRules: {
      "row-involves-business": (params) => Boolean(params.data && context?.actingAs && params.data.partyIds.includes(context.actingAs)),
    },
    statusBar: { statusPanels: [{ statusPanel: "agTotalAndFilteredRowCountComponent" }, { statusPanel: "agAggregationComponent" }] },
  }), [context]);


  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-[50px] items-center gap-3 border-b line bg-[var(--surface)] px-4">
        <div><h1 className="text-sm font-semibold tracking-tight">Settlement workspace</h1><p className="text-[10px] text-muted">Resolve invoice loops, then settle the net through PayPal</p></div>
        <div className="ml-auto flex items-center gap-2">
          {config.demo && <Button variant="ghost" size="sm" onClick={() => setChaosDialogOpen(true)}><Unplug size={14} />Pull the plug</Button>}
          {rounds.length > 0 && <label className="flex items-center gap-2 text-[10px] text-muted">
            <span>History</span>
            <span className="relative"><select className="desk-select max-w-[210px] pr-7 text-[10px]" value={selectedRoundId ?? ""} onChange={(event) => setSelectedRoundId(event.target.value)} aria-label="Select a settlement round">
              {rounds.map((item: RoundListItem) => <option key={item.id} value={item.id}>Round {short(item.id)} · {item.status}</option>)}
            </select><ChevronDown size={12} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2" /></span>
          </label>}
        </div>
      </div>

      {showHero ? <div className="flex-1 overflow-auto p-5 md:p-8">
        <div className="mx-auto flex min-h-[min(520px,100%)] max-w-4xl items-center justify-center">
          {roundQuery.isLoading && selectedRoundId !== null ? <Skeleton lines={5} className="w-full max-w-xl" /> : <div className="surface w-full rounded-xl border line p-6 shadow-sm md:p-9">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.12em] text-[var(--brand)]"><ArrowRightLeft size={14} />Clear the network</div>
            <h2 className="mt-4 max-w-2xl text-2xl font-semibold leading-tight tracking-[-.04em] md:text-3xl">{eligibleCount} open invoices worth <span className="tabular-nums">{formatMoney(totalOutstanding, summary.network.currency)}</span>.</h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted">Plan a settlement round. Untangle finds debts that cancel in loops first, then creates the fewest net PayPal payments needed to settle what remains.</p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button className="desk-button desk-button-primary h-10 px-4" onClick={() => plan.mutate()} disabled={plan.isPending || eligibleCount === 0}>
                {plan.isPending ? <LoaderCircle size={15} className="animate-spin" /> : <ArrowRightLeft size={15} />}
                {plan.isPending ? "Planning round…" : "Plan a settlement round"}
              </button>
              <span className="text-[10px] text-muted">No money moves until each business reviews its statement.</span>
            </div>
            {round?.status === "closed" && <button className="desk-button mt-5" onClick={() => setReviewLatest(true)}><History size={13} />Review last round</button>}
            {eligibleCount === 0 && <p className="mt-5 rounded-md bg-[var(--brand-tint)] px-3 py-2 text-xs text-[var(--brand-strong)]">All invoices are settled. There is nothing new to plan.</p>}
            {round?.status === "failed" && currentFailure && <p className="mt-4 text-xs text-[var(--red)]">Previous round: {currentFailure}</p>}
          </div>}
        </div>
      </div> : roundQuery.isLoading || !round || !context ? <Skeleton className="flex-1" lines={6} /> : <>
        <div className="border-b line bg-[var(--surface)] px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Round {short(round.id)}</span>
              <StatusPill status={round.status} />
              {round.planHash && <span className="hidden items-center gap-1 sm:inline-flex"><span className="text-[9px] text-muted">Plan</span><CopyHash value={round.planHash} onToast={onToast} /></span>}
            </div>
            <div className="ml-auto flex items-center gap-3">
              {round.status === "executing" && <span className="flex items-center gap-1.5 text-[10px] text-muted"><LoaderCircle size={13} className="animate-spin text-[var(--brand)]" />Recording set-offs on PayPal invoices…</span>}
              {showExecute && round.status === "executing" && <button className="desk-button" onClick={() => execute.mutate()} disabled={execute.isPending}>{execute.isPending ? <LoaderCircle size={13} className="animate-spin" /> : <RotateCw size={13} />}Execute now</button>}
              {["settling", "closed", "failed"].includes(round.status) && <button className="desk-button" onClick={() => verify.mutate(round.id)} disabled={verify.isPending}>{verify.isPending ? <LoaderCircle size={13} className="animate-spin" /> : <ShieldCheck size={13} />}Verify on PayPal</button>}
              <button className="desk-button" onClick={() => setShowCharts(true)} title="Chart debt cleared versus cash moved per loop / payment"><BarChart3 size={13} />Chart it</button>
              <button className="desk-button" onClick={() => setShowCollapse(true)} disabled={!collapseData || collapseData.engineObligations.length === 0} title="Animate this round's plan before → after on a graph"><GitBranch size={13} />Before → After</button>
              <NetProofVerifier variant="button" />
              <AuditPack round={round} obligations={obligations} names={names} currency={summary.network.currency} />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1 overflow-x-auto">
            {[
              { label: "Planned", index: 0 },
              { label: `Consent (${round.consents.length} of ${round.statements.length})`, index: 1 },
              { label: "Executing", index: 2 },
              { label: "Settling", index: 3 },
              { label: round.status === "failed" ? "Failed" : "Closed", index: 4 },
            ].map((step, index) => {
              const state = stepState(round, step.index);
              return <div key={step.label} className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] ${round.status === "failed" && step.index === 4 ? "bg-[var(--red-tint)] text-[var(--red)]" : state === "done" ? "bg-[var(--brand-tint)] text-[var(--brand)]" : state === "current" ? "bg-[var(--brand)] text-white" : "bg-[var(--surface-muted)] text-muted"}`}>{state === "done" ? <Check size={11} /> : index + 1}</span>
                <span className={`truncate text-[9px] ${state === "future" ? "text-muted" : "font-medium"}`}>{step.label}</span>
                {index < 4 && <span className="ml-auto h-px min-w-2 flex-1 bg-[var(--line)]" />}
              </div>;
            })}
          </div>
          {round.status === "failed" && currentFailure && <p className="mt-2 flex items-center gap-1.5 text-[10px] text-[var(--red)]"><CircleAlert size={12} />{currentFailure}</p>}
        </div>
        <div className="grid grid-cols-2 gap-2 border-b line bg-[var(--surface-soft)] px-3 py-2 sm:grid-cols-3 xl:grid-cols-5">
          <StatTile label="Total owed" value={formatMoney(round.stats?.totalOwed ?? 0, summary.network.currency)} detail="Invoice value in the plan" />
          <StatTile label="Cleared by loops" value={formatMoney(round.stats?.clearedByLoops ?? 0, summary.network.currency)} detail="No money moved" />
          <StatTile label="Settled by chains" value={formatMoney(round.stats?.settledByChains ?? 0, summary.network.currency)} detail="Invoice value settled" />
          <StatTile label="Moved through PayPal" value={formatMoney(round.stats?.moneyMoved ?? 0, summary.network.currency)} detail={`${round.transfers.length} payment${round.transfers.length === 1 ? "" : "s"}`} />
          <StatTile label="Leverage" value={formatLeverage(calculateLeverage((round.stats?.clearedByLoops ?? 0) + (round.stats?.settledByChains ?? 0), round.stats?.moneyMoved ?? 0))} detail="Invoices settled per $1 moved" accent />
        </div>

        {round.replanned && round.replanned.brokeLoops.length > 0 && (
          <div className="border-b line bg-[var(--red-tint)] px-4 py-2 text-[10px] leading-4 text-[var(--red)]">
            <span className="font-semibold">Re-planned after a rejection.</span> {round.replanned.brokeLoops.length} loop(s) that contained the disputed invoice broke ({round.replanned.brokeLoops.map((loop) => `loop ${loop.memberIds.length} invoices`).join(", ")}). The engine found {round.replanned.newLoops.length} new loop(s) without the disputed debt.
          </div>
        )}

        <div className="settlement-columns grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_310px]">
          <div className="flex min-h-0 flex-col border-r line">
            <div className="flex min-h-[36px] items-center justify-between px-4">
              <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted">Plan details</h2>
              <span className="text-[9px] text-muted">Expand rows to inspect invoice legs</span>
            </div>
            <div className="ag-grid-wrap min-h-0 flex-1">
              <AgGridReact<SettlementRow>
                rowData={rows}
                columnDefs={columnDefs}
                gridOptions={gridOptions}
                context={context}
                theme={theme === "dark" ? darkGridTheme : lightGridTheme}
              />
            </div>
          </div>

          <aside className="consent-panel scrollbar-thin flex min-h-0 flex-col overflow-y-auto bg-[var(--surface)]">
            <div className="sticky top-0 z-10 flex min-h-[36px] items-center justify-between border-b line bg-[var(--surface)] px-4">
              <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted">Business statements</h2>
              {actingAs === "" && round.status === "consenting" && round.pendingConsents.length > 0 && <button className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--brand)] hover:underline" onClick={() => void signAll()} disabled={signingAll || consent.isPending}>{signingAll && <LoaderCircle size={11} className="animate-spin" />}{signingAll ? "Signing…" : "Sign all (demo)"}</button>}
            </div>
            <div className="space-y-2 p-3">
              {round.statements.map((item) => {
                const signed = round.consents.find((consentItem) => consentItem.businessId === item.businessId);
                const body = item.body;
                const canSign = actingAs === "" || actingAs === item.businessId;
                const businessName = names[item.businessId] ?? "Business";
                return <article key={item.businessId} className={`rounded-md border line p-3 ${actingAs === item.businessId ? "ring-1 ring-[var(--brand)]/30" : ""}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><h3 className="truncate text-xs font-semibold">{businessName}</h3><p className="mt-1 text-[9px] text-muted">
                      cleared {formatMoney(body.totals.clearedMinor, body.currency)} <span className="mx-0.5">·</span> pays {formatMoney(body.totals.paysMinor, body.currency)} <span className="mx-0.5">·</span> receives {formatMoney(body.totals.receivesMinor, body.currency)}
                    </p></div>
                    {signed ? <span className="flex shrink-0 items-center gap-1 text-[9px] text-[var(--brand)]"><Check size={12} />Signed {new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit" }).format(new Date(signed.createdAt))}</span> : <span className="shrink-0 text-[9px] text-muted">Waiting</span>}
                  </div>
                  <div className="mt-3 flex items-center gap-1.5">
                    <button className="desk-button h-7 min-h-7 px-2 text-[10px]" onClick={() => setStatement({ roundId: round.id, ...item })}><FileCheck2 size={12} />View statement</button>
                    {!signed && canSign && round.status === "consenting" && <button className="desk-button desk-button-primary h-7 min-h-7 px-2 text-[10px]" onClick={() => consent.mutate(item.businessId)} disabled={consent.isPending}>{consent.isPending ? <LoaderCircle size={12} className="animate-spin" /> : <Check size={12} />}Sign as {businessName}</button>}
                  </div>
                </article>;
              })}
            </div>
            {round.status === "executing" && <p className="mx-3 mb-3 rounded-md bg-[var(--brand-tint)] px-3 py-2 text-[10px] leading-4 text-[var(--brand-strong)]">Every business signed. PayPal is recording the loop set-offs.</p>}
            {round.status === "failed" && <p className="mx-3 mb-3 rounded-md bg-[var(--red-tint)] px-3 py-2 text-[10px] leading-4 text-[var(--red)]">This round failed. Unsettled invoices remain available for a new plan.</p>}
          </aside>
        </div>
      </>}

      <Drawer open={statement !== null} title={statement ? `${names[statement.businessId] ?? "Business"} · settlement statement` : "Settlement statement"} onClose={() => setStatement(null)}>
        {statement && <StatementDetail statement={statement} roundId={statement.roundId} names={names} onToast={onToast} />}
      </Drawer>
      <Drawer open={showCharts} title="How this result came about" onClose={() => setShowCharts(false)}>
        {round && <AnalysisPanel round={round} obligations={obligations} names={names} currency={summary.network.currency} theme={theme} />}
      </Drawer>
      <Drawer open={showCollapse} title="Before → after collapse" onClose={() => setShowCollapse(false)}>
        {collapseData && (
          <CollapseGraph
            nodes={summary.businesses.map((b) => ({ id: b.id, name: b.name }))}
            obligations={collapseData.engineObligations}
            plan={{ setoffs: collapseData.setoffs, transfers: collapseData.transfers, stats: collapseData.stats }}
            currency={summary.network.currency}
            names={names}
          />
        )}
      </Drawer>
      <PayDialog
        transfer={payingTransfer ? round?.transfers.find((item) => item.id === payingTransfer.id) ?? payingTransfer : null}
        payeeName={payingTransfer ? names[payingTransfer.payeeId] ?? "the creditor" : "the creditor"}
        config={config}
        obligations={obligations}
        onClose={() => setPayingTransfer(null)}
        onRefresh={refreshPayDialogData}
        onToast={onToast}
      />
      <Dialog open={chaosDialogOpen} title="Crash the server in the middle of the next round?" onClose={() => setChaosDialogOpen(false)}>
        <p className="text-sm leading-6 text-soft">Untangle will crash right after PayPal accepts set-off payment number {Number(chaosAfterRecords) || 5}, before it can write down that it succeeded. It restarts, finishes the round, and the Watchdog checks PayPal for duplicates.</p>
        <form className="mt-4 space-y-4" onSubmit={(event) => {
          event.preventDefault();
          armChaos.mutate(Number(chaosAfterRecords));
        }}>
          <label className="block text-xs font-medium text-soft">
            Crash after this many PayPal writes
            <input className="desk-input mt-1.5 w-full text-sm" type="number" min={1} max={50} step={1} required value={chaosAfterRecords} onChange={(event) => setChaosAfterRecords(event.target.value)} />
          </label>
          <div className="flex flex-col-reverse justify-end gap-2 sm:flex-row">
            <Button type="button" variant="secondary" onClick={() => setChaosDialogOpen(false)}>Cancel</Button>
            <Button type="submit" variant="danger" loading={armChaos.isPending}><Unplug size={15} />Arm the crash</Button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}

function StatementDetail({ statement, roundId, names, onToast }: {
  statement: { businessId: string; statementHash: string; body: StatementBody };
  roundId: string;
  names: Readonly<Record<string, string>>;
  onToast: PushToast;
}) {
  const body = statement.body;
  return <div className="space-y-5">
    <div className="rounded-lg bg-[var(--surface-soft)] p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Statement totals</p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <div><p className="text-[9px] text-muted">Cleared</p><p className="mt-1 text-xs font-semibold tabular-nums">{formatMoney(body.totals.clearedMinor, body.currency)}</p></div>
        <div><p className="text-[9px] text-muted">Pays</p><p className="mt-1 text-xs font-semibold tabular-nums">{formatMoney(body.totals.paysMinor, body.currency)}</p></div>
        <div><p className="text-[9px] text-muted">Receives</p><p className="mt-1 text-xs font-semibold tabular-nums">{formatMoney(body.totals.receivesMinor, body.currency)}</p></div>
      </div>
      <p className="mt-3 rounded-md bg-[var(--brand-tint)] px-3 py-2 text-[10px] leading-4 text-[var(--brand-strong)]">
        Net position {formatMoney(body.netBefore, body.currency)} · after {formatMoney(body.netAfter, body.currency)} — unchanged
      </p>
    </div>
    <StatementSection
      title="Set-offs"
      items={body.setoffs.map((item) => ({ key: `so-${item.obligationId}`, label: `${item.role === "debtor" ? "Owes" : "Is owed by"} ${names[item.counterpartyId] ?? "a business"} · invoice ${short(item.invoiceId)}`, amount: item.amountMinor }))}
      currency={body.currency}
      extra={(item) => <PaypalSaysBadge obligationId={item.key?.replace("so-", "") ?? ""} currency={body.currency} />}
    />
    <StatementSection title="Pays" items={body.pays.map((item) => ({ label: `Pay ${names[item.payeeId] ?? "a business"}`, amount: item.amountMinor }))} currency={body.currency} />
    <StatementSection title="Receives" items={body.receives.map((item) => ({ label: `Receive from ${names[item.payerId] ?? "a business"}`, amount: item.amountMinor }))} currency={body.currency} />
    <StatementSection title="Pass-through legs" items={body.passThrough.map((item) => ({ label: `${item.role} · invoice ${short(item.obligationId)}`, amount: item.amountMinor }))} currency={body.currency} />
    <div className="border-t line pt-4"><p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Full statement hash</p><button className="mt-2 break-all text-left font-mono text-[10px] leading-5 text-soft hover:text-[var(--brand)]" title="Copy statement hash" onClick={() => {
      void navigator.clipboard.writeText(statement.statementHash).then(() => onToast({ kind: "success", title: "Statement hash copied.", code: null, debugId: null })).catch(() => onToast({ kind: "error", title: "Could not copy the statement hash.", code: null, debugId: null }));
    }}>{statement.statementHash}<Copy size={11} className="ml-2 inline" /></button></div>
    <StatementExplanation roundId={roundId} businessId={statement.businessId} onToast={onToast} />
  </div>;
}

function StatementSection({ title, items, currency, extra }: { title: string; items: { key?: string; label: string; amount: number }[]; currency: string; extra?: (item: { key?: string; label: string; amount: number }) => ReactNode }) {
  return <section><h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">{title} <span className="font-normal">({items.length})</span></h3>
    {items.length === 0 ? <p className="text-xs text-muted">None</p> : <div className="space-y-2">{items.map((item, index) => <div key={item.key ?? `${title}-${index}`} className="flex items-start justify-between gap-3 text-xs"><span className="text-soft">{item.label}</span><span className="flex shrink-0 items-center gap-2"><span className="tabular-nums font-medium">{formatMoney(item.amount, currency)}</span>{extra?.(item)}</span></div>)}</div>}
  </section>;
}

function notifyError(error: unknown, onToast: PushToast): void {
  if (error instanceof ApiError) {
    const message = error.code === "ROUND_IN_PROGRESS" ? "A settlement round is already in progress." : error.code === "NOTHING_TO_SETTLE" ? "There are no eligible invoices to settle." : error.code === "NOTHING_TO_PAY" ? "This payer has no eligible transfers to pay." : error.message;
    onToast({ kind: "error", title: message, code: error.code, debugId: error.debugId });
  } else onToast({ kind: "error", title: error instanceof Error ? error.message : "The request could not be completed.", code: null, debugId: null });
}

function short(value: string): string {
  return value.length > 16 ? `${value.slice(0, 9)}…${value.slice(-4)}` : value;
}

interface AuditRow {
  sheetKey: string;
  businessName: string;
  rowType: "TOTAL" | "BUSINESS" | "INVOICE";
  description: string;
  invoiceId: string;
  paypalInvoiceId: string;
  amountMinor: number;
  clearedMinor: number;
  cashNeededMinor: number;
  receivesMinor: number;
  status: string;
  dueOn: string;
}

interface JournalRow {
  journalNo: string;
  journalDate: string;
  account: string;
  debits: string;
  credits: string;
  description: string;
  name: string;
}

function AuditPack({ round, obligations, names, currency }: {
  round: RoundView;
  obligations: readonly ObligationView[];
  names: Readonly<Record<string, string>>;
  currency: string;
}) {
  const gridRef = useRef<AgGridReact<AuditRow>>(null);
  const [gridReady, setGridReady] = useState(false);
  const journalRef = useRef<AgGridReact<JournalRow>>(null);

  const journalRows = useMemo<JournalRow[]>(() => {
    const out: JournalRow[] = [];
    const journalDate = new Date().toISOString().slice(0, 10);
    const dollars = (minor: number) => (minor / 100).toFixed(2);
    let je = 0;
    for (const setoff of round.setoffs) {
      je += 1;
      const no = `JE-${String(je).padStart(4, "0")}`;
      const amount = dollars(setoff.amountMinor);
      out.push({ journalNo: no, journalDate, account: "Accounts Payable", debits: amount, credits: "0.00", description: `Set-off invoice ${setoff.obligationId.slice(0, 8)}`, name: names[setoff.debtorId] ?? "Debtor" });
      out.push({ journalNo: no, journalDate, account: "Accounts Receivable", debits: "0.00", credits: amount, description: `Set-off invoice ${setoff.obligationId.slice(0, 8)}`, name: names[setoff.creditorId] ?? "Creditor" });
    }
    for (const transfer of round.transfers) {
      je += 1;
      const no = `JE-${String(je).padStart(4, "0")}`;
      const amount = dollars(transfer.amountMinor);
      const ref = transfer.paypalCaptureId ?? transfer.payoutBatchId ?? transfer.payoutItemId ?? transfer.id;
      const description = `PayPal payment ${ref}`;
      const payer = names[transfer.payerId] ?? "Payer";
      const payee = names[transfer.payeeId] ?? "Payee";
      out.push({ journalNo: no, journalDate, account: "Accounts Payable", debits: amount, credits: "0.00", description, name: payer });
      out.push({ journalNo: no, journalDate, account: "PayPal Cash", debits: "0.00", credits: amount, description, name: payer });
      out.push({ journalNo: no, journalDate, account: "PayPal Cash", debits: amount, credits: "0.00", description, name: payee });
      out.push({ journalNo: no, journalDate, account: "Accounts Receivable", debits: "0.00", credits: amount, description, name: payee });
    }
    return out;
  }, [names, round]);

  const rows = useMemo<AuditRow[]>(() => {
    const eligible = obligations.filter((item) => item.status !== "cancelled");
    const totalOwed = eligible.reduce((sum, item) => sum + item.amountMinor, 0);
    const totalCleared = round.setoffs.reduce((sum, item) => sum + item.amountMinor, 0);
    const totalMoved = round.transfers.reduce((sum, item) => sum + item.amountMinor, 0);
    const out: AuditRow[] = [];
    out.push({
      sheetKey: "summary",
      businessName: "Untangle network",
      rowType: "TOTAL",
      description: "Grand total",
      invoiceId: "",
      paypalInvoiceId: "",
      amountMinor: totalOwed,
      clearedMinor: totalCleared,
      cashNeededMinor: totalMoved,
      receivesMinor: 0,
      status: "",
      dueOn: "",
    });
    for (const statement of round.statements) {
      const businessId = statement.businessId;
      const businessName = names[businessId] ?? "Business";
      const owes = eligible.filter((item) => item.debtorId === businessId).reduce((sum, item) => sum + item.amountMinor, 0);
      const totals = statement.body.totals;
      out.push({
        sheetKey: "summary",
        businessName,
        rowType: "BUSINESS",
        description: `${businessName} statement`,
        invoiceId: "",
        paypalInvoiceId: "",
        amountMinor: owes,
        clearedMinor: totals.clearedMinor,
        cashNeededMinor: totals.paysMinor,
        receivesMinor: totals.receivesMinor,
        status: "",
        dueOn: "",
      });
      for (const setoff of statement.body.setoffs) {
        out.push({
          sheetKey: businessId,
          businessName,
          rowType: "INVOICE",
          description: `Invoice ${short(setoff.invoiceId)}`,
          invoiceId: setoff.invoiceId,
          paypalInvoiceId: setoff.invoiceId,
          amountMinor: setoff.amountMinor,
          clearedMinor: setoff.amountMinor,
          cashNeededMinor: 0,
          receivesMinor: 0,
          status: "Cleared by loop",
          dueOn: "",
        });
      }
    }
    return out;
  }, [names, obligations, round]);

  const columnDefs = useMemo<ColDef<AuditRow>[]>(
    () => [
      { field: "sheetKey", headerName: "Sheet", hide: true, filter: "agTextColumnFilter" },
      { field: "businessName", headerName: "Business", minWidth: 150 },
      { field: "rowType", headerName: "Type", width: 110 },
      { field: "description", headerName: "Description", minWidth: 160 },
      { field: "invoiceId", headerName: "Invoice", width: 160, cellClass: "font-mono" },
      { field: "paypalInvoiceId", headerName: "PayPal invoice", width: 180, cellClass: "font-mono" },
      { field: "amountMinor", headerName: "Amount", type: "rightAligned", cellClass: "audit-currency", valueGetter: (params: ValueGetterParams<AuditRow>) => params.data ? Number(params.data.amountMinor ?? 0) / 100 : null },
      { field: "clearedMinor", headerName: "Cleared", type: "rightAligned", cellClass: "audit-currency", valueGetter: (params: ValueGetterParams<AuditRow>) => params.data ? Number(params.data.clearedMinor ?? 0) / 100 : null },
      { field: "cashNeededMinor", headerName: "Cash paid", type: "rightAligned", cellClass: "audit-currency", valueGetter: (params: ValueGetterParams<AuditRow>) => params.data ? Number(params.data.cashNeededMinor ?? 0) / 100 : null },
      { field: "receivesMinor", headerName: "Cash received", type: "rightAligned", cellClass: "audit-currency", valueGetter: (params: ValueGetterParams<AuditRow>) => params.data ? Number(params.data.receivesMinor ?? 0) / 100 : null },
      { field: "status", headerName: "Status", width: 140 },
      { field: "dueOn", headerName: "Due", width: 100 },
    ],
    [],
  );

  const excelStyles = useMemo<ExcelStyle[]>(
    () => [{ id: "audit-currency", dataType: "Number", numberFormat: { format: "$#,##0.00" } }],
    [],
  );

  const journalColumnDefs = useMemo<ColDef<JournalRow>[]>(
    () => [
      { field: "journalNo", headerName: "JournalNo", width: 90 },
      { field: "journalDate", headerName: "JournalDate", width: 110 },
      { field: "account", headerName: "AccountName", minWidth: 150 },
      { field: "debits", headerName: "Debits", type: "rightAligned", cellClass: "audit-currency" },
      { field: "credits", headerName: "Credits", type: "rightAligned", cellClass: "audit-currency" },
      { field: "description", headerName: "Description", minWidth: 180 },
      { field: "name", headerName: "Name", minWidth: 140 },
    ],
    [],
  );

  const doExport = () => {
    const api: GridApi<AuditRow> | undefined = gridRef.current?.api;
    if (!api) return;
    const date = new Date().toISOString().slice(0, 10);
    const sheets: string[] = [];
    api.setFilterModel({ sheetKey: { filterType: "text", type: "equals", filter: "summary" } });
    api.onFilterChanged();
    const summary = api.getSheetDataForExcel({ sheetName: "Summary", columnKeys: ["businessName", "rowType", "amountMinor", "clearedMinor", "cashNeededMinor", "receivesMinor"] });
    if (summary) sheets.push(summary);
    for (const statement of round.statements) {
      const businessId = statement.businessId;
      const name = names[businessId] ?? "Business";
      api.setFilterModel({ sheetKey: { filterType: "text", type: "equals", filter: businessId } });
      api.onFilterChanged();
      const sheet = api.getSheetDataForExcel({ sheetName: name.slice(0, 31), columnKeys: ["description", "invoiceId", "paypalInvoiceId", "amountMinor", "clearedMinor", "cashNeededMinor", "status", "dueOn"] });
      if (sheet) sheets.push(sheet);
    }
    const journalApi = journalRef.current?.api;
    if (journalApi) {
      const journalSheet = journalApi.getSheetDataForExcel({ sheetName: "Journal", columnKeys: ["journalNo", "journalDate", "account", "debits", "credits", "description", "name"] });
      if (journalSheet) sheets.push(journalSheet);
    }
    if (sheets.length > 0) api.exportMultipleSheetsAsExcel({ data: sheets, fileName: `untangle-audit-${date}.xlsx` });
  };

  return (
    <>
      <button className="desk-button" onClick={doExport} disabled={!gridReady} title="Export a Summary sheet plus one sheet per business statement"><FileCheck2 size={13} />Export audit pack</button>
      <div style={{ position: "absolute", left: -99999, top: 0, width: 1200, height: 600, pointerEvents: "none" }}>
        <AgGridReact<AuditRow>
          ref={gridRef}
          onGridReady={() => setGridReady(true)}
          rowData={rows}
          columnDefs={columnDefs}
          excelStyles={excelStyles}
          getRowId={(params) => `${params.data.sheetKey}:${params.data.rowType}:${params.data.invoiceId}:${params.data.description}`}
          suppressCellFocus
          suppressContextMenu
          suppressColumnVirtualisation
        />
      </div>
      <div style={{ position: "absolute", left: -99999, top: 0, width: 1200, height: 600, pointerEvents: "none" }}>
        <AgGridReact<JournalRow>
          ref={journalRef}
          rowData={journalRows}
          columnDefs={journalColumnDefs}
          excelStyles={excelStyles}
          getRowId={(params) => `${params.data.journalNo}:${params.data.name}:${params.data.account}`}
          suppressCellFocus
          suppressContextMenu
          suppressColumnVirtualisation
        />
      </div>
    </>
  );
}
