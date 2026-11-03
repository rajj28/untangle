import { eq } from "drizzle-orm";
import { businesses, networks, obligations } from "@untangle/db";
import { toMoney } from "@untangle/paypal";
import type { AppContext } from "../context.ts";
import { addDays } from "../dates.ts";
import { DomainError } from "../errors.ts";
import { mainStreetInvoices } from "./main-street.ts";

export interface SeedResult {
  created: number;
  skipped: number;
}

export async function seedNetwork(ctx: AppContext, networkId: string, runTag: string): Promise<SeedResult> {
  const [network] = await ctx.db.select().from(networks).where(eq(networks.id, networkId)).limit(1);
  if (network === undefined) throw new DomainError(404, "NETWORK_NOT_FOUND", "Network was not found");
  const businessRows = await ctx.db.select({ id: businesses.id, name: businesses.name, email: businesses.email })
    .from(businesses).where(eq(businesses.networkId, networkId));
  const idByEmail = new Map(businessRows.map((business) => [business.email.toLowerCase(), business.id]));
  const businessById = new Map(businessRows.map((business) => [business.id, business]));
  const configBySlot = new Map(ctx.config.businesses.map((business) => [business.slot, business]));
  let created = 0;
  let skipped = 0;

  for (const [index, invoice] of mainStreetInvoices.entries()) {
    const n = index + 1;
    const debtorConfig = configBySlot.get(invoice.debtor);
    const creditorConfig = configBySlot.get(invoice.creditor);
    if (debtorConfig === undefined || creditorConfig === undefined) {
      skipped += 1;
      continue;
    }
    const debtorId = idByEmail.get(debtorConfig.email.toLowerCase());
    const creditorId = idByEmail.get(creditorConfig.email.toLowerCase());
    const debtor = debtorId === undefined ? undefined : businessById.get(debtorId);
    const creditor = creditorId === undefined ? undefined : businessById.get(creditorId);
    if (debtor === undefined || creditor === undefined) throw new Error("configured seed businesses must exist in the network");

    const now = ctx.now();
    const due = addDays(now, invoice.dueInDays);
    const client = await ctx.paypal.forBusiness(creditor.id);
    const draft = await client.invoicing.createDraft({
      detail: {
        currency_code: network.currency,
        invoice_number: `UNT-${runTag}-${n.toString().padStart(3, "0")}`,
        note: "Sent through Untangle. It may be settled by set-off against what you are owed.",
        payment_term: { term_type: "DUE_ON_DATE_SPECIFIED", due_date: due },
      },
      primary_recipients: [{ billing_info: { email_address: debtorConfig.email, name: { business_name: debtor.name } } }],
      items: [{ name: invoice.item, quantity: "1", unit_amount: toMoney(invoice.dollars * 100, network.currency) }],
      configuration: { partial_payment: { allow_partial_payment: true } },
    }, { idempotencyKey: `seed-${runTag}-${n}` });
    if (draft.status === "DRAFT") {
      await client.invoicing.send(draft.id, { send_to_recipient: true, send_to_invoicer: false });
    }

    const inserted = await ctx.db.insert(obligations).values({
      networkId,
      debtorId: debtor.id,
      creditorId: creditor.id,
      amountMinor: invoice.dollars * 100,
      outstandingMinor: invoice.dollars * 100,
      currency: network.currency,
      dueOn: due,
      description: invoice.item,
      status: "invoiced",
      paypalInvoiceId: draft.id,
      debtorConfirmedAt: now,
      creditorConfirmedAt: now,
    }).onConflictDoNothing().returning({ id: obligations.id });
    if (inserted.length > 0) created += 1;
  }

  const result = { created, skipped };
  await ctx.bus.emit(`network:${networkId}`, "network.seeded", { networkId, runTag, ...result });
  return result;
}
