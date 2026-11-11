import { describe, expect, it } from "vitest";
import { planSettlement, screenLoops, verifyNetPositions } from "../src/index.ts";
import type { Obligation } from "../src/index.ts";
import type { FraudScreenInvoiceMeta, FraudScreenMeta, Loop } from "../src/index.ts";

/** Deterministic PRNG so the 10,000 networks are reproducible. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function makeNetwork(rand: () => number): Obligation[] {
  const parties = 3 + Math.floor(rand() * 198); // 3..200
  const edgeCount = Math.floor(rand() * parties * 3) + parties;
  const obligations: Obligation[] = [];
  for (let i = 0; i < edgeCount; i++) {
    const d = Math.floor(rand() * parties);
    let c = Math.floor(rand() * parties);
    if (c === d) c = (c + 1) % parties;
    // Include many small cycles to exercise loop clearing.
    const amount = 1 + Math.floor(rand() * 1_000_000_000);
    obligations.push({ id: `o${i}`, debtor: `p${d}`, creditor: `p${c}`, amount });
  }
  return obligations;
}

describe("verifyNetPositions", () => {
  it("proves 10,000 random networks move exactly the minimum cash with zero net drift", () => {
    const rand = generator(0xC0FFEE);
    for (let n = 0; n < 10_000; n++) {
      const obligations = makeNetwork(rand);
      const plan = planSettlement(obligations);
      const proof = verifyNetPositions(obligations, plan);
      expect(proof.maxAbsDelta, `network ${n} drifted`).toBe(0);
      expect(proof.minCashHolds, `network ${n} moved non-minimum cash`).toBe(true);
      expect(proof.cashMoved).toBe(plan.stats.moneyMoved);
      expect(proof.minCash).toBe(plan.stats.moneyMoved);
    }
  }, 180_000);

  it("reports per-business positions with zero delta", () => {
    const obligations: Obligation[] = [
      { id: "a", debtor: "bakery", creditor: "mill", amount: 1000 },
      { id: "b", debtor: "mill", creditor: "bakery", amount: 400 },
    ];
    const proof = verifyNetPositions(obligations, planSettlement(obligations));
    expect(proof.businesses.bakery).toEqual({ netBefore: -600, netAfter: -600, delta: 0 });
    expect(proof.businesses.mill).toEqual({ netBefore: 600, netAfter: 600, delta: 0 });
    expect(proof.maxAbsDelta).toBe(0);
    expect(proof.minCash).toBe(600);
    expect(proof.cashMoved).toBe(600);
    expect(proof.minCashHolds).toBe(true);
  });
});

const DAY = 24 * 60 * 60 * 1000;
const iso = (t: number) => new Date(t).toISOString();

function loopMeta(overrides: { young?: boolean; round?: boolean; sameDay?: boolean; outside?: boolean }): { meta: FraudScreenMeta; loop: Loop } {
  const now = Date.UTC(2026, 5, 1);
  const youngCutoff = now - 30 * DAY;
  // Five businesses. By default they are old, diverse partners, spread invoices.
  const young = overrides.young ?? false;
  const createdAtByBusiness: Record<string, string> = {};
  for (let b = 1; b <= 5; b++) {
    createdAtByBusiness[`b${b}`] = iso(young ? youngCutoff + b * DAY : now - 400 * DAY - b * DAY);
  }
  const memberIds = ["i1", "i2", "i3", "i4", "i5"];
  const invoices: Record<string, FraudScreenInvoiceMeta> = {};
  const base = overrides.sameDay ? now - 2 * DAY : now - 200 * DAY;
  let i = 0;
  for (const id of memberIds) {
    const amount = overrides.round ? 5000 : 1234 + i * 137;
    invoices[id] = {
      debtor: `b${i + 1}`,
      creditor: `b${((i + 1) % 5) + 1}`,
      createdAt: iso(base + i * (overrides.sameDay ? 2 * 60 * 60 * 1000 : 9 * DAY)),
      amount,
    };
    i++;
  }
  const loop: Loop = { id: "loop1", amount: 5000, memberIds };
  const meta: FraudScreenMeta = { createdAtByBusiness, invoices, now: iso(now) };
  // Always include a background marketplace between two unrelated businesses, so
  // every loop has "an outside" to be isolated from. The `outside` flag then
  // decides whether the members themselves trade with that outside.
  invoices["bg_a"] = { debtor: "z_a", creditor: "z_b", createdAt: iso(now - 350 * DAY), amount: 7000 };
  invoices["bg_b"] = { debtor: "z_b", creditor: "z_a", createdAt: iso(now - 350 * DAY), amount: 3000 };
  // `outside` controls whether members trade outside the loop. When true, add an
  // external invoice for every member so no member is isolated.
  if (overrides.outside) {
    for (let b = 1; b <= 5; b++) {
      invoices[`i_ext${b}`] = {
        debtor: `b${b}`,
        creditor: `z_external${b}`,
        createdAt: iso(now - 300 * DAY - b * DAY),
        amount: 900 + b,
      };
    }
  }
  return { meta, loop };
}

describe("screenLoops", () => {
  it("holds a classic fraud ring", () => {
    const { meta, loop } = loopMeta({ young: true, round: true, sameDay: true, outside: false });
    const result = screenLoops([loop], meta)[0]!;
    expect(result.held).toBe(true);
    expect(result.score).toBeGreaterThan(0);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("does not hold a normal loop (old members, varied amounts, spread dates, outside partners)", () => {
    const { meta, loop } = loopMeta({ young: false, round: false, sameDay: false, outside: true });
    const result = screenLoops([loop], meta)[0]!;
    expect(result.held).toBe(false);
    expect(result.score).toBe(0);
    expect(result.reasons).toEqual([]);
  });

  it("flags a loop with no outside partners even when everything else looks normal", () => {
    const { meta, loop } = loopMeta({ young: false, round: false, sameDay: false, outside: false });
    const result = screenLoops([loop], meta)[0]!;
    expect(result.held).toBe(true);
    expect(result.reasons.some((reason) => reason.startsWith("no_outside_partners"))).toBe(true);
  });

  it("does not hold a young, same-day, round-amount loop that still trades outside", () => {
    // A freshly-seeded marketplace looks "young" with round amounts issued the same
    // day; only isolation should trigger a hold.
    const { meta, loop } = loopMeta({ young: true, round: true, sameDay: true, outside: true });
    const result = screenLoops([loop], meta)[0]!;
    expect(result.held).toBe(false);
    expect(result.score).toBeGreaterThan(0);
    expect(result.reasons.some((reason) => reason.startsWith("no_outside_partners"))).toBe(false);
  });
});
