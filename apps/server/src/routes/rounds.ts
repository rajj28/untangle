import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.ts";
import { DomainError } from "../errors.ts";
import { executeRound, getRound, recordConsent } from "../services/rounds.ts";
import { refreshPayouts, startPayouts } from "../services/transfers.ts";
import { computeRecovery } from "../services/recovery.ts";
import { requireUuid } from "./shared.ts";

const consentBody = z.object({ businessId: z.string().uuid() });
const payerBody = z.object({ payerId: z.string().uuid() });

export const roundRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, options) => {
  app.get<{ Params: { id: string } }>("/api/rounds/:id", async (request) => getRound(options.ctx, requireUuid(request.params.id)));
  app.get<{ Params: { id: string } }>("/api/rounds/:id/recovery", async (request) => computeRecovery(options.ctx, requireUuid(request.params.id)));
  app.post<{ Params: { id: string }; Body: unknown }>("/api/rounds/:id/consents", async (request) => {
    const params = consentBody.parse(request.body);
    return recordConsent(options.ctx, requireUuid(request.params.id), params.businessId);
  });
  app.post<{ Params: { id: string } }>("/api/rounds/:id/execute", async (request, reply) => {
    const roundId = requireUuid(request.params.id);
    const view = await getRound(options.ctx, roundId);
    if (view.status !== "executing") throw new DomainError(409, "ROUND_NOT_READY", "Round is not ready to execute");
    const result = await executeRound(options.ctx, roundId);
    if ("retryInMs" in result) {
      await options.ctx.jobs.schedule("round.execute", { roundId }, result.retryInMs);
      reply.code(202);
      return getRound(options.ctx, roundId);
    }
    return getRound(options.ctx, roundId);
  });
  app.post<{ Params: { id: string }; Body: unknown }>("/api/rounds/:id/payouts", async (request) => {
    const body = payerBody.parse(request.body);
    return startPayouts(options.ctx, requireUuid(request.params.id), body.payerId);
  });
  app.post<{ Params: { id: string } }>("/api/rounds/:id/payouts/refresh", async (request) => refreshPayouts(options.ctx, requireUuid(request.params.id)));
};
