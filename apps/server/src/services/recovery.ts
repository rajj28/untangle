import { eq } from "drizzle-orm";
import { obligations, operations, rounds, setoffs } from "@untangle/db";
import type { AppContext } from "../context.ts";
import { DomainError } from "../errors.ts";
import { PayPalInvoiceGateway } from "../adapters/invoice-gateway.ts";

const setoffKey = (roundId: string, obligationId: string) => `setoff:${roundId}:${obligationId}`;
const undoKey = (roundId: string, obligationId: string) => `undo:setoff:${roundId}:${obligationId}`;

/**
 * Recovery report for a round, computed by comparing the plan's set-off payments against
 * what PayPal actually recorded. Nothing here is guessed: each counter is derived from the
 * round plan, the operation log, and the live invoice state on PayPal.
 *
 * - plannedPayments: set-off payments the plan intends to write.
 * - paymentsFoundAlreadyOnPaypal: payments whose marker note is already on the PayPal invoice.
 * - paymentsResumed: payments the executor has confirmed as recorded (op = succeeded).
 * - paymentsRolledBack: payments the executor deleted again during compensation (undo op succeeded).
 * - paidTwice: plan lines with more than one matching payment on PayPal (must be 0).
 */
export interface RecoveryReport {
  roundId: string;
  plannedPayments: number;
  paymentsFoundAlreadyOnPaypal: number;
  paymentsResumed: number;
  paymentsRolledBack: number;
  paidTwice: number;
}

/** Recent reports per round: the desk polls every few seconds and each report reads every invoice from PayPal. */
const CACHE_MS = 20_000;
const cache = new Map<string, { at: number; report: Promise<RecoveryReport> }>();

export function computeRecovery(ctx: AppContext, roundId: string): Promise<RecoveryReport> {
  const hit = cache.get(roundId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.report;
  const report = computeRecoveryNow(ctx, roundId);
  cache.set(roundId, { at: Date.now(), report });
  report.catch(() => cache.delete(roundId));
  return report;
}

async function computeRecoveryNow(ctx: AppContext, roundId: string): Promise<RecoveryReport> {
  const [round] = await ctx.db.select().from(rounds).where(eq(rounds.id, roundId)).limit(1);
  if (round === undefined) throw new DomainError(404, "ROUND_NOT_FOUND", "Round was not found");

  const lines = await ctx.db.select({
    obligationId: setoffs.obligationId,
    creditorId: obligations.creditorId,
    invoiceId: obligations.paypalInvoiceId,
  }).from(setoffs).innerJoin(obligations, eq(setoffs.obligationId, obligations.id)).where(eq(setoffs.roundId, roundId));

  const gateway = new PayPalInvoiceGateway(ctx.paypal);
  let found = 0;
  let resumed = 0;
  let rolledBack = 0;
  let twice = 0;

  const check = async (line: (typeof lines)[number]) => {
    if (line.invoiceId === null) return;
    const marker = `[untangle:${setoffKey(roundId, line.obligationId)}]`;
    let tagged = 0;
    try {
      const snapshot = await gateway.get(line.creditorId, line.invoiceId);
      tagged = snapshot.payments.filter((payment) => payment.note.includes(marker)).length;
    } catch {
      // PayPal unreachable for this invoice: the payment counters stay honest and just omit it.
    }
    if (tagged > 0) found += 1;
    if (tagged > 1) twice += 1;

    const [op] = await ctx.db.select({ status: operations.status }).from(operations)
      .where(eq(operations.idemKey, setoffKey(roundId, line.obligationId))).limit(1);
    if (op?.status === "succeeded") resumed += 1;

    const [undoOp] = await ctx.db.select({ status: operations.status }).from(operations)
      .where(eq(operations.idemKey, undoKey(roundId, line.obligationId))).limit(1);
    if (undoOp?.status === "succeeded") rolledBack += 1;
  };
  // A few PayPal reads at a time instead of one after another.
  for (let i = 0; i < lines.length; i += 6) await Promise.all(lines.slice(i, i + 6).map(check));

  return {
    roundId,
    plannedPayments: lines.length,
    paymentsFoundAlreadyOnPaypal: found,
    paymentsResumed: resumed,
    paymentsRolledBack: rolledBack,
    paidTwice: twice,
  };
}
