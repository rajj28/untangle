import { planSettlement, verifyNetPositions } from "@untangle/engine";
import type { Obligation } from "@untangle/engine";

/** A tiny deterministic PRNG so the check is reproducible for a given seed. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

export function makeRandomNetwork(rand: () => number): Obligation[] {
  const parties = 3 + Math.floor(rand() * 198); // 3..200
  const edgeCount = parties + Math.floor(rand() * parties * 2);
  const obligations: Obligation[] = [];
  for (let i = 0; i < edgeCount; i++) {
    const d = Math.floor(rand() * parties);
    let c = Math.floor(rand() * parties);
    if (c === d) c = (c + 1) % parties;
    obligations.push({ id: `o${i}`, debtor: `p${d}`, creditor: `p${c}`, amount: 1 + Math.floor(rand() * 1_000_000_000) });
  }
  return obligations;
}

export function runVerification(count: number): { networksChecked: number; millis: number; maxAbsDelta: number; minCashPassed: number; minCashTotal: number } {
  const started = performance.now();
  const rand = generator((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0);
  let maxAbsDelta = 0;
  let passed = 0;
  for (let n = 0; n < count; n++) {
    const obligations = makeRandomNetwork(rand);
    const plan = planSettlement(obligations);
    const proof = verifyNetPositions(obligations, plan);
    if (proof.maxAbsDelta > maxAbsDelta) maxAbsDelta = proof.maxAbsDelta;
    if (proof.minCashHolds && proof.maxAbsDelta === 0) passed += 1;
  }
  return { networksChecked: count, millis: Math.round(performance.now() - started), maxAbsDelta, minCashPassed: passed, minCashTotal: count };
}
