import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { ArrowDownLeft, ArrowUpRight, FileClock, RotateCw } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../api.ts";
import type { BusinessSummary, DisputeObligationPayload, ObligationHistory, ObligationView } from "../../types.ts";
import { percent } from "../../money.ts";
import { Button } from "../../ui/Button.tsx";
import { Card } from "../../ui/Card.tsx";
import { CopyId } from "../../ui/CopyId.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { Money } from "../../ui/Money.tsx";
import { Segmented } from "../../ui/Segmented.tsx";
import { Sheet } from "../../ui/Sheet.tsx";
import { Skeleton } from "../../ui/Skeleton.tsx";
import { StatusPill } from "../../ui/StatusPill.tsx";
import type { ToastMessage } from "../../components/Toasts.tsx";
type InvoiceFilter = "owe" | "owed" | "settled";
type PushToast = (toast: Omit<ToastMessage, "id">) => void;

export function BusinessInvoices({ business, obligations, names, onPlan, onToast }: {
  business: BusinessSummary;
  obligations: ObligationView[];
  names: Readonly<Record<string, string>>;
  onPlan: () => void;
  onToast: PushToast;
}) {
  const [filter, setFilter] = useState<InvoiceFilter>("owe");
  const [selected, setSelected] = useState<ObligationView | null>(null);
  const scoped = useMemo(() => obligations.filter((item) => item.debtorId === business.id || item.creditorId === business.id), [business.id, obligations]);
  const counts: Record<InvoiceFilter, number> = {
    owe: scoped.filter((item) => item.debtorId === business.id && item.status !== "cancelled" && item.outstandingMinor > 0).length,
    owed: scoped.filter((item) => item.creditorId === business.id && item.status !== "cancelled" && item.outstandingMinor > 0).length,
    settled: scoped.filter((item) => item.status === "cancelled" || item.outstandingMinor === 0).length,
  };
  const rows = scoped.filter((item) => {
    if (filter === "owe") return item.debtorId === business.id && item.status !== "cancelled" && item.outstandingMinor > 0;
    if (filter === "owed") return item.creditorId === business.id && item.status !== "cancelled" && item.outstandingMinor > 0;
    return item.status === "cancelled" || item.outstandingMinor === 0;
  }).sort((a, b) => b.outstandingMinor - a.outstandingMinor || b.amountMinor - a.amountMinor);
  const counterparty = (item: ObligationView) => item.debtorId === business.id ? item.creditorName : item.debtorName;
  const segmentOptions = [
    { value: "owe", label: `You owe · ${counts.owe}`, icon: <ArrowUpRight size={15} /> },
    { value: "owed", label: `Owed to you · ${counts.owed}`, icon: <ArrowDownLeft size={15} /> },
    { value: "settled", label: `Settled · ${counts.settled}` },
  ] as const;
  return <section className="business-page-section">
    <div className="business-page-title"><span className="me-eyebrow">Your PayPal invoices</span><h1>Invoices</h1><p>Every balance comes from the invoices in your PayPal account.</p></div>
    <Segmented value={filter} options={segmentOptions} onChange={setFilter} label="Filter invoices" />
    {rows.length === 0 ? <EmptyState title={filter === "settled" ? "No settled invoices yet" : "Nothing to show here"} detail={filter === "owe" ? "Invoices you owe will appear here when they are added to the network." : filter === "owed" ? "Invoices owed to you will appear here when the network is set up." : "Settled and cancelled invoices will stay here for reference."} {...(filter === "owe" && obligations.length === 0 && onPlan !== undefined ? { action: "Plan a settlement round", onAction: onPlan } : {})} icon={<FileClock size={24} />} /> : <div className="business-invoice-list">
      {rows.map((item) => {
        const settledPercent = percent(item.amountMinor - item.outstandingMinor, item.amountMinor);
        const owedToBusiness = item.creditorId === business.id;
        return <button key={item.id} type="button" className="business-invoice-card" onClick={() => setSelected(item)} aria-label={`Open invoice with ${counterparty(item)}, ${item.description ?? "invoice"}`}>
          <span className="flex min-w-0 items-start gap-3">
            <span className={`business-invoice-icon ${owedToBusiness ? "is-owed" : "is-owe"}`} aria-hidden="true">{owedToBusiness ? <ArrowDownLeft size={17} /> : <ArrowUpRight size={17} />}</span>
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate text-base font-semibold">{counterparty(item)}</span>
              <span className="mt-1 block truncate text-sm text-soft">{item.description ?? "Business invoice"}</span>
            </span>
            <span className="shrink-0"><StatusPill status={item.status} /></span>
          </span>
          <span className="mt-4 flex items-end justify-between gap-3">
            <span className="text-left"><span className="block text-xs text-muted">Invoice amount</span><span className="mt-1 block font-semibold"><Money cents={item.amountMinor} currency={item.currency} /></span></span>
            <span className="text-right"><span className="block text-xs text-muted">Outstanding</span><span className="mt-1 block font-semibold"><Money cents={item.outstandingMinor} currency={item.currency} /></span></span>
          </span>
          <span className="mt-3 block">
            <span className="flex items-center justify-between text-xs text-muted"><span>{settledPercent.toFixed(0)}% settled</span><span><Money cents={item.amountMinor - item.outstandingMinor} currency={item.currency} /> settled</span></span>
            <span role="progressbar" aria-label={`${settledPercent.toFixed(0)} percent settled`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={settledPercent} className="business-progress-track"><span style={{ width: `${settledPercent}%` }} /></span>
          </span>
        </button>;
      })}
    </div>}
    <InvoiceHistorySheet key={selected?.id ?? "closed"} item={selected} businessId={business.id} names={names} onClose={() => setSelected(null)} onToast={onToast} />
  </section>;
}

function InvoiceHistorySheet({ item, businessId, names, onClose, onToast }: {
  item: ObligationView | null;
  businessId: string;
  names: Readonly<Record<string, string>>;
  onClose: () => void;
  onToast: PushToast;
}) {
  const queryClient = useQueryClient();
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [claimedAmount, setClaimedAmount] = useState("");
  const [reason, setReason] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [disputeError, setDisputeError] = useState<string | null>(null);
  const history = useQuery({ queryKey: ["history", item?.id], queryFn: () => api.history(item?.id ?? ""), enabled: item !== null, staleTime: Infinity });
  const retry = () => { if (item) void queryClient.invalidateQueries({ queryKey: ["history", item.id] }); };
  const dispute = useMutation({
    mutationFn: ({ obligationId, payload }: { obligationId: string; payload: DisputeObligationPayload }) =>
      api.disputeObligation(obligationId, payload),
    onSuccess: (result) => {
      setRunId(result.runId);
      setDisputeOpen(false);
      setClaimedAmount("");
      setReason("");
      setDisputeError(null);
      onToast({ kind: "success", title: "Your treasurer and theirs are negotiating from the evidence.", code: null, debugId: null });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "The amount could not be disputed.";
      setDisputeError(message);
      onToast(error instanceof ApiError
        ? { kind: "error", title: error.message, code: error.code, debugId: error.debugId }
        : { kind: "error", title: message, code: null, debugId: null });
    },
  });
  const title = item ? `${item.description ?? "Invoice"} · ${item.debtorName} to ${item.creditorName}` : "Invoice history";
  const canDispute = item !== null && item.debtorId === businessId && ["invoiced", "partially_settled"].includes(item.status);
  const submitDispute = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (item === null) return;
    const claimedAmountMinor = parseDollarAmount(claimedAmount);
    if (claimedAmountMinor === null) {
      setDisputeError("Enter an amount in dollars with up to two decimal places.");
      return;
    }
    if (reason.trim() === "") {
      setDisputeError("Tell us what happened.");
      return;
    }
    setDisputeError(null);
    dispute.mutate({
      obligationId: item.id,
      payload: { byBusinessId: businessId, claimedAmountMinor, reason: reason.trim() },
    });
  };
  return <Sheet open={item !== null} title={title} onClose={onClose} wide>
    {item && <div className="space-y-5">
      <Card className="invoice-sheet-summary">
        <div><p className="text-xs text-muted">Amount</p><p className="mt-1 text-lg font-bold"><Money cents={item.amountMinor} currency={item.currency} /></p></div>
        <div><p className="text-xs text-muted">Outstanding</p><p className="mt-1 text-lg font-bold"><Money cents={item.outstandingMinor} currency={item.currency} /></p></div>
        <StatusPill status={item.status} />
      </Card>
      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-[.08em] text-muted">PayPal invoice id</h3>
        {item.paypalInvoiceId ? <CopyId value={item.paypalInvoiceId} label="Copy PayPal invoice id" /> : <p className="text-sm text-muted">No PayPal invoice id is attached.</p>}
      </section>
      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-[.08em] text-muted">Invoice history</h3>
        {history.isLoading ? <Skeleton variant="row" count={3} /> : history.error ? <div className="rounded-lg border border-[var(--red)]/30 bg-[var(--red-tint)] p-4 text-sm text-[var(--red)]"><p>{history.error instanceof Error ? history.error.message : "Invoice history could not be loaded."}</p><Button className="mt-3" variant="secondary" onClick={retry}><RotateCw size={14} />Try again</Button></div> : history.data ? <HistoryTimeline history={history.data} names={names} /> : <p className="text-sm text-muted">No invoice history is available.</p>}
      </section>
      {canDispute && <section className="border-t line pt-4">
        {disputeOpen ? <form className="space-y-3" onSubmit={submitDispute}>
          <h3 className="text-sm font-semibold">Dispute the amount</h3>
          <label className="block text-sm font-medium">
            The amount we agreed
            <span className="mt-1 flex items-center rounded-lg border line bg-[var(--surface)] px-3">
              <span className="text-sm text-muted">$</span>
              <input
                className="w-full bg-transparent px-2 py-2 text-sm text-[var(--ink)] outline-none"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={claimedAmount}
                onChange={(event) => setClaimedAmount(event.target.value)}
                required
              />
            </span>
          </label>
          <label className="block text-sm font-medium">
            What happened
            <textarea
              className="mt-1 min-h-24 w-full rounded-lg border line bg-[var(--surface)] px-3 py-2 text-sm text-[var(--ink)] outline-none"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={300}
              required
            />
          </label>
          {disputeError !== null && <p role="alert" className="text-sm text-[var(--red)]">{disputeError}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" loading={dispute.isPending}>Send to the agents</Button>
            <Button type="button" variant="ghost" onClick={() => { setDisputeOpen(false); setDisputeError(null); }} disabled={dispute.isPending}>Cancel</Button>
          </div>
        </form> : runId !== null ? <a href="#/desk/agents" className="text-sm font-semibold text-[var(--brand)] hover:underline">Watch the negotiation</a> : <Button variant="secondary" onClick={() => setDisputeOpen(true)}>Dispute the amount</Button>}
      </section>}
    </div>}
  </Sheet>;
}

function HistoryTimeline({ history, names }: { history: ObligationHistory; names: Readonly<Record<string, string>> }) {
  const setoffs = history.setoffs.map((item) => ({
    id: `setoff:${item.roundId}`, label: `Set-off recorded in round ${short(item.roundId)}`, amount: item.amountMinor, status: item.status, ref: item.paypalPaymentId, at: item.createdAt,
  }));
  const legs = history.legs.map((item) => ({
    id: `leg:${item.transferId}`, label: `Chain payment ${names[item.payerId] ?? "Business"} to ${names[item.payeeId] ?? "Business"}${item.instrument === "payouts" ? " via PayPal Payouts" : " via PayPal checkout"}`, amount: item.amountMinor, status: item.status, ref: item.paypalPaymentId, at: "",
  }));
  const entries = [...setoffs, ...legs];
  if (entries.length === 0) return <p className="rounded-lg border line bg-[var(--surface-soft)] p-4 text-sm text-muted">No clearing activity has been recorded yet.</p>;
  return <ol className="invoice-history-list">
    {entries.map((entry) => <li key={entry.id}>
      <span className="invoice-history-marker" aria-hidden="true" />
      <div className="min-w-0 flex-1"><p className="text-sm font-medium">{entry.label}</p>{entry.at && <time className="mt-1 block text-xs text-muted">{new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(entry.at))}</time>}<div className="mt-2 flex flex-wrap items-center gap-2"><StatusPill status={entry.status} /><Money cents={entry.amount} currency={history.obligation.currency} />{entry.ref && <CopyId value={entry.ref} label="Copy PayPal payment id" />}</div></div>
    </li>)}
  </ol>;
}

function short(value: string): string { return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value; }

function parseDollarAmount(value: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const dollars = Number(match[1]);
  const cents = Number((match[2] ?? "").padEnd(2, "0"));
  const amount = dollars * 100 + cents;
  return Number.isSafeInteger(amount) ? amount : null;
}
