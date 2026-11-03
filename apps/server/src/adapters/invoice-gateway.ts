import { fromMoney, toMoney } from "@untangle/paypal";
import type { InvoiceGateway, InvoiceSnapshot, RecordInput } from "@untangle/executor";
import type { PayPalRegistry } from "../paypal-registry.ts";

export class PayPalInvoiceGateway implements InvoiceGateway {
  private readonly registry: PayPalRegistry;

  constructor(registry: PayPalRegistry) {
    this.registry = registry;
  }

  async get(owner: string, invoiceId: string): Promise<InvoiceSnapshot> {
    const invoice = await (await this.registry.forBusiness(owner)).invoicing.get(invoiceId);
    let dueMinor: number;
    if (invoice.due_amount !== undefined) dueMinor = fromMoney(invoice.due_amount);
    else if (invoice.status === "PAID" || invoice.status === "MARKED_AS_PAID") dueMinor = 0;
    else {
      if (invoice.amount === undefined) throw new Error("invoice amount is missing");
      dueMinor = fromMoney(invoice.amount);
    }
    return {
      id: invoice.id,
      status: invoice.status,
      currency: invoice.detail.currency_code,
      dueMinor,
      payments: (invoice.payments?.transactions ?? []).map((transaction) => ({
        paymentId: transaction.payment_id ?? "",
        amountMinor: transaction.amount === undefined ? 0 : fromMoney(transaction.amount),
        note: transaction.note ?? "",
      })),
    };
  }

  async record(owner: string, invoiceId: string, input: RecordInput): Promise<string> {
    const result = await (await this.registry.forBusiness(owner)).invoicing.recordPayment(invoiceId, {
      method: "OTHER",
      payment_date: input.date,
      amount: toMoney(input.amountMinor, input.currency),
      note: input.note,
    });
    return result.payment_id;
  }

  async remove(owner: string, invoiceId: string, paymentId: string): Promise<void> {
    await (await this.registry.forBusiness(owner)).invoicing.deleteExternalPayment(invoiceId, paymentId);
  }
}
