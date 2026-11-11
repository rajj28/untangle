import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { obligations, paypalAccounts } from "@untangle/db";
import { fromMoney } from "@untangle/paypal";
import type { Invoice } from "@untangle/paypal";
import type { AppContext } from "../context.ts";
import { DomainError } from "../errors.ts";
import { getObligationHistory } from "../services/obligations.ts";
import { signConfirm } from "../services/confirm.ts";
import { requireUuid } from "./shared.ts";

function payerViewUrl(invoice: Invoice): string | null {
  const detail = invoice.detail as { metadata?: { recipient_view_url?: string } };
  const meta = detail?.metadata?.recipient_view_url;
  if (typeof meta === "string" && meta.length > 0) return meta;
  const links = (invoice as { links?: { rel?: string; href?: string }[] }).links ?? [];
  for (const link of links) {
    const href = link.href ?? "";
    if (href.includes("/view/") || (href.includes("/invoice/") && !href.includes("/v2/"))) return href;
  }
  return null;
}

export const obligationRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, options) => {
  app.get<{ Params: { id: string } }>("/api/obligations/:id/history", async (request) => {
    return getObligationHistory(options.ctx, requireUuid(request.params.id));
  });
  // Signed links for both sides of an obligation, for the desk's "Copy link" action.
  app.get<{ Params: { id: string } }>("/api/obligations/:id/confirm-links", async (request) => {
    const ctx = options.ctx;
    const obligationId = requireUuid(request.params.id);
    const [row] = await ctx.db.select({ debtorId: obligations.debtorId, creditorId: obligations.creditorId }).from(obligations).where(eq(obligations.id, obligationId)).limit(1);
    if (row === undefined) throw new DomainError(404, "OBLIGATION_NOT_FOUND", "Obligation was not found");
    return {
      obligationId,
      debtorToken: signConfirm(ctx, obligationId, row.debtorId, "debtor"),
      creditorToken: signConfirm(ctx, obligationId, row.creditorId, "creditor"),
    };
  });
  // "PayPal says": read-only mirror of what PayPal actually has for this obligation's invoice.
  app.get<{ Params: { id: string } }>("/api/obligations/:id/paypal", async (request, reply) => {
    const ctx = options.ctx;
    const obligationId = requireUuid(request.params.id);
    const [row] = await ctx.db.select().from(obligations).where(eq(obligations.id, obligationId)).limit(1);
    if (row === undefined) throw new DomainError(404, "OBLIGATION_NOT_FOUND", "Obligation was not found");
    if (row.paypalInvoiceId === null) {
      return { obligationId, connected: false, status: "no_invoice", amountMinor: null, dueDate: null, payerViewUrl: null, payments: [] };
    }
    const [account] = await ctx.db.select({ businessId: paypalAccounts.businessId }).from(paypalAccounts).where(eq(paypalAccounts.businessId, row.creditorId)).limit(1);
    if (account === undefined) {
      return reply.code(503).send({ error: "PAYPAL_NOT_CONNECTED", message: "PayPal is not connected for this business, so its invoice cannot be read." });
    }
    const client = await ctx.paypal.forBusiness(row.creditorId);
    const invoice = await client.invoicing.get(row.paypalInvoiceId);
    const amount = invoice.amount ?? invoice.due_amount;
    const detail = invoice.detail as { payment_term?: { due_date?: string }; metadata?: { recipient_view_url?: string } };
    const transactions = invoice.payments?.transactions ?? [];
    return {
      obligationId,
      connected: true,
      status: invoice.status,
      amountMinor: amount === undefined || amount === null ? null : fromMoney(amount),
      dueDate: detail?.payment_term?.due_date ?? null,
      payerViewUrl: payerViewUrl(invoice),
      payments: transactions.map((transaction) => ({
        method: transaction.method ?? null,
        type: transaction.type ?? null,
        amountMinor: transaction.amount === undefined ? null : fromMoney(transaction.amount),
        date: transaction.payment_date ?? null,
        note: transaction.note ?? null,
      })),
    };
  });
};
