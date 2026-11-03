// The hook's Main Street scene animates the real seed invoices and the engine's real plan for them.
import { writeFileSync } from "node:fs";
import { planSettlement } from "../../packages/engine/src/index.ts";
import { mainStreetBusinesses, mainStreetInvoices } from "../../apps/server/src/seed/main-street.ts";

const obligations = mainStreetInvoices.map((invoice, index) => ({ id: `i${index + 1}`, debtor: `b${invoice.debtor}`, creditor: `b${invoice.creditor}`, amount: invoice.dollars * 100 }));
const plan = planSettlement(obligations);
const data = {
  businesses: mainStreetBusinesses.map((business) => ({ id: `b${business.slot}`, name: business.name })),
  invoices: obligations.map((obligation, index) => ({ ...obligation, item: mainStreetInvoices[index]!.item, cleared: plan.setoffs[obligation.id] ?? 0 })),
  transfers: plan.transfers.map((transfer) => ({ payer: transfer.payer, payee: transfer.payee, amount: transfer.amount, legs: transfer.legs.length })),
  stats: plan.stats,
};
writeFileSync(new URL("../src/data/main-street.json", import.meta.url), JSON.stringify(data, null, 1));
console.log(JSON.stringify(data.stats), data.transfers);
