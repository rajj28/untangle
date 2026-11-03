import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { agentRuns, approvals, events, jobs, obligations, operations, rounds, transfers, webhookInbox } from "@untangle/db";
import { requestApproval, startRun } from "../src/agents/runs.ts";
import { DbOperationLog } from "../src/adapters/operation-log.ts";
import { PayPalInvoiceGateway } from "../src/adapters/invoice-gateway.ts";
import { consentSignature, decryptSecret, encryptSecret } from "../src/crypto.ts";
import { loadConfig } from "../src/config.ts";
import { captureCheckout, createCheckoutOrder, followPayouts, refreshPayouts, startPayouts } from "../src/services/transfers.ts";
import { executeRound, getRound, planRound, recordConsent } from "../src/services/rounds.ts";
import { mainStreetInvoices } from "../src/seed/main-street.ts";
import { seedNetwork } from "../src/seed/seed.ts";
import { makeTestContext } from "./context.ts";

const masterKey = Buffer.from("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", "hex");

async function consentAndExecute(ctx: Awaited<ReturnType<typeof makeTestContext>>["ctx"], network: string, ids: { bakery: string; mill: string; trucker: string }) {
  let round = await planRound(ctx, network);
  for (const businessId of [ids.bakery, ids.mill, ids.trucker]) round = await recordConsent(ctx, round.id, businessId);
  const result = await executeRound(ctx, round.id);
  return { round: await getRound(ctx, round.id), result };
}

async function settleRound(ctx: Awaited<ReturnType<typeof makeTestContext>>["ctx"], ids: { bakery: string; mill: string; trucker: string; network: string }) {
  return consentAndExecute(ctx, ids.network, ids);
}

function paypalHeaders(signature = "valid-sig") {
  return {
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-cert-url": "https://example.test/cert",
    "paypal-transmission-id": "transmission-1",
    "paypal-transmission-sig": signature,
    "paypal-transmission-time": "2026-10-29T00:00:00Z",
    "content-type": "application/json",
  };
}

async function checkoutAll(test: Awaited<ReturnType<typeof makeTestContext>>) {
  const { ctx } = test;
  const round = await settleRound(ctx, test.ids);
  for (const transfer of round.round.transfers) {
    const order = await createCheckoutOrder(ctx, transfer.id);
    await captureCheckout(ctx, transfer.id, order.orderId);
  }
  return getRound(ctx, round.round.id);
}

async function runMainStreetEndToEnd(test: Awaited<ReturnType<typeof makeTestContext>>) {
  let round = await planRound(test.ctx, test.ids.network);
  for (const businessId of Object.values(test.businessesBySlot)) round = await recordConsent(test.ctx, round.id, businessId);
  expect(await test.ctx.jobs.runDue()).toBe(1);
  round = await getRound(test.ctx, round.id);

  const cafeId = test.businessesBySlot[4]!;
  const dairyId = test.businessesBySlot[5]!;
  const cleaningId = test.businessesBySlot[8]!;
  const accountingId = test.businessesBySlot[9]!;
  const cafeTransfers = round.transfers.filter((transfer) => transfer.payerId === cafeId);
  expect(cafeTransfers).toHaveLength(2);
  for (const transfer of cafeTransfers) {
    const response = await test.app.inject({ method: "POST", url: `/api/sim/transfers/${transfer.id}/approve` });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("committed");
  }
  const dairyTransfer = round.transfers.find((transfer) => transfer.payerId === dairyId && transfer.payeeId === accountingId)!;
  expect(round.transfers.some((transfer) => transfer.payerId === cafeId && transfer.payeeId === cleaningId)).toBe(true);
  await test.app.inject({ method: "POST", url: `/api/rounds/${round.id}/payouts`, payload: { payerId: dairyId } });
  const payout = await test.app.inject({ method: "POST", url: `/api/sim/transfers/${dairyTransfer.id}/payout/SUCCESS` });
  expect(payout.statusCode).toBe(200);
  return getRound(test.ctx, round.id);
}

describe("server", () => {
  it("encrypts secrets and binds stable consent signatures", () => {
    const blob = encryptSecret("paypal-secret", masterKey);
    expect(decryptSecret(blob, masterKey)).toBe("paypal-secret");
    expect(() => decryptSecret(blob, Buffer.alloc(32, 9))).toThrow("secret could not be decrypted");
    const tampered = Buffer.from(blob);
    tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 1;
    expect(() => decryptSecret(tampered, masterKey)).toThrow("secret could not be decrypted");
    const signature = consentSignature(masterKey, "round", "business", "hash");
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(signature).toBe(createHmac("sha256", masterKey).update("round:business:hash").digest("hex"));
    expect(consentSignature(masterKey, "round", "business", "hash")).toBe(signature);
  });

  it("loads PayPal business slots and reports all invalid config cases", () => {
    const env = {
      DATABASE_URL: "postgres://db",
      MASTER_KEY: masterKey.toString("hex"),
      PAYPAL_BIZ_2_NAME: "Mill",
      PAYPAL_BIZ_2_EMAIL: "mill@example.test",
      PAYPAL_BIZ_2_CLIENT_ID: "mill-client",
      PAYPAL_BIZ_2_CLIENT_SECRET: "mill-secret",
      PAYPAL_BIZ_1_NAME: "Bakery",
      PAYPAL_BIZ_1_EMAIL: "bakery@example.test",
      PAYPAL_BIZ_1_CLIENT_ID: "bakery-client",
      PAYPAL_BIZ_1_CLIENT_SECRET: "bakery-secret",
    };
    const config = loadConfig(env);
    expect(config.businesses.map((business) => business.slot)).toEqual([1, 2]);
    expect(config.businesses[0]?.clientId).toBe("bakery-client");
    expect(() => loadConfig({ ...env, MASTER_KEY: "a".repeat(63) })).toThrow(/MASTER_KEY/);
    expect(() => loadConfig({ ...env, PAYPAL_BIZ_3_NAME: "Trucker" })).toThrow(/PAYPAL_BIZ_3/);
    expect(() => loadConfig({ ...env, PAYPAL_BIZ_3_NAME: "Duplicate", PAYPAL_BIZ_3_EMAIL: "bakery@example.test", PAYPAL_BIZ_3_CLIENT_ID: "x", PAYPAL_BIZ_3_CLIENT_SECRET: "y" })).toThrow(/duplicates/);
  });

  it("persists and upserts executor operations", async () => {
    const { ctx } = await makeTestContext();
    const log = new DbOperationLog(ctx.db);
    await log.put({ key: "leg:transfer:obligation", status: "in_flight", attempts: 1, ref: null, error: null });
    expect(await log.get("leg:transfer:obligation")).toEqual({ key: "leg:transfer:obligation", status: "in_flight", attempts: 1, ref: null, error: null });
    await log.put({ key: "leg:transfer:obligation", status: "succeeded", attempts: 2, ref: "EXTR-7", error: null });
    expect(await log.get("leg:transfer:obligation")).toEqual({ key: "leg:transfer:obligation", status: "succeeded", attempts: 2, ref: "EXTR-7", error: null });
    const [row] = await ctx.db.select().from(operations).where(eq(operations.idemKey, "leg:transfer:obligation"));
    expect(row?.kind).toBe("leg");
    expect(row?.refId).toBe("transfer:obligation");
  });

  it("maps PayPal invoices and treats paid invoices without due_amount as zero due", async () => {
    const test = await makeTestContext();
    const gateway = new PayPalInvoiceGateway(test.ctx.paypal);
    await gateway.record(test.ids.mill, test.ids.invoiceA, { amountMinor: 500, currency: "USD", date: "2026-10-29", note: "gateway test" });
    const invoice = await gateway.get(test.ids.mill, test.ids.invoiceA);
    expect(invoice.dueMinor).toBe(2500);
    expect(invoice.payments).toEqual([{ paymentId: "EXTR-1", amountMinor: 500, note: "gateway test" }]);
    const fakeRegistry = {
      forBusiness: async () => ({
        invoicing: {
          get: async () => ({ id: "paid", status: "MARKED_AS_PAID", detail: { currency_code: "USD" }, amount: { currency_code: "USD", value: "10.00" } }),
        },
      }),
    } as unknown as ConstructorParameters<typeof PayPalInvoiceGateway>[0];
    expect((await new PayPalInvoiceGateway(fakeRegistry).get("owner", "paid")).dueMinor).toBe(0);
  });

  it("plans loop setoffs, chain transfers and signed statements", async () => {
    const test = await makeTestContext();
    const view = await planRound(test.ctx, test.ids.network);
    expect(view.setoffs.map((row) => [row.obligationId, row.amountMinor]).sort()).toEqual([[test.ids.a, 2400], [test.ids.b, 2400], [test.ids.c, 2400]].sort());
    expect(view.transfers.map((transfer) => `${transfer.payerId}->${transfer.payeeId}:${transfer.amountMinor}`).sort()).toEqual([
      `${test.ids.bakery}->${test.ids.mill}:200`,
      `${test.ids.trucker}->${test.ids.mill}:400`,
    ].sort());
    expect(view.statements).toHaveLength(3);
    expect(view.statements.every((statement) => /^[0-9a-f]{64}$/.test(statement.statementHash))).toBe(true);
    await expect(planRound(test.ctx, test.ids.network)).rejects.toMatchObject({ status: 409, code: "ROUND_IN_PROGRESS" });
  });

  it("hashes an identical settlement plan deterministically", async () => {
    const test = await makeTestContext();
    const first = await planRound(test.ctx, test.ids.network);
    await test.ctx.db.update(rounds).set({ status: "failed" }).where(eq(rounds.id, first.id));
    const second = await planRound(test.ctx, test.ids.network);
    expect(second.planHash).toBe(first.planHash);
  });

  it("records three consents and executes the setoffs", async () => {
    const test = await makeTestContext();
    let round = await planRound(test.ctx, test.ids.network);
    for (const businessId of [test.ids.bakery, test.ids.mill, test.ids.trucker]) round = await recordConsent(test.ctx, round.id, businessId);
    expect(round.status).toBe("executing");
    const queued = await test.ctx.db.select().from(jobs).where(eq(jobs.kind, "round.execute"));
    expect(queued).toHaveLength(1);
    const result = await executeRound(test.ctx, round.id);
    expect(result).toEqual({ done: true });
    round = await getRound(test.ctx, round.id);
    expect(round.status).toBe("settling");
    expect(round.transfers.every((transfer) => transfer.status === "ready")).toBe(true);
    expect(test.sim.invoice(test.ids.invoiceA)).toMatchObject({ status: "PARTIALLY_PAID", dueMinor: 600 });
    expect(test.sim.invoice(test.ids.invoiceB)).toMatchObject({ status: "MARKED_AS_PAID", dueMinor: 0 });
    expect(test.sim.invoice(test.ids.invoiceC)).toMatchObject({ status: "PARTIALLY_PAID", dueMinor: 400 });
    const rows = await test.ctx.db.select().from(obligations);
    expect(rows.map((row) => [row.id, row.outstandingMinor, row.status]).sort()).toEqual([
      [test.ids.a, 600, "partially_settled"], [test.ids.b, 0, "settled"], [test.ids.c, 400, "partially_settled"],
    ].sort());
  });

  it("aborts and compensates when an invoice is cancelled", async () => {
    const test = await makeTestContext();
    test.sim.cancelInvoice(test.ids.invoiceB);
    let round = await planRound(test.ctx, test.ids.network);
    for (const businessId of [test.ids.bakery, test.ids.mill, test.ids.trucker]) round = await recordConsent(test.ctx, round.id, businessId);
    const result = await executeRound(test.ctx, round.id);
    expect(result).toEqual({ done: true });
    const failed = await getRound(test.ctx, round.id);
    expect(failed.status).toBe("failed");
    expect(failed.setoffs.every((setoff) => setoff.status === "failed")).toBe(true);
    for (const invoiceId of [test.ids.invoiceA, test.ids.invoiceB, test.ids.invoiceC]) expect(test.sim.invoice(invoiceId).payments).toHaveLength(0);
  });

  it("settles transfers through checkout and records every invoice leg", async () => {
    const test = await makeTestContext();
    const round = await settleRound(test.ctx, test.ids);
    const first = round.round.transfers[0]!;
    const order = await createCheckoutOrder(test.ctx, first.id);
    expect(order.clientId).toBe("client-mill");
    await captureCheckout(test.ctx, first.id, order.orderId);
    const refreshed = await getRound(test.ctx, round.round.id);
    const next = refreshed.transfers.find((transfer) => transfer.status === "ready")!;
    const nextOrder = await createCheckoutOrder(test.ctx, next.id);
    await captureCheckout(test.ctx, next.id, nextOrder.orderId);
    const finalRound = await getRound(test.ctx, round.round.id);
    expect(finalRound.status).toBe("closed");
    expect(finalRound.transfers.every((transfer) => transfer.status === "committed")).toBe(true);
    expect(finalRound.transfers.every((transfer) => transfer.legs.every((leg) => leg.status === "recorded" && leg.paypalPaymentId !== null))).toBe(true);
    const rows = await test.ctx.db.select().from(obligations);
    expect(rows.every((row) => row.outstandingMinor === 0 && row.status === "settled")).toBe(true);
    for (const invoiceId of [test.ids.invoiceA, test.ids.invoiceB, test.ids.invoiceC]) expect(test.sim.invoice(invoiceId).status).toBe("MARKED_AS_PAID");
  });

  it("keeps repeated checkout capture idempotent", async () => {
    const test = await makeTestContext();
    const round = await settleRound(test.ctx, test.ids);
    const transfer = round.round.transfers[0]!;
    const order = await createCheckoutOrder(test.ctx, transfer.id);
    const first = await captureCheckout(test.ctx, transfer.id, order.orderId);
    const counts = [test.ids.invoiceA, test.ids.invoiceB, test.ids.invoiceC].map((id) => test.sim.invoice(id).payments.length);
    const second = await captureCheckout(test.ctx, transfer.id, order.orderId);
    expect(second.status).toBe("committed");
    expect(second.status).toBe(first.status);
    expect([test.ids.invoiceA, test.ids.invoiceB, test.ids.invoiceC].map((id) => test.sim.invoice(id).payments.length)).toEqual(counts);
  });

  it("unwinds a refunded capture, reopens its invoices and frees the network for the next round", async () => {
    const test = await makeTestContext();
    const closed = await checkoutAll(test);
    const transfer = closed.transfers[0]!;
    const captureId = transfer.paypalCaptureId!;
    const response = await test.app.inject({
      method: "POST",
      url: `/webhooks/paypal/${transfer.payeeId}`,
      headers: paypalHeaders(),
      payload: JSON.stringify({
        id: "EV-REFUND-1",
        event_type: "PAYMENT.CAPTURE.REFUNDED",
        resource: { id: "REFUND-1", links: [{ rel: "up", href: `https://api-m.sandbox.paypal.com/v2/payments/captures/${captureId}` }] },
      }),
    });
    expect(response.statusCode).toBe(200);
    const view = await getRound(test.ctx, closed.id);
    const unwound = view.transfers.find((item) => item.id === transfer.id)!;
    expect(unwound.status).toBe("unwound");
    expect(view.status).toBe("closed");
    for (const leg of transfer.legs) {
      const obligation = (await test.ctx.db.select().from(obligations).where(eq(obligations.id, leg.obligationId)))[0]!;
      expect(obligation.outstandingMinor).toBe(leg.amountMinor);
      const invoiceId = obligation.paypalInvoiceId!;
      expect(test.sim.invoice(invoiceId).payments.some((payment) => payment.note.includes(`[untangle:leg:${transfer.id}:${leg.obligationId}]`))).toBe(false);
    }
    // The reopened chain is exactly what the next round settles.
    const next = await planRound(test.ctx, test.ids.network);
    expect(next.transfers.map((item) => [item.payerId, item.payeeId, item.amountMinor])).toEqual([[transfer.payerId, transfer.payeeId, transfer.amountMinor]]);
  });

  it("counts each payment once when PayPal's invoice webhooks land mid-settlement", async () => {
    const test = await makeTestContext();
    const owners = new Map([[test.ids.invoiceA, test.ids.mill], [test.ids.invoiceB, test.ids.trucker], [test.ids.invoiceC, test.ids.bakery]]);
    let delivered = 0;
    test.sim.onPaymentRecorded(async (invoiceId) => {
      const response = await test.app.inject({
        method: "POST",
        url: `/webhooks/paypal/${owners.get(invoiceId)}`,
        headers: paypalHeaders(),
        payload: JSON.stringify({ id: `EV-INVOICE-${++delivered}`, event_type: "INVOICING.INVOICE.UPDATED", resource: { invoice: { id: invoiceId } } }),
      });
      expect(response.statusCode).toBe(200);
    });
    const settled = await checkoutAll(test);
    expect(delivered).toBe(6);
    expect(settled.status).toBe("closed");
    const rows = await test.ctx.db.select().from(obligations);
    expect(rows.every((row) => row.outstandingMinor === 0 && row.status === "settled")).toBe(true);
    const inbox = await test.ctx.db.select({ error: webhookInbox.error }).from(webhookInbox);
    expect(inbox.every((row) => row.error === null)).toBe(true);
  });

  it("closes a round once every transfer has finished, failed payouts included", async () => {
    const test = await makeTestContext();
    const { round } = await settleRound(test.ctx, test.ids);
    const truckerTransfer = round.transfers.find((item) => item.payerId === test.ids.trucker)!;
    const bakeryTransfer = round.transfers.find((item) => item.payerId === test.ids.bakery)!;
    await startPayouts(test.ctx, round.id, test.ids.trucker);
    test.sim.setPayoutStatus(test.sim.payoutItemForTransfer(truckerTransfer.id), "FAILED");
    await refreshPayouts(test.ctx, round.id);
    expect((await getRound(test.ctx, round.id)).status).toBe("settling");
    const order = await createCheckoutOrder(test.ctx, bakeryTransfer.id);
    await captureCheckout(test.ctx, bakeryTransfer.id, order.orderId);
    const finished = await getRound(test.ctx, round.id);
    expect(finished.status).toBe("closed");
    expect(finished.transfers.find((item) => item.id === truckerTransfer.id)?.status).toBe("failed");
    // Nothing moved for the failed payout, so its chain is still owed and the next round takes it.
    const next = await planRound(test.ctx, test.ids.network);
    expect(next.transfers.map((item) => [item.payerId, item.payeeId, item.amountMinor])).toEqual([[test.ids.trucker, test.ids.mill, truckerTransfer.amountMinor]]);
  });

  it("starts payouts and commits a successful payout item", async () => {
    const test = await makeTestContext();
    const round = await settleRound(test.ctx, test.ids);
    const transfer = round.round.transfers.find((item) => item.payerId === test.ids.trucker)!;
    const payoutRound = await startPayouts(test.ctx, round.round.id, test.ids.trucker);
    expect(payoutRound.transfers.find((item) => item.id === transfer.id)?.status).toBe("pending_paypal");
    const itemId = test.sim.payoutItemForTransfer(transfer.id);
    test.sim.setPayoutStatus(itemId, "SUCCESS");
    const refreshed = await refreshPayouts(test.ctx, round.round.id);
    expect(refreshed.transfers.find((item) => item.id === transfer.id)?.status).toBe("committed");
  });

  it("follows a payout batch until PayPal settles it, without a webhook", async () => {
    const test = await makeTestContext();
    const round = await settleRound(test.ctx, test.ids);
    const transfer = round.round.transfers.find((item) => item.payerId === test.ids.trucker)!;
    await startPayouts(test.ctx, round.round.id, test.ids.trucker);
    const since = test.ctx.now().toISOString();
    expect(await followPayouts(test.ctx, round.round.id, since)).toEqual({ retryInMs: 20_000 });
    test.sim.setPayoutStatus(test.sim.payoutItemForTransfer(transfer.id), "SUCCESS");
    expect(await followPayouts(test.ctx, round.round.id, since)).toEqual({ done: true });
    expect((await getRound(test.ctx, round.round.id)).transfers.find((item) => item.id === transfer.id)?.status).toBe("committed");
  });

  it("closes a checkout approval when its transfer is paid by payouts instead", async () => {
    const test = await makeTestContext();
    const round = await settleRound(test.ctx, test.ids);
    const transfer = round.round.transfers.find((item) => item.payerId === test.ids.trucker)!;
    const runId = await startRun(test.ctx, test.ids.network, "cycle", "a cycle waiting on a checkout");
    await test.ctx.db.update(agentRuns).set({ status: "waiting" }).where(eq(agentRuns.id, runId));
    const approvalId = await requestApproval(test.ctx, {
      runId, networkId: test.ids.network, businessId: test.ids.trucker, agent: "treasurer", kind: "pay_checkout",
      title: "Pay with PayPal", detail: "checkout", payload: { transferId: transfer.id, roundId: round.round.id },
    });
    await startPayouts(test.ctx, round.round.id, test.ids.trucker);
    test.sim.setPayoutStatus(test.sim.payoutItemForTransfer(transfer.id), "SUCCESS");
    await refreshPayouts(test.ctx, round.round.id);
    const [approval] = await test.ctx.db.select().from(approvals).where(eq(approvals.id, approvalId));
    expect(approval).toMatchObject({ status: "executed", result: { paidBy: "payouts" } });
    expect((await test.ctx.db.select().from(agentRuns).where(eq(agentRuns.id, runId)))[0]?.status).toBe("completed");
  });

  it("rejects bad webhook signatures and deduplicates a verified event", async () => {
    const test = await makeTestContext();
    const businessId = test.ids.mill;
    const event = { id: "EV-UNKNOWN-1", event_type: "UNHANDLED.EVENT", resource: {} };
    const bad = await test.app.inject({ method: "POST", url: `/webhooks/paypal/${businessId}`, headers: paypalHeaders("bad"), payload: JSON.stringify(event) });
    expect(bad.statusCode).toBe(400);
    const first = await test.app.inject({ method: "POST", url: `/webhooks/paypal/${businessId}`, headers: paypalHeaders(), payload: JSON.stringify(event) });
    const before = await test.ctx.db.select().from(webhookInbox);
    const second = await test.app.inject({ method: "POST", url: `/webhooks/paypal/${businessId}`, headers: paypalHeaders(), payload: JSON.stringify(event) });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ duplicate: true });
    expect(first.statusCode).toBe(200);
    const after = await test.ctx.db.select().from(webhookInbox);
    expect(after).toEqual(before);
    expect(after).toHaveLength(1);
  });

  it("serializes capture and webhook writers for a transfer", async () => {
    const test = await makeTestContext();
    const round = await settleRound(test.ctx, test.ids);
    const transfer = round.round.transfers[0]!;
    const order = await createCheckoutOrder(test.ctx, transfer.id);
    const outstandingBefore = new Map((await test.ctx.db.select().from(obligations)).map((row) => [row.id, row.outstandingMinor]));
    const capture = await (await test.ctx.paypal.forBusiness(transfer.payeeId)).orders.capture(order.orderId, { idempotencyKey: `capture-${transfer.id}` });
    const captureId = capture.purchase_units?.[0]?.payments?.captures?.[0]?.id!;
    const event = {
      id: "EV-CAPTURE-RACE",
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource: { id: captureId, supplementary_data: { related_ids: { order_id: order.orderId } } },
    };
    const results = await Promise.all([
      captureCheckout(test.ctx, transfer.id, order.orderId),
      test.app.inject({ method: "POST", url: `/webhooks/paypal/${transfer.payeeId}`, headers: paypalHeaders(), payload: JSON.stringify(event) }),
    ]);
    expect(results[1].statusCode).toBe(200);
    const view = await getRound(test.ctx, round.round.id);
    expect(view.transfers.find((item) => item.id === transfer.id)?.status).toBe("committed");
    for (const leg of transfer.legs) {
      const obligation = (await test.ctx.db.select().from(obligations).where(eq(obligations.id, leg.obligationId)))[0]!;
      const invoice = test.sim.invoice(obligation.paypalInvoiceId!);
      expect(invoice.payments.filter((payment) => payment.note.includes(`[untangle:leg:${transfer.id}:${leg.obligationId}]`))).toHaveLength(1);
      expect(obligation.outstandingMinor).toBe(outstandingBefore.get(leg.obligationId)! - leg.amountMinor);
    }
  });

  it("retries a transient setoff through the durable job runner", async () => {
    const test = await makeTestContext();
    test.sim.failNext("POST", "/v2/invoicing/invoices/", 503, 50);
    const round = await planRound(test.ctx, test.ids.network);
    for (const businessId of [test.ids.bakery, test.ids.mill, test.ids.trucker]) await recordConsent(test.ctx, round.id, businessId);
    const firstAttempt = await executeRound(test.ctx, round.id);
    expect(firstAttempt).toMatchObject({ retryInMs: expect.any(Number) });
    test.sim.clearFaults();
    await test.ctx.db.update(jobs).set({ runAt: new Date(Date.now() - 1000) }).where(and(eq(jobs.kind, "round.execute"), eq(jobs.status, "queued")));
    expect(await test.ctx.jobs.runDue()).toBe(1);
    expect((await getRound(test.ctx, round.id)).status).toBe("settling");
  });

  it("serves health, planning, consent, execution and round lookup routes", async () => {
    const test = await makeTestContext();
    expect((await test.app.inject({ method: "GET", url: "/healthz" })).statusCode).toBe(200);
    const planned = await test.app.inject({ method: "POST", url: `/api/networks/${test.ids.network}/rounds` });
    expect(planned.statusCode).toBe(201);
    const roundId = planned.json().id as string;
    for (const businessId of [test.ids.bakery, test.ids.mill, test.ids.trucker]) {
      await test.app.inject({ method: "POST", url: `/api/rounds/${roundId}/consents`, payload: { businessId } });
    }
    const execution = await test.app.inject({ method: "POST", url: `/api/rounds/${roundId}/execute` });
    expect(execution.statusCode).toBe(200);
    expect(execution.json().status).toBe("settling");
    expect((await test.app.inject({ method: "GET", url: `/api/rounds/${roundId}` })).json().id).toBe(roundId);
    const missing = await test.app.inject({ method: "GET", url: "/api/rounds/00000000-0000-0000-0000-000000000000" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: "ROUND_NOT_FOUND" });
    expect((await test.app.inject({ method: "GET", url: "/api/rounds/not-a-uuid" })).statusCode).toBe(400);
  });

  it("verifies the event audit chain after checkout", async () => {
    const test = await makeTestContext();
    await checkoutAll(test);
    const response = await test.app.inject({ method: "GET", url: "/api/audit/verify" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true });
    expect(response.json().count).toBeGreaterThan(0);
  });

  it("seeds Main Street invoices with matching sent simulator invoices and obligations", async () => {
    const test = await makeTestContext({ town: "main-street" });
    const rows = await test.ctx.db.select().from(obligations).where(eq(obligations.networkId, test.ids.network));
    expect(rows).toHaveLength(25);
    for (const seed of mainStreetInvoices) {
      const row = rows.find((item) => item.description === seed.item)!;
      expect(row).toMatchObject({ amountMinor: seed.dollars * 100, outstandingMinor: seed.dollars * 100, status: "invoiced", description: seed.item });
      expect(test.sim.invoice(row.paypalInvoiceId!).status).toBe("SENT");
    }
  });

  it("makes a repeated Main Street seed idempotent", async () => {
    const test = await makeTestContext({ town: "main-street" });
    const before = await test.ctx.db.select({ id: obligations.id }).from(obligations).where(eq(obligations.networkId, test.ids.network));
    const result = await seedNetwork(test.ctx, test.ids.network, "TEST");
    const after = await test.ctx.db.select({ id: obligations.id }).from(obligations).where(eq(obligations.networkId, test.ids.network));
    expect(result).toEqual({ created: 0, skipped: 0 });
    expect(after).toHaveLength(before.length);
  });

  it("plans the expected Main Street loops and three transfers", async () => {
    const test = await makeTestContext({ town: "main-street" });
    const round = await planRound(test.ctx, test.ids.network);
    expect(round.stats).toMatchObject({ totalOwed: 2_810_000, clearedByLoops: 2_400_000, moneyMoved: 220_000 });
    const transfersBySlot = round.transfers.map((transfer) => {
      const payer = Number(Object.entries(test.businessesBySlot).find(([, id]) => id === transfer.payerId)?.[0]);
      const payee = Number(Object.entries(test.businessesBySlot).find(([, id]) => id === transfer.payeeId)?.[0]);
      return `${payer}->${payee}:${transfer.amountMinor}`;
    }).sort();
    expect(transfersBySlot).toEqual(["4->8:100000", "4->9:50000", "5->9:70000"]);
  });

  it("runs Main Street through set-off, checkout, and payout settlement", async () => {
    const test = await makeTestContext({ town: "main-street" });
    const round = await runMainStreetEndToEnd(test);
    expect(round.status).toBe("closed");
    const rows = await test.ctx.db.select().from(obligations).where(eq(obligations.networkId, test.ids.network));
    expect(rows).toHaveLength(25);
    expect(rows.every((row) => row.status === "settled" && row.outstandingMinor === 0)).toBe(true);
    expect(rows.every((row) => test.sim.invoice(row.paypalInvoiceId!).status === "MARKED_AS_PAID")).toBe(true);
    const summary = await test.app.inject({ method: "GET", url: `/api/networks/${test.ids.network}` });
    expect(summary.statusCode).toBe(200);
    expect(summary.json().totals).toMatchObject({ clearedByLoopsMinor: 2_400_000, settledByChainsMinor: 410_000, movedMinor: 220_000 });
  });

  it("resets Main Street, replans it, and keeps archived invoice webhooks final", async () => {
    const test = await makeTestContext({ town: "main-street" });
    await runMainStreetEndToEnd(test);
    const oldRows = await test.ctx.db.select().from(obligations).where(eq(obligations.networkId, test.ids.network));
    const reset = await test.app.inject({ method: "POST", url: "/api/demo/reset" });
    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toMatchObject({ networkId: test.ids.network, archived: 25, created: 25, skipped: 0 });
    const archived = await test.ctx.db.select().from(obligations).where(eq(obligations.networkId, test.ids.network));
    expect(archived.filter((row) => row.status === "cancelled")).toHaveLength(25);

    const nextRound = await planRound(test.ctx, test.ids.network);
    expect(nextRound.stats).toMatchObject({ totalOwed: 2_810_000, clearedByLoops: 2_400_000, moneyMoved: 220_000 });
    const oldInvoice = oldRows[0]!;
    const webhook = await test.app.inject({
      method: "POST",
      url: `/webhooks/paypal/${oldInvoice.creditorId}`,
      headers: paypalHeaders(),
      payload: JSON.stringify({ id: "EV-OLD-INVOICE", event_type: "INVOICING.INVOICE.UPDATED", resource: { invoice: { id: oldInvoice.paypalInvoiceId } } }),
    });
    expect(webhook.statusCode).toBe(200);
    const stillArchived = (await test.ctx.db.select().from(obligations).where(eq(obligations.id, oldInvoice.id)))[0]!;
    expect(stillArchived.status).toBe("cancelled");
  });

  it("returns later events in ascending order and respects the event limit", async () => {
    const test = await makeTestContext();
    await test.ctx.bus.emit("network:test", "test.initial", {});
    const latest = await test.app.inject({ method: "GET", url: "/api/events?limit=1" });
    const after = latest.json().events[0].seq as number;
    await test.ctx.bus.emit("network:test", "test.one", {});
    await test.ctx.bus.emit("network:test", "test.two", {});
    await test.ctx.bus.emit("network:test", "test.three", {});
    const response = await test.app.inject({ method: "GET", url: `/api/events?after=${after}&limit=2` });
    const rows = response.json().events as { seq: number; type: string }[];
    expect(rows.map((event) => event.type)).toEqual(["test.one", "test.two"]);
    expect(rows[0]!.seq).toBeLessThan(rows[1]!.seq);
    expect((await test.app.inject({ method: "GET", url: `/api/events?after=${after}&limit=1` })).json().events).toHaveLength(1);
  });

  it("returns set-off and chain payment ids in obligation history", async () => {
    const test = await makeTestContext();
    const round = await checkoutAll(test);
    expect(round.status).toBe("closed");
    const response = await test.app.inject({ method: "GET", url: `/api/obligations/${test.ids.a}/history` });
    expect(response.statusCode).toBe(200);
    const history = response.json();
    expect(history.obligation.id).toBe(test.ids.a);
    expect(history.setoffs).toHaveLength(1);
    expect(history.setoffs[0]).toMatchObject({ status: "recorded", paypalPaymentId: expect.any(String) });
    expect(history.legs.length).toBeGreaterThan(0);
    expect(history.legs.every((leg: { paypalPaymentId: string | null }) => leg.paypalPaymentId !== null)).toBe(true);
  });

  it("returns simulator config without a PayPal SDK URL", async () => {
    const test = await makeTestContext({ town: "main-street" });
    const response = await test.app.inject({ method: "GET", url: "/api/config" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ mode: "sim", demo: true, networkId: test.ids.network, paypalSdkUrl: null });
  });

  it("returns JSON for unknown API routes", async () => {
    const test = await makeTestContext();
    const response = await test.app.inject({ method: "GET", url: "/api/nope" });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "NOT_FOUND" });
  });

  it("requires the demo access code for writes when one is set, while reads and webhooks stay open", async () => {
    const test = await makeTestContext({ demoWriteToken: "judge-code-123" });
    expect((await test.app.inject({ method: "GET", url: `/api/networks/${test.ids.network}` })).statusCode).toBe(200);
    const denied = await test.app.inject({ method: "POST", url: `/api/networks/${test.ids.network}/rounds` });
    expect(denied.statusCode).toBe(401);
    expect(denied.json()).toMatchObject({ error: "ACCESS_CODE_REQUIRED" });
    const wrong = await test.app.inject({ method: "POST", url: `/api/networks/${test.ids.network}/rounds`, headers: { "x-demo-token": "judge-code-999" } });
    expect(wrong.statusCode).toBe(401);
    const allowed = await test.app.inject({ method: "POST", url: `/api/networks/${test.ids.network}/rounds`, headers: { "x-demo-token": "judge-code-123" } });
    expect(allowed.statusCode).toBe(201);
    const webhook = await test.app.inject({
      method: "POST", url: `/webhooks/paypal/${test.ids.mill}`, headers: paypalHeaders(),
      payload: JSON.stringify({ id: "EV-OPEN-1", event_type: "UNHANDLED.EVENT", resource: {} }),
    });
    expect(webhook.statusCode).toBe(200);
    expect((await test.app.inject({ method: "GET", url: "/api/config" })).json()).toMatchObject({ writeProtected: true });
  });

  it("rate limits demo resets", async () => {
    const test = await makeTestContext();
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await test.app.inject({ method: "POST", url: "/api/demo/reset" })).statusCode);
    expect(codes).toEqual([200, 200, 200, 429]);
  });

  it("finishes a capture PayPal held as pending once a later check sees it complete", async () => {
    const test = await makeTestContext();
    const { round } = await settleRound(test.ctx, test.ids);
    const transfer = round.transfers[0]!;
    test.sim.holdNextCapture();
    const order = await createCheckoutOrder(test.ctx, transfer.id);
    const held = await captureCheckout(test.ctx, transfer.id, order.orderId);
    expect(held.status).toBe("pending_paypal");
    const queued = await test.ctx.db.select().from(jobs).where(and(eq(jobs.kind, "transfer.reconcile"), eq(jobs.status, "queued")));
    expect(queued).toHaveLength(1);

    // Still pending at the first check: the job waits and tries again later.
    await test.ctx.db.update(jobs).set({ runAt: new Date(Date.now() - 1000) }).where(eq(jobs.kind, "transfer.reconcile"));
    await test.ctx.jobs.runDue();
    expect((await test.ctx.db.select().from(transfers).where(eq(transfers.id, transfer.id)))[0]?.status).toBe("pending_paypal");

    test.sim.completeCapture(order.orderId);
    await test.ctx.db.update(jobs).set({ runAt: new Date(Date.now() - 1000) }).where(and(eq(jobs.kind, "transfer.reconcile"), eq(jobs.status, "queued")));
    await test.ctx.jobs.runDue();
    expect((await test.ctx.db.select().from(transfers).where(eq(transfers.id, transfer.id)))[0]?.status).toBe("committed");
  });

  it("frees the network when a round's execution job runs out of attempts", async () => {
    const test = await makeTestContext();
    const round = await planRound(test.ctx, test.ids.network);
    for (const businessId of [test.ids.bakery, test.ids.mill, test.ids.trucker]) await recordConsent(test.ctx, round.id, businessId);
    test.ctx.jobs.register("round.execute", async () => {
      throw new Error("database unreachable");
    });
    await test.ctx.db.update(jobs).set({ attempts: 7, runAt: new Date(Date.now() - 1000) }).where(eq(jobs.kind, "round.execute"));
    await test.ctx.jobs.runDue();
    expect((await getRound(test.ctx, round.id)).status).toBe("failed");
    const types = (await test.ctx.db.select({ type: events.type }).from(events)).map((row) => row.type);
    expect(types).toContain("job.failed");
    expect(types).toContain("round.needs_attention");
    expect((await planRound(test.ctx, test.ids.network)).status).toBe("consenting");
  });
});
