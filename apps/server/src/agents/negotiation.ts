import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { businesses, claims, evidence, obligations, rounds, setoffs, transferLegs, transfers } from "@untangle/db";
import type { AppContext } from "../context.ts";
import { generateStructured } from "../ai/agent.ts";
import { DomainError } from "../errors.ts";
import { syncObligation } from "../services/obligations.ts";
import { requireGemini, short, toMinor, usd } from "./common.ts";
import { policyFor } from "./policies.ts";
import { finishRun, requestApproval, startRun, stepper } from "./runs.ts";

const ACTIVE_ROUND = ["consenting", "executing", "settling"];
const MAX_TURNS = 4;

const turnSchema = z.object({ position: z.string(), argument: z.string().min(5).max(500), accept: z.boolean() });

async function inActiveRound(ctx: AppContext, obligationId: string): Promise<boolean> {
  const viaSetoff = await ctx.db.select({ id: setoffs.id }).from(setoffs).innerJoin(rounds, eq(setoffs.roundId, rounds.id))
    .where(and(eq(setoffs.obligationId, obligationId), inArray(rounds.status, ACTIVE_ROUND))).limit(1);
  if (viaSetoff.length > 0) return true;
  const viaLeg = await ctx.db.select({ id: transferLegs.transferId }).from(transferLegs).innerJoin(transfers, eq(transferLegs.transferId, transfers.id))
    .innerJoin(rounds, eq(transfers.roundId, rounds.id)).where(and(eq(transferLegs.obligationId, obligationId), inArray(rounds.status, ACTIVE_ROUND))).limit(1);
  return viaLeg.length > 0;
}

/**
 * A debtor disputes an invoice amount. The invoice is frozen out of clearing while the two businesses'
 * AI treasurers negotiate from the evidence; a deterministic referee decides whether they agreed.
 */
export async function startDispute(ctx: AppContext, obligationId: string, input: { byBusinessId: string; claimedAmountMinor: number; reason: string }): Promise<string> {
  requireGemini(ctx);
  const [obligation] = await ctx.db.select().from(obligations).where(eq(obligations.id, obligationId)).limit(1);
  if (obligation === undefined) throw new DomainError(404, "OBLIGATION_NOT_FOUND", "Invoice was not found");
  if (input.byBusinessId !== obligation.debtorId && input.byBusinessId !== obligation.creditorId) throw new DomainError(403, "NOT_A_PARTY", "Only the two businesses on the invoice can dispute it");
  if (!["invoiced", "partially_settled"].includes(obligation.status)) throw new DomainError(409, "NOT_DISPUTABLE", "This invoice can't be disputed in its current state");
  if (input.claimedAmountMinor <= 0 || input.claimedAmountMinor >= obligation.amountMinor) throw new DomainError(422, "BAD_AMOUNT", "The disputed amount must be above zero and below the invoice amount");
  if (await inActiveRound(ctx, obligationId)) throw new DomainError(409, "OBLIGATION_IN_ROUND", "This invoice is part of a round in progress; dispute it after the round");
  const changed = await ctx.db.update(obligations).set({ status: "disputed", updatedAt: ctx.now() })
    .where(and(eq(obligations.id, obligationId), inArray(obligations.status, ["invoiced", "partially_settled"]))).returning({ id: obligations.id });
  if (changed.length === 0) throw new DomainError(409, "NOT_DISPUTABLE", "The invoice changed; try again");
  const names = new Map((await ctx.db.select({ id: businesses.id, name: businesses.name }).from(businesses).where(eq(businesses.networkId, obligation.networkId))).map((row) => [row.id, row.name]));
  const runId = await startRun(ctx, obligation.networkId, "negotiation", `Settle a disputed amount between ${names.get(obligation.debtorId)} and ${names.get(obligation.creditorId)}`);
  void negotiate(ctx, runId, obligation, input, names).catch(async (error: unknown) => {
    await ctx.db.update(obligations).set({ status: obligation.status, updatedAt: ctx.now() }).where(and(eq(obligations.id, obligationId), eq(obligations.status, "disputed")));
    await finishRun(ctx, runId, "failed", `The negotiation stopped: ${error instanceof Error ? error.message : String(error)}`).catch(() => undefined);
  });
  return runId;
}

async function negotiate(ctx: AppContext, runId: string, obligation: typeof obligations.$inferSelect, input: { byBusinessId: string; claimedAmountMinor: number; reason: string }, names: Map<string, string>) {
  const gemini = requireGemini(ctx);
  const referee = stepper(ctx, runId, "orchestrator");
  const creditorName = names.get(obligation.creditorId) ?? "the creditor";
  const debtorName = names.get(obligation.debtorId) ?? "the debtor";
  const invoiceMinor = obligation.amountMinor;

  // Evidence on file: what Intake read when the debt came in.
  const linked = await ctx.db.select({ quote: claims.quote, evidenceId: claims.evidenceId }).from(claims).where(eq(claims.obligationId, obligation.id));
  const evidenceLines: string[] = [];
  for (const claim of linked) {
    if (claim.quote) evidenceLines.push(`Quote: "${claim.quote}"`);
    if (claim.evidenceId === null) continue;
    const [row] = await ctx.db.select({ extraction: evidence.extraction }).from(evidence).where(eq(evidence.id, claim.evidenceId)).limit(1);
    const extraction = (row?.extraction ?? {}) as { fileName?: string; summary?: string; transcript?: string; warnings?: string[] };
    if (extraction.transcript) evidenceLines.push(`Transcript of ${extraction.fileName ?? "the evidence"}:\n${extraction.transcript}`);
    else if (extraction.summary) evidenceLines.push(`Summary of ${extraction.fileName ?? "the evidence"}: ${extraction.summary}`);
    for (const warning of extraction.warnings ?? []) evidenceLines.push(`Note from Intake: ${warning}`);
  }

  // The creditor's treasurer reads the live invoice from PayPal through its own toolkit.
  const creditorStep = stepper(ctx, runId, "treasurer", obligation.creditorId);
  let invoiceFacts = `PayPal invoice ${obligation.paypalInvoiceId ?? ""} for ${usd(invoiceMinor, obligation.currency)}${obligation.description ? ` (${obligation.description})` : ""}.`;
  if (obligation.paypalInvoiceId !== null) {
    try {
      const [getInvoice] = await ctx.ai.paypalTools(obligation.creditorId, { invoices: { get: true } });
      if (getInvoice !== undefined) {
        await creditorStep({ kind: "tool_call", title: `Called ${getInvoice.label}`, detail: obligation.paypalInvoiceId, tool: getInvoice.label });
        const invoice = await getInvoice.run({ invoice_id: obligation.paypalInvoiceId }) as { status?: string; items?: { name?: string }[] };
        await creditorStep({ kind: "tool_result", title: getInvoice.summarize?.(invoice, {}) ?? "Read the invoice", tool: getInvoice.label });
        invoiceFacts += ` PayPal shows it as ${invoice.status ?? "unknown"}${invoice.items?.[0]?.name ? `, for "${invoice.items[0].name}"` : ""}.`;
      }
    } catch {
      // The negotiation can still proceed from what Untangle holds.
    }
  }

  const facts = [
    invoiceFacts,
    `${debtorName} disputes it and says the agreed amount was ${usd(input.claimedAmountMinor, obligation.currency)}. Their reason: "${input.reason}".`,
    evidenceLines.length > 0 ? `Evidence on file:\n${evidenceLines.join("\n")}` : "There is no evidence on file beyond the invoice itself.",
  ].join("\n\n");
  await referee({ kind: "thought", title: `Dispute opened: ${debtorName} says ${usd(input.claimedAmountMinor, obligation.currency)}, the invoice says ${usd(invoiceMinor, obligation.currency)}`, detail: short(input.reason, 200) });

  const transcript: { side: "debtor" | "creditor"; positionMinor: number; argument: string }[] = [];
  let agreed: number | null = null;
  for (let turn = 0; turn < MAX_TURNS && agreed === null; turn++) {
    const side = turn % 2 === 0 ? "debtor" as const : "creditor" as const;
    const businessId = side === "debtor" ? obligation.debtorId : obligation.creditorId;
    const me = side === "debtor" ? debtorName : creditorName;
    const them = side === "debtor" ? creditorName : debtorName;
    const language = (await policyFor(ctx, businessId)).language;
    const history = transcript.map((entry) => `${entry.side === "debtor" ? debtorName : creditorName}: ${usd(entry.positionMinor, obligation.currency)} — ${entry.argument}`).join("\n") || "(no messages yet)";
    const { value } = await generateStructured(gemini, {
      system: `You are ${me}'s AI treasurer negotiating a disputed invoice amount with ${them}'s AI treasurer. Argue only from the evidence and the PayPal invoice, and quote the evidence when you can. Be fair: if the evidence clearly supports the other side, accept their amount. Never invent facts. Write in English${language !== "en" ? ` (your owner reads ${language}, but this negotiation is logged in English)` : ""}.`,
      parts: [{ text: `${facts}\n\nNegotiation so far:\n${history}\n\nYour move: state the amount you stand behind (a plain decimal like 450.00), a 1–2 sentence argument citing the evidence, and whether you accept ${them}'s latest amount.` }],
      jsonSchema: { type: "object", required: ["position", "argument", "accept"], properties: { position: { type: "string" }, argument: { type: "string" }, accept: { type: "boolean" } } },
      schema: turnSchema,
    });
    const positionMinor = toMinor(value.position) ?? (side === "debtor" ? input.claimedAmountMinor : invoiceMinor);
    const last = transcript.at(-1);
    transcript.push({ side, positionMinor, argument: value.argument });
    await stepper(ctx, runId, "treasurer", businessId)({ kind: "message", title: short(value.argument, 300), detail: `${me} stands at ${usd(positionMinor, obligation.currency)}${value.accept && last !== undefined ? ` and accepts ${usd(last.positionMinor, obligation.currency)}` : ""}` });
    if (value.accept && last !== undefined) agreed = last.positionMinor;
    else if (last !== undefined && Math.abs(last.positionMinor - positionMinor) <= 100) agreed = Math.max(last.positionMinor, positionMinor);
  }

  // The referee: an agreement must sit between the two opening positions, or it isn't one.
  if (agreed !== null && (agreed < input.claimedAmountMinor || agreed > invoiceMinor)) agreed = null;
  if (agreed === null) {
    await referee({ kind: "decision", title: "No agreement: both owners decide", detail: "The invoice stays out of clearing until they resolve it." });
    await finishRun(ctx, runId, "waiting", `${debtorName} and ${creditorName} did not agree; handed to the owners.`, { turns: transcript.length });
    return;
  }
  if (agreed === invoiceMinor) {
    await ctx.db.update(obligations).set({ status: obligation.outstandingMinor < obligation.amountMinor ? "partially_settled" : "invoiced", updatedAt: ctx.now() })
      .where(and(eq(obligations.id, obligation.id), eq(obligations.status, "disputed")));
    await syncObligation(ctx, obligation.id);
    await referee({ kind: "decision", title: `Agreed at ${usd(agreed, obligation.currency)}: the PayPal invoice stands`, detail: "The invoice is back in the clearing network." });
    await finishRun(ctx, runId, "completed", `Resolved in ${transcript.length} turns: the ${usd(agreed, obligation.currency)} invoice stands.`, { turns: transcript.length });
    return;
  }
  await requestApproval(ctx, {
    runId, networkId: obligation.networkId, businessId: obligation.creditorId, agent: "treasurer", kind: "adjust_invoice",
    title: `Reissue the invoice to ${debtorName} at the agreed ${usd(agreed, obligation.currency)}`,
    detail: `The treasurers agreed on ${usd(agreed, obligation.currency)} instead of ${usd(invoiceMinor, obligation.currency)}. Approving cancels the old PayPal invoice and sends a new one through the PayPal Agent Toolkit.`,
    payload: { obligationId: obligation.id, agreedMinor: agreed },
  });
  await referee({ kind: "decision", title: `Agreed at ${usd(agreed, obligation.currency)}: waiting for ${creditorName} to approve the new invoice` });
  await finishRun(ctx, runId, "waiting", `Agreed at ${usd(agreed, obligation.currency)}; ${creditorName} approves the reissued invoice.`, { turns: transcript.length });
}
