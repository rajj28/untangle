import type { Obligation } from "./types.ts";

/**
 * Multilateral set-off: cancels the largest possible amount of debt that runs in loops.
 *
 * Solved exactly as a maximum-weight circulation with cost-scaling push-relabel
 * (every unit cleared earns the same reward, scaled by n + 1 so a 1-optimal
 * circulation is optimal). Returns, for every obligation id, the amount cleared:
 * 0 <= cleared <= amount, and every party's net position is unchanged.
 */
export function clearLoops(obligations: readonly Obligation[]): Record<string, number> {
  type Edge = {
    to: number;
    rev: number;
    cap: number;
    cost: number;
  };

  const result: Record<string, number> = {};
  for (const obligation of obligations) {
    // defineProperty keeps ids such as "__proto__" from touching the prototype.
    Object.defineProperty(result, obligation.id, { value: 0, writable: true, enumerable: true, configurable: true });
  }

  const partyIndex = new Map<string, number>();
  const getPartyIndex = (party: string): number => {
    const existing = partyIndex.get(party);
    if (existing !== undefined) return existing;
    const index = partyIndex.size;
    partyIndex.set(party, index);
    return index;
  };
  for (const obligation of obligations) {
    getPartyIndex(obligation.debtor);
    getPartyIndex(obligation.creditor);
  }

  const n = partyIndex.size;
  if (n === 0) return result;

  const scale = n + 1;
  const graph: Edge[][] = Array.from({ length: n }, () => []);
  const originalEdges: { id: string; amount: number; edge: Edge }[] = [];

  for (const obligation of obligations) {
    const from = partyIndex.get(obligation.debtor)!;
    const to = partyIndex.get(obligation.creditor)!;
    const forward: Edge = { to, rev: graph[to]!.length + (from === to ? 1 : 0), cap: obligation.amount, cost: -scale };
    const reverse: Edge = { to: from, rev: graph[from]!.length, cap: 0, cost: scale };
    graph[from]!.push(forward);
    graph[to]!.push(reverse);
    originalEdges.push({ id: obligation.id, amount: obligation.amount, edge: forward });
  }

  const potential = new Array<number>(n).fill(0);
  const excess = new Array<number>(n).fill(0);
  const current = new Array<number>(n).fill(0);
  const reducedCost = (from: number, edge: Edge): number => edge.cost + potential[from]! - potential[edge.to]!;

  let epsilon = 1;
  while (epsilon < scale) epsilon *= 2;

  while (epsilon > 1) {
    epsilon = Math.floor(epsilon / 2);
    excess.fill(0);

    // Saturate every residual edge with negative reduced cost.
    for (let from = 0; from < n; from++) {
      for (const edge of graph[from]!) {
        if (edge.cap > 0 && reducedCost(from, edge) < 0) {
          const amount = edge.cap;
          edge.cap = 0;
          graph[edge.to]![edge.rev]!.cap += amount;
          excess[from]! -= amount;
          excess[edge.to]! += amount;
        }
      }
    }

    current.fill(0);
    const queue: number[] = [];
    const inQueue = new Array<boolean>(n).fill(false);
    for (let v = 0; v < n; v++) {
      if (excess[v]! > 0) {
        queue.push(v);
        inQueue[v] = true;
      }
    }

    let head = 0;
    while (head < queue.length) {
      const from = queue[head++]!;
      inQueue[from] = false;

      while (excess[from]! > 0) {
        if (current[from] === graph[from]!.length) {
          potential[from]! -= epsilon;
          current[from] = 0;
          continue;
        }
        const edge = graph[from]![current[from]!]!;
        if (edge.cap > 0 && reducedCost(from, edge) < 0) {
          const amount = Math.min(excess[from]!, edge.cap);
          edge.cap -= amount;
          graph[edge.to]![edge.rev]!.cap += amount;
          excess[from]! -= amount;
          excess[edge.to]! += amount;
          if (edge.to !== from && excess[edge.to]! > 0 && !inQueue[edge.to]) {
            queue.push(edge.to);
            inQueue[edge.to] = true;
          }
          if (edge.cap === 0) current[from]!++;
        } else {
          current[from]!++;
        }
      }
    }
  }

  for (const original of originalEdges) {
    Object.defineProperty(result, original.id, {
      value: original.amount - original.edge.cap,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  return result;
}
