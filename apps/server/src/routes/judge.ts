import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { businesses, consents, judgeSessions, networks, obligations, rounds, setoffs, statements, transfers } from "@untangle/db";
import type { AppContext } from "../context.ts";
import { DomainError } from "../errors.ts";
import { listObligations, networkSummary } from "../services/obligations.ts";

const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_PER_HOUR = 20;

/** A small street of six businesses, plus the visitor ("You"). */
const STREET = [
  { name: "Alpha Bakery", email: "alpha@judge.local" },
  { name: "Beta Butcher", email: "beta@judge.local" },
  { name: "Gamma Grocer", email: "gamma@judge.local" },
  { name: "Delta Dairy", email: "delta@judge.local" },
  { name: "Epsilon Eatery", email: "epsilon@judge.local" },
  { name: "Zeta Pharmacy", email: "zeta@judge.local" },
];

/**
 * Seeded debts form an open chain A→B→C→D→E→F→You: almost a loop. The visitor's one
 * added invoice (You → A) closes the loop that includes "You".
 */
const SEED_DEBTS: { debtor: number; creditor: number; amountMinor: number; item: string }[] = [
  { debtor: 0, creditor: 1, amountMinor: 12500, item: "Flour" },
  { debtor: 1, creditor: 2, amountMinor: 11800, item: "Premium cuts" },
  { debtor: 2, creditor: 3, amountMinor: 13200, item: "Produce" },
  { debtor: 3, creditor: 4, amountMinor: 14100, item: "Milk" },
  { debtor: 4, creditor: 5, amountMinor: 15400, item: "Catering" },
  { debtor: 5, creditor: 6, amountMinor: 16700, item: "Admission" },
];

async function deleteJudgeNetwork(ctx: AppContext, networkId: string): Promise<void> {
  try {
    await ctx.db.transaction(async (tx) => {
      const roundRows = await tx.select({ id: rounds.id }).from(rounds).where(eq(rounds.networkId, networkId));
      const roundIds = roundRows.map((row) => row.id);
      if (roundIds.length > 0) {
        await tx.delete(setoffs).where(inArray(setoffs.roundId, roundIds));
        await tx.delete(consents).where(inArray(consents.roundId, roundIds));
        await tx.delete(statements).where(inArray(statements.roundId, roundIds));
        await tx.delete(transfers).where(inArray(transfers.roundId, roundIds));
        await tx.delete(rounds).where(inArray(rounds.id, roundIds));
      }
      await tx.delete(obligations).where(eq(obligations.networkId, networkId));
      await tx.delete(businesses).where(eq(businesses.networkId, networkId));
      await tx.delete(networks).where(eq(networks.id, networkId));
    });
  } catch {
    // Expired judge networks are ephemeral; a failure to sweep just leaves them until next sweep.
  }
}

async function expireStaleSessions(ctx: AppContext): Promise<void> {
  const stale = await ctx.db.select({ networkId: judgeSessions.networkId }).from(judgeSessions).where(lt(judgeSessions.expiresAt, ctx.now()));
  for (const session of stale) {
    await deleteJudgeNetwork(ctx, session.networkId);
    await ctx.db.delete(judgeSessions).where(eq(judgeSessions.networkId, session.networkId));
  }
}

async function resolveSession(ctx: AppContext, token: string) {
  const [session] = await ctx.db.select().from(judgeSessions).where(eq(judgeSessions.token, token)).limit(1);
  if (session === undefined) throw new DomainError(404, "JUDGE_TOKEN_NOT_FOUND", "This judge link is not valid.");
  if (session.expiresAt < ctx.now()) throw new DomainError(404, "JUDGE_EXPIRED", "This judge network has expired after two hours.");
  return session;
}

export const judgeRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, options) => {
  // "Start your own network": a fresh, isolated judge network for one visitor.
  app.post("/api/judge/network", async (request, reply) => {
    const ctx = options.ctx;
    await expireStaleSessions(ctx);
    const hourAgo = new Date(ctx.now().getTime() - 60 * 60 * 1000);
    const [count] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(judgeSessions).where(gte(judgeSessions.createdAt, hourAgo));
    if ((count?.n ?? 0) >= MAX_PER_HOUR) {
      return reply.code(429).send({ error: "JUDGE_RATE_LIMITED", message: "Too many judge networks this hour; try again a little later." });
    }
    const token = randomBytes(16).toString("hex");
    const networkId = randomUUID();
    const now = ctx.now();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    let youBusinessId: string | null = null;
    await ctx.db.transaction(async (tx) => {
      await tx.insert(networks).values({ id: networkId, name: `Judge Street · ${token.slice(0, 4)}`, currency: "USD" });
      const ids: string[] = [];
      for (const business of STREET) {
        const [row] = await tx.insert(businesses).values({ networkId, name: business.name, email: business.email }).returning({ id: businesses.id });
        if (row === undefined) throw new Error("judge business insert returned no row");
        ids.push(row.id);
      }
      const [you] = await tx.insert(businesses).values({ networkId, name: "You", email: "you@judge.local" }).returning({ id: businesses.id });
      if (you === undefined) throw new Error("judge visitor insert returned no row");
      ids.push(you.id);
      youBusinessId = you.id;
      for (const debt of SEED_DEBTS) {
        await tx.insert(obligations).values({
          networkId,
          debtorId: ids[debt.debtor]!,
          creditorId: ids[debt.creditor]!,
          amountMinor: debt.amountMinor,
          outstandingMinor: debt.amountMinor,
          currency: "USD",
          description: debt.item,
          status: "invoiced",
          debtorConfirmedAt: now,
          creditorConfirmedAt: now,
        });
      }
      await tx.insert(judgeSessions).values({ token, networkId, expiresAt });
    });
    await ctx.bus.emit(`network:${networkId}`, "network.seeded", { networkId, runTag: token });
    const base = ctx.config.publicBaseUrl.replace(/\/$/, "");
    return { token, networkId, youBusinessId, qrPayload: `${base}/#/judge/phone/${token}` };
  });

  // Read-only desk data for a judge network.
  app.get<{ Params: { token: string } }>("/api/judge/network/:token", async (request) => {
    const ctx = options.ctx;
    const session = await resolveSession(ctx, request.params.token);
    const summary = await networkSummary(ctx, session.networkId);
    const obligationsView = await listObligations(ctx, session.networkId);
    const you = summary.businesses.find((business) => business.name === "You");
    return { network: summary, obligations: obligationsView, youBusinessId: you?.id ?? null, expiresAt: session.expiresAt.toISOString() };
  });

  // The phone page adds exactly one invoice the visitor owes or is owed.
  const addBody = z.object({
    direction: z.enum(["owe", "owed"]),
    counterpartyId: z.string().uuid(),
    amountMinor: z.number().int().positive().max(1_000_000),
    description: z.string().trim().min(1).max(200),
  });
  app.post<{ Params: { token: string }; Body: unknown }>("/api/judge/network/:token/obligations", async (request) => {
    const ctx = options.ctx;
    const session = await resolveSession(ctx, request.params.token);
    const body = addBody.parse(request.body);
    const networkId = session.networkId;
    const [you] = await ctx.db.select({ id: businesses.id }).from(businesses).where(and(eq(businesses.networkId, networkId), eq(businesses.name, "You"))).limit(1);
    if (you === undefined) throw new DomainError(404, "JUDGE_YOU_NOT_FOUND", "The judge visitor is missing from this network.");
    const [counterparty] = await ctx.db.select({ id: businesses.id }).from(businesses).where(and(eq(businesses.networkId, networkId), eq(businesses.id, body.counterpartyId))).limit(1);
    if (counterparty === undefined || counterparty.id === you.id) throw new DomainError(422, "JUDGE_COUNTERPARTY_INVALID", "Pick a business from the street, not yourself.");
    const now = ctx.now();
    const debtorId = body.direction === "owe" ? you.id : counterparty.id;
    const creditorId = body.direction === "owe" ? counterparty.id : you.id;
    const [inserted] = await ctx.db.insert(obligations).values({
      networkId,
      debtorId,
      creditorId,
      amountMinor: body.amountMinor,
      outstandingMinor: body.amountMinor,
      currency: "USD",
      description: body.description,
      status: "invoiced",
      debtorConfirmedAt: now,
      creditorConfirmedAt: now,
    }).returning({ id: obligations.id });
    if (inserted === undefined) throw new Error("judge obligation insert returned no row");
    await ctx.bus.emit(`network:${networkId}`, "obligation.updated", { obligationId: inserted.id, outstandingMinor: body.amountMinor, status: "invoiced" });
    await ctx.bus.emit(`network:${networkId}`, "judge.invoice_added", { obligationId: inserted.id, amountMinor: body.amountMinor, direction: body.direction });
    return { ok: true, obligationId: inserted.id };
  });
};
