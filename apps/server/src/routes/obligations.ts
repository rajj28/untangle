import type { FastifyPluginAsync } from "fastify";
import type { AppContext } from "../context.ts";
import { getObligationHistory } from "../services/obligations.ts";
import { requireUuid } from "./shared.ts";

export const obligationRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, options) => {
  app.get<{ Params: { id: string } }>("/api/obligations/:id/history", async (request) => {
    return getObligationHistory(options.ctx, requireUuid(request.params.id));
  });
};
