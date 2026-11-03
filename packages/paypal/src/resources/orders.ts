import type { HttpCore } from "../http.ts";
import type { Order, OrderInput } from "../types.ts";

export function createOrdersResource(http: HttpCore) {
  return {
    async create(input: OrderInput, opts: { idempotencyKey: string }): Promise<Order> {
      return http.request<Order>("POST", "/v2/checkout/orders", {
        body: input,
        idempotencyKey: opts.idempotencyKey,
        preferRepresentation: true,
      });
    },

    async get(id: string): Promise<Order> {
      return http.request<Order>("GET", `/v2/checkout/orders/${encodeURIComponent(id)}`);
    },

    async capture(id: string, opts: { idempotencyKey: string }): Promise<Order> {
      return http.request<Order>("POST", `/v2/checkout/orders/${encodeURIComponent(id)}/capture`, {
        body: {},
        idempotencyKey: opts.idempotencyKey,
        preferRepresentation: true,
      });
    },
  };
}
