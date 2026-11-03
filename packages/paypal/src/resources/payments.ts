import type { HttpCore } from "../http.ts";
import type { Capture, Money, Refund } from "../types.ts";

export interface RefundInput {
  amount?: Money;
  note_to_payer?: string;
  invoice_id?: string;
}

export function createPaymentsResource(http: HttpCore) {
  return {
    async getCapture(id: string): Promise<Capture> {
      return http.request<Capture>("GET", `/v2/payments/captures/${encodeURIComponent(id)}`);
    },

    async refundCapture(id: string, input: RefundInput, opts: { idempotencyKey: string }): Promise<Refund> {
      return http.request<Refund>("POST", `/v2/payments/captures/${encodeURIComponent(id)}/refund`, {
        body: input,
        idempotencyKey: opts.idempotencyKey,
        preferRepresentation: true,
      });
    },

    async getRefund(id: string): Promise<Refund> {
      return http.request<Refund>("GET", `/v2/payments/refunds/${encodeURIComponent(id)}`);
    },
  };
}
