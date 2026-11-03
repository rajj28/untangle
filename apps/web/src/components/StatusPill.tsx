import { Check, Circle, Clock3, Minus, TriangleAlert } from "lucide-react";

const variants: Record<string, { label: string; className: string; icon: typeof Circle; strike?: boolean }> = {
  invoiced: { label: "Invoiced", className: "status-invoiced", icon: Circle },
  partially_settled: { label: "Partially settled", className: "status-partial", icon: Clock3 },
  settled: { label: "Settled", className: "status-settled", icon: Check },
  recorded: { label: "Recorded", className: "status-settled", icon: Check },
  committed: { label: "Committed", className: "status-settled", icon: Check },
  cancelled: { label: "Cancelled", className: "status-cancelled", icon: Minus, strike: true },
  failed: { label: "Failed", className: "status-failed", icon: TriangleAlert },
  unwound: { label: "Unwound", className: "status-failed", icon: TriangleAlert },
  needs_attention: { label: "Needs attention", className: "status-failed", icon: TriangleAlert },
  pending: { label: "Pending", className: "status-pending", icon: Clock3 },
  pending_paypal: { label: "Pending PayPal", className: "status-pending", icon: Clock3 },
  awaiting_payer: { label: "Awaiting payer", className: "status-pending", icon: Clock3 },
  ready: { label: "Ready", className: "status-settled", icon: Check },
  planned: { label: "Planned", className: "status-neutral", icon: Circle },
  compensated: { label: "Compensated", className: "status-neutral", icon: Minus },
};

export function StatusPill({ status, compact = false }: { status: string; compact?: boolean }) {
  const variant = variants[status] ?? { label: status.replaceAll("_", " "), className: "status-neutral", icon: Circle };
  const Icon = variant.icon;
  return (
    <span className={`inline-flex max-w-full items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium capitalize leading-4 ${variant.className} ${variant.strike ? "status-struck" : ""}`}>
      <Icon size={11} strokeWidth={2.1} aria-hidden="true" />
      {!compact && <span className="truncate">{variant.label}</span>}
    </span>
  );
}
