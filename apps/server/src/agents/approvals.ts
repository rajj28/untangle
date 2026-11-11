import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { agentRuns, approvals, businesses, claims, networks, obligations } from "@untangle/db";
import { fromMoney, toMoney } from "@untangle/paypal";
import type { AppContext } from "../context.ts";
import { generateStructured } from "../ai/agent.ts";
import type { AgentTool } from "../ai/agent.ts";
import { findInvoiceId } from "../ai/paypal-tools.ts";
import { DomainError } from "../errors.ts";
import { addDays, pacificDate } from "../dates.ts";
import { syncObligation } from "../services/obligations.ts";
import { approvalViews, finishRun, startRun, stepper } from "./runs.ts";
import type { AgentName } from "./runs.ts";
import { policyFor } from "./policies.ts";
import { guardApproval } from "./guard.ts";
import { short, usd } from "./common.ts";

type ApprovalRow = typeof approvals.$inferSelect;

const LANGUAGE_NAMES: Record<string, string> = { en: "English", es: "Spanish", it: "Italian", hi: "Hindi", fr: "French", pt: "Portuguese", zh: "Chinese" };

async function approvalById(ctx: AppContext, id: string) {
  const [view] = await approvalViews(ctx, eq(approvals.id, id));
  if (view === undefined) throw new DomainError(404, "APPROVAL_NOT_FOUND", "Approval was not found");
  return view;
}

/** Runs one toolkit tool directly with arguments we built, and logs it like any agent call. */
async function callTool(step: ReturnType<typeof stepper>, tools: AgentTool[], name: string, args: Record<string, unknown>) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (tool === undefined) throw new Error(`The PayPal Agent Toolkit did not provide ${name}`);
  await step({ kind: "tool_call", title: `Called ${tool.label}`, detail: short(JSON.stringify(args), 240), tool: tool.label, businessId: tool.businessId ?? null });
  try {
    const result = await tool.run(args);
    await step({ kind: "tool_result", title: tool.summarize?.(result, args) ?? `${tool.label} answered`, tool: tool.label, businessId: tool.businessId ?? null });
    return result;
  } catch (error) {
    await step({ kind: "error", title: `${tool.label} failed`, detail: short(error instanceof Error ? error.message : String(error)), tool: tool.label, businessId: tool.businessId ?? null });
    throw error;
  }
}

/** PayPal answers the QR request with a multipart body around a base64 PNG; keep just the image. */
function qrImage(result: unknown): string | null {
  const text = typeof result === "string" ? result : JSON.stringify(result ?? "");
  const match = text.match(/iVBORw0KGgo[A-Za-z0-9+/=\s\\rn]+/);
  if (match === null) return null;
  const base64 = match[0].replace(/\\[rn]/g, "").replace(/[^A-Za-z0-9+/=]/g, "");
  return `data:image/png;base64,${base64}`;
}

/**
 * Invoicing agent: Gemini writes the invoice note in the customer's own language, then the
 * PayPal Agent Toolkit (on the creditor's own app) creates, sends and QR-codes the invoice.
 * The result is read back from PayPal before the debt joins the network.
 */
async function issueInvoice(ctx: AppContext, approval: ApprovalRow) {
  const payload = approval.payload as { claimId: string; debtorId: string; creditorId: string; amountMinor: number; item: string; dueOn: string | null };
  const [claim] = await ctx.db.select().from(claims).where(eq(claims.id, payload.claimId)).limit(1);
  if (claim === undefined) throw new DomainError(404, "CLAIM_NOT_FOUND", "Claim was not found");
  const [debtor] = await ctx.db.select().from(businesses).where(eq(businesses.id, payload.debtorId)).limit(1);
  const [creditor] = await ctx.db.select().from(businesses).where(eq(businesses.id, payload.creditorId)).limit(1);
  if (debtor === undefined || creditor === undefined) throw new DomainError(404, "BUSINESS_NOT_FOUND", "Business was not found");
  const [network] = await ctx.db.select().from(networks).where(eq(networks.id, approval.networkId)).limit(1);
  const currency = network?.currency ?? "USD";
  const runId = approval.runId ?? await startRun(ctx, approval.networkId, "invoicing", `Issue an invoice to ${debtor.name}`);
  const step = stepper(ctx, runId, "invoicing", creditor.id);
  const language = (await policyFor(ctx, debtor.id)).language;
  const dueOn = payload.dueOn ?? addDays(ctx.now(), 14);

  let note = `Invoice from ${creditor.name} for ${payload.item}. Sent through Untangle: it may be settled by set-off against what ${creditor.name} owes you.`;
  if (ctx.ai.gemini !== null) {
    try {
      const { value } = await generateStructured(ctx.ai.gemini, {
        system: "You are the Invoicing agent. Write short, warm, professional invoice notes for small businesses. Never invent amounts or terms.",
        parts: [{ text: `Write a note for a PayPal invoice from ${creditor.name} to ${debtor.name} for "${payload.item}", ${usd(payload.amountMinor, currency)}, due ${dueOn}. Write it in ${LANGUAGE_NAMES[language] ?? "English"}, at most 2 sentences, and mention it can be settled by set-off through Untangle.` }],
        jsonSchema: { type: "object", required: ["note"], properties: { note: { type: "string" } } },
        schema: z.object({ note: z.string().min(5).max(400) }),
      });
      note = value.note;
      await step({ kind: "thought", title: `Wrote the invoice note in ${LANGUAGE_NAMES[language] ?? "English"}`, detail: note });
    } catch {
      await step({ kind: "message", title: "Used the standard invoice note" });
    }
  }

  const tools = await ctx.ai.paypalTools(creditor.id, { invoices: { create: true, send: true, generateQRC: true } });
  const created = await callTool(step, tools, "create_invoice", {
    currency_code: currency,
    invoice_date: pacificDate(ctx.now()),
    note,
    invoicer_business_name: creditor.name,
    primary_recipients: [{ billing_info: { business_name: debtor.name, email_address: debtor.email } }],
    items: [{ name: payload.item.slice(0, 200), quantity: "1", unit_amount: toMoney(payload.amountMinor, currency) }],
    // Set-offs record partial payments on the invoice, so the invoice must accept them.
    allow_partial_payment: true,
  });
  const invoiceId = findInvoiceId(created);
  if (invoiceId === null) throw new Error("PayPal did not return an invoice id");
  await callTool(step, tools, "send_invoice", { invoice_id: invoiceId, send_to_recipient: true });
  let qrDataUrl: string | null = null;
  try {
    qrDataUrl = qrImage(await callTool(step, tools, "generate_invoice_qr_code", { invoice_id: invoiceId, width: 300, height: 300 }));
  } catch {
    // A QR code is a convenience; the invoice itself is already out.
  }

  // Trust PayPal's own record, not the tool's answer, before the debt enters the network.
  const invoice = await (await ctx.paypal.forBusiness(creditor.id)).invoicing.get(invoiceId);
  const amountMinor = invoice.amount === undefined ? payload.amountMinor : fromMoney(invoice.amount as { value: string; currency_code: string });
  const [obligation] = await ctx.db.insert(obligations).values({
    networkId: approval.networkId, debtorId: debtor.id, creditorId: creditor.id, amountMinor, outstandingMinor: amountMinor, currency,
    dueOn, description: payload.item.slice(0, 200), status: "invoiced", paypalInvoiceId: invoiceId,
    creditorConfirmedAt: ctx.now(),
  }).onConflictDoNothing().returning({ id: obligations.id });
  if (obligation !== undefined) await syncObligation(ctx, obligation.id);
  await ctx.db.update(claims).set({ status: "matched", obligationId: obligation?.id ?? null }).where(eq(claims.id, claim.id));
  await step({ kind: "decision", title: `Invoice ${invoiceId} for ${usd(amountMinor, currency)} is on its way to ${debtor.name} through PayPal`, detail: `PayPal shows it as ${invoice.status}. It joins the next clearing round.` });
  await ctx.bus.emit(`network:${approval.networkId}`, "claim.invoiced", { claimId: claim.id, obligationId: obligation?.id ?? null, invoiceId });
  if (approval.runId === null) await finishRun(ctx, runId, "completed", `Sent invoice ${invoiceId} to ${debtor.name}.`);
  return { invoiceId, obligationId: obligation?.id ?? null, qrDataUrl, status: invoice.status };
}

/** Discovery found these invoices on PayPal; after approval they join the clearing network. */
async function importInvoices(ctx: AppContext, approval: ApprovalRow) {
  const payload = approval.payload as { invoices: { invoiceId: string; debtorId: string; description: string | null; dueOn: string | null }[] };
  const client = await ctx.paypal.forBusiness(approval.businessId);
  const added: string[] = [];
  for (const item of payload.invoices) {
    const invoice = await client.invoicing.get(item.invoiceId);
    if (!["SENT", "UNPAID", "PARTIALLY_PAID"].includes(invoice.status) || invoice.amount === undefined) continue;
    const amountMinor = fromMoney(invoice.amount as { value: string; currency_code: string });
    const [row] = await ctx.db.insert(obligations).values({
      networkId: approval.networkId, debtorId: item.debtorId, creditorId: approval.businessId, amountMinor, outstandingMinor: amountMinor,
      currency: invoice.detail.currency_code, dueOn: item.dueOn, description: item.description, status: "invoiced", paypalInvoiceId: item.invoiceId,
      creditorConfirmedAt: ctx.now(),
    }).onConflictDoNothing().returning({ id: obligations.id });
    if (row === undefined) continue;
    await syncObligation(ctx, row.id);
    added.push(item.invoiceId);
  }
  if (approval.runId !== null) {
    await stepper(ctx, approval.runId, "discovery", approval.businessId)({ kind: "decision", title: `Added ${added.length} PayPal invoice${added.length === 1 ? "" : "s"} to the network` });
  }
  await ctx.bus.emit(`network:${approval.networkId}`, "obligation.imported", { invoiceIds: added });
  return { imported: added };
}

/** Collections agent: the reminder goes out through the toolkit on the creditor's own account. */
async function sendReminder(ctx: AppContext, approval: ApprovalRow) {
  const payload = approval.payload as { invoiceId: string; subject: string; note: string };
  const runId = approval.runId ?? await startRun(ctx, approval.networkId, "collections", "Send a reminder");
  const tools = await ctx.ai.paypalTools(approval.businessId, { invoices: { sendReminder: true } });
  await callTool(stepper(ctx, runId, "collections", approval.businessId), tools, "send_invoice_reminder", { invoice_id: payload.invoiceId, subject: payload.subject, note: payload.note });
  if (approval.runId === null) await finishRun(ctx, runId, "completed", `Reminder sent for ${payload.invoiceId}.`);
  return { reminded: payload.invoiceId };
}

/**
 * After two treasurers agree on a lower amount: the toolkit cancels the old PayPal invoice and issues a
 * new one at the agreed amount, on the creditor's own account.
 */
async function adjustInvoice(ctx: AppContext, approval: ApprovalRow) {
  const payload = approval.payload as { obligationId: string; agreedMinor: number };
  const [old] = await ctx.db.select().from(obligations).where(eq(obligations.id, payload.obligationId)).limit(1);
  if (old === undefined || old.paypalInvoiceId === null) throw new DomainError(404, "OBLIGATION_NOT_FOUND", "Invoice was not found");
  const [debtor] = await ctx.db.select().from(businesses).where(eq(businesses.id, old.debtorId)).limit(1);
  const [creditor] = await ctx.db.select().from(businesses).where(eq(businesses.id, old.creditorId)).limit(1);
  if (debtor === undefined || creditor === undefined) throw new DomainError(404, "BUSINESS_NOT_FOUND", "Business was not found");
  const runId = approval.runId ?? await startRun(ctx, approval.networkId, "invoicing", `Reissue an invoice to ${debtor.name}`);
  const step = stepper(ctx, runId, "invoicing", creditor.id);
  const tools = await ctx.ai.paypalTools(creditor.id, { invoices: { cancel: true, create: true, send: true, generateQRC: true } });
  await callTool(step, tools, "cancel_sent_invoice", { invoice_id: old.paypalInvoiceId, note: `Replaced by an invoice for the agreed ${usd(payload.agreedMinor, old.currency)}.`, send_to_recipient: true });
  await ctx.db.update(obligations).set({ status: "cancelled", updatedAt: ctx.now() }).where(eq(obligations.id, old.id));
  const created = await callTool(step, tools, "create_invoice", {
    currency_code: old.currency, invoice_date: pacificDate(ctx.now()),
    note: `Replaces invoice ${old.paypalInvoiceId} at the amount both sides agreed.`,
    invoicer_business_name: creditor.name,
    primary_recipients: [{ billing_info: { business_name: debtor.name, email_address: debtor.email } }],
    items: [{ name: (old.description ?? "Agreed amount").slice(0, 200), quantity: "1", unit_amount: toMoney(payload.agreedMinor, old.currency) }],
    allow_partial_payment: true,
  });
  const invoiceId = findInvoiceId(created);
  if (invoiceId === null) throw new Error("PayPal did not return an invoice id");
  await callTool(step, tools, "send_invoice", { invoice_id: invoiceId, send_to_recipient: true });
  let qrDataUrl: string | null = null;
  try {
    qrDataUrl = qrImage(await callTool(step, tools, "generate_invoice_qr_code", { invoice_id: invoiceId, width: 300, height: 300 }));
  } catch {
    // Optional, as above.
  }
  const [row] = await ctx.db.insert(obligations).values({
    networkId: old.networkId, debtorId: old.debtorId, creditorId: old.creditorId, amountMinor: payload.agreedMinor, outstandingMinor: payload.agreedMinor,
    currency: old.currency, dueOn: old.dueOn, description: old.description, status: "invoiced", paypalInvoiceId: invoiceId,
    creditorConfirmedAt: ctx.now(),
  }).onConflictDoNothing().returning({ id: obligations.id });
  if (row !== undefined) await syncObligation(ctx, row.id);
  await step({ kind: "decision", title: `Reissued as ${invoiceId} for the agreed ${usd(payload.agreedMinor, old.currency)}` });
  return { invoiceId, obligationId: row?.id ?? null, qrDataUrl, replaced: old.paypalInvoiceId };
}

export async function decideApproval(ctx: AppContext, approvalId: string, decision: "approve" | "reject") {
  return ctx.locks.run(`approval:${approvalId}`, async () => {
    const [row] = await ctx.db.select().from(approvals).where(eq(approvals.id, approvalId)).limit(1);
    if (row === undefined) throw new DomainError(404, "APPROVAL_NOT_FOUND", "Approval was not found");
    if (row.status !== "pending") return approvalById(ctx, approvalId);
    if (decision === "reject") {
      await ctx.db.update(approvals).set({ status: "rejected", decidedAt: ctx.now() }).where(and(eq(approvals.id, approvalId), eq(approvals.status, "pending")));
      if (row.kind === "issue_invoice") {
        const payload = row.payload as { claimId?: string };
        if (payload.claimId !== undefined) await ctx.db.update(claims).set({ status: "rejected" }).where(eq(claims.id, payload.claimId));
      }
    } else {
      // "The AI proposes, fixed rules decide": run the deterministic guard before
      // any proposal can be approved. A blocked proposal is stored as a blocked
      // approval with the rule that fired and the offending excerpt.
      const guard = await guardApproval(ctx, { kind: row.kind, businessId: row.businessId, payload: row.payload as Record<string, unknown> });
      if (!guard.ok) {
        await ctx.db.update(approvals).set({
          status: "blocked",
          decidedAt: ctx.now(),
          blockedRule: guard.rule,
          blockedExcerpt: guard.excerpt,
        }).where(and(eq(approvals.id, approvalId), eq(approvals.status, "pending")));
        await ctx.bus.emit(row.runId === null ? `network:${row.networkId}` : `agent:${row.runId}`, "agent.approval_blocked", {
          approvalId, rule: guard.rule, excerpt: guard.excerpt, agent: row.agent as AgentName,
        });
        return approvalById(ctx, approvalId);
      }
      await ctx.db.update(approvals).set({ status: "approved", decidedAt: ctx.now() }).where(and(eq(approvals.id, approvalId), eq(approvals.status, "pending")));
      if (row.kind !== "pay_checkout") {
        try {
          const result = row.kind === "issue_invoice" ? await issueInvoice(ctx, row)
            : row.kind === "import_invoices" ? await importInvoices(ctx, row)
              : row.kind === "adjust_invoice" ? await adjustInvoice(ctx, row)
                : await sendReminder(ctx, row);
          await ctx.db.update(approvals).set({ status: "executed", result }).where(eq(approvals.id, approvalId));
        } catch (error) {
          await ctx.db.update(approvals).set({ status: "failed", result: { error: error instanceof Error ? error.message : String(error) } }).where(eq(approvals.id, approvalId));
        }
      }
    }
    // A run that was only waiting on owners is done once nothing it asked for is still pending.
    if (row.runId !== null) {
      const [stillPending] = await ctx.db.select({ id: approvals.id }).from(approvals).where(and(eq(approvals.runId, row.runId), eq(approvals.status, "pending"))).limit(1);
      if (stillPending === undefined) await ctx.db.update(agentRuns).set({ status: "completed" }).where(and(eq(agentRuns.id, row.runId), eq(agentRuns.status, "waiting")));
    }
    const view = await approvalById(ctx, approvalId);
    await ctx.bus.emit(row.runId === null ? `network:${row.networkId}` : `agent:${row.runId}`, "agent.approval_decided", { approvalId, status: view.status, agent: row.agent as AgentName });
    return view;
  });
}

export async function listApprovals(ctx: AppContext, networkId: string, status?: string) {
  return approvalViews(ctx, status === undefined ? eq(approvals.networkId, networkId) : and(eq(approvals.networkId, networkId), eq(approvals.status, status)));
}
