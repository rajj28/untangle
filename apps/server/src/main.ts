import { fileURLToPath } from "node:url";
import { createDb, migrationsFolder, runMigrations } from "@untangle/db";
import { buildApp } from "./app.ts";
import { ensureNetwork } from "./bootstrap.ts";
import { loadConfig } from "./config.ts";
import { createContext } from "./context.ts";
import { registerJobs } from "./jobs-registry.ts";
import { createGemini } from "./ai/gemini.ts";
import { interruptOrphanedRuns } from "./agents/runs.ts";

const config = loadConfig();
const { db, close } = createDb(config.databaseUrl);

try {
  await runMigrations(db, migrationsFolder, "neon");
  const gemini = config.geminiApiKey === undefined ? null : createGemini({ apiKey: config.geminiApiKey, models: config.geminiModels, requestsPerMinute: config.aiRequestsPerMinute });
  const ctx = createContext({ db, config, gemini });
  await ensureNetwork(ctx);
  registerJobs(ctx);
  await interruptOrphanedRuns(ctx);
  await ctx.jobs.start();
  const webRoot = fileURLToPath(new URL("../../web/dist", import.meta.url));
  const samplesDir = fileURLToPath(new URL("../../../fixtures/evidence/files", import.meta.url));
  const app = buildApp(ctx, { webRoot, samplesDir });
  await app.listen({ port: config.port, host: "0.0.0.0" });
  console.log(`Untangle server listening at ${config.publicBaseUrl}`);
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      ctx.jobs.stop();
      void app.close().finally(() => close()).finally(() => process.exit(0));
    });
  }
} catch (error) {
  await close();
  throw error;
}
