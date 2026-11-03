import type { FastifyPluginAsync } from "fastify";
import { sql } from "drizzle-orm";
import type { AppContext } from "../context.ts";

export const healthRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, options) => {
  app.get("/healthz", async () => ({ ok: true }));
  app.get("/readyz", async (_request, reply) => {
    try {
      await options.ctx.db.execute(sql`select 1`);
      return { ok: true };
    } catch {
      reply.code(503);
      return { ok: false };
    }
  });
};
