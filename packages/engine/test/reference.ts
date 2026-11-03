// Independent oracles used only by tests.
import type { Obligation } from "../src/types.ts";

/** Exact maximum cleared amount: total minus the min-cost leftover flow (SPFA augmenting paths). */
export function referenceMaxCleared(obs: readonly Obligation[]): number {
  const idx = new Map<string, number>();
  const node = (p: string) => {
    let i = idx.get(p);
    if (i === undefined) {
      i = idx.size;
      idx.set(p, i);
    }
    return i;
  };
  for (const o of obs) {
    node(o.debtor);
    node(o.creditor);
  }
  const n = idx.size, S = n, T = n + 1, N = n + 2;
  const to: number[] = [], cap: number[] = [], cost: number[] = [], nxt: number[] = [];
  const head = new Array<number>(N).fill(-1);
  const add = (u: number, v: number, c: number, w: number) => {
    to.push(v); cap.push(c); cost.push(w); nxt.push(head[u]!); head[u] = to.length - 1;
    to.push(u); cap.push(0); cost.push(-w); nxt.push(head[v]!); head[v] = to.length - 1;
  };
  const bal = new Array<number>(n).fill(0);
  let total = 0;
  for (const o of obs) {
    const u = node(o.debtor), v = node(o.creditor);
    add(u, v, o.amount, 1);
    bal[v]! += o.amount;
    bal[u]! -= o.amount;
    total += o.amount;
  }
  let need = 0;
  for (let v = 0; v < n; v++) {
    if (bal[v]! < 0) {
      add(S, v, -bal[v]!, 0);
      need -= bal[v]!;
    } else if (bal[v]! > 0) add(v, T, bal[v]!, 0);
  }
  let flow = 0, spent = 0;
  while (flow < need) {
    const dist = new Array<number>(N).fill(Infinity), prev = new Array<number>(N).fill(-1), inQ = new Array<boolean>(N).fill(false);
    dist[S] = 0;
    const q = [S];
    inQ[S] = true;
    for (let qi = 0; qi < q.length; qi++) {
      const u = q[qi]!;
      inQ[u] = false;
      for (let e = head[u]!; e !== -1; e = nxt[e]!) {
        const v = to[e]!;
        if (cap[e]! > 0 && dist[u]! + cost[e]! < dist[v]!) {
          dist[v] = dist[u]! + cost[e]!;
          prev[v] = e;
          if (!inQ[v]) {
            inQ[v] = true;
            q.push(v);
          }
        }
      }
    }
    let f = need - flow;
    for (let v = T; v !== S; v = to[prev[v]! ^ 1]!) f = Math.min(f, cap[prev[v]!]!);
    for (let v = T; v !== S; v = to[prev[v]! ^ 1]!) {
      cap[prev[v]!]! -= f;
      cap[prev[v]! ^ 1]! += f;
    }
    flow += f;
    spent += f * dist[T]!;
  }
  return total - spent;
}

/** Brute force over every cleared vector; only for tiny graphs. */
export function bruteMaxCleared(obs: readonly Obligation[]): number {
  let best = 0;
  const x = new Array<number>(obs.length).fill(0);
  const rec = (i: number): void => {
    if (i === obs.length) {
      const net = new Map<string, number>();
      obs.forEach((o, k) => {
        net.set(o.creditor, (net.get(o.creditor) ?? 0) + x[k]!);
        net.set(o.debtor, (net.get(o.debtor) ?? 0) - x[k]!);
      });
      for (const v of net.values()) if (v !== 0) return;
      best = Math.max(best, x.reduce((a, b) => a + b, 0));
      return;
    }
    for (let a = 0; a <= obs[i]!.amount; a++) {
      x[i] = a;
      rec(i + 1);
    }
  };
  rec(0);
  return best;
}

/** Owed to each party minus owed by it. */
export function netPositions(obs: readonly Obligation[]): Map<string, number> {
  const net = new Map<string, number>();
  for (const o of obs) {
    net.set(o.creditor, (net.get(o.creditor) ?? 0) + o.amount);
    net.set(o.debtor, (net.get(o.debtor) ?? 0) - o.amount);
  }
  return net;
}
