import type { Obligation } from "./types.ts";

/** Rejects input the engine cannot settle safely. Throws TypeError on the first problem. */
export function validateObligations(obligations: readonly Obligation[]): void {
  const seen = new Set<string>();
  let total = 0;
  for (const o of obligations) {
    if (typeof o.id !== "string" || o.id === "") throw new TypeError("obligation id must be a non-empty string");
    if (seen.has(o.id)) throw new TypeError(`duplicate obligation id: ${o.id}`);
    seen.add(o.id);
    if (typeof o.debtor !== "string" || o.debtor === "" || typeof o.creditor !== "string" || o.creditor === "") {
      throw new TypeError(`obligation ${o.id}: debtor and creditor must be non-empty strings`);
    }
    if (o.debtor === o.creditor) throw new TypeError(`obligation ${o.id}: a party cannot owe itself`);
    if (!Number.isSafeInteger(o.amount) || o.amount <= 0) {
      throw new TypeError(`obligation ${o.id}: amount must be a positive integer of minor units`);
    }
    total += o.amount;
    if (!Number.isSafeInteger(total)) throw new TypeError("total amount exceeds the safe integer range");
  }
}
