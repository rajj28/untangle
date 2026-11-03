import { randomUUID } from "node:crypto";
import { asc, desc, gt, sql } from "drizzle-orm";
import type { Db } from "./client.ts";
import { canonicalJson, sha256Hex } from "./canonical.ts";
import { events as eventRows } from "./schema.ts";

export interface NewEvent {
  stream: string;
  type: string;
  payload: Record<string, unknown>;
  actor: string;
}

export interface StoredEvent extends NewEvent {
  seq: number;
  id: string;
  at: string;
  prevHash: string;
  hash: string;
}

export const GENESIS_HASH = "0".repeat(64);

export async function appendEvents(db: Db, events: NewEvent[]): Promise<StoredEvent[]> {
  if (events.length === 0) return [];

  return db.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(727274)`);
    const [latest] = await transaction
      .select({ hash: eventRows.hash })
      .from(eventRows)
      .orderBy(desc(eventRows.seq))
      .limit(1);
    let prevHash = latest?.hash ?? GENESIS_HASH;
    const stored: StoredEvent[] = [];

    for (const event of events) {
      const id = randomUUID();
      const at = new Date().toISOString();
      const hash = sha256Hex(`${prevHash}\n${canonicalJson({
        id,
        stream: event.stream,
        type: event.type,
        payload: event.payload,
        actor: event.actor,
        at,
      })}`);
      const [row] = await transaction
        .insert(eventRows)
        .values({
          id,
          stream: event.stream,
          type: event.type,
          payload: event.payload,
          actor: event.actor,
          at: new Date(at),
          prevHash,
          hash,
        })
        .returning();
      if (row === undefined) throw new Error("event insert did not return a row");

      stored.push({
        seq: row.seq,
        id: row.id,
        stream: row.stream,
        type: row.type,
        payload: row.payload as Record<string, unknown>,
        actor: row.actor,
        at: row.at.toISOString(),
        prevHash: row.prevHash,
        hash: row.hash,
      });
      prevHash = hash;
    }

    return stored;
  });
}

export async function verifyChain(db: Db): Promise<{ ok: true; count: number } | { ok: false; brokenAtSeq: number; reason: string }> {
  let previousHash = GENESIS_HASH;
  let lastSeq = 0;
  let count = 0;

  while (true) {
    const page = await db
      .select()
      .from(eventRows)
      .where(gt(eventRows.seq, lastSeq))
      .orderBy(asc(eventRows.seq))
      .limit(1000);
    if (page.length === 0) return { ok: true, count };

    for (const row of page) {
      count += 1;
      lastSeq = row.seq;
      if (row.prevHash !== previousHash) {
        return { ok: false, brokenAtSeq: row.seq, reason: "prev_hash mismatch" };
      }

      const at = new Date(row.at).toISOString();
      const expectedHash = sha256Hex(`${previousHash}\n${canonicalJson({
        id: row.id,
        stream: row.stream,
        type: row.type,
        payload: row.payload,
        actor: row.actor,
        at,
      })}`);
      if (row.hash !== expectedHash) return { ok: false, brokenAtSeq: row.seq, reason: "hash mismatch" };
      previousHash = row.hash;
    }
  }
}
