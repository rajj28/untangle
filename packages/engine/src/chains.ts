import type { Obligation, Transfer } from "./types.ts";

const byId = (a: Obligation, b: Obligation) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Settles debt that has no loops left in it. It walks chains from net debtors to
 * net creditors; each chain becomes one payment from its first business to its
 * last, and pays off every obligation along it by the same amount. Payments with
 * the same payer and payee are merged. Money moved equals the sum of net debts,
 * the least any settlement can use.
 *
 * Throws if the input still contains a loop: run clearLoops first.
 */
export function settleChains(remaining: readonly Obligation[]): Transfer[] {
  const left = new Map<string, number>();
  const outgoing = new Map<string, Obligation[]>();
  const net = new Map<string, number>(); // owed to the party minus owed by it

  for (const o of remaining) {
    if (o.amount <= 0) continue;
    left.set(o.id, o.amount);
    const list = outgoing.get(o.debtor);
    if (list) list.push(o);
    else outgoing.set(o.debtor, [o]);
    net.set(o.creditor, (net.get(o.creditor) ?? 0) + o.amount);
    net.set(o.debtor, (net.get(o.debtor) ?? 0) - o.amount);
  }
  for (const list of outgoing.values()) list.sort(byId);

  // Paid-off edges stay paid off, so each party keeps a cursor past them.
  const cursor = new Map<string, number>();
  const nextEdge = (party: string): Obligation | undefined => {
    const list = outgoing.get(party) ?? [];
    let i = cursor.get(party) ?? 0;
    while (i < list.length && (left.get(list[i]!.id) ?? 0) === 0) i++;
    cursor.set(party, i);
    return list[i];
  };

  const merged = new Map<string, { payer: string; payee: string; amount: number; legs: Map<string, number> }>();
  const debtors = [...net].filter(([, v]) => v < 0).map(([p]) => p).sort();

  for (const start of debtors) {
    while ((net.get(start) ?? 0) < 0) {
      const path: Obligation[] = [];
      const visited = new Set<string>([start]);
      let at = start;
      for (;;) {
        const edge = nextEdge(at);
        if (!edge) throw new Error(`settleChains: ${at} has nothing left to pay but still owes; input is inconsistent`);
        path.push(edge);
        at = edge.creditor;
        if ((net.get(at) ?? 0) > 0) break;
        if (visited.has(at)) throw new Error("settleChains: remaining debt contains a loop; run clearLoops first");
        visited.add(at);
      }

      let amount = Math.min(-(net.get(start) ?? 0), net.get(at) ?? 0);
      for (const o of path) amount = Math.min(amount, left.get(o.id) ?? 0);
      for (const o of path) left.set(o.id, (left.get(o.id) ?? 0) - amount);
      net.set(start, (net.get(start) ?? 0) + amount);
      net.set(at, (net.get(at) ?? 0) - amount);

      const key = `${start}\u0000${at}`;
      let transfer = merged.get(key);
      if (!transfer) {
        transfer = { payer: start, payee: at, amount: 0, legs: new Map() };
        merged.set(key, transfer);
      }
      transfer.amount += amount;
      for (const o of path) transfer.legs.set(o.id, (transfer.legs.get(o.id) ?? 0) + amount);
    }
  }

  // Every net position is settled, so anything still unpaid can only be a loop.
  for (const [id, amount] of left) {
    if (amount !== 0) {
      throw new Error(`settleChains: obligation ${id} still has ${amount} unpaid in a loop; run clearLoops first`);
    }
  }

  return [...merged.values()].map((t) => ({
    payer: t.payer,
    payee: t.payee,
    amount: t.amount,
    legs: [...t.legs].map(([obligationId, amount]) => ({ obligationId, amount })),
  }));
}
