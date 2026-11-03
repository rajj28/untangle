import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { Db } from "../src/client.ts";
import { runMigrations } from "../src/migrate.ts";
import * as schema from "../src/schema.ts";

export async function makeTestDb(): Promise<{ db: Db; close(): Promise<void> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema }) as Db;
  try {
    const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
    await runMigrations(db, migrationsFolder, "pglite");
    return { db, close: () => client.close() };
  } catch (error) {
    await client.close();
    throw error;
  }
}
