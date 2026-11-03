import { PayPalError } from "@untangle/paypal";
import type { ExecutorDeps } from "@untangle/executor";
import { PayPalInvoiceGateway } from "./invoice-gateway.ts";
import { DbOperationLog } from "./operation-log.ts";
import { afterPayPalRecord } from "../chaos.ts";
import type { AppContext } from "../context.ts";
import { pacificDate } from "../dates.ts";

export function makeExecutorDeps(ctx: AppContext, stream: string): ExecutorDeps {
  return {
    invoices: (() => {
      const gateway = new PayPalInvoiceGateway(ctx.paypal);
      return {
        get: gateway.get.bind(gateway),
        remove: gateway.remove.bind(gateway),
        record: async (owner: string, invoiceId: string, input: Parameters<PayPalInvoiceGateway["record"]>[2]) => {
          const paymentId = await gateway.record(owner, invoiceId, input);
          await afterPayPalRecord(() => ctx.bus.emit(stream, "demo.crashed", { invoiceId, paymentId, at: ctx.now().toISOString() }).then(() => undefined));
          return paymentId;
        },
      };
    })(),
    ops: new DbOperationLog(ctx.db),
    emit: async (type, payload) => { await ctx.bus.emit(stream, type, payload); },
    today: () => pacificDate(ctx.now()),
    sleep: (ms) => ctx.sleep(ms),
    isRetryable: (error) => error instanceof PayPalError && error.retryable,
    isNotFound: (error) => error instanceof PayPalError && error.status === 404,
  };
}
