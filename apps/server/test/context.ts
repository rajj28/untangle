import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { businesses, obligations, paypalAccounts, schema } from "@untangle/db";
import type { Db } from "@untangle/db";
import { migrationsFolder, runMigrations } from "@untangle/db";
import { buildApp } from "../src/app.ts";
import { ensureNetwork } from "../src/bootstrap.ts";
import type { Config } from "../src/config.ts";
import { createContext } from "../src/context.ts";
import { registerJobs } from "../src/jobs-registry.ts";
import { mainStreetBusinesses, mainStreetInvoices } from "../src/seed/main-street.ts";
import { seedNetwork } from "../src/seed/seed.ts";
import { createFakePayPal } from "../src/sim/fake-paypal.ts";
import type { Gemini } from "../src/ai/gemini.ts";

export async function makeTestContext(options: { town?: "trio" | "main-street"; demoWriteToken?: string; gemini?: Gemini } = {}) {
  const town = options.town ?? "trio";
  const db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await runMigrations(db, migrationsFolder, "pglite");
  const config: Config = {
    databaseUrl: "postgres://test",
    geminiModels: ["fake-model"],
    aiRequestsPerMinute: 10_000,
    masterKey: Buffer.from("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", "hex"),
    port: 3000,
    publicBaseUrl: "http://localhost:3000",
    demoMode: true,
    networkName: "Main Street",
    currency: "USD",
    businesses: town === "main-street" ? mainStreetBusinesses.map((business) => {
      const slug = business.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      return { slot: business.slot, name: business.name, email: `${slug}@sim.untangle.test`, clientId: `sim-client-${business.slot}`, clientSecret: `sim-secret-${business.slot}` };
    }) : [
      { slot: 1, name: "Bakery", email: "bakery@example.test", clientId: "client-bakery", clientSecret: "secret-bakery" },
      { slot: 2, name: "Mill", email: "mill@example.test", clientId: "client-mill", clientSecret: "secret-mill" },
      { slot: 3, name: "Trucker", email: "trucker@example.test", clientId: "client-trucker", clientSecret: "secret-trucker" },
    ],
    ...(options.demoWriteToken === undefined ? {} : { demoWriteToken: options.demoWriteToken }),
  };
  const { fetch, sim } = createFakePayPal();
  for (const business of config.businesses) sim.addMerchant(business.clientId, business.clientSecret, business.email);
  const ctx = createContext({ db, config, fetch, sleep: async () => {}, gemini: options.gemini ?? null, paypalTools: "simulated" });
  const network = await ensureNetwork(ctx);
  const businessesByEmail = await db.select().from(businesses);
  const byEmail = new Map(businessesByEmail.map((business) => [business.email, business.id]));
  const businessesBySlot: Record<number, string> = {};
  for (const business of config.businesses) {
    const id = byEmail.get(business.email);
    if (id === undefined) throw new Error(`test business ${business.email} was not created`);
    businessesBySlot[business.slot] = id;
    await db.update(paypalAccounts).set({ webhookId: `WH-${business.slot}` }).where(eq(paypalAccounts.businessId, id));
  }

  let invoiceA: string;
  let invoiceB: string;
  let invoiceC: string;
  let obligationA: string;
  let obligationB: string;
  let obligationC: string;
  if (town === "main-street") {
    await seedNetwork(ctx, network, "TEST");
    const rows = await db.select().from(obligations).where(eq(obligations.networkId, network));
    const first = rows.find((row) => row.description === mainStreetInvoices[0]?.item)!;
    const second = rows.find((row) => row.description === mainStreetInvoices[1]?.item)!;
    const third = rows.find((row) => row.description === mainStreetInvoices[2]?.item)!;
    invoiceA = first.paypalInvoiceId!;
    invoiceB = second.paypalInvoiceId!;
    invoiceC = third.paypalInvoiceId!;
    obligationA = first.id;
    obligationB = second.id;
    obligationC = third.id;
  } else {
    invoiceA = sim.createSentInvoice("mill@example.test", "bakery@example.test", 3000);
    invoiceB = sim.createSentInvoice("trucker@example.test", "mill@example.test", 2400);
    invoiceC = sim.createSentInvoice("bakery@example.test", "trucker@example.test", 2800);
    const [a, b, c] = await db.insert(obligations).values([
      { networkId: network, debtorId: businessesBySlot[1]!, creditorId: businessesBySlot[2]!, amountMinor: 3000, outstandingMinor: 3000, currency: "USD", status: "invoiced", paypalInvoiceId: invoiceA },
      { networkId: network, debtorId: businessesBySlot[2]!, creditorId: businessesBySlot[3]!, amountMinor: 2400, outstandingMinor: 2400, currency: "USD", status: "invoiced", paypalInvoiceId: invoiceB },
      { networkId: network, debtorId: businessesBySlot[3]!, creditorId: businessesBySlot[1]!, amountMinor: 2800, outstandingMinor: 2800, currency: "USD", status: "invoiced", paypalInvoiceId: invoiceC },
    ]).returning();
    if (a === undefined || b === undefined || c === undefined) throw new Error("test obligations were not inserted");
    obligationA = a.id;
    obligationB = b.id;
    obligationC = c.id;
  }
  registerJobs(ctx);
  return {
    ctx,
    sim,
    businessesBySlot,
    ids: { network, bakery: businessesBySlot[1]!, mill: businessesBySlot[2]!, trucker: businessesBySlot[3]!, a: obligationA, b: obligationB, c: obligationC, invoiceA, invoiceB, invoiceC },
    app: town === "main-street" ? buildApp(ctx, { mode: "sim", sim }) : buildApp(ctx),
  };
}
