import { eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { transfers } from "@untangle/db";
import type { AppContext } from "../context.ts";
import type { Sim } from "../sim/fake-paypal.ts";
import { DomainError } from "../errors.ts";
import { captureCheckout, createCheckoutOrder, refreshPayouts } from "../services/transfers.ts";
import { requireUuid } from "./shared.ts";

const payoutStatus = z.enum(["SUCCESS", "FAILED", "RETURNED", "UNCLAIMED"]);

export const simRoutes: FastifyPluginAsync<{ ctx: AppContext; sim: Sim }> = async (app, options) => {
  app.post<{ Params: { id: string } }>("/api/sim/transfers/:id/approve", async (request) => {
    const transferId = requireUuid(request.params.id);
    const order = await createCheckoutOrder(options.ctx, transferId);
    return captureCheckout(options.ctx, transferId, order.orderId);
  });

  app.post<{ Params: { id: string; status: string } }>("/api/sim/transfers/:id/payout/:status", async (request) => {
    const transferId = requireUuid(request.params.id);
    const status = payoutStatus.parse(request.params.status);
    const [transfer] = await options.ctx.db.select({ roundId: transfers.roundId }).from(transfers).where(eq(transfers.id, transferId)).limit(1);
    if (transfer === undefined) throw new DomainError(404, "TRANSFER_NOT_FOUND", "Transfer was not found");
    const itemId = options.sim.payoutItemForTransfer(transferId);
    options.sim.setPayoutStatus(itemId, status);
    return refreshPayouts(options.ctx, transfer.roundId);
  });
};
