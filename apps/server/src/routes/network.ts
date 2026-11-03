import type { FastifyPluginAsync } from "fastify";
import { asc, desc, eq } from "drizzle-orm";
import { networks, rounds } from "@untangle/db";
import type { AppContext } from "../context.ts";
import { listObligations, networkSummary } from "../services/obligations.ts";
import { planRound } from "../services/rounds.ts";
import { requireUuid } from "./shared.ts";

export const networkRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, options) => {
  app.get("/api/networks", async () => options.ctx.db.select({ id: networks.id, name: networks.name, currency: networks.currency }).from(networks).orderBy(asc(networks.createdAt)));
  app.get<{ Params: { id: string } }>("/api/networks/:id", async (request) => networkSummary(options.ctx, requireUuid(request.params.id)));
  app.get<{ Params: { id: string } }>("/api/networks/:id/obligations", async (request) => listObligations(options.ctx, requireUuid(request.params.id)));
  app.get<{ Params: { id: string } }>("/api/networks/:id/rounds", async (request) => {
    const networkId = requireUuid(request.params.id);
    const rows = await options.ctx.db.select({ id: rounds.id, status: rounds.status, createdAt: rounds.createdAt, planHash: rounds.planHash, plan: rounds.plan })
      .from(rounds).where(eq(rounds.networkId, networkId)).orderBy(desc(rounds.createdAt)).limit(20);
    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      createdAt: row.createdAt,
      planHash: row.planHash,
      stats: (row.plan as { stats?: unknown } | null)?.stats ?? null,
    }));
  });
  app.post<{ Params: { id: string } }>("/api/networks/:id/rounds", async (request, reply) => {
    const view = await planRound(options.ctx, requireUuid(request.params.id));
    reply.code(201);
    return view;
  });
};
