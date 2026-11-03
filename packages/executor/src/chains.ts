import { recordOnce, removeOnce } from "./once.ts";
import type { ExecutorDeps, PaymentLine } from "./ports.ts";

export type ChainResult =
  | { readonly status: "committed"; readonly payments: readonly { obligationId: string; paymentId: string }[] }
  | { readonly status: "retry_later"; readonly error: string }
  | { readonly status: "needs_attention"; readonly problems: readonly string[] };

export const legKey = (transferId: string, obligationId: string) => `leg:${transferId}:${obligationId}`;
const unwindKey = (transferId: string, obligationId: string) => `unwind:${transferId}:${obligationId}`;

/**
 * Called once PayPal has confirmed a chain payment (`proofRef` is the capture or payout
 * item id). Writes the paid-off amount onto every invoice along the chain.
 *
 * The money has already moved, so nothing is undone here: transient trouble returns
 * `retry_later`, and a leg PayPal refuses is reported as `needs_attention` for a person
 * to resolve, while the other legs stay recorded.
 */
export async function commitChain(
  transferId: string,
  proofRef: string,
  legs: readonly PaymentLine[],
  deps: ExecutorDeps,
): Promise<ChainResult> {
  const payments: { obligationId: string; paymentId: string }[] = [];
  const problems: string[] = [];
  for (const leg of legs) {
    const outcome = await recordOnce(legKey(transferId, leg.obligationId), leg, `Settled through PayPal chain payment ${proofRef}`, deps);
    if (outcome.kind === "retry_later") return { status: "retry_later", error: outcome.error };
    if (outcome.kind === "rejected") problems.push(`${leg.obligationId}: ${outcome.error}`);
    else payments.push({ obligationId: leg.obligationId, paymentId: outcome.paymentId });
  }
  if (problems.length > 0) {
    await deps.emit("chain.needs_attention", { transferId, proofRef, problems });
    return { status: "needs_attention", problems };
  }
  await deps.emit("chain.committed", { transferId, proofRef, payments });
  return { status: "committed", payments };
}

export type UnwindResult =
  | { readonly status: "unwound" }
  | { readonly status: "retry_later"; readonly error: string }
  | { readonly status: "needs_attention"; readonly problems: readonly string[] };

/**
 * Reverses a committed chain after PayPal refunds or reverses its payment: deletes the
 * leg payments it wrote, newest first, so the invoices are owed again.
 */
export async function unwindChain(transferId: string, legs: readonly PaymentLine[], deps: ExecutorDeps): Promise<UnwindResult> {
  for (const leg of [...legs].reverse()) {
    const op = await deps.ops.get(legKey(transferId, leg.obligationId));
    if (op?.status !== "succeeded" || op.ref === null) continue;
    const outcome = await removeOnce(unwindKey(transferId, leg.obligationId), leg, op.ref, deps);
    if (outcome.kind === "retry_later") return { status: "retry_later", error: outcome.error };
    if (outcome.kind === "rejected") return { status: "needs_attention", problems: [`${leg.obligationId}: ${outcome.error}`] };
  }
  await deps.emit("chain.unwound", { transferId });
  return { status: "unwound" };
}
