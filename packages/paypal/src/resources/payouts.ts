import { PayPalError } from "../errors.ts";
import { fromMoney } from "../money.ts";
import type { HttpCore } from "../http.ts";
import type { PayoutBatch, PayoutBatchHeaderResponse, PayoutInput, PayoutItem } from "../types.ts";

function isDuplicateBatchError(error: PayPalError): boolean {
  const text = [error.message, ...error.details.flatMap((detail) => [detail.issue, detail.description, detail.field, detail.value])]
    .filter((value): value is string => value !== undefined)
    .join(" ")
    .toLowerCase();
  return /sender[_ ]batch[_ ]id/.test(text) && text.includes("already");
}

export function createPayoutsResource(http: HttpCore) {
  return {
    async create(input: PayoutInput): Promise<PayoutBatchHeaderResponse> {
      const batchId = input.sender_batch_header.sender_batch_id;
      if (typeof batchId !== "string" || batchId.length < 1 || batchId.length > 256) {
        throw new TypeError("sender_batch_id must contain 1 to 256 characters");
      }
      if (input.items.length < 1 || input.items.length > 15_000) {
        throw new TypeError("payouts require 1 to 15000 items");
      }
      for (const item of input.items) fromMoney(item.amount);

      try {
        return await http.request<PayoutBatchHeaderResponse>("POST", "/v1/payments/payouts", {
          body: input,
          idempotencyKey: batchId,
        });
      } catch (error) {
        if (error instanceof PayPalError && isDuplicateBatchError(error)) {
          throw new PayPalError({
            status: error.status,
            code: "DUPLICATE_SENDER_BATCH_ID",
            details: error.details,
            debugId: error.debugId,
            method: error.method,
            path: error.path,
            retryable: error.retryable,
            message: `${error.method} ${error.path} → ${error.status} DUPLICATE_SENDER_BATCH_ID: sender batch id was already used`,
          });
        }
        throw error;
      }
    },

    async getBatch(batchId: string, page = 1, pageSize = 100): Promise<PayoutBatch> {
      return http.request<PayoutBatch>("GET", `/v1/payments/payouts/${encodeURIComponent(batchId)}`, {
        query: { page, page_size: pageSize, total_required: true },
      });
    },

    async getItem(itemId: string): Promise<PayoutItem> {
      return http.request<PayoutItem>("GET", `/v1/payments/payouts-item/${encodeURIComponent(itemId)}`);
    },

    async cancelUnclaimedItem(itemId: string): Promise<PayoutItem> {
      return http.request<PayoutItem>("POST", `/v1/payments/payouts-item/${encodeURIComponent(itemId)}/cancel`, {
        idempotencyKey: `cancel-${itemId}`,
      });
    },
  };
}
