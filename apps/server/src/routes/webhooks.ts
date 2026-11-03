import type { FastifyPluginAsync } from "fastify";
import type { AppContext } from "../context.ts";
import { handleWebhook } from "../services/webhooks.ts";
import { requireUuid } from "./shared.ts";

export const webhookRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, options) => {
  // PayPal webhook bodies are a few KB; cap them before the signature check costs a PayPal call.
  app.addContentTypeParser("application/json", { parseAs: "string", bodyLimit: 65_536 }, (_request, body, done) => done(null, body));
  app.post<{ Params: { businessId: string }; Body: string }>("/webhooks/paypal/:businessId", async (request, reply) => {
    const result = await handleWebhook(options.ctx, requireUuid(request.params.businessId), request.headers, request.body);
    reply.code(result.status);
    return result.body;
  });
};
