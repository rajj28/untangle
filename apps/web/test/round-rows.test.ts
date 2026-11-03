import { describe, expect, it } from "vitest";
import { roundRows, settlementRowId } from "../src/round-rows.ts";
import type { ObligationView, RoundView } from "../src/types.ts";

const round: RoundView = {
  id: "round-001",
  networkId: "network-001",
  status: "settling",
  planHash: "hash-001",
  stats: { totalOwed: 6600, clearedByLoops: 4100, settledByChains: 2500, moneyMoved: 1100, leverage: 6 },
  setoffs: [
    { obligationId: "obligation-a", debtorId: "bakery", creditorId: "mill", amountMinor: 2400, status: "recorded", paypalPaymentId: "EXTR-1" },
    { obligationId: "obligation-b", debtorId: "mill", creditorId: "trucker", amountMinor: 1200, status: "pending", paypalPaymentId: null },
    { obligationId: "obligation-c", debtorId: "trucker", creditorId: "bakery", amountMinor: 500, status: "recorded", paypalPaymentId: "EXTR-2" },
  ],
  transfers: [
    { id: "transfer-1", payerId: "bakery", payeeId: "mill", amountMinor: 400, currency: "USD", instrument: "checkout", status: "ready", paypalOrderId: null, paypalCaptureId: null, payoutBatchId: null, payoutItemId: null, legs: [
      { obligationId: "obligation-d", position: 0, amountMinor: 400, status: "pending", paypalPaymentId: null },
    ] },
    { id: "transfer-2", payerId: "trucker", payeeId: "mill", amountMinor: 700, currency: "USD", instrument: "payouts", status: "pending_paypal", paypalOrderId: null, paypalCaptureId: null, payoutBatchId: "PB-1", payoutItemId: "PI-1", legs: [
      { obligationId: "obligation-e", position: 0, amountMinor: 400, status: "pending", paypalPaymentId: null },
      { obligationId: "obligation-f", position: 1, amountMinor: 300, status: "pending", paypalPaymentId: null },
    ] },
  ],
  statements: [],
  consents: [],
  pendingConsents: [],
};

const obligations: ObligationView[] = [
  ["obligation-a", "bakery", "mill"], ["obligation-b", "mill", "trucker"], ["obligation-c", "trucker", "bakery"],
  ["obligation-d", "bakery", "mill"], ["obligation-e", "trucker", "cafe"], ["obligation-f", "cafe", "mill"],
].map(([id, debtorId, creditorId]) => ({
  id: id ?? "",
  debtorId: debtorId ?? "",
  debtorName: debtorId ?? "",
  creditorId: creditorId ?? "",
  creditorName: creditorId ?? "",
  description: `Invoice ${id ?? ""}`,
  amountMinor: 1000,
  outstandingMinor: 1000,
  currency: "USD",
  status: "invoiced",
  paypalInvoiceId: `INV-${id ?? ""}`,
  protected: false,
  dueOn: null,
}));

const names = { bakery: "Bakery", mill: "Mill", trucker: "Trucker", cafe: "Cafe" };

describe("roundRows", () => {
  it("creates loop and chain paths, totals, and nested legs", () => {
    const rows = roundRows(round, names, obligations);
    expect(rows.map((row) => row.path)).toEqual([
      ["loops"], ["loops", "setoff:obligation-a"], ["loops", "setoff:obligation-b"], ["loops", "setoff:obligation-c"],
      ["chains"], ["chains", "transfer:transfer-1"], ["chains", "transfer:transfer-1", "leg:obligation-d"],
      ["chains", "transfer:transfer-2"], ["chains", "transfer:transfer-2", "leg:obligation-e"], ["chains", "transfer:transfer-2", "leg:obligation-f"],
    ]);
    expect(rows[0]?.amountMinor).toBe(4100);
    expect(rows[4]?.amountMinor).toBe(1100);
    expect(rows[6]?.path.slice(0, 2)).toEqual(rows[5]?.path);
  });

  it("keeps row ids stable for the same plan", () => {
    const first = roundRows(round, names, obligations).map(settlementRowId);
    const second = roundRows(round, names, obligations).map(settlementRowId);
    expect(first).toEqual(second);
    expect(new Set(first).size).toBe(first.length);
  });
});
