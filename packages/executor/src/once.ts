import type { ExecutorDeps, InvoicePayment, InvoiceSnapshot, OpRecord, PaymentLine } from "./ports.ts";

/** PayPal invoice payments have no idempotency key, so every note carries the operation key. */
export const noteFor = (key: string, text: string): string => `${text} [untangle:${key}]`;

export const findPayment = (invoice: InvoiceSnapshot, key: string): InvoicePayment | undefined =>
  invoice.payments.find((p) => p.note.includes(`[untangle:${key}]`));

export type Outcome =
  | { readonly kind: "done"; readonly paymentId: string }
  | { readonly kind: "retry_later"; readonly error: string }
  | { readonly kind: "rejected"; readonly error: string };

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 500);
const backoffMs = (attempt: number): number => Math.min(4000, 250 * 2 ** attempt);

/**
 * Writes one payment onto an invoice exactly once, even across crashes and lost responses.
 *
 * The intent is saved before calling PayPal. If an earlier attempt may have reached PayPal
 * (in flight, or failed with an ambiguous error), the invoice is read first and the
 * payment is adopted if its marker is already there. Only then is it written again.
 */
export async function recordOnce(key: string, line: PaymentLine, text: string, deps: ExecutorDeps): Promise<Outcome> {
  const maxAttempts = deps.maxAttempts ?? 3;
  let op = await deps.ops.get(key);
  if (op?.status === "succeeded" && op.ref !== null) return { kind: "done", paymentId: op.ref };
  if (op?.status === "failed_permanent") return { kind: "rejected", error: op.error ?? "rejected" };

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (op !== undefined && (op.status === "in_flight" || op.status === "failed_retryable")) {
      let existing: InvoicePayment | undefined;
      try {
        existing = findPayment(await deps.invoices.get(line.owner, line.invoiceId), key);
      } catch (error) {
        if (!deps.isRetryable(error)) return reject(key, op, error, deps);
        op = await save(deps, { ...op, status: "failed_retryable", error: message(error) });
        await deps.sleep(backoffMs(attempt));
        continue;
      }
      if (existing !== undefined) {
        await save(deps, { ...op, status: "succeeded", ref: existing.paymentId, error: null });
        return { kind: "done", paymentId: existing.paymentId };
      }
    }

    op = await save(deps, { key, status: "in_flight", attempts: (op?.attempts ?? 0) + 1, ref: null, error: null });
    let paymentId: string;
    try {
      paymentId = await deps.invoices.record(line.owner, line.invoiceId, {
        amountMinor: line.amountMinor,
        currency: line.currency,
        date: deps.today(),
        note: noteFor(key, text),
      });
    } catch (error) {
      if (!deps.isRetryable(error)) return reject(key, op, error, deps);
      op = await save(deps, { ...op, status: "failed_retryable", error: message(error) });
      await deps.sleep(backoffMs(attempt));
      continue;
    }
    // Outside the try: if saving fails here the process is effectively down, and the
    // marker on the invoice lets the next run adopt this payment instead of repeating it.
    await save(deps, { ...op, status: "succeeded", ref: paymentId, error: null });
    return { kind: "done", paymentId };
  }
  return { kind: "retry_later", error: op?.error ?? "unknown error" };
}

/** Deletes a recorded payment exactly once. A payment that is already gone counts as deleted. */
export async function removeOnce(key: string, line: PaymentLine, paymentId: string, deps: ExecutorDeps): Promise<Outcome> {
  const maxAttempts = deps.maxAttempts ?? 3;
  let op = await deps.ops.get(key);
  if (op?.status === "succeeded") return { kind: "done", paymentId };
  if (op?.status === "failed_permanent") return { kind: "rejected", error: op.error ?? "rejected" };

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    op = await save(deps, { key, status: "in_flight", attempts: (op?.attempts ?? 0) + 1, ref: paymentId, error: null });
    try {
      await deps.invoices.remove(line.owner, line.invoiceId, paymentId);
    } catch (error) {
      if (!deps.isNotFound(error)) {
        if (!deps.isRetryable(error)) return reject(key, op, error, deps);
        op = await save(deps, { ...op, status: "failed_retryable", error: message(error) });
        await deps.sleep(backoffMs(attempt));
        continue;
      }
    }
    await save(deps, { ...op, status: "succeeded", error: null });
    return { kind: "done", paymentId };
  }
  return { kind: "retry_later", error: op?.error ?? "unknown error" };
}

async function save(deps: ExecutorDeps, op: OpRecord): Promise<OpRecord> {
  await deps.ops.put(op);
  return op;
}

async function reject(key: string, op: OpRecord, error: unknown, deps: ExecutorDeps): Promise<Outcome> {
  await save(deps, { ...op, key, status: "failed_permanent", error: message(error) });
  return { kind: "rejected", error: message(error) };
}
