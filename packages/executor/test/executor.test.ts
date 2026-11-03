import { beforeEach, describe, expect, it } from "vitest";
import { commitChain, executeSetoffs, legKey, setoffKey, unwindChain } from "../src/index.ts";
import type { PaymentLine } from "../src/index.ts";
import { CrashError, FakeInvoices, FakeOps, makeDeps, rng } from "./fakes.ts";
import type { Fault } from "./fakes.ts";

const R = "round-1";

// The bakery loop: each invoice is cleared by 2,400.
const loop: PaymentLine[] = [
  { obligationId: "a", invoiceId: "inv-a", owner: "mill", currency: "USD", amountMinor: 2400 },
  { obligationId: "b", invoiceId: "inv-b", owner: "trucker", currency: "USD", amountMinor: 2400 },
  { obligationId: "c", invoiceId: "inv-c", owner: "bakery", currency: "USD", amountMinor: 2400 },
];
const original = { "inv-a": 3000, "inv-b": 2400, "inv-c": 2800 } as const;

let invoices: FakeInvoices;
let ops: FakeOps;

beforeEach(() => {
  invoices = new FakeInvoices();
  invoices.add("inv-a", "mill", 3000);
  invoices.add("inv-b", "trucker", 2400);
  invoices.add("inv-c", "bakery", 2800);
  ops = new FakeOps();
});

const due = (id: string) => invoices.invoices.get(id)!.dueMinor;
const status = (id: string) => invoices.invoices.get(id)!.status;

describe("executeSetoffs", () => {
  it("records every set-off once and is safe to run again", async () => {
    const result = await executeSetoffs(R, loop, makeDeps(invoices, ops));
    expect(result.status).toBe("recorded");
    expect([due("inv-a"), due("inv-b"), due("inv-c")]).toEqual([600, 0, 400]);
    expect([status("inv-a"), status("inv-b"), status("inv-c")]).toEqual(["PARTIALLY_PAID", "MARKED_AS_PAID", "PARTIALLY_PAID"]);

    const writes = invoices.calls.record;
    expect((await executeSetoffs(R, loop, makeDeps(invoices, ops))).status).toBe("recorded");
    expect(invoices.calls.record).toBe(writes);
    for (const l of loop) expect(invoices.markers(l.invoiceId, setoffKey(R, l.obligationId))).toBe(1);
  });

  it("retries a write that failed before reaching PayPal", async () => {
    invoices.inject("record", "inv-b", "transient-before");
    expect((await executeSetoffs(R, loop, makeDeps(invoices, ops))).status).toBe("recorded");
    expect(invoices.markers("inv-b", setoffKey(R, "b"))).toBe(1);
    expect(invoices.calls.record).toBe(4);
  });

  it("adopts a write that reached PayPal but lost its answer instead of writing twice", async () => {
    invoices.inject("record", "inv-a", "transient-after");
    expect((await executeSetoffs(R, loop, makeDeps(invoices, ops))).status).toBe("recorded");
    expect(invoices.markers("inv-a", setoffKey(R, "a"))).toBe(1);
    expect(invoices.calls.record).toBe(3);
    expect(due("inv-a")).toBe(600);
  });

  it("recovers exactly once after the process dies right after PayPal accepted a write", async () => {
    ops.crashOn = (op) => op.key === setoffKey(R, "b") && op.status === "succeeded";
    await expect(executeSetoffs(R, loop, makeDeps(invoices, ops))).rejects.toBeInstanceOf(CrashError);
    ops.crashOn = undefined;
    expect((await executeSetoffs(R, loop, makeDeps(invoices, ops))).status).toBe("recorded");
    for (const l of loop) expect(invoices.markers(l.invoiceId, setoffKey(R, l.obligationId))).toBe(1);
    expect([due("inv-a"), due("inv-b"), due("inv-c")]).toEqual([600, 0, 400]);
  });

  it("rolls everything back when PayPal refuses one write", async () => {
    invoices.inject("record", "inv-c", "permanent");
    const deps = makeDeps(invoices, ops);
    const result = await executeSetoffs(R, loop, deps);
    expect(result.status).toBe("compensated");
    for (const [id, amount] of Object.entries(original)) {
      expect(due(id)).toBe(amount);
      expect(invoices.invoices.get(id)!.payments).toEqual([]);
    }
    expect(deps.events.map((e) => e.type)).toContain("setoffs.compensated");
  });

  it("aborts without writing anything when an invoice was already paid", async () => {
    invoices.invoices.get("inv-b")!.status = "PAID";
    const result = await executeSetoffs(R, loop, makeDeps(invoices, ops));
    expect(result.status).toBe("aborted");
    expect(invoices.calls.record).toBe(0);
  });

  it("aborts when less is still due than the set-off needs", async () => {
    invoices.invoices.get("inv-c")!.dueMinor = 1000;
    expect((await executeSetoffs(R, loop, makeDeps(invoices, ops))).status).toBe("aborted");
    expect(invoices.calls.record).toBe(0);
  });

  it("hands back to the job runner on persistent trouble, then finishes exactly once", async () => {
    invoices.inject("record", "inv-a", "transient-before", 3);
    expect((await executeSetoffs(R, loop, makeDeps(invoices, ops))).status).toBe("retry_later");
    expect(invoices.calls.record).toBe(3);
    expect((await executeSetoffs(R, loop, makeDeps(invoices, ops))).status).toBe("recorded");
    for (const l of loop) expect(invoices.markers(l.invoiceId, setoffKey(R, l.obligationId))).toBe(1);
  });

  it("never pays twice and never half-settles under random faults and crashes", async () => {
    const outcomes: Record<string, number> = {};
    for (let seed = 1; seed <= 300; seed++) {
      const rand = rng(seed);
      invoices = new FakeInvoices();
      invoices.add("inv-a", "mill", 3000);
      invoices.add("inv-b", "trucker", 2400);
      invoices.add("inv-c", "bakery", 2800);
      ops = new FakeOps();
      if (rand() < 0.25) invoices.refusing.add(loop[Math.floor(rand() * 3)]!.invoiceId);
      invoices.chaos = (): Fault | undefined => {
        const r = rand();
        return r < 0.15 ? "transient-before" : r < 0.3 ? "transient-after" : undefined;
      };
      ops.crashOn = () => rand() < 0.08;

      let final: string | undefined;
      for (let run = 0; run < 60 && final === undefined; run++) {
        if (run === 50) {
          invoices.chaos = undefined;
          ops.crashOn = undefined;
        }
        try {
          const result = await executeSetoffs(R, loop, makeDeps(invoices, ops));
          if (result.status !== "retry_later") final = result.status;
        } catch (e) {
          if (!(e instanceof CrashError)) throw e;
        }
      }

      expect(final, `seed ${seed}`).toBeDefined();
      outcomes[final!] = (outcomes[final!] ?? 0) + 1;
      for (const l of loop) expect(invoices.markers(l.invoiceId, setoffKey(R, l.obligationId)), `seed ${seed}`).toBeLessThanOrEqual(1);
      if (final === "recorded") {
        expect([due("inv-a"), due("inv-b"), due("inv-c")], `seed ${seed}`).toEqual([600, 0, 400]);
      } else {
        expect(["compensated", "aborted"], `seed ${seed}`).toContain(final);
        for (const [id, amount] of Object.entries(original)) expect(due(id), `seed ${seed}`).toBe(amount);
      }
    }
    // Guard the test itself: both the success path and the rollback path must have run.
    expect(outcomes.recorded ?? 0).toBeGreaterThan(100);
    expect((outcomes.compensated ?? 0) + (outcomes.aborted ?? 0)).toBeGreaterThan(20);
  });
});

// Trucker paid Mill 400 through PayPal; that settles Trucker -> Bakery and Bakery -> Mill.
const chain: PaymentLine[] = [
  { obligationId: "c", invoiceId: "inv-c", owner: "bakery", currency: "USD", amountMinor: 400 },
  { obligationId: "a", invoiceId: "inv-a", owner: "mill", currency: "USD", amountMinor: 400 },
];

describe("commitChain and unwindChain", () => {
  it("records every leg with the PayPal proof in its note", async () => {
    const result = await commitChain("t1", "CAPTURE-9F2", chain, makeDeps(invoices, ops));
    expect(result.status).toBe("committed");
    expect([due("inv-c"), due("inv-a")]).toEqual([2400, 2600]);
    expect(invoices.invoices.get("inv-c")!.payments[0]!.note).toContain("CAPTURE-9F2");
  });

  it("keeps recorded legs and flags a leg PayPal refuses, because the money already moved", async () => {
    invoices.inject("record", "inv-a", "permanent");
    const deps = makeDeps(invoices, ops);
    const result = await commitChain("t1", "CAPTURE-9F2", chain, deps);
    expect(result.status).toBe("needs_attention");
    expect(due("inv-c")).toBe(2400);
    expect(deps.events.map((e) => e.type)).toContain("chain.needs_attention");
  });

  it("recovers exactly once when a leg's answer is lost", async () => {
    invoices.inject("record", "inv-c", "transient-after");
    expect((await commitChain("t1", "CAPTURE-9F2", chain, makeDeps(invoices, ops))).status).toBe("committed");
    expect(invoices.markers("inv-c", legKey("t1", "c"))).toBe(1);
  });

  it("unwinds a refunded chain, and repeating the unwind changes nothing", async () => {
    await commitChain("t1", "CAPTURE-9F2", chain, makeDeps(invoices, ops));
    expect((await unwindChain("t1", chain, makeDeps(invoices, ops))).status).toBe("unwound");
    expect([due("inv-c"), due("inv-a")]).toEqual([2800, 3000]);
    const removes = invoices.calls.remove;
    expect((await unwindChain("t1", chain, makeDeps(invoices, ops))).status).toBe("unwound");
    expect(invoices.calls.remove).toBe(removes);
  });

  it("treats a payment someone already deleted as unwound", async () => {
    await commitChain("t1", "CAPTURE-9F2", chain, makeDeps(invoices, ops));
    invoices.invoices.get("inv-a")!.payments = [];
    expect((await unwindChain("t1", chain, makeDeps(invoices, ops))).status).toBe("unwound");
  });
});
