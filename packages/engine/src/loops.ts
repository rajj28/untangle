import type { Obligation } from "./types.ts";

export interface Loop {
  readonly id: string;
  /** Total amount of this loop, in minor units. */
  readonly amount: number;
  /** The obligation ids that form this loop. */
  readonly memberIds: readonly string[];
}

/**
 * Decompose the cleared subgraph into directed cycles ("loops").
 *
 * clearLoops produces a circulation: on the subgraph of obligations with a
 * positive set-off, every party's inflow equals its outflow. A balanced
 * directed graph decomposes into edge-disjoint directed cycles. This walks the
 * residual graph extracting one cycle at a time (greedy cycle-canceling
 * decomposition), so it actually enumerates the loops that were cleared, not
 * just the aggregate amount.
 *
 * Each detected cycle yields a Loop with the shared amount along that cycle
 * (the minimum residual on its edges) and the obligation ids on it. An
 * obligation can appear on several loops; callers that want a single loop per
 * invoice should use the first loop that contains it.
 *
 * `maxLoops` bounds the number of cycles extracted for very large graphs; the
 * remaining cleared debt is simply not enumerated (the aggregate cleared amount
 * is unaffected).
 */
export function findLoops(
  obligations: readonly Obligation[],
  setoffs: Readonly<Record<string, number>>,
  maxLoops = 100_000,
): Loop[] {
  interface Edge {
    to: string;
    cap: number;
    obligationId: string;
    from: string;
  }

  const adj = new Map<string, Edge[]>();
  const active = new Set<string>();

  for (const obligation of obligations) {
    const cleared = setoffs[obligation.id] ?? 0;
    if (cleared <= 0) continue;
    const edge: Edge = {
      from: obligation.debtor,
      to: obligation.creditor,
      cap: cleared,
      obligationId: obligation.id,
    };
    const list = adj.get(obligation.debtor);
    if (list !== undefined) {
      list.push(edge);
    } else {
      adj.set(obligation.debtor, [edge]);
    }
    active.add(obligation.debtor);
  }

  // Find a directed cycle reachable from `seed`. Returns the ordered steps of
  // the cycle (each step's edge leaves step.from and enters step.to; the last
  // step enters back to the first node). Null when no cycle is reachable.
  const findCycle = (seed: string): { from: string; edge: Edge }[] | null => {
    const stack: { node: string; next: number }[] = [{ node: seed, next: 0 }];
    const pathNodes: string[] = [seed];
    const pathSteps: { from: string; edge: Edge }[] = [];
    const pathIndex = new Map<string, number>([[seed, 0]]);

    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      const edges = adj.get(top.node) ?? [];
      let advanced = false;
      while (top.next < edges.length) {
        const edge = edges[top.next]!;
        top.next += 1;
        if (edge.cap <= 0) continue;
        const to = edge.to;
        pathSteps.push({ from: top.node, edge });
        const onPath = pathIndex.get(to);
        if (onPath !== undefined) {
          return pathSteps.slice(onPath);
        }
        pathNodes.push(to);
        pathIndex.set(to, pathNodes.length - 1);
        stack.push({ node: to, next: 0 });
        advanced = true;
        break;
      }
      if (!advanced) {
        stack.pop();
        pathSteps.pop();
        const popped = pathNodes.pop()!;
        pathIndex.delete(popped);
      }
    }
    return null;
  };

  const loops: Loop[] = [];
  let loopCount = 0;

  // The cleared subgraph is balanced, so any active node lies on a cycle. Keep
  // extracting cycles until no active node remains or the budget is exhausted.
  while (active.size > 0 && loopCount < maxLoops) {
    const seed = active.values().next().value as string | undefined;
    if (seed === undefined) break;
    const steps = findCycle(seed);
    if (steps === null) {
      active.delete(seed);
      continue;
    }
    let minCap = Infinity;
    for (const step of steps) {
      if (step.edge.cap < minCap) minCap = step.edge.cap;
    }
    loops.push({
      id: `loop${loopCount + 1}`,
      amount: minCap,
      memberIds: steps.map((step) => step.edge.obligationId),
    });
    loopCount += 1;

    for (const step of steps) {
      const edge = step.edge;
      edge.cap -= minCap;
      if (edge.cap === 0) {
        const list = adj.get(edge.from)!;
        if (!list.some((other) => other.cap > 0)) active.delete(edge.from);
      }
    }
  }

  return loops;
}
