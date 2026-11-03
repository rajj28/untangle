import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { approvals, businesses, rounds } from "@untangle/db";
import type { AppContext } from "../context.ts";
import { generateStructured } from "../ai/agent.ts";
import { DomainError } from "../errors.ts";
import { getRound } from "../services/rounds.ts";
import { cached, networkBusinesses, requireGemini, sha256, usd } from "./common.ts";

const LANGUAGES: Record<string, string> = { en: "English", es: "Spanish (Español)", fr: "French (Français)", hi: "Hindi (हिन्दी)", zh: "Chinese (中文)", pt: "Portuguese (Português)", it: "Italian (Italiano)" };

interface StatementBody {
  setoffs: { obligationId: string; role: "creditor" | "debtor"; counterpartyId: string; amountMinor: number; outstandingBeforeMinor: number; remainingAfterMinor: number }[];
  pays: { transferId: string; payeeId: string; amountMinor: number }[];
  receives: { transferId: string; payerId: string; amountMinor: number }[];
  passThrough: { transferId: string; obligationId: string; role: "creditor" | "debtor"; amountMinor: number }[];
  totals: { clearedMinor: number; paysMinor: number; receivesMinor: number };
}

const explanationSchema = z.object({ headline: z.string().min(3), paragraphs: z.array(z.string().min(3)).min(1).max(4), actions: z.array(z.string()).max(3) });

/** Every dollar figure the model writes must be one that is actually in the statement. */
function amountsIn(text: string): number[] {
  return [...text.matchAll(/\$\s?([\d][\d.,]*)/g)].map((match) => {
    const digits = match[1]!.replace(/[.,](?=\d{3}\b)/g, "").replace(",", ".");
    return Math.round(Number(digits) * 100);
  }).filter((value) => Number.isFinite(value));
}

/**
 * Explainer: the owner's statement in plain words, in their language. Gemini only sees the signed
 * statement; every amount it writes is checked against it, and a stray number means a retry.
 */
export async function explainStatement(ctx: AppContext, roundId: string, businessId: string, language: string) {
  const gemini = requireGemini(ctx);
  const round = await getRound(ctx, roundId);
  const statement = round.statements.find((item) => item.businessId === businessId);
  if (statement === undefined) throw new DomainError(404, "STATEMENT_NOT_FOUND", "This business has no statement in the round");
  const lang = LANGUAGES[language] === undefined ? "en" : language;
  const names = new Map((await networkBusinesses(ctx, round.networkId)).map((business) => [business.id, business.name]));
  const body = statement.body as StatementBody;
  const me = names.get(businessId) ?? "your business";
  const lines = [
    ...body.setoffs.map((setoff) => setoff.role === "creditor"
      ? `${names.get(setoff.counterpartyId)} owed ${me} ${usd(setoff.outstandingBeforeMinor)}; ${usd(setoff.amountMinor)} of it is cleared by set-off (no money moves); ${usd(setoff.remainingAfterMinor)} remains.`
      : `${me} owed ${names.get(setoff.counterpartyId)} ${usd(setoff.outstandingBeforeMinor)}; ${usd(setoff.amountMinor)} of it is cleared by set-off (no money moves); ${usd(setoff.remainingAfterMinor)} remains.`),
    ...body.pays.map((pay) => `${me} pays ${names.get(pay.payeeId)} ${usd(pay.amountMinor)} with one PayPal payment.`),
    ...body.receives.map((receive) => `${me} receives ${usd(receive.amountMinor)} from ${names.get(receive.payerId)} by PayPal.`),
    ...body.passThrough.map((pass) => `An invoice where ${me} is the ${pass.role} (${usd(pass.amountMinor)}) is settled as part of someone else's chain payment.`),
    `Totals: cleared ${usd(body.totals.clearedMinor)}, pays ${usd(body.totals.paysMinor)}, receives ${usd(body.totals.receivesMinor)}.`,
  ];
  const allowed = new Set([0, ...body.setoffs.flatMap((s) => [s.amountMinor, s.outstandingBeforeMinor, s.remainingAfterMinor]), ...body.pays.map((p) => p.amountMinor), ...body.receives.map((r) => r.amountMinor), ...body.passThrough.map((p) => p.amountMinor), body.totals.clearedMinor, body.totals.paysMinor, body.totals.receivesMinor]);

  const { value, model, cached: wasCached } = await cached(ctx, `explain:v1:${statement.statementHash}:${lang}`, 1, async () => {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const result = await generateStructured(gemini, {
        system: `You explain clearing statements to busy small-business owners. Write in ${LANGUAGES[lang]}. Plain words, no jargon; when you say "set-off", explain it as both sides cancelling what they owe each other. Use dollar amounts exactly as written in the facts, with a $ sign. Never introduce any other number.`,
        parts: [{ text: `Facts for ${me}'s statement:\n${lines.join("\n")}\n\nWrite a headline, 2–3 short paragraphs, and up to 3 "what to do next" actions.${attempt > 1 ? " Your previous answer used an amount that is not in the facts; use only the amounts listed." : ""}` }],
        jsonSchema: { type: "object", required: ["headline", "paragraphs", "actions"], properties: { headline: { type: "string" }, paragraphs: { type: "array", items: { type: "string" } }, actions: { type: "array", items: { type: "string" } } } },
        schema: explanationSchema,
      });
      const all = [result.value.headline, ...result.value.paragraphs, ...result.value.actions].join(" ");
      if (amountsIn(all).every((amount) => allowed.has(amount))) return result;
    }
    // The model kept inventing numbers: fall back to the facts themselves.
    return { value: { headline: `Your statement, ${me}`, paragraphs: lines, actions: [] }, model: "statement" };
  });
  await ctx.bus.emit(`round:${roundId}`, "ai.explained", { roundId, businessId, language: lang, cached: wasCached });
  return { language: lang, model, ...value };
}

const adviceSchema = z.object({
  summary: z.string().min(3),
  recommendations: z.array(z.object({
    title: z.string().min(3), reason: z.string().min(3),
    action: z.enum(["sign_statement", "pay_checkout", "send_payouts", "review_approval", "upload_evidence", "none"]),
    targetId: z.string().nullable(), urgency: z.enum(["now", "soon", "fyi"]),
  })).max(4),
});

const recentAdvice = new Map<string, { at: number; value: unknown }>();

/** The business's AI treasurer, summarised for its owner. Every suggested action is checked against real state. */
export async function adviseBusiness(ctx: AppContext, businessId: string) {
  const gemini = requireGemini(ctx);
  const [business] = await ctx.db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (business === undefined) throw new DomainError(404, "BUSINESS_NOT_FOUND", "Business was not found");
  const [latest] = await ctx.db.select({ id: rounds.id }).from(rounds).where(eq(rounds.networkId, business.networkId)).orderBy(desc(rounds.createdAt)).limit(1);
  const round = latest === undefined ? null : await getRound(ctx, latest.id);
  const statement = round?.statements.find((item) => item.businessId === businessId) ?? null;
  const toPay = (round?.transfers ?? []).filter((transfer) => transfer.payerId === businessId && ["ready", "awaiting_payer"].includes(transfer.status));
  const myApprovals = await ctx.db.select({ id: approvals.id, title: approvals.title }).from(approvals).where(and(eq(approvals.businessId, businessId), inArray(approvals.status, ["pending"])));
  const names = new Map((await networkBusinesses(ctx, business.networkId)).map((item) => [item.id, item.name]));
  const facts = {
    business: business.name,
    round: round === null ? null : { id: round.id, status: round.status, needsMySignature: round.pendingConsents.includes(businessId), statementTotals: (statement?.body as StatementBody | undefined)?.totals ?? null },
    paymentsDue: toPay.map((transfer) => ({ transferId: transfer.id, to: names.get(transfer.payeeId), amount: usd(transfer.amountMinor, transfer.currency) })),
    approvalsWaiting: myApprovals,
  };
  const key = sha256(JSON.stringify(facts));
  const memo = recentAdvice.get(`${businessId}:${key}`);
  if (memo !== undefined && Date.now() - memo.at < 120_000) return memo.value;

  const { value, model } = await generateStructured(gemini, {
    system: `You are ${business.name}'s AI treasurer. Give the owner at most 3 concrete next steps, most urgent first, from the facts only. Use the ids given in the facts as targetId. If there is nothing to do, say so and recommend uploading new evidence of debts.`,
    parts: [{ text: JSON.stringify(facts) }],
    jsonSchema: {
      type: "object", required: ["summary", "recommendations"],
      properties: {
        summary: { type: "string" },
        recommendations: { type: "array", items: { type: "object", required: ["title", "reason", "action", "targetId", "urgency"], properties: {
          title: { type: "string" }, reason: { type: "string" },
          action: { type: "string", enum: ["sign_statement", "pay_checkout", "send_payouts", "review_approval", "upload_evidence", "none"] },
          targetId: { type: ["string", "null"] }, urgency: { type: "string", enum: ["now", "soon", "fyi"] },
        } } },
      },
    },
    schema: adviceSchema,
  });
  // Drop any suggestion that points at something which doesn't exist or isn't this business's to do.
  const valid = value.recommendations.filter((item) => {
    if (item.action === "sign_statement") return round !== null && round.pendingConsents.includes(businessId);
    if (item.action === "pay_checkout" || item.action === "send_payouts") return toPay.some((transfer) => transfer.id === item.targetId);
    if (item.action === "review_approval") return myApprovals.some((approval) => approval.id === item.targetId);
    return true;
  }).map((item) => item.action === "sign_statement" ? { ...item, targetId: round?.id ?? null } : item);
  const advice = { businessId, summary: value.summary, recommendations: valid, model };
  recentAdvice.set(`${businessId}:${key}`, { at: Date.now(), value: advice });
  return advice;
}

/** AG Grid AI Toolkit: turn a plain-English question into grid state for the grid's own schema. */
export async function gridQuery(ctx: AppContext, input: { question: string; schema: Record<string, unknown>; state: Record<string, unknown> }) {
  const gemini = requireGemini(ctx);
  if (JSON.stringify(input.schema).length > 200_000) throw new DomainError(422, "SCHEMA_TOO_LARGE", "The grid schema is too large");
  // AG Grid's schema refers to "#/$defs/..." on its own root; nested under gridState, those defs must move to our root.
  const { $defs: definitions, ...gridSchema } = input.schema as { $defs?: unknown } & Record<string, unknown>;
  const { value } = await cached(ctx, `grid:v2:${sha256(JSON.stringify(input.schema))}:${input.question.trim().toLowerCase()}`, 1, () => generateStructured(gemini, {
    system: "You control an AG Grid showing a ledger of invoices between small businesses (amounts in cents). Return the grid state that answers the user's question, following the provided schema exactly, plus a one-sentence explanation of what you changed.",
    parts: [{ text: `Current grid state: ${JSON.stringify(input.state).slice(0, 20_000)}\n\nQuestion: ${input.question.slice(0, 500)}` }],
    jsonSchema: { type: "object", required: ["gridState", "explanation"], properties: { gridState: gridSchema, explanation: { type: "string" } }, ...(definitions === undefined ? {} : { $defs: definitions }) },
    schema: z.object({ gridState: z.record(z.string(), z.unknown()), explanation: z.string() }),
    temperature: 0,
  }));
  return value;
}
