import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrationsFolder, runMigrations, schema } from "@untangle/db";
import type { Db } from "@untangle/db";
import { buildApp } from "../app.ts";
import { ensureNetwork } from "../bootstrap.ts";
import type { Config } from "../config.ts";
import { createContext } from "../context.ts";
import { createGemini } from "../ai/gemini.ts";
import { registerJobs } from "../jobs-registry.ts";
import { mainStreetBusinesses } from "../seed/main-street.ts";
import { seedNetwork } from "../seed/seed.ts";
import { createFakePayPal } from "./fake-paypal.ts";

const port = Number(process.env.PORT ?? "3000");
const config: Config = {
  databaseUrl: "pglite://memory",
  geminiModels: (process.env.GEMINI_MODELS ?? "gemini-flash-lite-latest,gemini-flash-latest,gemini-3.8-flash").split(",").map((model) => model.trim()).filter(Boolean),
  aiRequestsPerMinute: Number(process.env.AI_RPM ?? 14),
  masterKey: randomBytes(32),
  port,
  publicBaseUrl: `http://localhost:${port}`,
  demoMode: true,
  networkName: "Main Street",
  currency: "USD",
  businesses: mainStreetBusinesses.map((business) => {
    const slug = business.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return {
      slot: business.slot,
      name: business.name,
      email: `${slug}@sim.untangle.test`,
      clientId: `sim-client-${business.slot}`,
      clientSecret: `sim-secret-${business.slot}`,
    };
  }),
};

const pglite = new PGlite();
const db = drizzle(pglite, { schema }) as Db;
await runMigrations(db, migrationsFolder, "pglite");
const { fetch, sim } = createFakePayPal();
for (const business of config.businesses) sim.addMerchant(business.clientId, business.clientSecret, business.email);
const geminiKey = process.env.GEMINI_API_KEY?.trim();
const gemini = geminiKey ? createGemini({ apiKey: geminiKey, models: config.geminiModels, requestsPerMinute: config.aiRequestsPerMinute }) : null;
const ctx = createContext({ db, config, fetch, gemini, paypalTools: "simulated" });
const networkId = await ensureNetwork(ctx);
await seedNetwork(ctx, networkId, "SIM");
registerJobs(ctx);
await ctx.jobs.start();
const webRoot = fileURLToPath(new URL("../../../web/dist", import.meta.url));
const samplesDir = fileURLToPath(new URL("../../../../fixtures/evidence/files", import.meta.url));
const app = buildApp(ctx, { mode: "sim", sim, webRoot, samplesDir });
await app.listen({ port, host: "0.0.0.0" });
console.log(`Untangle simulator on http://localhost:${port} (Main Street, 25 invoices, no real PayPal)`);

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    ctx.jobs.stop();
    void app.close().finally(() => pglite.close()).finally(() => process.exit(0));
  });
}
