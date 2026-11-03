import type { FastifyPluginAsync } from "fastify";
import type { AppContext } from "../context.ts";
import { resetDemo } from "../services/demo.ts";
import { z } from "zod";
import { armCrash, chaos } from "../chaos.ts";
import { DomainError } from "../errors.ts";

export const demoRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, options) => {
  // "Pull the plug": the next settlement crashes the server after this many PayPal set-off writes.
  app.post<{ Body: unknown }>("/api/demo/chaos", async (request) => {
    if (!options.ctx.config.demoMode) throw new DomainError(404, "NOT_FOUND", "Not available");
    const body = z.object({ afterRecords: z.number().int().min(1).max(50).default(5) }).parse(request.body ?? {});
    armCrash(body.afterRecords);
    await options.ctx.bus.emit("system", "demo.chaos_armed", { afterRecords: body.afterRecords });
    return { armed: true, afterRecords: chaos.crashAfterRecords };
  });
  // A reset cancels and recreates 25 PayPal invoices, so it is rate limited well below the global write limit.
  app.post("/api/demo/reset", { config: { rateLimit: { max: 3, timeWindow: "1 minute" } } }, async () => resetDemo(options.ctx));
};
