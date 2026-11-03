import { and, ne, eq } from "drizzle-orm";
import { createDb, migrationsFolder, runMigrations, obligations } from "@untangle/db";
import { ensureNetwork } from "../src/bootstrap.ts";
import { loadConfig } from "../src/config.ts";
import { createContext } from "../src/context.ts";
import { seedNetwork } from "../src/seed/seed.ts";

const config = loadConfig();
const { db, close } = createDb(config.databaseUrl);
try {
  await runMigrations(db, migrationsFolder, "neon");
  const ctx = createContext({ db, config });
  const networkId = await ensureNetwork(ctx);
  const open = await db.select({ id: obligations.id }).from(obligations).where(and(
    eq(obligations.networkId, networkId), ne(obligations.status, "cancelled"),
  ));
  if (open.length > 0) {
    console.log(`Already seeded: ${open.length} open invoices. Use POST /api/demo/reset for a fresh set.`);
  } else {
    const result = await seedNetwork(ctx, networkId, `M${Date.now().toString(36).toUpperCase()}`);
    console.log(`Seeded: ${result.created} created, ${result.skipped} skipped.`);
  }
} finally {
  await close();
}
