import { and, eq, isNotNull } from "drizzle-orm";
import { approvals, obligations } from "@untangle/db";
import { fromMoney } from "@untangle/paypal";
import type { AppContext } from "../context.ts";
import { runAgent } from "../ai/agent.ts";
import type { AgentTool, ToolCallRecord } from "../ai/agent.ts";
import { networkBusinesses, requireGemini, slug, usd } from "./common.ts";
import { requestApproval, stepper } from "./runs.ts";

interface ListedInvoice {
  id?: string; status?: string;
  detail?: { invoice_number?: string; currency_code?: string };
  primary_recipients?: { billing_info?: { email_address?: string } }[];
  amount?: { value?: string; currency_code?: string };
  due_amount?: { value?: string; currency_code?: string };
}

const OPEN = new Set(["SENT", "UNPAID", "PARTIALLY_PAID"]);

function listedInvoices(record: ToolCallRecord): ListedInvoice[] {
  const result = record.result as { items?: ListedInvoice[] } | null;
  return record.ok && Array.isArray(result?.items) ? result.items : [];
}

/**
 * Discovery: one agent holds every business's PayPal invoice tools (each signed in as that
 * business's own app) and searches them all. Unpaid invoices between network members that
 * Untangle doesn't track yet become one approval per creditor to bring them into the network.
 */
export async function runDiscovery(ctx: AppContext, networkId: string, runId: string) {
  const gemini = requireGemini(ctx);
  const step = stepper(ctx, runId, "discovery");
  const members = await networkBusinesses(ctx, networkId);
  const byEmail = new Map(members.map((business) => [business.email.toLowerCase(), business]));
  const tools: AgentTool[] = [];
  for (const business of members) {
    tools.push(...await ctx.ai.paypalTools(business.id, { invoices: { list: true } }, { prefix: slug(business.name), businessName: business.name }));
  }
  const tracked = new Set((await ctx.db.select({ id: obligations.paypalInvoiceId }).from(obligations)
    .where(and(eq(obligations.networkId, networkId), isNotNull(obligations.paypalInvoiceId)))).map((row) => row.id));

  const { text, calls } = await runAgent(gemini, {
    system: "You are the Discovery agent of Untangle, a clearing network for small businesses on PayPal. You have read-only PayPal invoice tools for each business, each signed in as that business's own PayPal account. Untangle settles debts by recording set-offs and chain payments on the invoices as external payments, so invoices marked as paid or partially paid that way are genuinely settled — that is normal, not a problem. Your job is to spot unpaid invoices (status SENT or UNPAID) between members. Be brief and factual.",
    prompt: [{ text: `Find unpaid PayPal invoices that these businesses have sent to each other: ${members.map((business) => business.name).join(", ")}. Call the list tool for every business in one turn. Then reply in two sentences: how many invoices you saw in total, and anything unusual.` }],
    tools,
    onStep: step,
    maxSteps: 3,
  });

  // The agent decides what to look at; completeness is still guaranteed: any account it skipped is listed directly.
  const queried = new Set(calls.map((call) => call.tool));
  for (const tool of tools) {
    if (queried.has(tool.name)) continue;
    await step({ kind: "tool_call", title: `Called ${tool.label} (completeness check)`, tool: tool.label, businessId: tool.businessId ?? null });
    try {
      const result = await tool.run({ page: 1, page_size: 100 });
      calls.push({ tool: tool.name, label: tool.label, args: {}, result, ok: true });
      await step({ kind: "tool_result", title: tool.summarize?.(result, {}) ?? "Listed", tool: tool.label, businessId: tool.businessId ?? null });
    } catch (error) {
      await step({ kind: "error", title: `${tool.label} failed`, detail: error instanceof Error ? error.message : String(error), tool: tool.label, businessId: tool.businessId ?? null });
    }
  }

  const found = new Map<string, { invoiceId: string; debtorId: string; amountMinor: number; dueMinor: number; currency: string; number: string | null }[]>();
  for (const call of calls) {
    const creditor = members.find((business) => call.tool.startsWith(`${slug(business.name)}__`));
    if (creditor === undefined) continue;
    for (const invoice of listedInvoices(call)) {
      const email = invoice.primary_recipients?.[0]?.billing_info?.email_address?.toLowerCase();
      const debtor = email === undefined ? undefined : byEmail.get(email);
      if (invoice.id === undefined || !OPEN.has(invoice.status ?? "") || tracked.has(invoice.id) || debtor === undefined || debtor.id === creditor.id) continue;
      if (invoice.amount?.value === undefined) continue;
      const currency = invoice.amount.currency_code ?? "USD";
      const amountMinor = fromMoney({ value: invoice.amount.value, currency_code: currency });
      const dueMinor = invoice.due_amount?.value === undefined ? amountMinor : fromMoney({ value: invoice.due_amount.value, currency_code: currency });
      const list = found.get(creditor.id) ?? [];
      list.push({ invoiceId: invoice.id, debtorId: debtor.id, amountMinor, dueMinor, currency, number: invoice.detail?.invoice_number ?? null });
      found.set(creditor.id, list);
    }
  }
  if (text.trim() !== "") await step({ kind: "thought", title: text.trim().slice(0, 240) });

  let total = 0;
  let approvalsCreated = 0;
  for (const [creditorId, items] of found) {
    const creditor = members.find((business) => business.id === creditorId)!;
    const value = items.reduce((sum, item) => sum + item.dueMinor, 0);
    total += items.length;
    // Don't ask twice about the same invoices.
    const pending = await ctx.db.select({ payload: approvals.payload }).from(approvals).where(and(eq(approvals.businessId, creditorId), eq(approvals.kind, "import_invoices"), eq(approvals.status, "pending")));
    const alreadyAsked = new Set(pending.flatMap((row) => ((row.payload as { invoices?: { invoiceId: string }[] }).invoices ?? []).map((item) => item.invoiceId)));
    const fresh = items.filter((item) => !alreadyAsked.has(item.invoiceId));
    if (fresh.length === 0) continue;
    const names = fresh.map((item) => `${members.find((business) => business.id === item.debtorId)?.name ?? "?"} ${usd(item.dueMinor, item.currency)}`);
    await requestApproval(ctx, {
      runId, networkId, businessId: creditorId, agent: "discovery", kind: "import_invoices",
      title: `Add ${fresh.length} unpaid PayPal invoice${fresh.length === 1 ? "" : "s"} (${usd(value)}) to the clearing network`,
      detail: `Discovery found these in ${creditor.name}'s PayPal account but not in Untangle: ${names.join(", ")}. Adding them lets the next round clear them against what ${creditor.name} owes.`,
      payload: { invoices: fresh.map((item) => ({ invoiceId: item.invoiceId, debtorId: item.debtorId, description: item.number === null ? null : `PayPal invoice ${item.number}`, dueOn: null })) },
    });
    approvalsCreated++;
  }
  await step({ kind: "decision", title: total === 0 ? "Every unpaid invoice between members is already in the network" : `Found ${total} unpaid invoice${total === 1 ? "" : "s"} outside the network; asked ${approvalsCreated} owner${approvalsCreated === 1 ? "" : "s"} to add them` });
  return { found: total, approvals: approvalsCreated, paypalCalls: calls.length };
}
