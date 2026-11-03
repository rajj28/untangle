import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { migrate as migrateNeon } from "drizzle-orm/neon-serverless/migrator";
import type { NeonDatabase } from "drizzle-orm/neon-serverless";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import * as schema from "./schema.ts";
import type { Db } from "./client.ts";

/** The generated SQL migrations that ship with this package. */
export const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

export async function runMigrations(db: Db, migrationsFolder: string, kind: "neon" | "pglite"): Promise<void> {
  const config = { migrationsFolder };
  if (kind === "neon") {
    await db.transaction(async (transaction) => {
      await transaction.execute(sql`select pg_advisory_lock(727273)`);
      try {
        await migrateNeon(db as unknown as NeonDatabase<typeof schema>, config);
      } finally {
        await transaction.execute(sql`select pg_advisory_unlock(727273)`);
      }
    });
    return;
  }

  await db.execute(sql`select pg_advisory_lock(727273)`);
  try {
    await migratePglite(db as unknown as PgliteDatabase<typeof schema>, config);
  } finally {
    await db.execute(sql`select pg_advisory_unlock(727273)`);
  }
}
