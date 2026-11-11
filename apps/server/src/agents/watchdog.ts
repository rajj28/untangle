import { and, asc, eq, gt, inArray, isNotNull, lte } from "drizzle-orm";
import { z } from "zod";
import { obligations } from "@untangle/db";
import type { AppContext } from "../context.ts";
import { generateStructured, runAgent } from "../ai/agent.ts";
import type { AgentTool, ToolCallRecord } from "../ai/agent.ts";
import { invoiceDueMinor } from "../ai/paypal-tools.ts";
import { addDays } from "../dates.ts";
import { DomainError } from "../errors.ts";
import { getRound } from "../services/rounds.ts";
import { networkBusinesses, requireGemini, slug, usd } from "./common.ts";
import { policyFor } from "./policies.ts";
import { finishRun, requestApproval, startRun, stepper } from "./runs.ts";

/**
 * Watchdog: after a round, re-reads every invoice it touched straight from PayPal (through each
 * creditor's own toolkit) and checks the accounts that received chain payments for disputes.
 * The comparison itself is deterministic; anything the agent skipped is checked directly.
 */
export async function runWatchdog(ctx: AppContext, runId: string, roundId: string) {
  const gemini = requireGemini(ctx);
  const step = stepper(ctx, runId, "watchdog");
  const round = await getRound(ctx, roundId);
  const heldLoops = round.heldForFraudReview.length;
  const touched = [...new Set([...round.setoffs.map((setoff) => setoff.obligationId), ...round.transfers.flatMap((transfer) => transfer.legs.map((leg) => leg.obligationId))])];
  if (touched.length === 0) {
    await step({ kind: "decision", title: "Nothing to verify in this round" });
    return { checked: 0, matched: 0, mismatches: [] as string[], disputes: 0, duplicates: 0, paypalCalls: 0, heldLoops };
  }
  const rows = await ctx.db.select().from(obligations).where(and(inArray(obligations.id, touched), isNotNull(obligations.paypalInvoiceId)));
  const members = await networkBusinesses(ctx, round.networkId);
  const payees = new Set(round.transfers.filter((transfer) => transfer.status === "committed").map((transfer) => transfer.payeeId));
  const creditors = new Set(rows.map((row) => row.creditorId));
  const tools: AgentTool[] = [];
  for (const business of members.filter((member) => creditors.has(member.id) || payees.has(member.id))) {
    tools.push(...await ctx.ai.paypalTools(business.id, { invoices: { get: true }, disputes: { list: true } }, { prefix: slug(business.name), businessName: business.name }));
  }
  const nameOf = new Map(members.map((member) => [member.id, member.name]));
  const { calls } = await runAgent(gemini, {
    system: "You are the Watchdog agent of Untangle. You verify the clearing network's records against PayPal using read-only tools, each signed in as one business's own PayPal account. Be brief.",
    prompt: [{ text: `Verify these invoices on PayPal (call get_invoice on the account shown; call as many as you can at once): ${rows.map((row) => `${row.paypalInvoiceId} on ${nameOf.get(row.creditorId)}'s account`).join("; ")}. Then list open disputes on these accounts, which received chain payments: ${[...payees].map((id) => nameOf.get(id)).join(", ") || "none"}. Finish with one sentence.` }],
    tools,
    onStep: step,
    maxSteps: 6,
  });

  const seen = new Map<string, unknown>();
  for (const call of calls) if (call.ok && call.tool.endsWith("__get_invoice")) seen.set(String(call.args.invoice_id ?? ""), call.result);
  for (const row of rows) {
    if (seen.has(row.paypalInvoiceId!)) continue;
    const tool = tools.find((candidate) => candidate.name === `${slug(nameOf.get(row.creditorId) ?? "")}__get_invoice`);
    if (tool === undefined) continue;
    try {
      seen.set(row.paypalInvoiceId!, await tool.run({ invoice_id: row.paypalInvoiceId }));
    } catch {
      // Reported below as not verified.
    }
  }
  const mismatches: string[] = [];
  let matched = 0;
  for (const row of rows) {
    const due = invoiceDueMinor(seen.get(row.paypalInvoiceId!));
    if (due === null) { mismatches.push(`${row.paypalInvoiceId} could not be read`); continue; }
    if (Math.min(row.amountMinor, Math.max(0, due)) === row.outstandingMinor) matched++;
    else mismatches.push(`${row.paypalInvoiceId}: PayPal says ${usd(due)} due, Untangle has ${usd(row.outstandingMinor)}`);
  }
  // Exactly-once, checked on PayPal itself: every Untangle payment carries a unique marker in its note.
  let duplicates = 0;
  for (const result of seen.values()) {
    const notes = ((result as { payments?: { transactions?: { note?: string }[] } } | null)?.payments?.transactions ?? []).map((transaction) => transaction.note ?? "");
    const markers = notes.flatMap((note) => note.match(/\[untangle:[^\]]+\]/g) ?? []);
    duplicates += markers.length - new Set(markers).size;
  }
  const disputes = calls.filter((call: ToolCallRecord) => call.ok && call.tool.endsWith("__list_disputes"))
    .reduce((sum, call) => sum + (((call.result as { items?: unknown[] } | null)?.items ?? []).length), 0);
  await step({
    kind: "decision",
    title: mismatches.length === 0 ? `All ${matched} invoices match PayPal; ${duplicates === 0 ? "zero duplicate payments" : `${duplicates} DUPLICATE payment(s)`}${disputes === 0 ? "; no disputes" : `; ${disputes} dispute(s) to look at`}` : `${mismatches.length} invoice(s) differ from PayPal`,
    detail: mismatches.length === 0 ? null : mismatches.slice(0, 5).join("; "),
  });
  if (heldLoops > 0) {
    await step({ kind: "decision", title: `${heldLoops} loop(s) were held by the fraud-ring screen in this round's plan` });
  }
  return { checked: rows.length, matched, mismatches, disputes, duplicates, paypalCalls: calls.length, heldLoops };
}

/** Runs the Watchdog on its own, e.g. after a round that was interrupted by a crash. */
export async function startVerification(ctx: AppContext, roundId: string): Promise<string> {
  requireGemini(ctx);
  const round = await getRound(ctx, roundId);
  if (round.status === "planned" || round.status === "consenting") throw new DomainError(409, "ROUND_NOT_EXECUTED", "This round has not written anything to PayPal yet");
  const runId = await startRun(ctx, round.networkId, "verify", "Check every invoice in the round against PayPal");
  void runWatchdog(ctx, runId, roundId).then((result) => finishRun(ctx, runId, result.mismatches.length === 0 && result.duplicates === 0 ? "completed" : "failed",
    result.mismatches.length === 0
      ? `${result.matched} of ${result.checked} invoices match PayPal; ${result.duplicates} duplicate payments.`
      : `${result.mismatches.length} invoice(s) differ from PayPal.`,
    { checked: result.checked, matched: result.matched, duplicates: result.duplicates, disputes: result.disputes, paypalCalls: result.paypalCalls },
  )).catch((error: unknown) => finishRun(ctx, runId, "failed", `Verification stopped: ${error instanceof Error ? error.message : String(error)}`).catch(() => undefined));
  return runId;
}

const reminderSchema = z.object({ reminders: z.array(z.object({ obligationId: z.string(), subject: z.string().min(3).max(120), note: z.string().min(5).max(500) })) });
const LANGUAGE_NAMES: Record<string, string> = { en: "English", es: "Spanish", it: "Italian", hi: "Hindi", fr: "French", pt: "Portuguese", zh: "Chinese" };

/** Collections: invoices still open and due soon get a polite reminder, drafted in the debtor's language, sent only on approval. */
export async function runCollections(ctx: AppContext, runId: string, networkId: string) {
  const gemini = requireGemini(ctx);
  const step = stepper(ctx, runId, "collections");
  const horizon = addDays(ctx.now(), 7);
  const open = await ctx.db.select().from(obligations).where(and(
    eq(obligations.networkId, networkId), inArray(obligations.status, ["invoiced", "partially_settled"]),
    gt(obligations.outstandingMinor, 0), isNotNull(obligations.paypalInvoiceId), lte(obligations.dueOn, horizon),
  )).orderBy(asc(obligations.dueOn)).limit(5);
  if (open.length === 0) {
    await step({ kind: "decision", title: "Nothing to chase: every invoice is settled or not yet due" });
    return { reminders: 0 };
  }
  const names = new Map((await networkBusinesses(ctx, networkId)).map((member) => [member.id, member.name]));
  const facts = await Promise.all(open.map(async (row) => ({
    obligationId: row.id, from: names.get(row.creditorId), to: names.get(row.debtorId), amountDue: usd(row.outstandingMinor, row.currency),
    for: row.description, dueOn: row.dueOn, language: LANGUAGE_NAMES[(await policyFor(ctx, row.debtorId)).language] ?? "English",
  })));
  const { value } = await generateStructured(gemini, {
    system: "You are the Collections agent. Draft short, friendly payment reminders between small businesses that work together. Write each in the given language. Mention that the invoice can also be settled by set-off in the next Untangle round. Never threaten, never invent numbers.",
    parts: [{ text: JSON.stringify(facts) }],
    jsonSchema: { type: "object", required: ["reminders"], properties: { reminders: { type: "array", items: { type: "object", required: ["obligationId", "subject", "note"], properties: { obligationId: { type: "string" }, subject: { type: "string" }, note: { type: "string" } } } } } },
    schema: reminderSchema,
  });
  let created = 0;
  for (const reminder of value.reminders) {
    const row = open.find((item) => item.id === reminder.obligationId);
    if (row === undefined) continue;
    await requestApproval(ctx, {
      runId, networkId, businessId: row.creditorId, agent: "collections", kind: "send_reminder",
      title: `Send ${names.get(row.debtorId)} a reminder for ${usd(row.outstandingMinor, row.currency)}`,
      detail: `${reminder.subject}: ${reminder.note}`,
      payload: { invoiceId: row.paypalInvoiceId, obligationId: row.id, subject: reminder.subject, note: reminder.note },
    });
    created++;
  }
  await step({ kind: "decision", title: `Drafted ${created} reminder${created === 1 ? "" : "s"}; each waits for its owner's approval` });
  return { reminders: created };
}
