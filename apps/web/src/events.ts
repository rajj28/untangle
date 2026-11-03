import type { BusEvent } from "./types.ts";

type NameMap = Readonly<Record<string, string>>;

function field(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" ? value : null;
}

function businessName(id: string | null, names: NameMap): string {
  return id === null ? "A business" : names[id] ?? "A business";
}

export function describeEvent(event: BusEvent, names: NameMap = {}): string {
  const payload = event.payload;
  const transferId = field(payload, "transferId");
  const roundId = field(payload, "roundId");
  switch (event.type) {
    case "network.seeded":
      return `${String(payload.created ?? 0)} invoices were added to the network.`;
    case "demo.reset":
      return "The demo network was reset with a fresh set of invoices.";
    case "demo.chaos_armed":
      return "Crash armed for the next round";
    case "demo.crashed":
      return "Server crashed on purpose after a PayPal write";
    case "round.planned":
      return "A settlement plan is ready for business review.";
    case "round.consented":
      return `${businessName(field(payload, "businessId"), names)} signed the settlement statement.`;
    case "round.ready":
      return "Every business signed. The round is recording set-offs.";
    case "round.setoffs_recorded":
      return "Invoice set-offs were recorded. Remaining debts are ready to settle.";
    case "round.retrying":
      return "The round will retry recording set-offs.";
    case "round.failed":
      return "The settlement round failed and needs review.";
    case "round.needs_attention":
      return "The settlement round needs operator attention.";
    case "round.closed":
      return "The settlement round is closed.";
    case "obligation.updated":
      return "An invoice balance changed in PayPal.";
    case "transfer.order_created":
      return `A PayPal checkout order was created${transferId ? ` for transfer ${shortId(transferId)}` : ""}.`;
    case "transfer.captured":
      return `PayPal confirmed a payment${transferId ? ` for transfer ${shortId(transferId)}` : ""}; invoice recording is underway.`;
    case "transfer.payout_sent":
      return "A payout batch was sent to PayPal.";
    case "transfer.committed":
      return `A chain payment was confirmed${transferId ? ` for transfer ${shortId(transferId)}` : ""}.`;
    case "transfer.unwound":
      return "A chain payment was reversed and its invoice balances restored.";
    case "transfer.failed":
      return "A PayPal transfer failed.";
    case "transfer.unclaimed":
      return "A PayPal payout has not been claimed yet.";
    case "transfer.needs_attention":
      return "A transfer needs operator attention.";
    default:
      if (event.type.startsWith("round.")) return `Settlement round ${roundId ? shortId(roundId) : ""} changed state.`;
      if (event.type.startsWith("transfer.")) return "A PayPal transfer changed state.";
      if (event.type.startsWith("obligation.")) return "An invoice changed state.";
      if (event.type.startsWith("setoffs.")) return "Invoice set-offs changed state.";
      if (event.type.startsWith("chain.")) return "A settlement chain changed state.";
      return "A network activity was recorded.";
  }
}

function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 5)}…${value.slice(-4)}` : value;
}
