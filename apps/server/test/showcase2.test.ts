import { describe, expect, it } from "vitest";
import { planSettlement, findLoops } from "@untangle/engine";
import { executeRound, planRound, recordConsent } from "../src/services/rounds.ts";
import { makeTestContext } from "./context.ts";

describe("showcase 2", () => {
  it("serves real PayPal-says data for an obligation after a settlement round", async () => {
    const { ctx, ids, app } = await makeTestContext();
    let round = await planRound(ctx, ids.network);
    for (const businessId of [ids.bakery, ids.mill, ids.trucker]) round = await recordConsent(ctx, round.id, businessId);
    await executeRound(ctx, round.id);

    const response = await app.inject({ method: "GET", url: `/api/obligations/${ids.a}/paypal` });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.connected).toBe(true);
    expect(typeof body.status).toBe("string");
    expect(Array.isArray(body.payments)).toBe(true);
    // The live invoice on PayPal records the set-off payment with its marker.
    expect(body.payments.length).toBeGreaterThan(0);
  });

  it("computes a real recovery report from PayPal-recorded payments versus the plan", async () => {
    const { ctx, ids, app } = await makeTestContext();
    let round = await planRound(ctx, ids.network);
    for (const businessId of [ids.bakery, ids.mill, ids.trucker]) round = await recordConsent(ctx, round.id, businessId);
    await executeRound(ctx, round.id);

    const response = await app.inject({ method: "GET", url: `/api/rounds/${round.id}/recovery` });
    expect(response.statusCode).toBe(200);
    const report = response.json();
    expect(report.plannedPayments).toBe(round.setoffs.length);
    expect(report.paymentsFoundAlreadyOnPaypal).toBeGreaterThan(0);
    expect(report.paymentsResumed).toBe(report.plannedPayments);
    expect(report.paymentsRolledBack).toBe(0);
    expect(report.paidTwice).toBe(0);
  });

  it("starts an isolated judge network and closes the loop through You when one invoice is added", async () => {
    const { app, ctx } = await makeTestContext();

    const start = await app.inject({ method: "POST", url: "/api/judge/network" });
    expect(start.statusCode).toBe(200);
    const session = start.json();
    expect(session.token).toBeTruthy();
    expect(session.youBusinessId).toBeTruthy();

    const get = await app.inject({ method: "GET", url: `/api/judge/network/${session.token}` });
    expect(get.statusCode).toBe(200);
    const data = get.json();
    expect(data.network.businesses).toHaveLength(7); // six-street + You
    expect(data.network.totals.obligations).toBe(6);
    expect(data.youBusinessId).toBe(session.youBusinessId);

    // Add one invoice: You owes the first street business.
    const firstStreet = data.network.businesses.find((b: { id: string; name: string }) => b.name !== "You")!;
    const add = await app.inject({
      method: "POST",
      url: `/api/judge/network/${session.token}/obligations`,
      payload: { direction: "owe", counterpartyId: firstStreet.id, amountMinor: 10000, description: "Your invoice" },
    });
    expect(add.statusCode).toBe(200);

    // Re-read: the engine plan should now include a loop through "You".
    const after = await app.inject({ method: "GET", url: `/api/judge/network/${session.token}` });
    const fresh = after.json();
    const obligations = fresh.obligations.map((o: { id: string; debtorId: string; creditorId: string; outstandingMinor: number }) => ({
      id: o.id, debtor: o.debtorId, creditor: o.creditorId, amount: o.outstandingMinor,
    }));
    const plan = planSettlement(obligations);
    const loops = findLoops(obligations, plan.setoffs);
    const youLoop = loops.find((loop) => loop.memberIds.some((id) => {
      const o = fresh.obligations.find((item: { id: string }) => item.id === id);
      return o !== undefined && (o.debtorId === fresh.youBusinessId || o.creditorId === fresh.youBusinessId);
    }));
    expect(youLoop).toBeTruthy();
    expect(plan.stats.leverage).not.toBeNull();
  });
});
