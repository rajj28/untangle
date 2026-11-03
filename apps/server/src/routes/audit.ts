import type { FastifyPluginAsync } from "fastify";
import { verifyChain } from "@untangle/db";
import type { AppContext } from "../context.ts";

// Verifying rereads the whole event log; a short cache keeps a public button from hammering the database.
const CACHE_MS = 30_000;

export const auditRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, options) => {
  let cached: { at: number; result: Awaited<ReturnType<typeof verifyChain>> } | undefined;
  app.get("/api/audit/verify", async () => {
    const now = Date.now();
    if (cached === undefined || now - cached.at > CACHE_MS) cached = { at: now, result: await verifyChain(options.ctx.db) };
    return cached.result;
  });
};
