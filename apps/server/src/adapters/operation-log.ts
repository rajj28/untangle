import { eq, sql } from "drizzle-orm";
import type { OperationLog, OpRecord } from "@untangle/executor";
import type { Db } from "@untangle/db";
import { operations } from "@untangle/db";

export class DbOperationLog implements OperationLog {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async get(key: string): Promise<OpRecord | undefined> {
    const [row] = await this.db.select().from(operations).where(eq(operations.idemKey, key)).limit(1);
    if (row === undefined) return undefined;
    return {
      key: row.idemKey,
      status: row.status as OpRecord["status"],
      attempts: row.attempts,
      ref: row.paypalRef,
      error: row.lastError,
    };
  }

  async put(op: OpRecord): Promise<void> {
    const separator = op.key.indexOf(":");
    const kind = separator < 0 ? op.key : op.key.slice(0, separator);
    const refId = separator < 0 ? "" : op.key.slice(separator + 1);
    await this.db.insert(operations).values({
      idemKey: op.key,
      kind,
      refId,
      status: op.status,
      attempts: op.attempts,
      paypalRef: op.ref,
      lastError: op.error,
    }).onConflictDoUpdate({
      target: operations.idemKey,
      set: {
        status: op.status,
        attempts: op.attempts,
        paypalRef: op.ref,
        lastError: op.error,
        updatedAt: sql`now()`,
      },
    });
  }
}
