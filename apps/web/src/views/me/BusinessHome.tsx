import { useCallback, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Check, CircleAlert, Clock3, Landmark, LoaderCircle, RotateCw, ShieldCheck, WalletCards } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../api.ts";
import type { AppRoute } from "../../routes.ts";
import type { BusinessSummary, BusEvent, Config, NetworkSummary, ObligationView, RoundView, TransferView } from "../../types.ts";
import { calculateLeverage } from "../../money.ts";
import { leverageLabel } from "../../leverage.ts";
import { statementLines } from "../../statement.ts";
import { describeEvent } from "../../events.ts";
import { shortDateTime } from "../../time.ts";
import type { ToastMessage } from "../../components/Toasts.tsx";
import { PayDialog } from "../../paypal/PayDialog.tsx";
import { Button } from "../../ui/Button.tsx";
import { Card } from "../../ui/Card.tsx";
import { CopyId } from "../../ui/CopyId.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { Money } from "../../ui/Money.tsx";
import { Skeleton } from "../../ui/Skeleton.tsx";
import { StatTile } from "../../ui/StatTile.tsx";
import { StatusPill } from "../../ui/StatusPill.tsx";
import { Stepper } from "../../ui/Stepper.tsx";
import { Sheet } from "../../ui/Sheet.tsx";
import { useBusinessEvents } from "./useBusinessEvents.ts";
import { StatementExplanation } from "./StatementExplanation.tsx";

type PushToast = (toast: Omit<ToastMessage, "id">) => void;

export function BusinessHome({ business, summary, obligations, events, names, config, onNavigate, onToast }: {
  business: BusinessSummary;
  summary: NetworkSummary;
  obligations: ObligationView[];
  events: BusEvent[];
  names: Readonly<Record<string, string>>;
  config: Config;
  onNavigate: (route: AppRoute) => void;
  onToast: PushToast;
}) {
  const queryClient = useQueryClient();
  const [statementOpen, setStatementOpen] = useState(false);
  const [payingTransferId, setPayingTransferId] = useState<string | null>(null);
  const roundId = summary.latestRound?.id ?? null;
  const roundQuery = useQuery({ queryKey: ["round", roundId], queryFn: () => api.round(roundId ?? ""), enabled: roundId !== null, staleTime: Infinity });
  const round = roundQuery.data;
  const statement = round?.statements.find((item) => item.businessId === business.id);
  const signed = round?.consents.find((item) => item.businessId === business.id);
  const position = useMemo(() => ({ owesMinor: business.owesMinor, owedMinor: business.owedMinor, netMinor: business.netMinor }), [business.netMinor, business.owedMinor, business.owesMinor]);
  const recent = useBusinessEvents(events, obligations, business.id, round);
  const consent = useMutation({
    mutationFn: () => api.consent(round?.id ?? "", business.id),
    onSuccess: (updated) => {
      queryClient.setQueryData(["round", updated.id], updated);
      void queryClient.invalidateQueries({ queryKey: ["network", summary.network.id] });
      onToast({ kind: "success", title: "Statement signed. Your consent is recorded for this plan.", code: null, debugId: null });
    },
    onError: (error) => onToast(errorToast(error)),
  });
  const payouts = useMutation({
    mutationFn: (payerId: string) => api.payouts(round?.id ?? "", payerId),
    onSuccess: (updated) => {
      queryClient.setQueryData(["round", updated.id], updated);
      onToast({ kind: "success", title: "PayPal Payouts batch sent for eligible transfers.", code: null, debugId: null });
    },
    onError: (error) => onToast(errorToast(error)),
  });
  const retryRound = useCallback(() => {
    if (roundId !== null) void queryClient.invalidateQueries({ queryKey: ["round", roundId] });
  }, [queryClient, roundId]);
  const retryActivity = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["history"] });
  }, [queryClient]);
  const payingTransfer = round?.transfers.find((item) => item.id === payingTransferId) ?? null;
  const netText = position.netMinor < 0
    ? `If everyone settled today, you'd pay ${formatAmount(Math.abs(position.netMinor), summary.network.currency)} in total.`
    : position.netMinor > 0
      ? `If everyone settled today, you'd receive ${formatAmount(position.netMinor, summary.network.currency)} in total.`
      : "If everyone settled today, your business would be even.";

  return <div className="business-home-stack">
    <header className="business-page-title">
      <span className="me-eyebrow"><ShieldCheck size={14} />Your position in {summary.network.name}</span>
      <h1>Good to see you, {business.name}</h1>
      <p>Here is where your business stands with the network.</p>
    </header>

    <Card className="position-card">
      <p className="text-sm font-semibold">You owe <Money cents={position.owesMinor} currency={summary.network.currency} /> <span aria-hidden="true">·</span> You’re owed <Money cents={position.owedMinor} currency={summary.network.currency} /></p>
      <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-[.08em] text-muted">Your net position</p><p className={`mt-1 text-[32px] font-bold tracking-[-.055em] tabular-nums ${position.netMinor < 0 ? "business-position-owes" : position.netMinor > 0 ? "business-position-owed" : "text-muted"}`}>
          Net <Money cents={position.netMinor} currency={summary.network.currency} sign />
        </p></div>
        <p className="max-w-[260px] text-sm leading-6 text-soft">{netText}</p>
      </div>
    </Card>

    {roundQuery.isLoading && roundId !== null ? <Card className="p-5"><Skeleton variant="text" count={4} /></Card> : roundQuery.error ? <Card className="p-5"><InlineError title="This round could not be loaded" error={roundQuery.error} onRetry={retryRound} /></Card> : statement && round ? <ThisRoundCard
      business={business} round={round} statement={statement} names={names} signed={signed !== undefined} signedAt={signed?.createdAt}
      onReview={() => setStatementOpen(true)} onSign={() => consent.mutate()} signing={consent.isPending}
      statementOpen={statementOpen} onCloseStatement={() => setStatementOpen(false)} onToast={onToast}
    /> : null}

    <PaymentsCard
      business={business} round={round} names={names} currency={summary.network.currency} onPay={setPayingTransferId}
      onPayouts={() => payouts.mutate(business.id)} payoutPending={payouts.isPending}
    />

    <Card className="business-recent-card">
      <div className="flex items-start justify-between gap-3"><div><h2 className="text-base font-semibold">Recent activity</h2><p className="mt-1 text-sm text-muted">The latest changes involving your business.</p></div><Button variant="ghost" size="sm" onClick={() => onNavigate({ kind: "business", businessId: business.id, page: "activity" })}>All activity<ArrowRight size={14} /></Button></div>
      {recent.loading ? <Skeleton variant="row" count={3} className="mt-4" /> : recent.error !== null ? <InlineError title="Recent activity could not be loaded" error={recent.error} onRetry={retryActivity} /> : recent.events.length === 0 ? <p className="mt-5 rounded-lg bg-[var(--surface-soft)] p-4 text-sm text-muted">No recent activity involving this business.</p> : <ol className="mt-4 divide-y divide-[var(--line)]">
        {recent.events.slice(0, 5).map((event) => <li key={event.seq} className="flex gap-3 py-3 first:pt-0 last:pb-0"><span className="business-activity-dot mt-2" aria-hidden="true" /><div className="min-w-0 flex-1"><p className="text-sm leading-5">{describeEvent(event, names)}</p><time className="mt-1 block text-xs text-muted" dateTime={event.at}>{shortDateTime(event.at)}</time></div></li>)}
      </ol>}
    </Card>

    <PayDialog transfer={payingTransfer} payeeName={payingTransfer ? names[payingTransfer.payeeId] ?? "the creditor" : "the creditor"} config={config} obligations={obligations} onClose={() => setPayingTransferId(null)} onRefresh={() => {
      if (roundId !== null) void queryClient.invalidateQueries({ queryKey: ["round", roundId] });
      void queryClient.invalidateQueries({ queryKey: ["network", summary.network.id] });
      void queryClient.invalidateQueries({ queryKey: ["obligations", summary.network.id] });
    }} onToast={onToast} />
  </div>;
}

function ThisRoundCard({ business, round, statement, names, signed, signedAt, onReview, onSign, signing, statementOpen, onCloseStatement, onToast }: {
  business: BusinessSummary;
  round: RoundView;
  statement: RoundView["statements"][number];
  names: Readonly<Record<string, string>>;
  signed: boolean;
  signedAt: string | Date | undefined;
  onReview: () => void;
  onSign: () => void;
  signing: boolean;
  statementOpen: boolean;
  onCloseStatement: () => void;
  onToast: PushToast;
}) {
  const body = statement.body;
  const complete = round.status === "closed";
  const current = round.status === "settling" ? 3 : round.status === "executing" ? 2 : round.status === "closed" ? 4 : 1;
  const steps = ["Planned", `Review (${round.consents.length}/${round.statements.length})`, "Recording", "Payments", "Complete"].map((label, index) => ({
    label,
    state: index < current ? "complete" as const : index === current ? "current" as const : "upcoming" as const,
  }));
  const value = body.totals.clearedMinor + body.totals.paysMinor + body.totals.receivesMinor;
  const plannedValue = round.stats?.leverage;
  const planned = typeof plannedValue === "number" ? plannedValue : typeof plannedValue === "string" && !Number.isNaN(Number(plannedValue)) ? Number(plannedValue) : null;
  const leverage = leverageLabel(calculateLeverage(value, round.stats?.moneyMoved ?? 0), round.status, planned);
  const signedLabel = signedAt === undefined ? "Signed" : `Signed ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(signedAt))}`;
  const payable = body.totals.paysMinor > 0;
  const receiving = body.totals.receivesMinor > 0;
  const canSign = round.status === "consenting" && round.pendingConsents.includes(business.id);
  return <Card className="business-round-card">
    <div className="flex items-start justify-between gap-3"><div><span className="me-eyebrow"><Clock3 size={14} />This round</span><h2 className="mt-1 text-xl font-bold">{complete ? "Settled" : "Your settlement plan"} {complete && <span className="text-[var(--brand)]">✓</span>}</h2></div><StatusPill status={round.status} /></div>
    {complete ? <p className="mt-2 text-sm leading-6 text-soft">This round is complete. Your invoice balances and PayPal payments are up to date.</p> : <>
      <div className="mt-4"><Stepper steps={steps} density="compact" /></div>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <StatTile label="Cleared with no money moving" value={<Money cents={body.totals.clearedMinor} currency={body.currency} />} detail="of your invoices" tone="brand" />
        <StatTile label={payable ? "You pay" : receiving ? "You receive" : "Your remaining balance"} value={<Money cents={payable ? body.totals.paysMinor : body.totals.receivesMinor} currency={body.currency} />} detail={payable ? "to settle the rest" : receiving ? "from the settlement" : "No payment needed"} tone={payable ? "amber" : "default"} />
      </div>
      <div className="mt-3 flex items-start gap-2 rounded-lg bg-[var(--surface-soft)] px-3 py-2.5 text-xs text-soft"><span className="font-semibold text-[var(--brand)]">{leverage.primary}</span>{leverage.secondary && <span className="text-muted">· {leverage.secondary}</span>}</div>
    </>}
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t line pt-4">
      {signed ? <span className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--brand)]"><Check size={16} />{signedLabel}</span> : <span className="text-sm text-muted">Your statement is ready to review.</span>}
      <Button variant={canSign ? "primary" : "secondary"} onClick={onReview}>{canSign ? "Review & sign" : "View statement"}<ArrowRight size={15} /></Button>
    </div>
    <Sheet open={statementOpen} title={`${business.name} · settlement statement`} onClose={onCloseStatement} wide>
      <div className="space-y-5">
        <div className="grid grid-cols-3 gap-2">
          <StatTile label="Cleared" value={<Money cents={body.totals.clearedMinor} currency={body.currency} />} />
          <StatTile label="Pays" value={<Money cents={body.totals.paysMinor} currency={body.currency} />} />
          <StatTile label="Receives" value={<Money cents={body.totals.receivesMinor} currency={body.currency} />} />
        </div>
        <section><h3 className="text-xs font-semibold uppercase tracking-[.08em] text-muted">What this means</h3>
          {statementLines(body, names, body.currency).map((line, index) => <p key={`${line.kind}-${index}`} className="statement-line"><span className="statement-line-marker" aria-hidden="true" />{line.text}</p>)}
        </section>
        <section className="border-t line pt-4"><h3 className="mb-2 text-xs font-semibold uppercase tracking-[.08em] text-muted">Statement hash</h3><CopyId value={statement.statementHash} label="Copy statement hash" /></section>
        <StatementExplanation roundId={round.id} businessId={business.id} onToast={onToast} />
        {signed ? <p role="status" className="inline-flex items-center gap-2 rounded-lg bg-[var(--brand-tint)] px-4 py-3 text-sm font-semibold text-[var(--brand-strong)]"><Check size={17} />{signedLabel}</p> : round.status === "consenting" ? <Button variant="primary" size="lg" className="w-full" onClick={onSign} loading={signing}><ShieldCheck size={18} />Sign statement</Button> : <p className="rounded-lg bg-[var(--surface-soft)] p-4 text-sm text-soft">This round is no longer accepting signatures.</p>}
      </div>
    </Sheet>
  </Card>;
}

function PaymentsCard({ business, round, names, currency, onPay, onPayouts, payoutPending }: {
  business: BusinessSummary;
  round: RoundView | undefined;
  names: Readonly<Record<string, string>>;
  currency: string;
  onPay: (id: string) => void;
  onPayouts: () => void;
  payoutPending: boolean;
}) {
  const transfers = round?.status === "settling" ? round.transfers.filter((item) => item.payerId === business.id || item.payeeId === business.id) : [];
  const payments = transfers.filter((item) => item.payerId === business.id);
  const receives = transfers.filter((item) => item.payeeId === business.id);
  const canPayout = payments.some((item) => ["ready", "awaiting_payer"].includes(item.status) && (item.paypalOrderId === null || item.instrument === "payouts"));
  return <Card className="business-payments-card">
    <div><h2 className="text-base font-semibold">Payments</h2><p className="mt-1 text-sm text-muted">Pay or receive the remaining amount in this round.</p></div>
    {transfers.length === 0 ? <p className="mt-4 rounded-lg bg-[var(--surface-soft)] p-4 text-sm text-muted">No PayPal payments are waiting for your business right now.</p> : <div className="mt-4 space-y-3">
      {payments.map((transfer) => <PayerTransfer key={transfer.id} transfer={transfer} names={names} currency={currency} onPay={() => onPay(transfer.id)} />)}
      {receives.map((transfer) => <PayeeTransfer key={transfer.id} transfer={transfer} names={names} currency={currency} />)}
    </div>}
    {canPayout && <div className="mt-4 border-t line pt-3"><Button variant="secondary" className="w-full" onClick={onPayouts} loading={payoutPending}><Landmark size={16} />Send via Payouts</Button><p className="mt-2 text-center text-xs text-muted">Sends all eligible payments for this business in one batch.</p></div>}
  </Card>;
}

function PayerTransfer({ transfer, names, currency, onPay }: { transfer: TransferView; names: Readonly<Record<string, string>>; currency: string; onPay: () => void }) {
  const reference = transfer.paypalCaptureId ?? transfer.payoutItemId ?? transfer.payoutBatchId;
  return <article className="payment-transfer-card">
    <div className="flex min-w-0 items-start justify-between gap-3"><div className="min-w-0"><p className="font-semibold">Pay {names[transfer.payeeId] ?? "the creditor"}</p><p className="mt-1 text-sm text-soft">One payment settles {transfer.legs.length} {transfer.legs.length === 1 ? "invoice" : "invoices"} along the chain.</p></div><p className="shrink-0 text-right text-lg font-bold"><Money cents={transfer.amountMinor} currency={currency} /></p></div>
    {transfer.status === "committed" ? <div role="status" className="mt-3 flex flex-wrap items-center gap-2 text-sm font-semibold text-[var(--brand)]"><Check size={16} />Paid <StatusPill status={transfer.status} />{reference && <CopyId value={reference} label="Copy PayPal reference" />}</div> : ["ready", "awaiting_payer"].includes(transfer.status) ? <Button variant="paypal" className="mt-4 w-full" onClick={onPay}><WalletCards size={16} />Pay {formatAmount(transfer.amountMinor, currency)} with PayPal</Button> : <div className="mt-3 flex items-center gap-2 text-sm text-soft"><StatusPill status={transfer.status} />{transfer.status === "pending_paypal" && <><LoaderCircle size={14} className="animate-spin" />Confirming with PayPal</>}</div>}
  </article>;
}

function PayeeTransfer({ transfer, names, currency }: { transfer: TransferView; names: Readonly<Record<string, string>>; currency: string }) {
  const reference = transfer.paypalCaptureId ?? transfer.payoutItemId;
  return <article className="payment-transfer-card">
    <div className="flex items-start justify-between gap-3"><p className="min-w-0 font-semibold">{names[transfer.payeeId] ?? "Your business"} receives {formatAmount(transfer.amountMinor, currency)} from {names[transfer.payerId] ?? "another business"}</p><ArrowDownLeft size={18} className="shrink-0 text-[var(--brand)]" /></div>
    <div className="mt-3 flex flex-wrap items-center gap-2"><StatusPill status={transfer.status} />{transfer.status === "committed" && reference && <CopyId value={reference} label="Copy PayPal reference" />}</div>
  </article>;
}

function InlineError({ title, error, onRetry }: { title: string; error: unknown; onRetry: () => void }) {
  return <div className="mt-4 rounded-lg border border-[var(--red)]/30 bg-[var(--red-tint)] p-4">
    <p className="flex items-center gap-2 text-sm font-semibold text-[var(--red)]"><CircleAlert size={16} />{title}</p>
    <p className="mt-1 text-sm text-[var(--red)]">{error instanceof Error ? error.message : "Please try again."}</p>
    <Button variant="secondary" className="mt-3" onClick={onRetry}><RotateCw size={14} />Try again</Button>
  </div>;
}

function errorToast(error: unknown): Omit<ToastMessage, "id"> {
  if (error instanceof ApiError) return { kind: "error", title: error.message, code: error.code, debugId: error.debugId };
  return { kind: "error", title: error instanceof Error ? error.message : "The request could not be completed.", code: null, debugId: null };
}

function formatAmount(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}
