import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { appendEvents, GENESIS_HASH, verifyChain } from "../src/events.ts";
import { makeTestDb } from "./helpers.ts";

describe("event log", () => {
  let testDb: Awaited<ReturnType<typeof makeTestDb>>;

  beforeEach(async () => {
    testDb = await makeTestDb();
  });

  afterEach(async () => {
    await testDb.close();
  });

  it("appends events in sequence with a continuous hash chain", async () => {
    const stored = await appendEvents(testDb.db, [
      { stream: "obligation/1", type: "created", payload: { amount: 100 }, actor: "user/1" },
      { stream: "obligation/1", type: "confirmed", payload: { accepted: true }, actor: "user/2" },
      { stream: "obligation/1", type: "settled", payload: {}, actor: "system" },
    ]);

    expect(stored.map((event) => event.seq)).toEqual([1, 2, 3]);
    expect(stored[0]?.prevHash).toBe(GENESIS_HASH);
    expect(stored[1]?.prevHash).toBe(stored[0]?.hash);
    expect(stored[2]?.prevHash).toBe(stored[1]?.hash);
  });

  it("verifies an intact three-event chain", async () => {
    await appendEvents(testDb.db, [
      { stream: "s", type: "one", payload: {}, actor: "a" },
      { stream: "s", type: "two", payload: {}, actor: "a" },
      { stream: "s", type: "three", payload: {}, actor: "a" },
    ]);

    await expect(verifyChain(testDb.db)).resolves.toEqual({ ok: true, count: 3 });
  });

  it("detects a changed payload", async () => {
    await appendEvents(testDb.db, [
      { stream: "s", type: "one", payload: {}, actor: "a" },
      { stream: "s", type: "two", payload: { value: 2 }, actor: "a" },
      { stream: "s", type: "three", payload: {}, actor: "a" },
    ]);
    await testDb.db.execute(sql`update events set payload = '{"value":3}'::jsonb where seq = 2`);

    await expect(verifyChain(testDb.db)).resolves.toEqual({ ok: false, brokenAtSeq: 2, reason: "hash mismatch" });
  });

  it("detects a changed previous hash", async () => {
    await appendEvents(testDb.db, [
      { stream: "s", type: "one", payload: {}, actor: "a" },
      { stream: "s", type: "two", payload: {}, actor: "a" },
      { stream: "s", type: "three", payload: {}, actor: "a" },
    ]);
    await testDb.db.execute(sql`update events set prev_hash = 'tampered' where seq = 3`);

    await expect(verifyChain(testDb.db)).resolves.toEqual({ ok: false, brokenAtSeq: 3, reason: "prev_hash mismatch" });
  });

  it("keeps the chain continuous across append calls", async () => {
    const first = await appendEvents(testDb.db, [
      { stream: "s", type: "one", payload: {}, actor: "a" },
      { stream: "s", type: "two", payload: {}, actor: "a" },
    ]);
    const second = await appendEvents(testDb.db, [
      { stream: "s", type: "three", payload: {}, actor: "a" },
    ]);

    expect(second[0]?.prevHash).toBe(first[1]?.hash);
    await expect(verifyChain(testDb.db)).resolves.toEqual({ ok: true, count: 3 });
  });

  it("returns an empty array without appending when given no events", async () => {
    await expect(appendEvents(testDb.db, [])).resolves.toEqual([]);
    await expect(verifyChain(testDb.db)).resolves.toEqual({ ok: true, count: 0 });
  });
});
