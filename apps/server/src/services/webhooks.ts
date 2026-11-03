import { and, eq, inArray } from "drizzle-orm";
import type { WebhookEvent } from "@untangle/paypal";
import { businesses, transfers, webhookInbox } from "@untangle/db";
import type { AppContext } from "../context.ts";
import { DomainError } from "../errors.ts";
import { commitTransfer, handlePayoutItem, unwindTransfer } from "./transfers.ts";
import { refreshObligationFromInvoice } from "./obligations.ts";

type HeaderMap = Record<string, string | string[] | undefined>;
type WebhookResult = { status: 200 | 400; body: Record<string, unknown> };

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

export async function handleWebhook(ctx: AppContext, businessId: string, headers: HeaderMap, rawBody: string): Promise<WebhookResult> {
  const [business] = await ctx.db.select({ id: businesses.id }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (business === undefined) throw new DomainError(404, "BUSINESS_NOT_FOUND", "Business was not found");
  const webhookId = await ctx.paypal.webhookIdFor(businessId);
  if (webhookId === null) return { status: 400, body: { error: "WEBHOOK_NOT_CONFIGURED" } };
  const client = await ctx.paypal.forBusiness(businessId);
  if (!await client.webhooks.verify({ webhookId, headers, rawBody })) return { status: 400, body: { error: "BAD_SIGNATURE" } };

  const parsed: unknown = JSON.parse(rawBody);
  const record = object(parsed);
  if (record === undefined || typeof record.id !== "string" || typeof record.event_type !== "string" || object(record.resource) === undefined) {
    return { status: 400, body: { error: "BAD_EVENT" } };
  }
  const event = record as unknown as WebhookEvent;
  const inserted = await ctx.db.insert(webhookInbox).values({
    paypalEventId: event.id,
    businessId,
    eventType: event.event_type,
    payload: event,
    verified: true,
  }).onConflictDoNothing().returning({ paypalEventId: webhookInbox.paypalEventId });
  if (inserted.length === 0) return { status: 200, body: { duplicate: true } };

  let errorMessage: string | null = null;
  try {
    await dispatch(ctx, businessId, event);
  } catch (error) {
    errorMessage = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
  }
  await ctx.db.update(webhookInbox).set({ processedAt: ctx.now(), error: errorMessage }).where(eq(webhookInbox.paypalEventId, event.id));
  return { status: 200, body: { received: true } };
}

async function dispatch(ctx: AppContext, businessId: string, event: WebhookEvent): Promise<void> {
  const resource = event.resource;
  if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
    const related = object(object(resource.supplementary_data)?.related_ids);
    const orderId = stringField(related, "order_id");
    const captureId = stringField(resource, "id");
    if (orderId === undefined || captureId === undefined) return;
    const [transfer] = await ctx.db.select().from(transfers).where(eq(transfers.paypalOrderId, orderId)).limit(1);
    if (transfer === undefined) return;
    await ctx.db.update(transfers).set({ paypalCaptureId: captureId, updatedAt: ctx.now() })
      .where(and(eq(transfers.id, transfer.id), inArray(transfers.status, ["pending_paypal", "ready", "awaiting_payer"])));
    await commitTransfer(ctx, transfer.id, captureId);
    return;
  }

  if (event.event_type === "PAYMENT.CAPTURE.REFUNDED") {
    const links = Array.isArray(resource.links) ? resource.links : [];
    let captureId: string | undefined;
    for (const value of links) {
      const link = object(value);
      if (link?.rel === "up" && typeof link.href === "string") {
        const parts = link.href.split("/").filter(Boolean);
        captureId = parts.at(-1);
      }
    }
    captureId ??= stringField(resource, "id");
    if (captureId === undefined) return;
    const [transfer] = await ctx.db.select().from(transfers).where(eq(transfers.paypalCaptureId, captureId)).limit(1);
    if (transfer !== undefined) await unwindTransfer(ctx, transfer.id);
    return;
  }

  if (event.event_type === "PAYMENT.CAPTURE.REVERSED") {
    const captureId = stringField(resource, "id");
    if (captureId === undefined) return;
    const [transfer] = await ctx.db.select().from(transfers).where(eq(transfers.paypalCaptureId, captureId)).limit(1);
    if (transfer !== undefined) await unwindTransfer(ctx, transfer.id);
    return;
  }

  if (event.event_type.startsWith("PAYMENT.PAYOUTS-ITEM.")) {
    const payoutItemId = stringField(resource, "payout_item_id") ?? stringField(resource, "id");
    if (payoutItemId !== undefined) await handlePayoutItem(ctx, businessId, payoutItemId);
    return;
  }

  if (["INVOICING.INVOICE.PAID", "INVOICING.INVOICE.UPDATED", "INVOICING.INVOICE.CANCELLED"].includes(event.event_type)) {
    const invoice = object(resource.invoice);
    const invoiceId = stringField(invoice, "id") ?? stringField(resource, "id");
    if (invoiceId !== undefined) await refreshObligationFromInvoice(ctx, invoiceId);
  }
}
