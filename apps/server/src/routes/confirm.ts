import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.ts";
import { decideConfirm, getConfirm } from "../services/confirm.ts";

const decisionBody = z.object({
  decision: z.enum(["confirm", "reject"]),
  reason: z.string().max(500).optional(),
});

export const confirmRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, options) => {
  app.get<{ Params: { token: string } }>("/api/confirm/:token", async (request) => getConfirm(options.ctx, request.params.token));
  app.post<{ Params: { token: string }; Body: unknown }>("/api/confirm/:token", async (request) => {
    const body = decisionBody.parse(request.body ?? {});
    return decideConfirm(options.ctx, request.params.token, body.decision, body.reason);
  });
};
