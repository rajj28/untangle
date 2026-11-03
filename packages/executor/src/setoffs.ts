import { findPayment, recordOnce, removeOnce } from "./once.ts";
import type { ExecutorDeps, PaymentLine } from "./ports.ts";

const OPEN = new Set(["SENT", "UNPAID", "PARTIALLY_PAID"]);

export type SetoffResult =
  | { readonly status: "recorded"; readonly payments: readonly { obligationId: string; paymentId: string }[] }
  | { readonly status: "aborted"; readonly problems: readonly string[] }
  | { readonly status: "compensated"; readonly problems: readonly string[] }
  | { readonly status: "retry_later"; readonly error: string }
  | { readonly status: "needs_attention"; readonly problems: readonly string[] };

export const setoffKey = (roundId: string, obligationId: string) => `setoff:${roundId}:${obligationId}`;
const undoKey = (roundId: string, obligationId: string) => `undo:setoff:${roundId}:${obligationId}`;
const ordered = (lines: readonly PaymentLine[]) =>
  [...lines].sort((a, b) => (a.obligationId < b.obligationId ? -1 : a.obligationId > b.obligationId ? 1 : 0));

/**
 * Records a round's loop set-offs on the creditors' PayPal invoices.
 *
 * All or nothing: every invoice is checked before the first write. If any write is
 * rejected, or a recorded payment cannot be confirmed, the payments already written are
 * deleted again. Transient trouble returns `retry_later` with nothing undone, so the job
 * runner can resume exactly where it stopped. Safe to call again with the same round.
 */
export async function executeSetoffs(
  roundId: string,
  lines: readonly PaymentLine[],
  deps: ExecutorDeps,
  text = "Settled by multilateral set-off",
): Promise<SetoffResult> {
  const all = ordered(lines);

  const problems: string[] = [];
  for (const line of all) {
    const op = await deps.ops.get(setoffKey(roundId, line.obligationId));
    if (op?.status === "succeeded") continue;
    let invoice;
    try {
      invoice = await deps.invoices.get(line.owner, line.invoiceId);
    } catch (error) {
      if (deps.isRetryable(error)) return { status: "retry_later", error: String(error) };
      problems.push(`${line.obligationId}: invoice ${line.invoiceId} could not be read`);
      continue;
    }
    if (findPayment(invoice, setoffKey(roundId, line.obligationId)) !== undefined) continue;
    if (!OPEN.has(invoice.status)) problems.push(`${line.obligationId}: invoice is ${invoice.status}`);
    else if (invoice.currency !== line.currency) problems.push(`${line.obligationId}: currency ${invoice.currency}, expected ${line.currency}`);
    else if (invoice.dueMinor < line.amountMinor) problems.push(`${line.obligationId}: only ${invoice.dueMinor} still due, need ${line.amountMinor}`);
  }
  if (problems.length > 0) return undo(roundId, all, deps, problems);

  const payments: { obligationId: string; paymentId: string }[] = [];
  for (const line of all) {
    const outcome = await recordOnce(setoffKey(roundId, line.obligationId), line, text, deps);
    if (outcome.kind === "retry_later") return { status: "retry_later", error: outcome.error };
    if (outcome.kind === "rejected") return undo(roundId, all, deps, [`${line.obligationId}: ${outcome.error}`]);
    payments.push({ obligationId: line.obligationId, paymentId: outcome.paymentId });
  }

  for (const line of all) {
    let invoice;
    try {
      invoice = await deps.invoices.get(line.owner, line.invoiceId);
    } catch (error) {
      if (deps.isRetryable(error)) return { status: "retry_later", error: String(error) };
      return undo(roundId, all, deps, [`${line.obligationId}: could not verify`]);
    }
    const payment = findPayment(invoice, setoffKey(roundId, line.obligationId));
    if (payment === undefined || payment.amountMinor !== line.amountMinor) {
      return undo(roundId, all, deps, [`${line.obligationId}: recorded payment missing or wrong amount`]);
    }
  }

  await deps.emit("setoffs.recorded", { roundId, payments });
  return { status: "recorded", payments };
}

/** Deletes every set-off payment this round already wrote, newest first. */
async function undo(roundId: string, all: readonly PaymentLine[], deps: ExecutorDeps, problems: string[]): Promise<SetoffResult> {
  let undid = 0;
  for (const line of [...all].reverse()) {
    const op = await deps.ops.get(setoffKey(roundId, line.obligationId));
    let paymentId = op?.status === "succeeded" ? op.ref : null;
    if (paymentId === null && op !== undefined && op.status !== "failed_permanent") {
      // An ambiguous attempt may have landed; look for its marker before deciding.
      try {
        paymentId = findPayment(await deps.invoices.get(line.owner, line.invoiceId), setoffKey(roundId, line.obligationId))?.paymentId ?? null;
      } catch (error) {
        if (deps.isRetryable(error)) return { status: "retry_later", error: String(error) };
        return { status: "needs_attention", problems: [...problems, `${line.obligationId}: could not check for a stray payment`] };
      }
    }
    if (paymentId === null) continue;
    const outcome = await removeOnce(undoKey(roundId, line.obligationId), line, paymentId, deps);
    if (outcome.kind === "retry_later") return { status: "retry_later", error: outcome.error };
    if (outcome.kind === "rejected") {
      return { status: "needs_attention", problems: [...problems, `${line.obligationId}: could not undo (${outcome.error})`] };
    }
    undid++;
  }
  await deps.emit(undid > 0 ? "setoffs.compensated" : "setoffs.aborted", { roundId, problems });
  return undid > 0 ? { status: "compensated", problems } : { status: "aborted", problems };
}
