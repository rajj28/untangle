import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { api, ApiError } from "../api.ts";
import type { PaypalSays } from "../types.ts";
import { formatMoney } from "../money.ts";

function openPayerView(url: string | null): void {
  if (!url) return;
  window.open(url, "_blank", "noopener");
}

/** Live "PayPal says" status for one obligation, fed by GET /api/obligations/:id/paypal. */
export function PaypalSaysBadge({ obligationId, currency }: { obligationId: string; currency: string }) {
  const query = useQuery({
    queryKey: ["paypal-says", obligationId],
    queryFn: () => api.obligationPaypal(obligationId),
    enabled: obligationId !== "",
    staleTime: 8_000,
  });

  if (query.isLoading) return <span className="text-[10px] text-muted">reading PayPal…</span>;
  if (query.error) {
    const error = query.error instanceof ApiError ? query.error : null;
    if (error?.status === 503 || error?.code === "PAYPAL_NOT_CONNECTED") {
      return <span className="text-[10px] text-[var(--status-pending-fg)]">PayPal not connected</span>;
    }
    return <span className="text-[10px] text-[var(--red)]">unavailable</span>;
  }
  const data: PaypalSays | undefined = query.data;
  if (!data) return <span className="text-[10px] text-muted">—</span>;
  if (!data.connected) {
    return <span className="text-[10px] text-[var(--status-pending-fg)]">{data.status === "no_invoice" ? "No PayPal invoice" : "PayPal not connected"}</span>;
  }
  const payments = data.payments.filter((p) => p.amountMinor !== null);
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className="truncate text-[10px] font-medium uppercase tracking-wide text-[var(--brand)]">{data.status?.replaceAll("_", " ")}</span>
      <span className="text-[10px] text-muted">· {payments.length} payment{payments.length === 1 ? "" : "s"}</span>
      {data.payerViewUrl && (
        <button
          type="button"
          className="shrink-0 inline-flex items-center gap-0.5 rounded border line px-1.5 py-0.5 text-[9px] font-medium text-soft hover:bg-[var(--surface-muted)]"
          onClick={(event) => { event.stopPropagation(); openPayerView(data.payerViewUrl); }}
          title="Open the payer view on PayPal"
        >
          <ExternalLink size={10} />Open on PayPal
        </button>
      )}
    </span>
  );
}

/** Full "PayPal says" detail for a ledger cell: live status, recorded set-off payments, open link. */
export function PaypalSaysCell({ obligationId, currency }: { obligationId: string; currency: string }) {
  const query = useQuery({
    queryKey: ["paypal-says", obligationId],
    queryFn: () => api.obligationPaypal(obligationId),
    enabled: obligationId !== "",
    staleTime: 8_000,
  });

  if (query.isLoading) return <span className="text-[10px] text-muted">reading PayPal…</span>;
  if (query.error) {
    const error = query.error instanceof ApiError ? query.error : null;
    if (error?.status === 503 || error?.code === "PAYPAL_NOT_CONNECTED") {
      return <span className="text-[10px] text-[var(--status-pending-fg)]">PayPal not connected</span>;
    }
    return <span className="text-[10px] text-[var(--red)]">PayPal unavailable</span>;
  }
  const data: PaypalSays | undefined = query.data;
  if (!data) return <span className="text-muted">—</span>;
  if (!data.connected) {
    return <span className="text-[10px] text-[var(--status-pending-fg)]">{data.status === "no_invoice" ? "No PayPal invoice" : "PayPal not connected"}</span>;
  }
  const paymentList = data.payments.map((payment) => `${payment.method ?? "payment"} ${payment.amountMinor !== null ? formatMoney(payment.amountMinor, currency) : ""}${payment.date ? ` · ${payment.date}` : ""}`).join(String.fromCharCode(10));
  // One line so it fits a grid row; the recorded payments are in the tooltip.
  return (
    <div className="flex min-w-0 items-center gap-1.5" title={paymentList || undefined}>
      <span className="shrink-0 rounded-sm bg-[var(--brand-tint)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--brand)]">{data.status?.replaceAll("_", " ")}</span>
      {data.payments.length > 0
        ? <span className="truncate text-[10px] tabular-nums text-muted">{data.payments.length} {data.payments.length === 1 ? "payment" : "payments"}</span>
        : data.amountMinor !== null && <span className="truncate text-[10px] tabular-nums text-muted">{formatMoney(data.amountMinor, currency)}</span>}
      {data.payerViewUrl && (
        <button
          type="button"
          className="ml-auto inline-flex shrink-0 items-center gap-0.5 rounded border line px-1.5 py-0.5 text-[9px] font-medium text-soft hover:bg-[var(--surface-muted)]"
          onClick={(event) => { event.stopPropagation(); openPayerView(data.payerViewUrl); }}
          title="Open the payer view on PayPal"
        >
          <ExternalLink size={10} />Open on PayPal
        </button>
      )}
    </div>
  );
}
