import { describe, expect, it } from "vitest";
import { businessPosition } from "../src/business.ts";
import type { ObligationView } from "../src/types.ts";

function obligation(overrides: Partial<ObligationView>): ObligationView {
  return {
    id: "obligation-1", debtorId: "cafe", debtorName: "Corner Cafe", creditorId: "bakery", creditorName: "Rosa's Bakery",
    description: "Supplies", amountMinor: 10000, outstandingMinor: 10000, currency: "USD", status: "invoiced",
    paypalInvoiceId: "INV-1", protected: false, dueOn: null, ...overrides,
  };
}

describe("businessPosition", () => {
  it("sums amounts owed, owed to the business, and net position", () => {
    const rows = [
      obligation({ id: "a", outstandingMinor: 5000 }),
      obligation({ id: "b", debtorId: "mill", creditorId: "cafe", outstandingMinor: 3200 }),
      obligation({ id: "c", debtorId: "cafe", creditorId: "mill", outstandingMinor: 9900, status: "cancelled" }),
    ];
    expect(businessPosition(rows, "cafe")).toEqual({ owesMinor: 5000, owedMinor: 3200, netMinor: -1800 });
  });
});
