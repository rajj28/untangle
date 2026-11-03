import { eq } from "drizzle-orm";
import { businesses, createDb, migrationsFolder, paypalAccounts, runMigrations } from "@untangle/db";
import { ensureNetwork } from "../src/bootstrap.ts";
import { loadConfig } from "../src/config.ts";
import { createContext } from "../src/context.ts";

const eventTypes = [
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.REFUNDED",
  "PAYMENT.CAPTURE.REVERSED",
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
  "PAYMENT.PAYOUTS-ITEM.FAILED",
  "PAYMENT.PAYOUTS-ITEM.RETURNED",
  "PAYMENT.PAYOUTS-ITEM.UNCLAIMED",
  "PAYMENT.PAYOUTS-ITEM.BLOCKED",
  "PAYMENT.PAYOUTS-ITEM.CANCELED",
  "PAYMENT.PAYOUTS-ITEM.DENIED",
  "PAYMENT.PAYOUTS-ITEM.HELD",
  "INVOICING.INVOICE.PAID",
  "INVOICING.INVOICE.UPDATED",
  "INVOICING.INVOICE.CANCELLED",
].map((name) => ({ name }));

const config = loadConfig();
if (!config.publicBaseUrl.startsWith("https://")) throw new Error("PUBLIC_BASE_URL must start with https:// for PayPal webhooks");
const { db, close } = createDb(config.databaseUrl);
try {
  await runMigrations(db, migrationsFolder, "neon");
  const ctx = createContext({ db, config });
  const networkId = await ensureNetwork(ctx);
  const rows = await db.select({ id: businesses.id, name: businesses.name }).from(businesses).where(eq(businesses.networkId, networkId));
  for (const business of rows) {
    const url = `${config.publicBaseUrl}/webhooks/paypal/${business.id}`;
    const client = await ctx.paypal.forBusiness(business.id);
    const existing = (await client.webhooks.list()).find((webhook) => webhook.url === url);
    const webhook = existing ?? await client.webhooks.create({ url, event_types: eventTypes });
    await db.update(paypalAccounts).set({ webhookId: webhook.id }).where(eq(paypalAccounts.businessId, business.id));
    console.log(`${business.name}: ${webhook.id}`);
  }
} finally {
  await close();
}
