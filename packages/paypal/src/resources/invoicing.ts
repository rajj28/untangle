import type { HttpCore } from "../http.ts";
import type { Invoice, InvoiceInput, InvoiceSearch, InvoiceSearchResult, Money } from "../types.ts";

export interface IdempotencyOptions {
  idempotencyKey?: string;
}

export interface RecordPaymentInput {
  method: "BANK_TRANSFER" | "CASH" | "CHECK" | "CREDIT_CARD" | "DEBIT_CARD" | "PAYPAL" | "WIRE_TRANSFER" | "OTHER";
  payment_date: string;
  amount: Money;
  note?: string;
}

export function createInvoicingResource(http: HttpCore) {
  return {
    async createDraft(input: InvoiceInput, opts: IdempotencyOptions = {}): Promise<Invoice> {
      return http.request<Invoice>("POST", "/v2/invoicing/invoices", {
        body: input,
        preferRepresentation: true,
        ...(opts.idempotencyKey === undefined ? {} : { idempotencyKey: opts.idempotencyKey }),
      });
    },

    async send(
      id: string,
      input?: { send_to_recipient?: boolean; send_to_invoicer?: boolean; subject?: string; note?: string },
      opts: IdempotencyOptions = {},
    ): Promise<void> {
      await http.request<void>("POST", `/v2/invoicing/invoices/${encodeURIComponent(id)}/send`, {
        body: input ?? {},
        ...(opts.idempotencyKey === undefined ? {} : { idempotencyKey: opts.idempotencyKey }),
      });
    },

    async get(id: string): Promise<Invoice> {
      return http.request<Invoice>("GET", `/v2/invoicing/invoices/${encodeURIComponent(id)}`);
    },

    async search(filter: InvoiceSearch, page = 1, pageSize = 100): Promise<InvoiceSearchResult> {
      const result = await http.request<Partial<InvoiceSearchResult>>("POST", "/v2/invoicing/search-invoices", {
        query: { page, page_size: pageSize, total_required: true },
        body: filter,
        idempotencyKey: `search-${globalThis.crypto.randomUUID()}`,
      });
      return { ...result, items: result.items ?? [] };
    },

    async recordPayment(id: string, input: RecordPaymentInput): Promise<{ payment_id: string }> {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.payment_date)) throw new TypeError("payment_date must match YYYY-MM-DD");
      return http.request<{ payment_id: string }>("POST", `/v2/invoicing/invoices/${encodeURIComponent(id)}/payments`, {
        body: input,
      });
    },

    async deleteExternalPayment(id: string, transactionId: string): Promise<void> {
      await http.request<void>("DELETE", `/v2/invoicing/invoices/${encodeURIComponent(id)}/payments/${encodeURIComponent(transactionId)}`);
    },

    async remind(id: string, input?: { subject?: string; note?: string }): Promise<void> {
      await http.request<void>("POST", `/v2/invoicing/invoices/${encodeURIComponent(id)}/remind`, { body: input ?? {} });
    },

    async cancel(id: string, input?: { subject?: string; note?: string; send_to_recipient?: boolean }): Promise<void> {
      await http.request<void>("POST", `/v2/invoicing/invoices/${encodeURIComponent(id)}/cancel`, { body: input ?? {} });
    },

    async qrCode(id: string, size?: { width?: number; height?: number }): Promise<string> {
      return http.request<string>("POST", `/v2/invoicing/invoices/${encodeURIComponent(id)}/generate-qr-code`, {
        body: size ?? {},
        expectText: true,
      });
    },

    async nextInvoiceNumber(): Promise<string> {
      const result = await http.request<{ invoice_number: string }>("POST", "/v2/invoicing/generate-next-invoice-number");
      return result.invoice_number;
    },
  };
}
