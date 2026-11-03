import { HttpCore } from "./http.ts";
import { createDisputesResource } from "./resources/disputes.ts";
import { createIdentityResource } from "./resources/identity.ts";
import { createInvoicingResource } from "./resources/invoicing.ts";
import { createOrdersResource } from "./resources/orders.ts";
import { createPaymentsResource } from "./resources/payments.ts";
import { createPayoutsResource } from "./resources/payouts.ts";
import { createReportingResource } from "./resources/reporting.ts";
import { createWebhooksResource } from "./resources/webhooks.ts";
import type { PayPalClientConfig } from "./types.ts";

export interface PayPalClient {
  invoicing: ReturnType<typeof createInvoicingResource>;
  orders: ReturnType<typeof createOrdersResource>;
  payments: ReturnType<typeof createPaymentsResource>;
  payouts: ReturnType<typeof createPayoutsResource>;
  reporting: ReturnType<typeof createReportingResource>;
  disputes: ReturnType<typeof createDisputesResource>;
  webhooks: ReturnType<typeof createWebhooksResource>;
  identity: ReturnType<typeof createIdentityResource>;
  environment: "sandbox" | "live";
}

export function createPayPalClient(config: PayPalClientConfig): PayPalClient {
  if (config.clientId.length === 0) throw new TypeError("clientId must not be empty");
  if (config.clientSecret.length === 0) throw new TypeError("clientSecret must not be empty");
  if (config.environment === "live" && config.allowLive !== true) {
    throw new Error("Live PayPal is disabled; pass allowLive: true");
  }

  const http = new HttpCore(config);
  return {
    invoicing: createInvoicingResource(http),
    orders: createOrdersResource(http),
    payments: createPaymentsResource(http),
    payouts: createPayoutsResource(http),
    reporting: createReportingResource(http),
    disputes: createDisputesResource(http),
    webhooks: createWebhooksResource(http),
    identity: createIdentityResource(http, config.clientId),
    environment: config.environment,
  };
}
