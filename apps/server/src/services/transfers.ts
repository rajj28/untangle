import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { PayPalError, payoutAmount, toMoney } from "@untangle/paypal";
import type { PayoutItem } from "@untangle/paypal";
import { businesses, obligations, rounds, transferLegs, transfers } from "@untangle/db";
import { commitChain, unwindChain } from "@untangle/executor";
import type { PaymentLine } from "@untangle/executor";
import type { AppContext } from "../context.ts";
import type { JobResult } from "../jobs.ts";
import { DomainError } from "../errors.ts";
import { makeExecutorDeps } from "../adapters/executor-deps.ts";
import { syncObligations } from "./obligations.ts";
import { getRound } from "./rounds.ts";
import { resolveCheckoutApprovals } from "../agents/runs.ts";

export type TransferView = Awaited<ReturnType<typeof getRound>>["transfers"][number] & { roundId: string };

type Tx = Parameters<Parameters<AppContext["db"]["transaction"]>[0]>[0];

const PAYABLE = ["ready", "awaiting_payer", "pending_paypal"];
const FINISHED = ["committed", "unwound", "failed"];

interface TransferRow {
  id: string;
  roundId: string;
  payerId: string;
  payeeId: string;
  amountMinor: number;
  currency: string;
  instrument: string | null;
  status: string;
  paypalOrderId: string | null;
  paypalCaptureId: string | null;
  payoutBatchId: string | null;
  payoutItemId: string | null;
}

async function findTransfer(ctx: AppContext, transferId: string): Promise<TransferRow> {
  const [transfer] = await ctx.db.select().from(transfers).where(eq(transfers.id, transferId)).limit(1);
  if (transfer === undefined) throw new DomainError(404, "TRANSFER_NOT_FOUND", "Transfer was not found");
  return transfer;
}

async function transferView(ctx: AppContext, transferId: string): Promise<TransferView> {
  const transfer = await findTransfer(ctx, transferId);
  const round = await getRound(ctx, transfer.roundId);
  const view = round.transfers.find((item) => item.id === transferId);
  if (view === undefined) throw new Error("transfer missing from round view");
  return { ...view, roundId: transfer.roundId };
}

async function withOrderLocks<T>(ctx: AppContext, transferIds: readonly string[], action: () => Promise<T>, index = 0): Promise<T> {
  const transferId = transferIds[index];
  if (transferId === undefined) return action();
  return ctx.locks.run(`order:${transferId}`, () => withOrderLocks(ctx, transferIds, action, index + 1));
}

/** The invoice payments a transfer settles, in chain order. */
async function legLines(ctx: AppContext, transferId: string): Promise<PaymentLine[]> {
  const legs = await ctx.db.select({
    obligationId: transferLegs.obligationId,
    invoiceId: obligations.paypalInvoiceId,
    owner: obligations.creditorId,
    currency: obligations.currency,
    amountMinor: transferLegs.amountMinor,
  }).from(transferLegs).innerJoin(obligations, eq(transferLegs.obligationId, obligations.id))
    .where(eq(transferLegs.transferId, transferId)).orderBy(asc(transferLegs.position));
  return legs.map((leg) => {
    if (leg.invoiceId === null) throw new Error(`transfer obligation ${leg.obligationId} has no PayPal invoice`);
    return { ...leg, invoiceId: leg.invoiceId };
  });
}

/** A round is over once every transfer has finished, paid or not; unpaid debt goes to the next round. */
async function closeRoundIfFinished(tx: Tx, roundId: string, now: Date): Promise<boolean> {
  const rows = await tx.select({ status: transfers.status }).from(transfers).where(eq(transfers.roundId, roundId));
  if (!rows.every((row) => FINISHED.includes(row.status))) return false;
  const closed = await tx.update(rounds).set({ status: "closed", updatedAt: now })
    .where(and(eq(rounds.id, roundId), eq(rounds.status, "settling"))).returning({ id: rounds.id });
  return closed.length > 0;
}

export async function createCheckoutOrder(ctx: AppContext, transferId: string): Promise<{ orderId: string; clientId: string; amountMinor: number; currency: string }> {
  return ctx.locks.run(`order:${transferId}`, async () => {
    let transfer = await findTransfer(ctx, transferId);
    const [round] = await ctx.db.select().from(rounds).where(eq(rounds.id, transfer.roundId)).limit(1);
    if (round === undefined) throw new DomainError(404, "ROUND_NOT_FOUND", "Round was not found");
    if (round.status !== "settling" || !["ready", "awaiting_payer"].includes(transfer.status)) {
      throw new DomainError(409, "TRANSFER_NOT_PAYABLE", "Transfer is not ready for checkout");
    }
    const clientId = await ctx.paypal.clientIdFor(transfer.payeeId);
    if (transfer.paypalOrderId !== null) {
      return { orderId: transfer.paypalOrderId, clientId, amountMinor: transfer.amountMinor, currency: transfer.currency };
    }
    const legs = await ctx.db.select({ obligationId: transferLegs.obligationId }).from(transferLegs).where(eq(transferLegs.transferId, transferId));
    const order = await (await ctx.paypal.forBusiness(transfer.payeeId)).orders.create({
      intent: "CAPTURE",
      purchase_units: [{
        reference_id: transferId,
        custom_id: transfer.roundId,
        description: `Untangle chain settlement: settles ${legs.length} invoice(s)`,
        amount: toMoney(transfer.amountMinor, transfer.currency),
      }],
    }, { idempotencyKey: `order-${transferId}` });
    const changed = await ctx.db.update(transfers).set({
      paypalOrderId: order.id,
      instrument: "checkout",
      status: "awaiting_payer",
      updatedAt: ctx.now(),
    }).where(and(eq(transfers.id, transferId), inArray(transfers.status, ["ready", "awaiting_payer"]), isNull(transfers.paypalOrderId))).returning({ id: transfers.id });
    if (changed.length === 0) {
      transfer = await findTransfer(ctx, transferId);
      if (transfer.paypalOrderId === null) throw new DomainError(409, "TRANSFER_NOT_PAYABLE", "Transfer changed while creating the order");
      return { orderId: transfer.paypalOrderId, clientId, amountMinor: transfer.amountMinor, currency: transfer.currency };
    }
    await ctx.bus.emit(`transfer:${transferId}`, "transfer.order_created", { transferId, orderId: order.id });
    return { orderId: order.id, clientId, amountMinor: transfer.amountMinor, currency: transfer.currency };
  });
}

export async function captureCheckout(ctx: AppContext, transferId: string, orderId: string): Promise<TransferView> {
  const transfer = await findTransfer(ctx, transferId);
  if (transfer.paypalOrderId !== orderId) throw new DomainError(422, "ORDER_MISMATCH", "Order does not match this transfer");
  if (FINISHED.includes(transfer.status)) return transferView(ctx, transferId);
  const order = await (await ctx.paypal.forBusiness(transfer.payeeId)).orders.capture(orderId, { idempotencyKey: `capture-${transferId}` });
  const capture = order.purchase_units?.[0]?.payments?.captures?.[0];
  if (capture?.id === undefined) throw new Error("PayPal capture response did not include a capture id");
  const changed = await ctx.db.update(transfers).set({
    paypalCaptureId: capture.id,
    status: "pending_paypal",
    updatedAt: ctx.now(),
  }).where(and(eq(transfers.id, transferId), inArray(transfers.status, ["ready", "awaiting_payer"]))).returning({ id: transfers.id });
  if (changed.length > 0) await ctx.bus.emit(`transfer:${transferId}`, "transfer.captured", { transferId, captureId: capture.id });
  if (capture.status === "COMPLETED") await commitTransfer(ctx, transferId, capture.id);
  // PayPal's webhook normally finishes a held capture; this check covers one that never arrives.
  else await ctx.jobs.schedule("transfer.reconcile", { transferId }, 60_000);
  return transferView(ctx, transferId);
}

/** Asks PayPal how a capture that wasn't complete at the time is doing now. */
export async function reconcileCheckout(ctx: AppContext, transferId: string): Promise<JobResult> {
  const transfer = await findTransfer(ctx, transferId);
  if (!PAYABLE.includes(transfer.status) || transfer.paypalOrderId === null) return { done: true };
  const order = await (await ctx.paypal.forBusiness(transfer.payeeId)).orders.get(transfer.paypalOrderId);
  const capture = order.purchase_units?.[0]?.payments?.captures?.[0];
  if (capture?.id !== undefined && capture.status === "COMPLETED") return commitTransfer(ctx, transferId, capture.id, true);
  if (capture?.status === "DECLINED" || capture?.status === "FAILED") {
    await markTransferFailed(ctx, transfer);
    return { done: true };
  }
  return { retryInMs: 10 * 60_000 };
}

export async function commitTransfer(ctx: AppContext, transferId: string, proofRef: string, fromJob = false): Promise<JobResult> {
  return ctx.locks.run(`commit:${transferId}`, async () => {
    const transfer = await findTransfer(ctx, transferId);
    if (!PAYABLE.includes(transfer.status)) {
      // PayPal says money moved for a transfer we already gave up on, so a person has to look.
      if (transfer.status === "failed") {
        await ctx.bus.emit(`transfer:${transferId}`, "transfer.needs_attention", { transferId, proofRef, problems: ["PayPal confirmed a payment for a failed transfer"] });
      }
      return { done: true };
    }
    const lines = await legLines(ctx, transferId);
    const outcome = await commitChain(transferId, proofRef, lines, makeExecutorDeps(ctx, `transfer:${transferId}`));
    if (outcome.status === "retry_later") {
      if (fromJob) return { retryInMs: 30_000 };
      await ctx.jobs.schedule("transfer.commit", { transferId, proofRef }, 30_000);
      return { done: true };
    }
    if (outcome.status === "needs_attention") {
      await ctx.bus.emit(`transfer:${transferId}`, "transfer.needs_attention", { transferId, problems: outcome.problems });
      await syncObligations(ctx, lines.map((line) => line.obligationId));
      return { done: true };
    }

    const committed = await ctx.db.transaction(async (tx) => {
      const updated = await tx.update(transfers).set({ status: "committed", updatedAt: ctx.now() })
        .where(and(eq(transfers.id, transferId), inArray(transfers.status, PAYABLE))).returning({ id: transfers.id });
      if (updated.length === 0) return { changed: false, roundClosed: false };
      for (const payment of outcome.payments) {
        await tx.update(transferLegs).set({ status: "recorded", paypalPaymentId: payment.paymentId })
          .where(and(eq(transferLegs.transferId, transferId), eq(transferLegs.obligationId, payment.obligationId), eq(transferLegs.status, "pending")));
      }
      return { changed: true, roundClosed: await closeRoundIfFinished(tx, transfer.roundId, ctx.now()) };
    });
    if (committed.changed) {
      await ctx.bus.emit(`transfer:${transferId}`, "transfer.committed", { transferId, proofRef, payments: outcome.payments });
      await resolveCheckoutApprovals(ctx, transferId, transfer.instrument ?? "paypal");
      if (committed.roundClosed) await ctx.bus.emit(`round:${transfer.roundId}`, "round.closed", { roundId: transfer.roundId });
    }
    await syncObligations(ctx, lines.map((line) => line.obligationId));
    return { done: true };
  });
}

export async function unwindTransfer(ctx: AppContext, transferId: string, fromJob = false): Promise<JobResult> {
  return ctx.locks.run(`commit:${transferId}`, async () => {
    const transfer = await findTransfer(ctx, transferId);
    if (transfer.status !== "committed") return { done: true };
    const lines = await legLines(ctx, transferId);
    const outcome = await unwindChain(transferId, lines, makeExecutorDeps(ctx, `transfer:${transferId}`));
    if (outcome.status === "retry_later") {
      if (fromJob) return { retryInMs: 30_000 };
      await ctx.jobs.schedule("transfer.unwind", { transferId }, 30_000);
      return { done: true };
    }
    if (outcome.status === "needs_attention") {
      await ctx.bus.emit(`transfer:${transferId}`, "transfer.needs_attention", { transferId, problems: outcome.problems });
      await syncObligations(ctx, lines.map((line) => line.obligationId));
      return { done: true };
    }
    // An unwound transfer is finished too: its invoices are owed again and the next round picks them up.
    const unwound = await ctx.db.transaction(async (tx) => {
      const updated = await tx.update(transfers).set({ status: "unwound", updatedAt: ctx.now() })
        .where(and(eq(transfers.id, transferId), eq(transfers.status, "committed"))).returning({ id: transfers.id });
      if (updated.length === 0) return { changed: false, roundClosed: false };
      await tx.update(transferLegs).set({ status: "compensated" })
        .where(and(eq(transferLegs.transferId, transferId), eq(transferLegs.status, "recorded")));
      return { changed: true, roundClosed: await closeRoundIfFinished(tx, transfer.roundId, ctx.now()) };
    });
    if (unwound.changed) {
      await ctx.bus.emit(`transfer:${transferId}`, "transfer.unwound", { transferId });
      if (unwound.roundClosed) await ctx.bus.emit(`round:${transfer.roundId}`, "round.closed", { roundId: transfer.roundId });
    }
    await syncObligations(ctx, lines.map((line) => line.obligationId));
    return { done: true };
  });
}

export async function startPayouts(ctx: AppContext, roundId: string, payerId: string) {
  return ctx.locks.run(`payouts:${roundId}:${payerId}`, async () => {
    const [knownRound] = await ctx.db.select({ id: rounds.id }).from(rounds).where(eq(rounds.id, roundId)).limit(1);
    if (knownRound === undefined) throw new DomainError(404, "ROUND_NOT_FOUND", "Round was not found");
    const eligible = await ctx.db.select({ id: transfers.id }).from(transfers).where(and(
      eq(transfers.roundId, roundId), eq(transfers.payerId, payerId), inArray(transfers.status, ["ready", "awaiting_payer"]),
      sql`(${transfers.paypalOrderId} is null or ${transfers.instrument} = 'payouts')`,
    ));
    if (eligible.length === 0) throw new DomainError(409, "NOTHING_TO_PAY", "There are no transfers to pay out");
    return withOrderLocks(ctx, eligible.map((transfer) => transfer.id).sort(), async () => {
      const [round] = await ctx.db.select().from(rounds).where(eq(rounds.id, roundId)).limit(1);
      if (round === undefined) throw new DomainError(404, "ROUND_NOT_FOUND", "Round was not found");
      const payoutTransfers = await ctx.db.select().from(transfers).where(and(
        eq(transfers.roundId, roundId), eq(transfers.payerId, payerId), inArray(transfers.status, ["ready", "awaiting_payer"]),
        sql`(${transfers.paypalOrderId} is null or ${transfers.instrument} = 'payouts')`,
      ));
      if (payoutTransfers.length === 0) throw new DomainError(409, "NOTHING_TO_PAY", "There are no transfers to pay out");
      const recipients = await ctx.db.select({ id: businesses.id, email: businesses.email }).from(businesses)
        .where(inArray(businesses.id, [...new Set(payoutTransfers.map((item) => item.payeeId))]));
      const emailById = new Map(recipients.map((row) => [row.id, row.email]));
      try {
        const batch = await (await ctx.paypal.forBusiness(payerId)).payouts.create({
          sender_batch_header: { sender_batch_id: `untangle-${roundId}-${payerId}`, email_subject: "You have a payment from Untangle" },
          items: payoutTransfers.map((transfer) => {
            const receiver = emailById.get(transfer.payeeId);
            if (receiver === undefined) throw new Error(`payee ${transfer.payeeId} has no business email`);
            return {
              recipient_type: "EMAIL" as const,
              receiver,
              amount: payoutAmount(transfer.amountMinor, transfer.currency),
              sender_item_id: transfer.id,
              note: "Untangle chain settlement",
            };
          }),
        });
        const batchId = batch.batch_header.payout_batch_id;
        // PayPal has accepted the batch, so nothing below may throw it away: record what still
        // matches and flag the rest, whose payout webhooks still find them by sender_item_id.
        const updated = await ctx.db.transaction(async (tx) => {
          const changed: string[] = [];
          for (const transfer of payoutTransfers) {
            const row = await tx.update(transfers).set({ payoutBatchId: batchId, instrument: "payouts", status: "pending_paypal", updatedAt: ctx.now() })
              .where(and(eq(transfers.id, transfer.id), inArray(transfers.status, ["ready", "awaiting_payer"]), sql`(${transfers.paypalOrderId} is null or ${transfers.instrument} = 'payouts')`))
              .returning({ id: transfers.id });
            if (row.length > 0) changed.push(transfer.id);
          }
          return changed;
        });
        for (const id of updated) await ctx.bus.emit(`transfer:${id}`, "transfer.payout_sent", { transferId: id, batchId });
        if (updated.length > 0) await ctx.jobs.schedule("round.follow_payouts", { roundId, since: ctx.now().toISOString() }, 15_000);
        const unmatched = payoutTransfers.map((transfer) => transfer.id).filter((id) => !updated.includes(id));
        if (unmatched.length > 0) {
          await ctx.bus.emit(`round:${roundId}`, "round.needs_attention", {
            roundId, payerId, batchId, problems: [`payout batch ${batchId} includes transfers that changed meanwhile: ${unmatched.join(", ")}`],
          });
        }
      } catch (error) {
        if (error instanceof PayPalError && error.code === "DUPLICATE_SENDER_BATCH_ID") {
          await ctx.bus.emit(`round:${roundId}`, "round.needs_attention", { roundId, payerId, code: error.code });
          throw new DomainError(409, "PAYOUT_ALREADY_SENT", "This payout batch was already sent");
        }
        throw error;
      }
      return getRound(ctx, roundId);
    });
  });
}

/**
 * Payout items settle on PayPal's schedule. Their webhook normally reports the result; this check covers
 * a server PayPal cannot reach: often at first, then every few minutes, for at most a day.
 */
export async function followPayouts(ctx: AppContext, roundId: string, since: string): Promise<JobResult> {
  const round = await refreshPayouts(ctx, roundId);
  const pending = round.transfers.some((transfer) => transfer.instrument === "payouts" && transfer.status === "pending_paypal");
  const age = ctx.now().getTime() - new Date(since).getTime();
  if (!pending || !(age < 24 * 3_600_000)) return { done: true };
  return { retryInMs: age < 10 * 60_000 ? 20_000 : 5 * 60_000 };
}

export async function refreshPayouts(ctx: AppContext, roundId: string) {
  const payoutRows = await ctx.db.select().from(transfers).where(and(eq(transfers.roundId, roundId), isNotNull(transfers.payoutBatchId)));
  const batches = new Map<string, string>();
  for (const transfer of payoutRows) if (transfer.payoutBatchId !== null) batches.set(transfer.payoutBatchId, transfer.payerId);
  for (const [batchId, payerId] of batches) {
    const batch = await (await ctx.paypal.forBusiness(payerId)).payouts.getBatch(batchId);
    for (const item of batch.items ?? []) {
      const senderItemId = item.payout_item?.sender_item_id;
      if (senderItemId === undefined) continue;
      const [transfer] = await ctx.db.select().from(transfers).where(and(eq(transfers.roundId, roundId), eq(transfers.id, senderItemId))).limit(1);
      if (transfer === undefined) continue;
      await ctx.db.update(transfers).set({ payoutItemId: item.payout_item_id, updatedAt: ctx.now() })
        .where(and(eq(transfers.id, transfer.id), inArray(transfers.status, ["pending_paypal", "committed"])));
      await applyPayoutStatus(ctx, transfer, item);
    }
  }
  return getRound(ctx, roundId);
}

export async function handlePayoutItem(ctx: AppContext, businessId: string, payoutItemId: string): Promise<void> {
  const item = await (await ctx.paypal.forBusiness(businessId)).payouts.getItem(payoutItemId);
  const senderItemId = item.payout_item?.sender_item_id;
  const [transfer] = senderItemId === undefined
    ? await ctx.db.select().from(transfers).where(eq(transfers.payoutItemId, payoutItemId)).limit(1)
    : await ctx.db.select().from(transfers).where(eq(transfers.id, senderItemId)).limit(1);
  if (transfer === undefined) return;
  await ctx.db.update(transfers).set({ payoutItemId: item.payout_item_id, updatedAt: ctx.now() })
    .where(and(eq(transfers.id, transfer.id), inArray(transfers.status, ["pending_paypal", "committed"])));
  await applyPayoutStatus(ctx, transfer, item);
}

async function applyPayoutStatus(ctx: AppContext, transfer: TransferRow, item: PayoutItem): Promise<void> {
  const status = item.transaction_status ?? "";
  if (status === "SUCCESS") {
    await commitTransfer(ctx, transfer.id, item.payout_item_id);
    return;
  }
  if (status === "UNCLAIMED") {
    await ctx.bus.emit(`transfer:${transfer.id}`, "transfer.unclaimed", { transferId: transfer.id, payoutItemId: item.payout_item_id });
    return;
  }
  if (["FAILED", "BLOCKED", "DENIED", "CANCELED"].includes(status)) {
    await markTransferFailed(ctx, transfer);
    return;
  }
  if (["RETURNED", "REFUNDED", "REVERSED"].includes(status)) {
    // Each is a no-op in the wrong state, so the row read before this call can be stale.
    await unwindTransfer(ctx, transfer.id);
    await markTransferFailed(ctx, transfer);
  }
}

async function markTransferFailed(ctx: AppContext, transfer: TransferRow): Promise<void> {
  await ctx.locks.run(`commit:${transfer.id}`, async () => {
    const result = await ctx.db.transaction(async (tx) => {
      const changed = await tx.update(transfers).set({ status: "failed", updatedAt: ctx.now() })
        .where(and(eq(transfers.id, transfer.id), inArray(transfers.status, PAYABLE))).returning({ id: transfers.id });
      if (changed.length === 0) return { changed: false, roundClosed: false };
      return { changed: true, roundClosed: await closeRoundIfFinished(tx, transfer.roundId, ctx.now()) };
    });
    if (result.changed) {
      await ctx.bus.emit(`transfer:${transfer.id}`, "transfer.failed", { transferId: transfer.id });
      if (result.roundClosed) await ctx.bus.emit(`round:${transfer.roundId}`, "round.closed", { roundId: transfer.roundId });
    }
  });
}
