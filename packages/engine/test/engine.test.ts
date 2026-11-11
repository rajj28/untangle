import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { clearLoops, findLoops, planSettlement, settleChains } from "../src/index.ts";
import type { Obligation } from "../src/index.ts";
import { bruteMaxCleared, netPositions, referenceMaxCleared } from "./reference.ts";

const obligationsArb = (maxParties: number, maxEdges: number, maxAmount: number) =>
  fc
    .array(
      fc.record({
        d: fc.integer({ min: 0, max: maxParties - 1 }),
        c: fc.integer({ min: 0, max: maxParties - 1 }),
        amount: fc.integer({ min: 1, max: maxAmount }),
      }),
      { maxLength: maxEdges },
    )
    .map((rows) =>
      rows
        .filter((r) => r.d !== r.c)
        .map((r, i): Obligation => ({ id: `o${i}`, debtor: `p${r.d}`, creditor: `p${r.c}`, amount: r.amount })),
    );

const bakery: Obligation[] = [
  { id: "a", debtor: "bakery", creditor: "mill", amount: 3000 },
  { id: "b", debtor: "mill", creditor: "trucker", amount: 2400 },
  { id: "c", debtor: "trucker", creditor: "bakery", amount: 2800 },
];

describe("reference oracle", () => {
  it("agrees with brute force on tiny graphs", () => {
    fc.assert(fc.property(obligationsArb(4, 5, 3), (obs) => referenceMaxCleared(obs) === bruteMaxCleared(obs)), {
      numRuns: 300,
    });
  });
});

describe("clearLoops", () => {
  it("stays within bounds and changes nobody's net position", () => {
    fc.assert(
      fc.property(obligationsArb(8, 24, 1000), (obs) => {
        const cleared = clearLoops(obs);
        const net = new Map<string, number>();
        for (const o of obs) {
          const x = cleared[o.id]!;
          expect(Number.isInteger(x) && x >= 0 && x <= o.amount).toBe(true);
          net.set(o.creditor, (net.get(o.creditor) ?? 0) + x);
          net.set(o.debtor, (net.get(o.debtor) ?? 0) - x);
        }
        for (const v of net.values()) expect(v).toBe(0);
      }),
      { numRuns: 300 },
    );
  });

  it("clears the maximum possible", () => {
    fc.assert(
      fc.property(obligationsArb(8, 24, 1000), (obs) => {
        const cleared = clearLoops(obs);
        const sum = obs.reduce((s, o) => s + cleared[o.id]!, 0);
        expect(sum).toBe(referenceMaxCleared(obs));
      }),
      { numRuns: 300 },
    );
  });

  it("is not fooled by a short loop that blocks a longer one", () => {
    const obs: Obligation[] = [
      { id: "a", debtor: "A", creditor: "B", amount: 1 },
      { id: "b", debtor: "B", creditor: "A", amount: 1 },
      { id: "c", debtor: "B", creditor: "C", amount: 1 },
      { id: "d", debtor: "C", creditor: "A", amount: 1 },
    ];
    const cleared = clearLoops(obs);
    expect(cleared.a! + cleared.b! + cleared.c! + cleared.d!).toBe(3);
  });

  it("treats ids like __proto__ as plain keys", () => {
    const cleared = clearLoops([
      { id: "__proto__", debtor: "x", creditor: "y", amount: 5 },
      { id: "constructor", debtor: "y", creditor: "x", amount: 5 },
    ]);
    expect(Object.getOwnPropertyDescriptor(cleared, "__proto__")?.value).toBe(5);
    expect(cleared.constructor).toBe(5);
  });
});

describe("settleChains", () => {
  it("refuses debt that still has a loop in it", () => {
    expect(() => settleChains(bakery)).toThrow(/loop/);
  });
});

describe("planSettlement", () => {
  it("settles the bakery example with $600 moving through PayPal", () => {
    const plan = planSettlement(bakery);
    expect(plan.setoffs).toEqual({ a: 2400, b: 2400, c: 2400 });
    expect(plan.transfers).toEqual([
      { payer: "bakery", payee: "mill", amount: 200, legs: [{ obligationId: "a", amount: 200 }] },
      {
        payer: "trucker",
        payee: "mill",
        amount: 400,
        legs: [
          { obligationId: "c", amount: 400 },
          { obligationId: "a", amount: 400 },
        ],
      },
    ]);
    expect(plan.stats).toEqual({
      totalOwed: 8200,
      clearedByLoops: 7200,
      settledByChains: 1000,
      moneyMoved: 600,
      leverage: 8200 / 600,
    });
  });

  it("handles an empty network", () => {
    expect(planSettlement([])).toEqual({
      setoffs: {},
      transfers: [],
      stats: { totalOwed: 0, clearedByLoops: 0, settledByChains: 0, moneyMoved: 0, leverage: null },
    });
  });

  it("pays off every obligation exactly, moving only the sum of net debts", () => {
    fc.assert(
      fc.property(obligationsArb(10, 30, 1000), (obs) => {
        const plan = planSettlement(obs);
        const paid = new Map<string, number>();
        for (const t of plan.transfers) for (const l of t.legs) paid.set(l.obligationId, (paid.get(l.obligationId) ?? 0) + l.amount);
        for (const o of obs) expect((plan.setoffs[o.id] ?? 0) + (paid.get(o.id) ?? 0)).toBe(o.amount);

        const net = netPositions(obs);
        let netDebt = 0;
        for (const v of net.values()) if (v < 0) netDebt -= v;
        expect(plan.stats.moneyMoved).toBe(netDebt);

        // Nobody pays more than they owe overall, and money only flows from net debtors to net creditors.
        const paidBy = new Map<string, number>();
        for (const t of plan.transfers) {
          expect(net.get(t.payer)!).toBeLessThan(0);
          expect(net.get(t.payee)!).toBeGreaterThan(0);
          paidBy.set(t.payer, (paidBy.get(t.payer) ?? 0) + t.amount);
        }
        for (const [party, amount] of paidBy) expect(amount).toBe(-net.get(party)!);
      }),
      { numRuns: 300 },
    );
  });

  it("each transfer's legs form chains from its payer to its payee", () => {
    fc.assert(
      fc.property(obligationsArb(10, 30, 1000), (obs) => {
        const byId = new Map(obs.map((o) => [o.id, o]));
        for (const t of planSettlement(obs).transfers) {
          const flow = new Map<string, number>();
          for (const l of t.legs) {
            const o = byId.get(l.obligationId)!;
            flow.set(o.creditor, (flow.get(o.creditor) ?? 0) + l.amount);
            flow.set(o.debtor, (flow.get(o.debtor) ?? 0) - l.amount);
          }
          for (const [party, v] of flow) {
            const expected = party === t.payer ? -t.amount : party === t.payee ? t.amount : 0;
            expect(v).toBe(expected);
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  it("gives the same plan for the same obligations in any order", () => {
    fc.assert(
      fc.property(obligationsArb(8, 24, 1000), fc.integer(), (obs, seed) => {
        const shuffled = [...obs];
        let s = seed;
        for (let i = shuffled.length - 1; i > 0; i--) {
          s = (Math.imul(s, 1103515245) + 12345) | 0;
          const j = Math.abs(s) % (i + 1);
          [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
        }
        expect(planSettlement(shuffled)).toEqual(planSettlement(obs));
      }),
      { numRuns: 200 },
    );
  });

  it("rejects bad input", () => {
    expect(() => planSettlement([{ id: "x", debtor: "a", creditor: "a", amount: 1 }])).toThrow(/owe itself/);
    expect(() =>
      planSettlement([
        { id: "x", debtor: "a", creditor: "b", amount: 1 },
        { id: "x", debtor: "b", creditor: "a", amount: 1 },
      ]),
    ).toThrow(/duplicate/);
    expect(() => planSettlement([{ id: "x", debtor: "a", creditor: "b", amount: 1.5 }])).toThrow(/positive integer/);
    expect(() => planSettlement([{ id: "x", debtor: "a", creditor: "b", amount: 0 }])).toThrow(/positive integer/);
  });

  it("plans 300 businesses and 3,000 obligations in under two seconds", () => {
    let seed = 99;
    const rand = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const obs: Obligation[] = [];
    for (let i = 0; i < 3000; i++) {
      const d = Math.floor(rand() * 300);
      const c = (d + 1 + Math.floor(rand() * 299)) % 300;
      obs.push({ id: `o${i}`, debtor: `p${d}`, creditor: `p${c}`, amount: 1 + Math.floor(rand() * 100000) });
    }
    const t0 = performance.now();
    const plan = planSettlement(obs);
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(plan.stats.clearedByLoops).toBe(referenceMaxCleared(obs));
  });
});

describe("findLoops", () => {
  it("finds the single loop in the bakery triangle", () => {
    const plan = planSettlement(bakery);
    const loops = findLoops(bakery, plan.setoffs);
    expect(loops).toHaveLength(1);
    expect(loops[0]!.amount).toBe(2400);
    expect(new Set(loops[0]!.memberIds)).toEqual(new Set(["a", "b", "c"]));
  });

  it("finds two disjoint loops", () => {
    const obs: Obligation[] = [
      { id: "a", debtor: "A", creditor: "B", amount: 100 },
      { id: "b", debtor: "B", creditor: "A", amount: 100 },
      { id: "c", debtor: "X", creditor: "Y", amount: 50 },
      { id: "d", debtor: "Y", creditor: "X", amount: 50 },
    ];
    const plan = planSettlement(obs);
    const loops = findLoops(obs, plan.setoffs);
    expect(loops).toHaveLength(2);
    expect(loops.reduce((s, l) => s + l.amount, 0)).toBe(150);
  });

  it("decomposes the entire cleared flow into cycles", () => {
    fc.assert(
      fc.property(obligationsArb(8, 24, 1000), (obs) => {
        const plan = planSettlement(obs);
        const loops = findLoops(obs, plan.setoffs);
        for (const loop of loops) {
          expect(loop.amount).toBeGreaterThan(0);
          expect(loop.memberIds.length).toBeGreaterThanOrEqual(2);
        }
        // Every cleared unit of an obligation is assigned to exactly one loop
        // that contains it, so the loops' amounts must reconstruct each set-off.
        for (const o of obs) {
          const so = plan.setoffs[o.id] ?? 0;
          if (so === 0) continue;
          const covered = loops
            .filter((loop) => loop.memberIds.includes(o.id))
            .reduce((s, loop) => s + loop.amount, 0);
          expect(covered).toBe(so);
        }
      }),
      { numRuns: 200 },
    );
  });
});
