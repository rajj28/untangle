import { describe, expect, it } from "vitest";
import { buildGraph, layout } from "../src/views/network/graph.ts";
import type { BusinessSummary, ObligationView, RoundView } from "../src/types.ts";

const businesses: BusinessSummary[] = [
  { id: "bakery", name: "Bakery", email: "bakery@example.test", owesMinor: 0, owedMinor: 0, netMinor: 0 },
  { id: "mill", name: "Mill", email: "mill@example.test", owesMinor: 0, owedMinor: 0, netMinor: 0 },
  { id: "trucker", name: "Trucker", email: "trucker@example.test", owesMinor: 0, owedMinor: 0, netMinor: 0 },
];

function obligation(id: string, debtorId: string, creditorId: string, amountMinor: number): ObligationView {
  return {
    id,
    debtorId,
    debtorName: debtorId,
    creditorId,
    creditorName: creditorId,
    description: `Invoice ${id}`,
    amountMinor,
    outstandingMinor: amountMinor,
    currency: "USD",
    status: "invoiced",
    paypalInvoiceId: null,
    protected: false,
    dueOn: null,
  };
}

const obligations: ObligationView[] = [
  obligation("a", "bakery", "mill", 3000),
  obligation("b", "mill", "trucker", 2400),
  obligation("c", "trucker", "bakery", 2800),
];

const round: RoundView = {
  id: "round-1",
  networkId: "network-1",
  status: "recording",
  planHash: null,
  stats: null,
  setoffs: [
    { obligationId: "a", debtorId: "bakery", creditorId: "mill", amountMinor: 2400, status: "recorded", paypalPaymentId: null },
    { obligationId: "b", debtorId: "mill", creditorId: "trucker", amountMinor: 2400, status: "recorded", paypalPaymentId: null },
    { obligationId: "c", debtorId: "trucker", creditorId: "bakery", amountMinor: 2400, status: "recorded", paypalPaymentId: null },
  ],
  transfers: [{
    id: "transfer-1",
    payerId: "trucker",
    payeeId: "mill",
    amountMinor: 600,
    currency: "USD",
    instrument: "paypal",
    status: "recorded",
    paypalOrderId: null,
    paypalCaptureId: null,
    payoutBatchId: null,
    payoutItemId: null,
    legs: [
      { obligationId: "c", position: 0, amountMinor: 400, status: "recorded", paypalPaymentId: null },
      { obligationId: "a", position: 1, amountMinor: 400, status: "recorded", paypalPaymentId: null },
    ],
  }],
  statements: [],
  consents: [],
  pendingConsents: [],
};

describe("network graph model", () => {
  it("classifies loop edges before chain edges and calculates outstanding positions", () => {
    const graph = buildGraph(obligations, businesses, round);

    expect(graph.edges.map((edge) => edge.kind)).toEqual(["loop", "loop", "loop"]);
    expect(graph.edges.filter((edge) => edge.alsoChain).map((edge) => edge.id)).toEqual(["a", "c"]);
    expect(graph.nodes.map(({ id, owesMinor, owedMinor, netMinor }) => ({ id, owesMinor, owedMinor, netMinor }))).toEqual([
      { id: "bakery", owesMinor: 3000, owedMinor: 2800, netMinor: -200 },
      { id: "mill", owesMinor: 2400, owedMinor: 3000, netMinor: 600 },
      { id: "trucker", owesMinor: 2800, owedMinor: 2400, netMinor: -400 },
    ]);
  });

  it("skips cancelled obligations", () => {
    const cancelled: ObligationView = { ...obligations[0]!, id: "cancelled", status: "cancelled" };
    const graph = buildGraph([...obligations, cancelled], businesses, round);
    expect(graph.edges.map((edge) => edge.id)).toEqual(["a", "b", "c"]);
  });

  it("lays out the same graph deterministically inside its bounds", () => {
    const graph = buildGraph(obligations, businesses, round);
    const first = layout(graph.nodes, graph.edges, 640, 420);
    const second = layout(graph.nodes, graph.edges, 640, 420);

    expect(second).toEqual(first);
    for (const node of first) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.x).toBeLessThanOrEqual(640);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeLessThanOrEqual(420);
    }
  });
});
