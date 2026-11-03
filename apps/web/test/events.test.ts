import { describe, expect, it } from "vitest";
import { describeEvent } from "../src/events.ts";
import type { BusEvent } from "../src/types.ts";

const knownTypes = [
  "network.seeded", "demo.reset", "obligation.updated", "round.planned", "round.consented", "round.ready",
  "round.retrying", "round.setoffs_recorded", "round.failed", "round.needs_attention", "round.closed",
  "transfer.order_created", "transfer.captured", "transfer.payout_sent", "transfer.committed",
  "transfer.unwound", "transfer.failed", "transfer.unclaimed", "transfer.needs_attention",
  "setoffs.recorded", "chain.committed", "chain.unwound",
];

function event(type: string): BusEvent {
  return { seq: 1, stream: "network:test", type, payload: { businessId: "biz-1", transferId: "transfer-1234567890" }, at: "2026-01-01T10:00:00.000Z" };
}

describe("describeEvent", () => {
  for (const type of knownTypes) {
    it(`describes ${type} in a short sentence`, () => {
      const sentence = describeEvent(event(type), { "biz-1": "Corner Cafe" });
      expect(sentence.length).toBeGreaterThan(8);
      expect(sentence).toMatch(/[.!?]$/);
    });
  }

  it("uses a safe fallback for unknown event types", () => {
    expect(describeEvent(event("new.server.event"))).toBe("A network activity was recorded.");
  });

  it("humanizes demo chaos events", () => {
    expect(describeEvent(event("demo.chaos_armed"))).toBe("Crash armed for the next round");
    expect(describeEvent(event("demo.crashed"))).toBe("Server crashed on purpose after a PayPal write");
  });
});
