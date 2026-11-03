// Checks every external service Untangle needs, using the values in .env.
// Prints only outcomes, never a secret. Run: pnpm --filter @untangle/server check
import { sql } from "drizzle-orm";
import { createDb, migrationsFolder, runMigrations } from "@untangle/db";

const env = process.env;
const SANDBOX = "https://api-m.sandbox.paypal.com";
let failures = 0;

function report(ok: boolean, label: string, detail: string): void {
  if (!ok) failures++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}: ${detail}`);
}

async function checkDatabase(): Promise<void> {
  const url = env.DATABASE_URL?.trim();
  if (!url) return report(false, "Neon", "DATABASE_URL is empty");
  if (url.includes("-pooler.")) report(false, "Neon", "this is the pooled URL; use the direct one (Connect → turn Connection pooling off)");
  const { db, close } = createDb(url);
  try {
    const result = await db.execute(sql`select current_setting('server_version') as version`);
    const version = (result as unknown as { rows: { version: string }[] }).rows[0]?.version ?? "?";
    await runMigrations(db, migrationsFolder, "neon");
    const tables = await db.execute(sql`select count(*)::int as n from information_schema.tables where table_schema = 'public'`);
    const count = (tables as unknown as { rows: { n: number }[] }).rows[0]?.n ?? 0;
    report(count >= 21, "Neon", `connected (Postgres ${version}), migrations applied, ${count} tables`);
  } catch (error) {
    report(false, "Neon", error instanceof Error ? error.message.split("\n")[0]! : "connection failed");
  } finally {
    await close();
  }
}

async function checkGemini(): Promise<void> {
  const key = env.GEMINI_API_KEY?.trim();
  if (!key) return report(false, "Gemini", "GEMINI_API_KEY is empty");
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": key } });
  if (!response.ok) return report(false, "Gemini", `key rejected (HTTP ${response.status})`);
  const body = await response.json() as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
  const flash = (body.models ?? [])
    .filter((model) => model.name.includes("flash") && model.supportedGenerationMethods?.includes("generateContent"))
    .map((model) => model.name.replace("models/", ""));
  report(flash.length > 0, "Gemini", `key works; Flash models: ${flash.slice(0, 6).join(", ") || "none"}`);
}

async function checkPayPal(slot: number): Promise<void> {
  const name = env[`PAYPAL_BIZ_${slot}_NAME`]?.trim() ?? `slot ${slot}`;
  const clientId = env[`PAYPAL_BIZ_${slot}_CLIENT_ID`]?.trim();
  const secret = env[`PAYPAL_BIZ_${slot}_CLIENT_SECRET`]?.trim();
  if (!clientId || !secret) return report(false, `PayPal ${slot} ${name}`, "client id or secret not set yet");
  const tokenResponse = await fetch(`${SANDBOX}/v1/oauth2/token`, {
    method: "POST",
    headers: { authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!tokenResponse.ok) return report(false, `PayPal ${slot} ${name}`, `sandbox rejected the credentials (HTTP ${tokenResponse.status})`);
  const token = await tokenResponse.json() as { access_token: string; scope?: string };
  const scope = token.scope ?? "";
  const auth = { authorization: `Bearer ${token.access_token}` };

  const invoices = await fetch(`${SANDBOX}/v2/invoicing/invoices?page=1&page_size=1`, { headers: auth });
  const end = new Date();
  const start = new Date(end.getTime() - 24 * 3600_000);
  const search = await fetch(`${SANDBOX}/v1/reporting/transactions?start_date=${start.toISOString().slice(0, 19)}Z&end_date=${end.toISOString().slice(0, 19)}Z&page_size=1`, { headers: auth });
  const checks = [
    `invoicing ${invoices.ok ? "yes" : `no (${invoices.status})`}`,
    `payouts ${/payouts/.test(scope) ? "yes" : "no"}`,
    `transaction search ${search.ok ? "yes" : `no (${search.status})`}`,
    `disputes ${/disputes/.test(scope) ? "yes" : "no"}`,
  ];
  report(invoices.ok && /payouts/.test(scope), `PayPal ${slot} ${name}`, `token ok; ${checks.join(", ")}`);
}

await checkDatabase();
await checkGemini();
for (let slot = 1; slot <= 9; slot++) await checkPayPal(slot);
console.log(failures === 0 ? "\nEverything is ready." : `\n${failures} check(s) need attention.`);
process.exitCode = failures === 0 ? 0 : 1;
