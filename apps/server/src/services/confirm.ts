import { and, eq, sql } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "node:crypto";
import { businesses, claims, evidence, obligations, rounds } from "@untangle/db";
import type { SettlementPlan } from "@untangle/engine";
import type { AppContext } from "../context.ts";
import { DomainError } from "../errors.ts";
import { planRound } from "./rounds.ts";

export type ConfirmSide = "debtor" | "creditor";

export interface ConfirmToken {
  obligationId: string;
  businessId: string;
  side: ConfirmSide;
}

function mac(key: Buffer, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

/** Signed capability: owning the token lets one confirm one side of one obligation. */
export function signConfirm(ctx: AppContext, obligationId: string, businessId: string, side: ConfirmSide): string {
  const payload = `${obligationId}.${businessId}.${side}`;
  return `${payload}.${mac(ctx.config.confirmSecret, payload).toString("hex")}`;
}

export function verifyConfirm(ctx: AppContext, token: string): ConfirmToken {
  const parts = token.split(".");
  if (parts.length !== 4) throw new DomainError(400, "BAD_CONFIRM_TOKEN", "Confirmation link is not valid");
  const [obligationId, businessId, side, given] = parts as [string, string, string, string];
  if ((side !== "debtor" && side !== "creditor") || obligationId.length === 0 || businessId.length === 0) {
    throw new DomainError(400, "BAD_CONFIRM_TOKEN", "Confirmation link is not valid");
  }
  const payload = `${obligationId}.${businessId}.${side}`;
  const expected = mac(ctx.config.confirmSecret, payload);
  let givenBuf: Buffer;
  try {
    givenBuf = Buffer.from(given, "hex");
  } catch {
    throw new DomainError(400, "BAD_CONFIRM_TOKEN", "Confirmation link is not valid");
  }
  if (givenBuf.length !== expected.length || !timingSafeEqual(givenBuf, expected)) {
    throw new DomainError(400, "BAD_CONFIRM_TOKEN", "Confirmation link is not valid");
  }
  return { obligationId, businessId, side };
}

export interface ConfirmView {
  obligationId: string;
  side: ConfirmSide;
  businessId: string;
  businessName: string;
  debtor: { id: string; name: string };
  creditor: { id: string; name: string };
  amountMinor: number;
  currency: string;
  description: string | null;
  status: string;
  disputeReason: string | null;
  debtorConfirmed: boolean;
  creditorConfirmed: boolean;
  evidenceSummary: string | null;
}

async function confirmViewFor(ctx: AppContext, token: ConfirmToken): Promise<ConfirmView> {
  const [obligation] = await ctx.db.select().from(obligations).where(eq(obligations.id, token.obligationId)).limit(1);
  if (obligation === undefined) throw new DomainError(404, "OBLIGATION_NOT_FOUND", "Obligation was not found");
  const [debtorRows, creditorRows] = await Promise.all([
    ctx.db.select({ id: businesses.id, name: businesses.name }).from(businesses).where(eq(businesses.id, obligation.debtorId)).limit(1),
    ctx.db.select({ id: businesses.id, name: businesses.name }).from(businesses).where(eq(businesses.id, obligation.creditorId)).limit(1),
  ]);
  const debtor = debtorRows[0];
  const creditor = creditorRows[0];
  const [claim] = await ctx.db.select({ evidenceId: claims.evidenceId }).from(claims).where(eq(claims.obligationId, obligation.id)).limit(1);
  let evidenceSummary: string | null = null;
  if (claim !== undefined && claim.evidenceId !== null) {
    const [evidenceRow] = await ctx.db.select({ extraction: evidence.extraction }).from(evidence).where(eq(evidence.id, claim.evidenceId)).limit(1);
    const extraction = (evidenceRow?.extraction ?? {}) as { summary?: string };
    evidenceSummary = extraction.summary ?? null;
  }
  if (debtor === undefined || creditor === undefined) throw new DomainError(404, "BUSINESS_NOT_FOUND", "A business on this obligation was not found");
  const businessName = token.businessId === obligation.debtorId ? debtor.name : token.businessId === obligation.creditorId ? creditor.name : "Unknown";
  return {
    obligationId: obligation.id,
    side: token.side,
    businessId: token.businessId,
    businessName,
    debtor: { id: debtor.id, name: debtor.name },
    creditor: { id: creditor.id, name: creditor.name },
    amountMinor: obligation.amountMinor,
    currency: obligation.currency,
    description: obligation.description,
    status: obligation.status,
    disputeReason: obligation.disputeReason,
    debtorConfirmed: obligation.debtorConfirmedAt !== null,
    creditorConfirmed: obligation.creditorConfirmedAt !== null,
    evidenceSummary,
  };
}

export async function getConfirm(ctx: AppContext, token: string): Promise<ConfirmView> {
  return confirmViewFor(ctx, verifyConfirm(ctx, token));
}

export async function decideConfirm(ctx: AppContext, token: string, decision: "confirm" | "reject", reason?: string): Promise<ConfirmView> {
  const parsed = verifyConfirm(ctx, token);
  const result = await ctx.locks.run(`obligation:${parsed.obligationId}`, async () => {
    const [obligation] = await ctx.db.select().from(obligations).where(eq(obligations.id, parsed.obligationId)).limit(1);
    if (obligation === undefined) throw new DomainError(404, "OBLIGATION_NOT_FOUND", "Obligation was not found");
    if (decision === "confirm") {
      if (parsed.side === "debtor") {
        await ctx.db.update(obligations).set({ debtorConfirmedAt: ctx.now(), updatedAt: ctx.now() }).where(eq(obligations.id, parsed.obligationId));
      } else {
        await ctx.db.update(obligations).set({ creditorConfirmedAt: ctx.now(), updatedAt: ctx.now() }).where(eq(obligations.id, parsed.obligationId));
      }
      await ctx.bus.emit(`network:${obligation.networkId}`, "obligation.confirmed", { obligationId: obligation.id, side: parsed.side });
      return { emitted: "confirmed" as const };
    }
    if (obligation.status === "disputed") throw new DomainError(409, "ALREADY_DISPUTED", "This obligation is already disputed");
    await ctx.db.update(obligations).set({
      status: "disputed",
      disputeReason: (reason ?? "Rejected via confirmation link").slice(0, 500),
      version: sql`${obligations.version} + 1`,
      updatedAt: ctx.now(),
    }).where(and(eq(obligations.id, obligation.id), eq(obligations.status, obligation.status)));
    await ctx.bus.emit(`network:${obligation.networkId}`, "obligation.disputed", {
      obligationId: obligation.id,
      reason: (reason ?? "Rejected via confirmation link").slice(0, 500),
      side: parsed.side,
    });
    return { emitted: "disputed" as const, networkId: obligation.networkId };
  });
  if (result.emitted === "disputed") await replanAfterRejection(ctx, result.networkId, parsed.obligationId);
  return confirmViewFor(ctx, parsed);
}

/** True when the plan cancels or pays any part of this obligation. */
function planTouches(plan: SettlementPlan | null, obligationId: string): boolean {
  if (plan === null || plan === undefined) return false;
  if ((plan.setoffs?.[obligationId] ?? 0) > 0) return true;
  return (plan.transfers ?? []).some((transfer) => transfer.legs.some((leg) => leg.obligationId === obligationId));
}

/**
 * A rejected debt cannot stay in a plan that is still collecting consent. Nothing has been recorded on
 * PayPal yet, so that round is withdrawn and the engine plans again without the disputed debt; the new
 * round carries `replanned` (the loops that broke and the loops found now).
 */
async function replanAfterRejection(ctx: AppContext, networkId: string, obligationId: string): Promise<void> {
  const active = await ctx.db.select({ id: rounds.id, plan: rounds.plan }).from(rounds)
    .where(and(eq(rounds.networkId, networkId), eq(rounds.status, "consenting")));
  const stale = active.filter((round) => planTouches(round.plan as SettlementPlan | null, obligationId));
  if (stale.length === 0) return;
  let withdrawnAny = false;
  for (const round of stale) {
    const withdrawn = await ctx.locks.run(`round:${round.id}`, () => ctx.db.update(rounds).set({ status: "failed", updatedAt: ctx.now() })
      .where(and(eq(rounds.id, round.id), eq(rounds.status, "consenting"))).returning({ id: rounds.id }));
    if (withdrawn.length === 0) continue;
    withdrawnAny = true;
    await ctx.bus.emit(`network:${networkId}`, "round.withdrawn", { roundId: round.id, reason: "an invoice in the plan was rejected", obligationId });
  }
  if (!withdrawnAny) return;
  try {
    await planRound(ctx, networkId);
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
  }
}
