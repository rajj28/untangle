import { z } from "zod";
import type { AppContext } from "../context.ts";
import { generateStructured, runAgent } from "../ai/agent.ts";
import { getRound, recordConsent } from "../services/rounds.ts";
import { addDays } from "../dates.ts";
import { networkBusinesses, requireGemini, short, usd } from "./common.ts";
import { policyAllowsSigning, policyFor } from "./policies.ts";
import { stepper } from "./runs.ts";

interface StatementTotals { clearedMinor: number; paysMinor: number; receivesMinor: number }

const decisionSchema = z.object({
  decision: z.enum(["sign", "hold"]),
  rationale: z.string().min(5).max(400),
  ownerNote: z.string().min(2).max(400),
});

const LANGUAGE_NAMES: Record<string, string> = { en: "English", es: "Spanish", it: "Italian", hi: "Hindi", fr: "French", pt: "Portuguese", zh: "Chinese" };

async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let index = next++; index < items.length; index = next++) results[index] = await fn(items[index]!);
  }));
  return results;
}

/**
 * One AI treasurer per business. A treasurer whose business pays money first checks its recent
 * PayPal activity through the toolkit (on its own account). It then decides to sign or hold, and
 * a deterministic referee applies the owner's policy: the AI can be more careful, never less.
 */
export async function runTreasurers(ctx: AppContext, runId: string, roundId: string) {
  const gemini = requireGemini(ctx);
  const round = await getRound(ctx, roundId);
  const names = new Map((await networkBusinesses(ctx, round.networkId)).map((business) => [business.id, business.name]));
  const pending = round.statements.filter((statement) => round.pendingConsents.includes(statement.businessId));
  const outcomes = await mapLimited(pending, 3, async (statement) => {
    const businessId = statement.businessId;
    const name = names.get(businessId) ?? "This business";
    const step = stepper(ctx, runId, "treasurer", businessId);
    const policy = await policyFor(ctx, businessId);
    const totals = (statement.body as { totals: StatementTotals }).totals;
    let liquidity = "";
    if (totals.paysMinor > 0) {
      try {
        const tools = await ctx.ai.paypalTools(businessId, { transactions: { list: true } });
        const end = ctx.now();
        const { text } = await runAgent(gemini, {
          system: `You are ${name}'s AI treasurer. You may read ${name}'s own PayPal transactions. Be brief.`,
          prompt: [{ text: `${name} would pay ${usd(totals.paysMinor)} in this settlement round. Check money that came in over the last 30 days (start_date ${addDays(end, -30)}T00:00:00Z, end_date ${addDays(end, 0)}T23:59:59Z) and say in one sentence whether paying now looks comfortable.` }],
          tools,
          onStep: step,
          maxSteps: 3,
        });
        liquidity = text.trim();
      } catch (error) {
        await step({ kind: "message", title: "Could not read recent PayPal activity; deciding from the statement alone", detail: short(error instanceof Error ? error.message : String(error)) });
      }
    }
    let decision: z.infer<typeof decisionSchema>;
    try {
      ({ value: decision } = await generateStructured(gemini, {
        system: `You are ${name}'s AI treasurer in Untangle, a clearing network for small businesses on PayPal. Decide whether to sign this round's settlement statement on the owner's behalf. Sign only if it is good for ${name}. Never invent numbers.`,
        parts: [{ text: [
          `Statement for ${name}: cleared by set-off with no money moving ${usd(totals.clearedMinor)}; ${name} pays ${usd(totals.paysMinor)}; receives ${usd(totals.receivesMinor)}.`,
          `Owner policy: ${JSON.stringify({ autoSign: policy.autoSign, maxAutoPay: usd(policy.maxAutoPayMinor), payVia: policy.payVia })}.`,
          liquidity === "" ? "" : `Recent PayPal activity: ${liquidity}`,
          `Reply with decision, a one-sentence rationale in English, and a one-sentence note to the owner in ${LANGUAGE_NAMES[policy.language] ?? "English"}.`,
        ].filter(Boolean).join("\n") }],
        jsonSchema: { type: "object", required: ["decision", "rationale", "ownerNote"], properties: { decision: { type: "string", enum: ["sign", "hold"] }, rationale: { type: "string" }, ownerNote: { type: "string" } } },
        schema: decisionSchema,
      }));
    } catch (error) {
      decision = { decision: "hold", rationale: "The treasurer could not reach a decision, so the owner decides.", ownerNote: "Please review your statement." };
      await step({ kind: "error", title: "Treasurer could not decide", detail: short(error instanceof Error ? error.message : String(error)) });
    }
    const referee = policyAllowsSigning(policy, totals.paysMinor);
    if (decision.decision === "sign" && referee.allowed) {
      await recordConsent(ctx, roundId, businessId, "policy");
      await step({ kind: "decision", title: `Signed for ${name} under the owner's policy`, detail: `${decision.rationale} ${decision.ownerNote}` });
      return { businessId, signed: true, reason: decision.rationale };
    }
    const reason = decision.decision === "hold" ? decision.rationale : referee.reason;
    await step({ kind: "decision", title: `Held for ${name}'s owner to sign`, detail: `${reason} ${decision.ownerNote}` });
    return { businessId, signed: false, reason };
  });
  return {
    signed: outcomes.filter((outcome) => outcome.signed).map((outcome) => outcome.businessId),
    held: outcomes.filter((outcome) => !outcome.signed).map((outcome) => ({ businessId: outcome.businessId, name: names.get(outcome.businessId) ?? "", reason: outcome.reason })),
  };
}
