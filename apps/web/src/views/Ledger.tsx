import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, GridApi, GridOptions, GridState, ValueFormatterParams } from "ag-grid-community";
import type { CustomCellRendererProps, CustomDetailCellRendererProps } from "ag-grid-react";
import { Check, CircleAlert, Copy, Download, LoaderCircle, Search, Sparkles } from "lucide-react";
import { api, ApiError } from "../api.ts";
import type { ObligationHistory, ObligationView } from "../types.ts";
import { formatMoney, formatLeverage } from "../money.ts";
import { findLoops, planSettlement } from "@untangle/engine";
import type { Obligation } from "@untangle/engine";
import { StatusPill } from "../components/StatusPill.tsx";
import { ProgressCell } from "../components/ProgressCell.tsx";
import { PaypalSaysCell } from "../components/PaypalSays.tsx";
import { Skeleton } from "../components/Skeleton.tsx";
import { Empty } from "../components/Empty.tsx";
import type { ThemeMode } from "../components/Header.tsx";
import { darkGridTheme, lightGridTheme } from "../theme.ts";
import type { ToastMessage } from "../components/Toasts.tsx";

type PushToast = (toast: Omit<ToastMessage, "id">) => void;

interface LedgerRow extends ObligationView {
  include?: boolean;
}

interface ScenarioStats {
  count: number;
  loopsFound: number;
  debtCleared: number;
  cashNeeded: number;
  leverage: number | null;
}

function computeStats(rows: readonly LedgerRow[]): ScenarioStats {
  const obligations: Obligation[] = rows
    .filter((row) => Boolean(row.include))
    .map((row) => ({ id: row.id, debtor: row.debtorId, creditor: row.creditorId, amount: row.amountMinor }));
  const plan = planSettlement(obligations);
  const loops = findLoops(obligations, plan.setoffs);
  return {
    count: obligations.length,
    loopsFound: loops.length,
    debtCleared: plan.stats.clearedByLoops,
    cashNeeded: plan.stats.moneyMoved,
    leverage: plan.stats.leverage,
  };
}

type IncludeCellProps = CustomCellRendererProps<LedgerRow, boolean> & {
  onToggle?: (row: LedgerRow) => void;
};

function IncludeCell(props: IncludeCellProps) {
  return (
    <span className="flex h-full items-center justify-center">
      <input
        type="checkbox"
        aria-label="Include this invoice in clearing"
        checked={Boolean(props.value)}
        onChange={() => props.onToggle?.(props.data!)}
        className="accent-[var(--brand)]"
      />
    </span>
  );
}

function statDelta(actual: number, scenario: number, currency: string): string {
  const d = scenario - actual;
  return `${d >= 0 ? "+" : "−"}${formatMoney(Math.abs(d), currency)}`;
}

function leverageDelta(actual: number | null, scenario: number | null): string {
  if (actual === null || scenario === null) return "—";
  const d = scenario - actual;
  return `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}×`;
}

function fmtLev(value: number | null): string {
  return value === null ? "—" : formatLeverage(value);
}

function ScenarioStat({ label, actual, scenario, delta }: { label: string; actual: string; scenario: string; delta?: string }) {
  return (
    <div className="min-w-0 rounded-md border line bg-[var(--surface)] px-3 py-2">
      <p className="truncate text-[9px] font-semibold uppercase tracking-[.1em] text-muted">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold tabular-nums">
        <span className="text-muted">{actual}</span>
        <span className="mx-1 text-muted">→</span>
        <span className="text-[var(--brand)]">{scenario}</span>
      </p>
      {delta !== undefined ? <p className="truncate text-[9px] text-muted">Δ {delta}</p> : <p className="truncate text-[9px] text-muted">&nbsp;</p>}
    </div>
  );
}

function StatusCell(props: CustomCellRendererProps<ObligationView>) {
  const status = props.data?.status ?? "invoiced";
  return <StatusPill status={status} />;
}

function CopyId({ value, onToast }: { value: string | null; onToast: PushToast }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="text-muted">—</span>;
  const label = value.length > 16 ? `${value.slice(0, 9)}…${value.slice(-4)}` : value;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1100);
    } catch {
      onToast({ kind: "error", title: "Could not copy this PayPal reference.", code: null, debugId: null });
    }
  };
  return (
    <span className="inline-flex min-w-0 items-center gap-1 font-mono text-[10px] text-soft" title={value}>
      <span className="truncate">{label}</span>
      <button className="shrink-0 rounded p-0.5 text-muted hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]" onClick={(event) => { event.stopPropagation(); void copy(); }} aria-label={`Copy ${value}`}>
        {copied ? <span className="text-[9px] text-[var(--brand)]">Copied</span> : <Copy size={11} />}
      </button>
    </span>
  );
}

function InvoiceCell(props: CustomCellRendererProps<ObligationView> & { onToast?: PushToast }) {
  return <CopyId value={props.data?.paypalInvoiceId ?? null} onToast={props.onToast ?? (() => undefined)} />;
}

function OutstandingCell(props: CustomCellRendererProps<ObligationView>) {
  const row = props.data;
  if (!row) return null;
  return <div className="flex w-full items-center gap-3"><span className="min-w-[82px] text-right tabular-nums">{formatMoney(row.outstandingMinor, row.currency)}</span><ProgressCell amountMinor={row.amountMinor} outstandingMinor={row.outstandingMinor} /></div>;
}

function PaypalSaysRenderer(props: CustomCellRendererProps<ObligationView>) {
  const row = props.data;
  if (!row) return null;
  return <PaypalSaysCell obligationId={row.paypalInvoiceId ? row.id : ""} currency={row.currency} />;
}

function DueCell(props: CustomCellRendererProps<ObligationView>) {
  const dueOn = props.data?.dueOn;
  if (!dueOn) return <span className="text-muted">—</span>;
  const due = new Date(`${dueOn.slice(0, 10)}T00:00:00Z`);
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const delta = Math.round((due.getTime() - todayUtc) / 86_400_000);
  const relative = delta < 0 ? `${Math.abs(delta)} ${Math.abs(delta) === 1 ? "day" : "days"} late` : delta === 0 ? "due today" : `in ${delta} days`;
  return <span className="flex min-w-0 flex-col leading-tight"><span className="tabular-nums">{dueOn.slice(0, 10)}</span><span className="text-[9px] text-muted">{relative}</span></span>;
}

type ConfirmCellProps = CustomCellRendererProps<ObligationView> & { onToast: PushToast; demo?: boolean };

function ConfirmationCell(props: ConfirmCellProps) {
  const row = props.data;
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!row) return null;
  if (row.status === "disputed") {
    return <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[var(--red)]" title={row.disputeReason ?? ""}><CircleAlert size={12} />disputed{row.disputeReason ? " · " + row.disputeReason.slice(0, 60) : ""}</span>;
  }
  const both = row.debtorConfirmedAt !== null && row.creditorConfirmedAt !== null;
  const waitingSide = !both ? (row.debtorConfirmedAt === null ? "debtor" : "creditor") : null;
  const copyLink = async () => {
    setBusy(true);
    try {
      const links = await api.confirmLinks(row.id);
      const token = waitingSide === "debtor" ? links.debtorToken : waitingSide === "creditor" ? links.creditorToken : links.debtorToken || links.creditorToken;
      const url = `${window.location.origin}${window.location.pathname}#/confirm/${encodeURIComponent(token)}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      props.onToast({ kind: "error", title: "Could not build the confirmation link.", code: null, debugId: null });
    } finally {
      setBusy(false);
    }
  };
  const requestAgain = async () => {
    setBusy(true);
    try {
      const result = await api.requestConfirmationAgain(row.id);
      props.onToast({ kind: "success", title: `Cleared the ${result.waitingSide} confirmation. Send that side its link.`, code: null, debugId: null });
    } catch {
      props.onToast({ kind: "error", title: "Could not re-request confirmation.", code: null, debugId: null });
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {both ? (
        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[var(--brand)]"><Check size={12} />both sides</span>
      ) : (
        <span className="text-[10px] text-[var(--status-pending-fg)]">waiting on {waitingSide}</span>
      )}
      {!both && (
        <button
          className="shrink-0 rounded border line px-1.5 py-0.5 text-[9px] font-medium text-soft hover:bg-[var(--surface-muted)]"
          onClick={(event) => { event.stopPropagation(); void copyLink(); }}
          disabled={busy}
          title={`Copy the ${waitingSide} confirmation link`}
        >
          {busy ? <LoaderCircle size={10} className="animate-spin" /> : copied ? "Copied" : "Copy link"}
        </button>
      )}
      {both && props.demo && (
        <button
          className="shrink-0 rounded border line px-1.5 py-0.5 text-[9px] font-medium text-muted hover:bg-[var(--surface-muted)]"
          onClick={(event) => { event.stopPropagation(); void requestAgain(); }}
          disabled={busy}
          title="Demo: clear one side's confirmation so you can record a rejection story"
        >
          {busy ? <LoaderCircle size={10} className="animate-spin" /> : "Request again"}
        </button>
      )}
    </span>
  );
}

function HistoryDetail(props: CustomDetailCellRendererProps<ObligationView> & { names: Readonly<Record<string, string>>; onToast: PushToast }) {
  const id = props.data?.id ?? "";
  const history = useQuery({ queryKey: ["history", id], queryFn: () => api.history(id), enabled: id !== "", staleTime: Infinity });
  useEffect(() => {
    if (history.error) {
      const error = history.error;
      props.onToast(error instanceof ApiError
        ? { kind: "error", title: error.message, code: error.code, debugId: error.debugId }
        : { kind: "error", title: error instanceof Error ? error.message : "Could not load invoice history.", code: null, debugId: null });
    }
  }, [history.error, props.onToast]);
  if (history.isLoading) return <div className="border-t line px-8 py-3 text-xs text-muted">Loading invoice history…</div>;
  if (history.error || !history.data) return <div className="border-t line px-8 py-3 text-xs text-[var(--red)]">Could not load invoice history.</div>;
  const data: ObligationHistory = history.data;
  const entries = [
    ...data.setoffs.map((setoff) => ({
      id: `setoff-${setoff.roundId}`,
      at: setoff.createdAt,
      title: `Set off in round ${short(setoff.roundId)}`,
      amount: setoff.amountMinor,
      status: setoff.status,
      ref: setoff.paypalPaymentId,
    })),
    ...data.legs.map((leg) => ({
      id: `${leg.transferId}-${leg.status}`,
      at: "",
      title: `Chain payment ${props.names[leg.payerId] ?? "Business"} → ${props.names[leg.payeeId] ?? "Business"} (${leg.instrument === "payouts" ? "PayPal Payouts" : "PayPal checkout"}, ${leg.transferStatus})`,
      amount: leg.amountMinor,
      status: leg.status,
      ref: leg.paypalPaymentId,
    })),
  ];
  return (
    <div className="border-t line bg-[var(--surface-soft)] px-8 py-3">
      <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted"><span className="h-px w-4 bg-[var(--line)]" />Invoice history</div>
      {entries.length === 0 ? <p className="text-xs text-muted">No clearing activity recorded yet.</p> : <div className="space-y-2">
        {entries.map((entry) => <div key={entry.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--brand)]" />
          <span className="text-soft">{entry.title}</span>
          <span className="tabular-nums font-medium">−{formatMoney(entry.amount, data.obligation.currency)}</span>
          <StatusPill status={entry.status} compact />
          {entry.ref && <code className="font-mono text-[10px] text-muted">{short(entry.ref)}</code>}
        </div>)}
      </div>}
    </div>
  );
}

function short(value: string): string {
  return value.length > 16 ? `${value.slice(0, 9)}…${value.slice(-4)}` : value;
}

export function Ledger({ rows, actingAs, theme, onToast, loading, onPlan, names, demo }: {
  rows: ObligationView[];
  actingAs: string;
  theme: ThemeMode;
  onToast: PushToast;
  loading: boolean;
  onPlan: () => void;
  names: Readonly<Record<string, string>>;
  demo?: boolean;
}) {
  const [quickFilter, setQuickFilter] = useState("");
  const [question, setQuestion] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiExplanation, setAiExplanation] = useState<string | null>(null);
  const [previousGridState, setPreviousGridState] = useState<GridState | null>(null);
  const [scenarioActive, setScenarioActive] = useState(false);
  const [scenarioRows, setScenarioRows] = useState<LedgerRow[]>([]);
  const [scenarioStats, setScenarioStats] = useState<ScenarioStats | null>(null);
  const gridRef = useRef<AgGridReact<LedgerRow>>(null);
  const detailRenderer = useMemo(() => {
    return function InvoiceHistory(props: CustomDetailCellRendererProps<ObligationView>) {
      return <HistoryDetail {...props} names={names} onToast={onToast} />;
    };
  }, [names, onToast]);
  // Cancelled invoices are history from earlier rounds or demo resets, not debt: hidden unless asked for.
  const [showCancelled, setShowCancelled] = useState(false);
  const cancelledCount = useMemo(() => rows.filter((row) => row.status === "cancelled").length, [rows]);
  const visibleRows = useMemo(() => {
    const live = showCancelled ? rows : rows.filter((row) => row.status !== "cancelled");
    return actingAs === "" ? live : live.filter((row) => row.debtorId === actingAs || row.creditorId === actingAs);
  }, [actingAs, rows, showCancelled]);
  const currency = visibleRows[0]?.currency ?? "USD";

  const actualStats = useMemo(() => computeStats(visibleRows.map((row) => ({ ...row, include: true }))), [visibleRows]);

  const makeScenarioRows = () => visibleRows.map((row) => ({ ...row, include: true }));

  const toggleScenario = () => {
    if (scenarioActive) {
      setScenarioActive(false);
      setScenarioRows([]);
      setScenarioStats(null);
    } else {
      const next = makeScenarioRows();
      setScenarioRows(next);
      try { setScenarioStats(computeStats(next)); } catch { setScenarioStats(null); }
      setScenarioActive(true);
    }
  };

  const resetScenario = () => {
    const next = makeScenarioRows();
    setScenarioRows(next);
    try { setScenarioStats(computeStats(next)); } catch { setScenarioStats(null); }
  };

  const onToggleInclude = (row: LedgerRow) => {
    const next = scenarioRows.map((r) => (r.id === row.id ? { ...r, include: !r.include } : r));
    setScenarioRows(next);
    try { setScenarioStats(computeStats(next)); } catch { /* keep current stats */ }
  };

  const onCellValueChanged = () => {
    if (!scenarioActive) return;
    const next: LedgerRow[] = [];
    gridRef.current?.api.forEachNode((node) => {
      if (node.data) next.push(node.data as LedgerRow);
    });
    setScenarioRows(next);
    try { setScenarioStats(computeStats(next)); } catch { /* invalid edit: keep current stats */ }
  };
  const columnDefs = useMemo<ColDef<LedgerRow>[]>(() => [
    {
      field: "status", headerName: "Status", width: 148, minWidth: 126, filter: "agSetColumnFilter", enableRowGroup: true,
      enableCellChangeFlash: true, cellRenderer: "agGroupCellRenderer", cellRendererParams: { innerRenderer: StatusCell },
    },
    { field: "debtorName", headerName: "From", width: 155, minWidth: 130, filter: "agSetColumnFilter", enableRowGroup: true },
    { field: "creditorName", headerName: "To", width: 155, minWidth: 130, filter: "agSetColumnFilter", enableRowGroup: true },
    { field: "description", headerName: "Description", minWidth: 170, flex: 1, filter: "agTextColumnFilter", valueFormatter: (params: ValueFormatterParams<LedgerRow>) => params.value ?? "—" },
    {
      field: "paypalInvoiceId", headerName: "PayPal invoice", width: 158, minWidth: 145,
      cellRenderer: InvoiceCell, cellRendererParams: { onToast },
    },
    {
      colId: "paypalSays",
      headerName: "PayPal says",
      width: 250,
      minWidth: 190,
      filter: false,
      sortable: false,
      cellRenderer: PaypalSaysRenderer,
    },
    {
      field: "amountMinor", headerName: "Amount", width: 126, minWidth: 112, type: "rightAligned", filter: "agNumberColumnFilter",
      valueFormatter: (params) => params.data ? formatMoney(params.value ?? 0, params.data.currency) : "",
    },
    {
      field: "outstandingMinor", headerName: "Outstanding", width: 246, minWidth: 210, enableCellChangeFlash: true,
      cellRenderer: OutstandingCell,
    },
    { field: "dueOn", headerName: "Due", width: 112, minWidth: 100, cellRenderer: DueCell, filter: "agDateColumnFilter" },
    {
      colId: "confirmation",
      headerName: "Confirmation",
      width: 174,
      minWidth: 148,
      filter: "agSetColumnFilter",
      cellRenderer: ConfirmationCell,
      cellRendererParams: { onToast, demo },
    },
  ], [onToast, demo]);

  const finalColumnDefs = useMemo<ColDef<LedgerRow>[]>(() => {
    const base = columnDefs.map((col) =>
      col.field === "amountMinor" && scenarioActive
        ? { ...col, editable: true, cellEditor: "agNumberCellEditor", enableCellChangeFlash: true }
        : col,
    ) as ColDef<LedgerRow>[];
    if (!scenarioActive) return base;
    return [
      {
        colId: "include",
        field: "include",
        headerName: "Include",
        width: 84,
        minWidth: 76,
        sortable: false,
        filter: false,
        editable: false,
        lockPosition: "left",
        cellRenderer: IncludeCell,
        cellRendererParams: { onToggle: onToggleInclude },
      },
      ...base,
    ];
  }, [columnDefs, scenarioActive, onToggleInclude]);

  const exportExcel = () => {
    const date = new Date().toISOString().slice(0, 10);
    gridRef.current?.api.exportDataAsExcel({ fileName: `untangle-ledger-${date}.xlsx` });
  };
  const onGridReady = (event: { api: GridApi<LedgerRow> }) => {
    gridRef.current?.api.setGridOption("quickFilterText", quickFilter);
    void event;
  };
  const askLedger = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const gridApi = gridRef.current?.api;
    const trimmedQuestion = question.trim();
    if (gridApi === undefined || trimmedQuestion === "" || aiLoading) return;
    setAiLoading(true);
    setAiExplanation(null);
    setPreviousGridState(null);
    try {
      const schema = gridApi.getStructuredSchema();
      const state = gridApi.getState();
      const result = await api.aiGrid({ question: trimmedQuestion, schema, state });
      gridApi.setState(result.gridState);
      setPreviousGridState(state);
      setAiExplanation(result.explanation);
    } catch (error) {
      onToast(error instanceof ApiError
        ? { kind: "error", title: error.message, code: error.code, debugId: error.debugId }
        : { kind: "error", title: error instanceof Error ? error.message : "The ledger could not answer that question.", code: null, debugId: null });
    } finally {
      setAiLoading(false);
    }
  };
  const suggestions = [
    "Invoices Corner Cafe owes, largest first",
    "Only partially settled invoices",
    "Group by creditor",
  ];
  const gridOptions: GridOptions<LedgerRow> = {
    masterDetail: true,
    isRowMaster: () => true,
    detailCellRenderer: detailRenderer,
    keepDetailRows: true,
    detailRowAutoHeight: true,
    getRowId: (params) => params.data.id,
    cellSelection: true,
    rowGroupPanelShow: "always",
    sideBar: {
      toolPanels: [
        { id: "columns", labelDefault: "Columns", labelKey: "columns", iconKey: "columns", toolPanel: "agColumnsToolPanel" },
        { id: "filters", labelDefault: "Filters", labelKey: "filters", iconKey: "filter", toolPanel: "agFiltersToolPanel" },
      ],
      defaultToolPanel: "columns",
    },
    statusBar: { statusPanels: [{ statusPanel: "agTotalAndFilteredRowCountComponent" }, { statusPanel: "agAggregationComponent" }] },
    rowHeight: 30,
    headerHeight: 34,
    quickFilterText: quickFilter,
    defaultColDef: { sortable: true, resizable: true, filter: true, floatingFilter: false, enableRowGroup: true },
    undoRedoCellEditing: true,
    undoRedoCellEditingLimit: 20,
    onCellValueChanged,
    onGridReady,
  };

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-[50px] items-center gap-3 border-b line bg-[var(--surface)] px-4">
        <div><h1 className="text-sm font-semibold tracking-tight">Invoice ledger</h1><p className="text-[10px] text-muted">{visibleRows.length} invoices <span className="mx-1">·</span> PayPal record of every debt{cancelledCount > 0 && <>
          <span className="mx-1">·</span><button className="underline-offset-2 hover:underline" onClick={() => setShowCancelled((value) => !value)}>
            {showCancelled ? "Hide" : "Show"} {cancelledCount} cancelled</button></>}</p></div>
        <div className="ml-auto flex items-center gap-2">
          <button className={`desk-button ${scenarioActive ? "desk-button-primary" : ""}`} onClick={toggleScenario} title="Edit a copy of the current invoices and see how clearing changes">
            What-if
          </button>
          {scenarioActive && <>
            <button className="desk-button" onClick={() => gridRef.current?.api.undoCellEditing()} disabled={!gridRef.current?.api.getCurrentUndoSize()}>Undo</button>
            <button className="desk-button" onClick={() => gridRef.current?.api.redoCellEditing()} disabled={!gridRef.current?.api.getCurrentRedoSize()}>Redo</button>
            <button className="desk-button" onClick={resetScenario} title="Restore the original invoice amounts and inclusions">Reset scenario</button>
          </>}
          <label className="relative hidden sm:block"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" /><input className="desk-input w-52 pl-8 text-xs" value={quickFilter} onChange={(event) => setQuickFilter(event.target.value)} placeholder="Search invoices…" /></label>
          <button className="desk-button" onClick={exportExcel} title="Export filtered rows to Excel"><Download size={14} />Export .xlsx</button>
        </div>
      </div>
      {scenarioActive && actualStats && scenarioStats && (
        <div className="grid grid-cols-2 gap-2 border-b line bg-[var(--surface-soft)] px-3 py-2 sm:grid-cols-4">
          <ScenarioStat label="Loops found" actual={String(actualStats.loopsFound)} scenario={String(scenarioStats.loopsFound)} />
          <ScenarioStat label="Debt cleared" actual={formatMoney(actualStats.debtCleared, currency)} scenario={formatMoney(scenarioStats.debtCleared, currency)} delta={statDelta(actualStats.debtCleared, scenarioStats.debtCleared, currency)} />
          <ScenarioStat label="Cash needed" actual={formatMoney(actualStats.cashNeeded, currency)} scenario={formatMoney(scenarioStats.cashNeeded, currency)} delta={statDelta(actualStats.cashNeeded, scenarioStats.cashNeeded, currency)} />
          <ScenarioStat label="Leverage" actual={fmtLev(actualStats.leverage)} scenario={fmtLev(scenarioStats.leverage)} delta={leverageDelta(actualStats.leverage, scenarioStats.leverage)} />
        </div>
      )}
      <div className="border-b line bg-[var(--surface)] px-4 py-3">
        <form className="flex flex-wrap gap-2" onSubmit={(event) => void askLedger(event)}>
          <label className="relative min-w-[220px] flex-1">
            <Sparkles size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input
              className="desk-input w-full pl-9 text-xs"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask the ledger… e.g. invoices Corner Cafe owes, largest first"
              aria-label="Ask the ledger"
            />
          </label>
          <button className="desk-button desk-button-primary" type="submit" disabled={aiLoading || loading || visibleRows.length === 0 || question.trim() === ""}>
            {aiLoading ? <LoaderCircle size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {aiLoading ? "Asking…" : "Ask"}
          </button>
        </form>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {suggestions.map((suggestion) => <button
            key={suggestion}
            type="button"
            className="rounded-full border line px-2.5 py-1 text-[10px] text-soft hover:bg-[var(--surface-muted)] disabled:opacity-50"
            onClick={() => setQuestion(suggestion)}
            disabled={aiLoading}
          >{suggestion}</button>)}
        </div>
        {aiLoading && <p role="status" className="mt-2 text-xs text-muted">Asking the ledger…</p>}
        {aiExplanation !== null && <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-[var(--brand-tint)] px-3 py-2 text-xs text-[var(--brand-strong)]">
          <p>{aiExplanation}</p>
          {previousGridState !== null && <button
            type="button"
            className="font-semibold underline underline-offset-2"
            onClick={() => {
              if (previousGridState === null) return;
              gridRef.current?.api.setState(previousGridState);
              setPreviousGridState(null);
              setAiExplanation(null);
            }}
          >Undo</button>}
        </div>}
      </div>
      {loading ? <Skeleton className="flex-1" lines={7} /> : visibleRows.length === 0 ? <Empty
        title={rows.length === 0 ? "Your ledger is ready for its first invoices" : "No invoices for this business"}
        detail={rows.length === 0 ? "Plan a settlement round once invoices arrive in this network." : "Choose another business or return to Operator view to see the full ledger."}
        action={rows.length === 0 ? "Plan a settlement round" : undefined}
        onAction={rows.length === 0 ? onPlan : undefined}
      /> : (
        <div className="ag-grid-wrap flex-1" style={{ ["--ag-background-color" as string]: "var(--surface)", ["--ag-foreground-color" as string]: "var(--ink)" }}>
          <AgGridReact<LedgerRow>
            ref={gridRef}
            rowData={scenarioActive ? scenarioRows : (visibleRows as LedgerRow[])}
            columnDefs={finalColumnDefs}
            gridOptions={gridOptions}
            theme={theme === "dark" ? darkGridTheme : lightGridTheme}
          />
        </div>
      )}
    </section>
  );
}
