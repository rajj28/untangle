import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.ts";
import { captureCheckout, createCheckoutOrder } from "../services/transfers.ts";
import { refreshObligationFromInvoice } from "../services/obligations.ts";
import { obligations } from "@untangle/db";
import { eq } from "drizzle-orm";
import { DomainError } from "../errors.ts";
import { requireUuid } from "./shared.ts";

const captureBody = z.object({ orderId: z.string().min(1) });

export const transferRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, options) => {
  app.post<{ Params: { id: string } }>("/api/transfers/:id/order", async (request) => createCheckoutOrder(options.ctx, requireUuid(request.params.id)));
  app.post<{ Params: { id: string }; Body: unknown }>("/api/transfers/:id/capture", async (request) => {
    const body = captureBody.parse(request.body);
    return captureCheckout(options.ctx, requireUuid(request.params.id), body.orderId);
  });
  app.post<{ Params: { id: string } }>("/api/obligations/:id/refresh", async (request) => {
    const id = requireUuid(request.params.id);
    const [obligation] = await options.ctx.db.select().from(obligations).where(eq(obligations.id, id)).limit(1);
    if (obligation === undefined) throw new DomainError(404, "OBLIGATION_NOT_FOUND", "Obligation was not found");
    if (obligation.paypalInvoiceId === null) throw new DomainError(422, "INVOICE_NOT_FOUND", "Obligation has no PayPal invoice");
    return refreshObligationFromInvoice(options.ctx, obligation.paypalInvoiceId);
  });
};
