// Creates invoices directly in PayPal (not through Untangle) so the Discovery agent has something real to find.
import { toMoney } from "@untangle/paypal";
import { createDb } from "@untangle/db";
import { loadConfig } from "../src/config.ts";
import { createContext } from "../src/context.ts";
import { ensureNetwork } from "../src/bootstrap.ts";
import { businesses } from "@untangle/db";

const config = loadConfig();
const { db, close } = createDb(config.databaseUrl);
const ctx = createContext({ db, config });
await ensureNetwork(ctx);
const rows = await db.select().from(businesses);
const by = (name: string) => rows.find((row) => row.name === name)!;
const tag = Date.now().toString(36).toUpperCase();
const plan: [string, string, number, string][] = [
  ["Bean & Leaf Roasters", "Main St Print Shop", 300, "Coffee for the print shop's open house"],
  ["Main St Print Shop", "Sparkle Cleaning Co", 300, "Printed flyers and price lists"],
  ["Sparkle Cleaning Co", "Bean & Leaf Roasters", 300, "Roastery deep clean"],
  ["Green Valley Dairy", "Corner Cafe", 250, "Extra cream for the holiday menu"],
];
let n = 0;
for (const [creditor, debtor, dollars, item] of plan) {
  const client = await ctx.paypal.forBusiness(by(creditor).id);
  const draft = await client.invoicing.createDraft({
    detail: { currency_code: "USD", invoice_number: `OUT-${tag}-${++n}`, note: "Sent directly in PayPal." },
    primary_recipients: [{ billing_info: { email_address: by(debtor).email, name: { business_name: debtor } } }],
    items: [{ name: item, quantity: "1", unit_amount: toMoney(dollars * 100, "USD") }],
    configuration: { partial_payment: { allow_partial_payment: true } },
  }, { idempotencyKey: `outside-${tag}-${n}` });
  await client.invoicing.send(draft.id, { send_to_recipient: true, send_to_invoicer: false });
  console.log(`${creditor} -> ${debtor}: $${dollars} as ${draft.id}`);
}
await close();
