import { fromMoney, toMoney } from "@untangle/paypal";
import type { Invoice, Order, PayoutAmount, PayoutInput, PayoutItem } from "@untangle/paypal";

interface Merchant {
  clientId: string;
  clientSecret: string;
  email: string;
}

interface SimInvoice {
  id: string;
  ownerClientId: string;
  debtorEmail: string;
  status: string;
  currency: string;
  amountMinor: number;
  dueMinor: number;
  payments: { id: string; amountMinor: number; note: string }[];
}

interface SimOrder {
  id: string;
  ownerClientId: string;
  status: string;
  requestCaptureId: string | null;
  captureStatus: string;
  purchaseUnit: Record<string, unknown>;
}

interface SimBatch {
  id: string;
  senderBatchId: string;
  ownerClientId: string;
  items: PayoutItem[];
}

export interface Sim {
  addMerchant(clientId: string, clientSecret: string, email: string): void;
  createSentInvoice(creditorEmail: string, debtorEmail: string, amountMinor: number, currency?: string): string;
  cancelInvoice(id: string): void;
  setPayoutStatus(itemId: string, status: string): void;
  payoutItemForTransfer(transferId: string): string;
  failNext(method: string, pathPrefix: string, status: number, times?: number): void;
  clearFaults(): void;
  invoice(id: string): { status: string; dueMinor: number; payments: { id: string; amountMinor: number; note: string }[] };
  /** Runs after each recorded payment, before PayPal's response returns, like a webhook that beats our own code. */
  onPaymentRecorded(listener: (invoiceId: string) => Promise<void>): void;
  /** The next new capture comes back PENDING, as when PayPal holds a payment for review. */
  holdNextCapture(): void;
  completeCapture(orderId: string): void;
}

export function createFakePayPal(): { fetch: typeof fetch; sim: Sim } {
  const merchants = new Map<string, Merchant>();
  const tokens = new Map<string, Merchant>();
  const invoices = new Map<string, SimInvoice>();
  const invoiceByRequestId = new Map<string, string>();
  const orders = new Map<string, SimOrder>();
  const batches = new Map<string, SimBatch>();
  const batchBySenderId = new Map<string, string>();
  const captureByRequestId = new Map<string, string>();
  const faults: { method: string; pathPrefix: string; status: number }[] = [];
  let invoiceSequence = 1;
  let paymentSequence = 1;
  let orderSequence = 1;
  let captureSequence = 1;
  let batchSequence = 1;
  let payoutItemSequence = 1;
  let paymentListener: ((invoiceId: string) => Promise<void>) | undefined;
  let holdNext = false;

  const sim: Sim = {
    onPaymentRecorded(listener) {
      paymentListener = listener;
    },
    addMerchant(clientId, clientSecret, email) {
      merchants.set(clientId, { clientId, clientSecret, email });
    },
    createSentInvoice(creditorEmail, debtorEmail, amountMinor, currency = "USD") {
      const merchant = [...merchants.values()].find((item) => item.email === creditorEmail);
      if (merchant === undefined) throw new Error(`unknown invoice creditor ${creditorEmail}`);
      const id = `INV2-${invoiceSequence++}`;
      invoices.set(id, { id, ownerClientId: merchant.clientId, debtorEmail, status: "SENT", currency, amountMinor, dueMinor: amountMinor, payments: [] });
      return id;
    },
    cancelInvoice(id) {
      const invoice = invoices.get(id);
      if (invoice === undefined) throw new Error(`unknown invoice ${id}`);
      invoice.status = "CANCELLED";
    },
    setPayoutStatus(itemId, status) {
      const item = findPayoutItem(itemId);
      item.transaction_status = status;
    },
    payoutItemForTransfer(transferId) {
      for (const batch of batches.values()) {
        const item = batch.items.find((candidate) => candidate.payout_item?.sender_item_id === transferId);
        if (item !== undefined) return item.payout_item_id;
      }
      throw new Error(`unknown payout transfer ${transferId}`);
    },
    failNext(method, pathPrefix, status, times = 1) {
      for (let i = 0; i < times; i++) faults.push({ method: method.toUpperCase(), pathPrefix, status });
    },
    clearFaults() {
      faults.length = 0;
    },
    holdNextCapture() {
      holdNext = true;
    },
    completeCapture(orderId) {
      const order = orders.get(orderId);
      if (order === undefined) throw new Error(`unknown order ${orderId}`);
      order.captureStatus = "COMPLETED";
    },
    invoice(id) {
      const invoice = invoices.get(id);
      if (invoice === undefined) throw new Error(`unknown invoice ${id}`);
      return { status: invoice.status, dueMinor: invoice.dueMinor, payments: invoice.payments.map(({ id: paymentId, amountMinor, note }) => ({ id: paymentId, amountMinor, note })) };
    },
  };

  function findPayoutItem(itemId: string): PayoutItem {
    for (const batch of batches.values()) {
      const item = batch.items.find((candidate) => candidate.payout_item_id === itemId);
      if (item !== undefined) return item;
    }
    throw new Error(`unknown payout item ${itemId}`);
  }

  function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }

  const fakeFetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const method = (init?.method ?? (typeof input === "object" && !(input instanceof URL) ? input.method : undefined) ?? "GET").toUpperCase();
    const path = url.pathname;
    const headers = new Headers(init?.headers ?? (typeof input === "object" && !(input instanceof URL) ? input.headers : undefined));
    const faultIndex = faults.findIndex((fault) => fault.method === method && path.startsWith(fault.pathPrefix));
    if (faultIndex >= 0) {
      const [fault] = faults.splice(faultIndex, 1);
      return json({ name: "SIMULATED_FAILURE", message: "temporary simulator fault" }, fault!.status);
    }

    if (path === "/v1/oauth2/token" && method === "POST") {
      const authorization = headers.get("authorization") ?? "";
      const encoded = authorization.replace(/^Basic\s+/i, "");
      const [clientId, clientSecret] = Buffer.from(encoded, "base64").toString("utf8").split(":");
      const merchant = merchants.get(clientId ?? "");
      if (merchant === undefined || merchant.clientSecret !== clientSecret) return json({ name: "INVALID_CLIENT", message: "invalid client" }, 401);
      const token = `tok-${merchant.clientId}`;
      tokens.set(token, merchant);
      return json({ access_token: token, expires_in: 3600 });
    }

    const token = (headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const merchant = tokens.get(token);
    if (merchant === undefined) return json({ name: "INVALID_TOKEN", message: "invalid token" }, 401);
    const bodyText = typeof init?.body === "string" ? init.body : "";
    const body = bodyText.length === 0 ? {} : JSON.parse(bodyText) as Record<string, unknown>;

    if (path === "/v2/invoicing/search-invoices" && method === "POST") {
      const items = [...invoices.values()].filter((invoice) => invoice.ownerClientId === merchant.clientId).map(invoiceJson);
      return json({ items, total_items: items.length, total_pages: 1 });
    }
    const remindMatch = /^\/v2\/invoicing\/invoices\/([^/]+)\/remind$/.exec(path);
    if (remindMatch !== null && method === "POST") {
      const invoice = invoices.get(decodeURIComponent(remindMatch[1]!));
      if (invoice === undefined || invoice.ownerClientId !== merchant.clientId) return json({ name: "RESOURCE_NOT_FOUND", message: "invoice not found" }, 404);
      return new Response(null, { status: 204 });
    }
    if (path === "/v2/invoicing/invoices" && method === "POST") {
      const requestId = headers.get("paypal-request-id");
      const requestKey = requestId === null ? null : `${merchant.clientId}:${requestId}`;
      const existingId = requestKey === null ? undefined : invoiceByRequestId.get(requestKey);
      if (existingId !== undefined) return json(invoiceJson(invoices.get(existingId)!), 201);
      const detail = body.detail as Record<string, unknown>;
      const primary = (body.primary_recipients as { billing_info?: { email_address?: string } }[] | undefined)?.[0];
      const items = body.items as { quantity: string; unit_amount: { currency_code: string; value: string } }[] | undefined;
      const amountMinor = (items ?? []).reduce((sum, item) => sum + fromMoney(item.unit_amount) * Number(item.quantity), 0);
      const id = `INV2-${invoiceSequence++}`;
      const invoice: SimInvoice = {
        id, ownerClientId: merchant.clientId, debtorEmail: primary?.billing_info?.email_address ?? "", status: "DRAFT",
        currency: String(detail.currency_code), amountMinor, dueMinor: amountMinor, payments: [],
      };
      invoices.set(id, invoice);
      if (requestKey !== null) invoiceByRequestId.set(requestKey, id);
      return json(invoiceJson(invoice), 201);
    }
    const invoiceMatch = /^\/v2\/invoicing\/invoices\/([^/]+)(?:\/(payments)(?:\/([^/]+))?|\/(send|cancel))?$/.exec(path);
    if (invoiceMatch !== null) {
      const id = decodeURIComponent(invoiceMatch[1]!);
      const invoice = invoices.get(id);
      if (invoice === undefined || invoice.ownerClientId !== merchant.clientId) return json({ name: "RESOURCE_NOT_FOUND", message: "invoice not found" }, 404);
      const action = invoiceMatch[4];
      if (method === "GET" && action === undefined) return json(invoiceJson(invoice));
      if (method === "POST" && action === "send") {
        invoice.status = "SENT";
        return new Response(null, { status: 204 });
      }
      if (method === "POST" && action === "cancel") {
        invoice.status = "CANCELLED";
        return new Response(null, { status: 204 });
      }
      if (method === "POST" && invoiceMatch[2] === "payments") {
        if (!["SENT", "UNPAID", "PARTIALLY_PAID"].includes(invoice.status)) return json({ name: "INVOICE_NOT_PAYABLE", message: "invoice is not payable" }, 422);
        const amount = body.amount as { currency_code: string; value: string };
        const amountMinor = fromMoney(amount);
        if (amount.currency_code !== invoice.currency || amountMinor > invoice.dueMinor) return json({ name: "AMOUNT_EXCEEDS_DUE", message: "amount exceeds due" }, 422);
        const paymentId = `EXTR-${paymentSequence++}`;
        invoice.payments.push({ id: paymentId, amountMinor, note: String(body.note ?? "") });
        invoice.dueMinor -= amountMinor;
        invoice.status = invoice.dueMinor === 0 ? "MARKED_AS_PAID" : "PARTIALLY_PAID";
        if (paymentListener !== undefined) await paymentListener(invoice.id);
        return json({ payment_id: paymentId }, 201);
      }
      if (method === "DELETE" && invoiceMatch[2] === "payments") {
        const paymentId = decodeURIComponent(invoiceMatch[3] ?? "");
        const index = invoice.payments.findIndex((payment) => payment.id === paymentId);
        if (index < 0) return json({ name: "RESOURCE_NOT_FOUND", message: "payment not found" }, 404);
        const [payment] = invoice.payments.splice(index, 1);
        invoice.dueMinor += payment!.amountMinor;
        invoice.status = invoice.dueMinor === invoice.amountMinor ? "SENT" : "PARTIALLY_PAID";
        return new Response(null, { status: 204 });
      }
    }

    if (path === "/v2/checkout/orders" && method === "POST") {
      const purchaseUnits = body.purchase_units as Record<string, unknown>[];
      const orderId = `ORDER-${orderSequence++}`;
      const order: SimOrder = { id: orderId, ownerClientId: merchant.clientId, status: "CREATED", requestCaptureId: null, captureStatus: "COMPLETED", purchaseUnit: purchaseUnits[0] ?? {} };
      orders.set(orderId, order);
      return json(orderJson(order), 201);
    }
    const captureMatch = /^\/v2\/checkout\/orders\/([^/]+)\/capture$/.exec(path);
    if (captureMatch !== null && method === "POST") {
      const order = orders.get(decodeURIComponent(captureMatch[1]!));
      if (order === undefined || order.ownerClientId !== merchant.clientId) return json({ name: "RESOURCE_NOT_FOUND", message: "order not found" }, 404);
      const requestId = headers.get("paypal-request-id") ?? "";
      let captureId = captureByRequestId.get(requestId);
      if (captureId === undefined) {
        captureId = `CAP-${captureSequence++}`;
        captureByRequestId.set(requestId, captureId);
        order.captureStatus = holdNext ? "PENDING" : "COMPLETED";
        holdNext = false;
      }
      order.status = "COMPLETED";
      order.requestCaptureId = captureId;
      return json(orderJson(order, captureId));
    }
    const orderGet = /^\/v2\/checkout\/orders\/([^/]+)$/.exec(path);
    if (orderGet !== null && method === "GET") {
      const order = orders.get(decodeURIComponent(orderGet[1]!));
      if (order === undefined || order.ownerClientId !== merchant.clientId) return json({ name: "RESOURCE_NOT_FOUND", message: "order not found" }, 404);
      return json(orderJson(order, order.requestCaptureId ?? undefined));
    }

    if (path === "/v1/payments/payouts" && method === "POST") {
      const header = body.sender_batch_header as { sender_batch_id: string };
      if (batchBySenderId.has(header.sender_batch_id)) return json({ name: "DUPLICATE_SENDER_BATCH_ID", message: "sender batch id already used" }, 409);
      const id = `PB-${batchSequence++}`;
      const payoutItems = (body.items as PayoutInput["items"]).map((payout) => ({
        payout_item_id: `PI-${payoutItemSequence++}`,
        transaction_status: "PENDING",
        payout_batch_id: id,
        payout_item: {
          recipient_type: payout.recipient_type,
          receiver: payout.receiver,
        amount: payout.amount as PayoutAmount,
          ...(payout.sender_item_id === undefined ? {} : { sender_item_id: payout.sender_item_id }),
        },
      } satisfies PayoutItem));
      const batch: SimBatch = { id, senderBatchId: header.sender_batch_id, ownerClientId: merchant.clientId, items: payoutItems };
      batches.set(id, batch);
      batchBySenderId.set(header.sender_batch_id, id);
      return json({ batch_header: { payout_batch_id: id, batch_status: "PENDING", sender_batch_header: header } }, 201);
    }
    const batchMatch = /^\/v1\/payments\/payouts\/([^/]+)$/.exec(path);
    if (batchMatch !== null && method === "GET") {
      const batch = batches.get(decodeURIComponent(batchMatch[1]!));
      if (batch === undefined || batch.ownerClientId !== merchant.clientId) return json({ name: "RESOURCE_NOT_FOUND", message: "batch not found" }, 404);
      return json({ batch_header: { payout_batch_id: batch.id, batch_status: "PENDING" }, items: batch.items });
    }
    const itemMatch = /^\/v1\/payments\/payouts-item\/([^/]+)$/.exec(path);
    if (itemMatch !== null && method === "GET") {
      const item = findPayoutItem(decodeURIComponent(itemMatch[1]!));
      const batch = [...batches.values()].find((candidate) => candidate.items.includes(item));
      if (batch?.ownerClientId !== merchant.clientId) return json({ name: "RESOURCE_NOT_FOUND", message: "item not found" }, 404);
      return json(item);
    }

    if (path === "/v1/notifications/verify-webhook-signature" && method === "POST") {
      const signature = body as Record<string, unknown>;
      return json({ verification_status: signature.transmission_sig === "valid-sig" ? "SUCCESS" : "FAILURE" });
    }
    return json({ name: "RESOURCE_NOT_FOUND", message: `${method} ${path} is not simulated` }, 404);
  };

  function invoiceJson(invoice: SimInvoice): Invoice {
    return {
      id: invoice.id,
      status: invoice.status as Invoice["status"],
      detail: { currency_code: invoice.currency, invoice_number: invoice.id },
      primary_recipients: [{ billing_info: { email_address: invoice.debtorEmail } }],
      amount: { currency_code: invoice.currency, value: toMoney(invoice.amountMinor, invoice.currency).value },
      due_amount: toMoney(invoice.dueMinor, invoice.currency),
      payments: {
        transactions: invoice.payments.map((payment) => ({
          payment_id: payment.id,
          amount: toMoney(payment.amountMinor, invoice.currency),
          note: payment.note,
        })),
      },
    };
  }

  function orderJson(order: SimOrder, captureId?: string): Order {
    return {
      id: order.id,
      status: order.status,
      purchase_units: [{
        ...order.purchaseUnit,
        ...(captureId === undefined ? {} : { payments: { captures: [{ id: captureId, status: order.captureStatus }] } }),
      }],
    };
  }

  return { fetch: fakeFetch, sim };
}
