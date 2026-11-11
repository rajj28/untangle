import type { FastifyPluginAsync } from "fastify";
import type { AppContext } from "../context.ts";
import { resetDemo } from "../services/demo.ts";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { obligations } from "@untangle/db";
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
  // Demo-only: clear one side's confirmation stamp so a judge can record a confirmation/rejection story.
  app.post<{ Params: { id: string } }>("/api/demo/confirm-request/:id", async (request) => {
    if (!options.ctx.config.demoMode) throw new DomainError(404, "NOT_FOUND", "Not available");
    const ctx = options.ctx;
    const obligationId = request.params.id;
    const [row] = await ctx.db.select().from(obligations).where(eq(obligations.id, obligationId)).limit(1);
    if (row === undefined) throw new DomainError(404, "OBLIGATION_NOT_FOUND", "Obligation was not found");
    if (row.status === "disputed") throw new DomainError(409, "ALREADY_DISPUTED", "A disputed obligation cannot be re-confirmed with this action");
    const clearDebtor = row.debtorConfirmedAt !== null && row.creditorConfirmedAt === null ? false : row.debtorConfirmedAt !== null;
    const next = clearDebtor
      ? { debtorConfirmedAt: null as Date | null }
      : { creditorConfirmedAt: null as Date | null };
    await ctx.db.update(obligations).set({ ...next, updatedAt: ctx.now() }).where(eq(obligations.id, obligationId));
    const side = clearDebtor ? "debtor" : "creditor";
    await ctx.bus.emit(`network:${row.networkId}`, "obligation.confirmation_requested", { obligationId, side });
    return { obligationId, waitingSide: side };
  });
};
