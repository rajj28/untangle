import { describe, expect, it } from "vitest";
import { createPayPalClient } from "../src/client.ts";
import type { PayoutInput } from "../src/types.ts";
import { fakeFetch, type FakeFetchCall, type FakeRoutes } from "./fake-fetch.ts";

const clientConfig = { clientId: "merchant-id", clientSecret: "merchant-secret", environment: "sandbox" as const };

function clientWith(routes: FakeRoutes = {}) {
  const fetch = fakeFetch(routes);
  const client = createPayPalClient({ ...clientConfig, fetch });
  return { client, fetch };
}

function resourceCall(calls: FakeFetchCall[]): FakeFetchCall {
  const call = calls.find((entry) => new URL(entry.url).pathname !== "/v1/oauth2/token");
  if (call === undefined) throw new Error("expected an API request");
  return call;
}

function jsonBody(call: FakeFetchCall): unknown {
  if (typeof call.body !== "string") throw new Error("expected a JSON string body");
  return JSON.parse(call.body) as unknown;
}

function pathOf(call: FakeFetchCall): string {
  return new URL(call.url).pathname;
}

describe("resource methods", () => {
  it("invoicing.createDraft sends a represented invoice with an idempotency key", async () => {
    const input = { detail: { currency_code: "USD" }, primary_recipients: [], items: [] };
    const { client, fetch } = clientWith({ "POST /v2/invoicing/invoices": { status: 201, json: { id: "i/1", status: "DRAFT", detail: { currency_code: "USD" } } } });
    await client.invoicing.createDraft(input, { idempotencyKey: "draft-1" });
    const call = resourceCall(fetch.calls);
    expect(call.method).toBe("POST");
    expect(pathOf(call)).toBe("/v2/invoicing/invoices");
    expect(jsonBody(call)).toEqual(input);
    expect(call.headers.prefer).toBe("return=representation");
    expect(call.headers["paypal-request-id"]).toBe("draft-1");
    expect(call.headers.authorization).toBe("Bearer tok-1");
  });

  it("invoicing.send encodes its id and defaults the body to an empty object", async () => {
    const { client, fetch } = clientWith();
    await client.invoicing.send("id/one");
    const call = resourceCall(fetch.calls);
    expect(call.method).toBe("POST");
    expect(pathOf(call)).toBe("/v2/invoicing/invoices/id%2Fone/send");
    expect(jsonBody(call)).toEqual({});
  });

  it("invoicing.get encodes its id", async () => {
    const { client, fetch } = clientWith({ "GET /v2/invoicing/invoices/id%2Fone": { status: 200, json: { id: "id/one", status: "DRAFT", detail: { currency_code: "USD" } } } });
    await client.invoicing.get("id/one");
    expect(resourceCall(fetch.calls).method).toBe("GET");
    expect(pathOf(resourceCall(fetch.calls))).toBe("/v2/invoicing/invoices/id%2Fone");
  });

  it("invoicing.search sends its filter, paging query, and a retryable idempotency key", async () => {
    const { client, fetch } = clientWith({ "POST /v2/invoicing/search-invoices": { status: 200, json: {} } });
    await expect(client.invoicing.search({ invoice_number: "N-1" }, 2, 30)).resolves.toEqual({ items: [] });
    const call = resourceCall(fetch.calls);
    expect(call.method).toBe("POST");
    expect(pathOf(call)).toBe("/v2/invoicing/search-invoices");
    expect(jsonBody(call)).toEqual({ invoice_number: "N-1" });
    expect(new URL(call.url).searchParams.toString()).toBe("page=2&page_size=30&total_required=true");
    expect(call.headers["paypal-request-id"]).toMatch(/^search-/);
  });

  it("invoicing.recordPayment sends no idempotency header", async () => {
    const input = { method: "CASH" as const, payment_date: "2026-11-05", amount: { currency_code: "USD", value: "1.00" } };
    const { client, fetch } = clientWith({ "POST /v2/invoicing/invoices/id%2Fone/payments": { status: 201, json: { payment_id: "p-1" } } });
    await client.invoicing.recordPayment("id/one", input);
    const call = resourceCall(fetch.calls);
    expect(call.method).toBe("POST");
    expect(pathOf(call)).toBe("/v2/invoicing/invoices/id%2Fone/payments");
    expect(jsonBody(call)).toEqual(input);
    expect(call.headers["paypal-request-id"]).toBeUndefined();
  });

  it("invoicing.recordPayment rejects an invalid date without fetching", async () => {
    const { client, fetch } = clientWith();
    await expect(client.invoicing.recordPayment("id", {
      method: "CASH", payment_date: "2026/11/05", amount: { currency_code: "USD", value: "1.00" },
    })).rejects.toBeInstanceOf(TypeError);
    expect(fetch.calls).toHaveLength(0);
  });

  it("invoicing.deleteExternalPayment encodes both path parameters", async () => {
    const { client, fetch } = clientWith();
    await client.invoicing.deleteExternalPayment("invoice/1", "txn/2");
    const call = resourceCall(fetch.calls);
    expect(call.method).toBe("DELETE");
    expect(pathOf(call)).toBe("/v2/invoicing/invoices/invoice%2F1/payments/txn%2F2");
  });

  it("invoicing.remind sends the default body", async () => {
    const { client, fetch } = clientWith();
    await client.invoicing.remind("i/1");
    const call = resourceCall(fetch.calls);
    expect(call.method).toBe("POST");
    expect(pathOf(call)).toBe("/v2/invoicing/invoices/i%2F1/remind");
    expect(jsonBody(call)).toEqual({});
  });

  it("invoicing.cancel sends its body", async () => {
    const input = { subject: "Cancelled", send_to_recipient: false };
    const { client, fetch } = clientWith();
    await client.invoicing.cancel("i/1", input);
    const call = resourceCall(fetch.calls);
    expect(call.method).toBe("POST");
    expect(pathOf(call)).toBe("/v2/invoicing/invoices/i%2F1/cancel");
    expect(jsonBody(call)).toEqual(input);
  });

  it("invoicing.qrCode returns raw text with a JSON size body", async () => {
    const { client, fetch } = clientWith({ "POST /v2/invoicing/invoices/i%2F1/generate-qr-code": { status: 200, text: "base64-png" } });
    await expect(client.invoicing.qrCode("i/1", { width: 200, height: 200 })).resolves.toBe("base64-png");
    const call = resourceCall(fetch.calls);
    expect(call.method).toBe("POST");
    expect(pathOf(call)).toBe("/v2/invoicing/invoices/i%2F1/generate-qr-code");
    expect(jsonBody(call)).toEqual({ width: 200, height: 200 });
  });

  it("invoicing.nextInvoiceNumber reads invoice_number", async () => {
    const { client, fetch } = clientWith({ "POST /v2/invoicing/generate-next-invoice-number": { status: 200, json: { invoice_number: "INV-1" } } });
    await expect(client.invoicing.nextInvoiceNumber()).resolves.toBe("INV-1");
    const call = resourceCall(fetch.calls);
    expect(call.method).toBe("POST");
    expect(pathOf(call)).toBe("/v2/invoicing/generate-next-invoice-number");
    expect(call.body).toBeUndefined();
  });

  it("orders.create requires and sends the idempotency key and representation preference", async () => {
    const input = { intent: "CAPTURE" as const, purchase_units: [{ amount: { currency_code: "USD", value: "1.00" } }] };
    const { client, fetch } = clientWith();
    await client.orders.create(input, { idempotencyKey: "order-key" });
    const call = resourceCall(fetch.calls);
    expect(call.method).toBe("POST");
    expect(pathOf(call)).toBe("/v2/checkout/orders");
    expect(jsonBody(call)).toEqual(input);
    expect(call.headers["paypal-request-id"]).toBe("order-key");
    expect(call.headers.prefer).toBe("return=representation");
  });

  it("orders.get encodes the order id", async () => {
    const { client, fetch } = clientWith();
    await client.orders.get("order/1");
    const call = resourceCall(fetch.calls);
    expect(call.method).toBe("GET");
    expect(pathOf(call)).toBe("/v2/checkout/orders/order%2F1");
  });

  it("orders.capture sends an empty body, representation preference, and request id", async () => {
    const { client, fetch } = clientWith();
    await client.orders.capture("order/1", { idempotencyKey: "capture-1" });
    const call = resourceCall(fetch.calls);
    expect(call.method).toBe("POST");
    expect(pathOf(call)).toBe("/v2/checkout/orders/order%2F1/capture");
    expect(jsonBody(call)).toEqual({});
    expect(call.headers.prefer).toBe("return=representation");
    expect(call.headers["paypal-request-id"]).toBe("capture-1");
  });

  it("payments.getCapture encodes the capture id", async () => {
    const { client, fetch } = clientWith();
    await client.payments.getCapture("capture/1");
    const call = resourceCall(fetch.calls);
    expect(call.method).toBe("GET");
    expect(pathOf(call)).toBe("/v2/payments/captures/capture%2F1");
  });

  it("payments.refundCapture sends its body and retry headers", async () => {
    const input = { amount: { currency_code: "USD", value: "1.00" }, invoice_id: "INV-1" };
    const { client, fetch } = clientWith();
    await client.payments.refundCapture("capture/1", input, { idempotencyKey: "refund-1" });
    const call = resourceCall(fetch.calls);
    expect(call.method).toBe("POST");
    expect(pathOf(call)).toBe("/v2/payments/captures/capture%2F1/refund");
    expect(jsonBody(call)).toEqual(input);
    expect(call.headers["paypal-request-id"]).toBe("refund-1");
    expect(call.headers.prefer).toBe("return=representation");
  });

  it("payments.getRefund encodes the refund id", async () => {
    const { client, fetch } = clientWith();
    await client.payments.getRefund("refund/1");
    const call = resourceCall(fetch.calls);
    expect(call.method).toBe("GET");
    expect(pathOf(call)).toBe("/v2/payments/refunds/refund%2F1");
  });

  it("payouts.create validates and sends sender_batch_id as the request id", async () => {
    const input: PayoutInput = {
      sender_batch_header: { sender_batch_id: "batch-1" },
      items: [{ recipient_type: "EMAIL", receiver: "a@example.com", amount: { currency: "USD", value: "2.50" } }],
    };
    const { client, fetch } = clientWith();
    await client.payouts.create(input);
    const call = resourceCall(fetch.calls);
    expect(call.method).toBe("POST");
    expect(pathOf(call)).toBe("/v1/payments/payouts");
    expect(jsonBody(call)).toEqual(input);
    expect(call.headers["paypal-request-id"]).toBe("batch-1");
  });

  it("payouts.create rejects zero items before fetching", async () => {
    const { client, fetch } = clientWith();
    await expect(client.payouts.create({ sender_batch_header: { sender_batch_id: "batch" }, items: [] })).rejects.toBeInstanceOf(TypeError);
    expect(fetch.calls).toHaveLength(0);
  });

  it("payouts.create marks an already-used sender batch id for reconciliation", async () => {
    const { client, fetch } = clientWith({
      "POST /v1/payments/payouts": { status: 400, json: { name: "VALIDATION_ERROR", message: "sender_batch_id was already used" } },
    });
    await expect(client.payouts.create({
      sender_batch_header: { sender_batch_id: "batch-1" },
      items: [{ recipient_type: "EMAIL", receiver: "a@example.com", amount: { currency: "USD", value: "1.00" } }],
    })).rejects.toMatchObject({ code: "DUPLICATE_SENDER_BATCH_ID" });
    expect(resourceCall(fetch.calls).headers["paypal-request-id"]).toBe("batch-1");
  });

  it("payouts.getBatch sends its paging query and encodes the id", async () => {
    const { client, fetch } = clientWith();
    await client.payouts.getBatch("batch/1", 3, 40);
    const call = resourceCall(fetch.calls);
    expect(call.method).toBe("GET");
    expect(pathOf(call)).toBe("/v1/payments/payouts/batch%2F1");
    expect(new URL(call.url).searchParams.toString()).toBe("page=3&page_size=40&total_required=true");
  });

  it("payouts.getItem encodes the item id", async () => {
    const { client, fetch } = clientWith();
    await client.payouts.getItem("item/1");
    const call = resourceCall(fetch.calls);
    expect(call.method).toBe("GET");
    expect(pathOf(call)).toBe("/v1/payments/payouts-item/item%2F1");
  });

  it("payouts.cancelUnclaimedItem sends its repeat-safe request id", async () => {
    const { client, fetch } = clientWith();
    await client.payouts.cancelUnclaimedItem("item/1");
    const call = resourceCall(fetch.calls);
    expect(call.method).toBe("POST");
    expect(pathOf(call)).toBe("/v1/payments/payouts-item/item%2F1/cancel");
    expect(call.body).toBeUndefined();
    expect(call.headers["paypal-request-id"]).toBe("cancel-item/1");
  });

  it("reporting.listTransactions validates its range, defaults fields, and normalizes missing details", async () => {
    const { client, fetch } = clientWith({ "GET /v1/reporting/transactions": { status: 200, json: {} } });
    await expect(client.reporting.listTransactions({ start_date: "2026-01-01", end_date: "2026-01-31" }))
      .resolves.toMatchObject({ transaction_details: [] });
    const call = resourceCall(fetch.calls);
    expect(call.method).toBe("GET");
    expect(pathOf(call)).toBe("/v1/reporting/transactions");
    expect(new URL(call.url).searchParams.get("fields")).toBe("all");
    expect(new URL(call.url).searchParams.get("page_size")).toBe("500");
  });

  it("reporting.listTransactions rejects a 32-day range before fetching", async () => {
    const { client, fetch } = clientWith();
    await expect(client.reporting.listTransactions({ start_date: "2026-01-01", end_date: "2026-02-02" })).rejects.toBeInstanceOf(TypeError);
    expect(fetch.calls).toHaveLength(0);
  });

  it("reporting.listBalances sends optional query values", async () => {
    const { client, fetch } = clientWith();
    await client.reporting.listBalances({ as_of_time: "2026-11-05T00:00:00Z", currency_code: "USD" });
    const call = resourceCall(fetch.calls);
    expect(call.method).toBe("GET");
    expect(pathOf(call)).toBe("/v1/reporting/balances");
    expect(new URL(call.url).searchParams.get("as_of_time")).toBe("2026-11-05T00:00:00Z");
    expect(new URL(call.url).searchParams.get("currency_code")).toBe("USD");
  });

  it("disputes.list sends filters and normalizes missing items", async () => {
    const { client, fetch } = clientWith({ "GET /v1/customer/disputes": { status: 200, json: {} } });
    await expect(client.disputes.list({ page_size: 20, dispute_state: "OPEN" })).resolves.toEqual({ items: [] });
    const call = resourceCall(fetch.calls);
    expect(call.method).toBe("GET");
    expect(pathOf(call)).toBe("/v1/customer/disputes");
    expect(new URL(call.url).searchParams.get("page_size")).toBe("20");
    expect(new URL(call.url).searchParams.get("dispute_state")).toBe("OPEN");
  });

  it("disputes.get encodes the dispute id", async () => {
    const { client, fetch } = clientWith();
    await client.disputes.get("dispute/1");
    const call = resourceCall(fetch.calls);
    expect(call.method).toBe("GET");
    expect(pathOf(call)).toBe("/v1/customer/disputes/dispute%2F1");
  });

  it("disputes.provideEvidence sends multipart input and files without JSON content type", async () => {
    const { client, fetch } = clientWith();
    await client.disputes.provideEvidence("dispute/1", { evidences: [{ evidence_type: "PROOF_OF_FULFILLMENT" }] }, [
      { name: "receipt.txt", contentType: "text/plain", data: new Uint8Array([104, 105]) },
    ]);
    const call = resourceCall(fetch.calls);
    expect(call.method).toBe("POST");
    expect(pathOf(call)).toBe("/v1/customer/disputes/dispute%2F1/provide-evidence");
    expect(call.body).toBeInstanceOf(FormData);
    const form = call.body as FormData;
    expect(await (form.get("input") as Blob).text()).toBe(JSON.stringify({ evidences: [{ evidence_type: "PROOF_OF_FULFILLMENT" }] }));
    expect(form.get("evidence-file")).toBeInstanceOf(Blob);
    expect(call.headers["content-type"]).toBeUndefined();
    expect(call.headers["paypal-request-id"]).toBeUndefined();
  });

  it("webhooks.create uses a URL-derived request id", async () => {
    const input = { url: "https://example.com/hook", event_types: [{ name: "PAYMENT.CAPTURE.COMPLETED" }] };
    const { client, fetch } = clientWith();
    await client.webhooks.create(input);
    const call = resourceCall(fetch.calls);
    expect(call.method).toBe("POST");
    expect(pathOf(call)).toBe("/v1/notifications/webhooks");
    expect(jsonBody(call)).toEqual(input);
    expect(call.headers["paypal-request-id"]).toBe("webhook-https://example.com/hook");
  });

  it("webhooks.list returns the webhooks array or an empty array", async () => {
    const { client, fetch } = clientWith({ "GET /v1/notifications/webhooks": { status: 200, json: { webhooks: [{ id: "w1", url: "https://example.com", event_types: [] }] } } });
    await expect(client.webhooks.list()).resolves.toEqual([{ id: "w1", url: "https://example.com", event_types: [] }]);
    expect(resourceCall(fetch.calls).method).toBe("GET");
  });

  it("webhooks.delete encodes the webhook id", async () => {
    const { client, fetch } = clientWith();
    await client.webhooks.delete("webhook/1");
    const call = resourceCall(fetch.calls);
    expect(call.method).toBe("DELETE");
    expect(pathOf(call)).toBe("/v1/notifications/webhooks/webhook%2F1");
  });

  it("webhooks.verify avoids a request when a signature header is missing", async () => {
    const { client, fetch } = clientWith();
    await expect(client.webhooks.verify({ webhookId: "w1", headers: {}, rawBody: "{}" })).resolves.toBe(false);
    expect(fetch.calls).toHaveLength(0);
  });

  it("webhooks.verify reads mixed-case headers and sends the parsed event", async () => {
    const { client, fetch } = clientWith({
      "POST /v1/notifications/verify-webhook-signature": { status: 200, json: { verification_status: "SUCCESS" } },
    });
    const rawBody = JSON.stringify({ id: "evt-1", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: {} });
    await expect(client.webhooks.verify({
      webhookId: "w1",
      headers: {
        "PayPal-Auth-Algo": "SHA256withRSA",
        "paypal-Cert-Url": "https://cert.example",
        "PayPal-Transmission-Id": ["tx-1", "ignored"],
        "paypal-transmission-sig": "sig",
        "PAYPAL-TRANSMISSION-TIME": "time",
      },
      rawBody,
    })).resolves.toBe(true);
    const call = resourceCall(fetch.calls);
    expect(call.method).toBe("POST");
    expect(pathOf(call)).toBe("/v1/notifications/verify-webhook-signature");
    expect(jsonBody(call)).toEqual({
      auth_algo: "SHA256withRSA",
      cert_url: "https://cert.example",
      transmission_id: "tx-1",
      transmission_sig: "sig",
      transmission_time: "time",
      webhook_id: "w1",
      webhook_event: JSON.parse(rawBody),
    });
    expect(call.headers["paypal-request-id"]).toBe("verify-tx-1");
  });

  it("webhooks.verify returns false for invalid JSON and failed verification", async () => {
    const headers = {
      "paypal-auth-algo": "a", "paypal-cert-url": "c", "paypal-transmission-id": "t",
      "paypal-transmission-sig": "s", "paypal-transmission-time": "x",
    };
    const { client: invalidClient, fetch: invalidFetch } = clientWith();
    await expect(invalidClient.webhooks.verify({ webhookId: "w", headers, rawBody: "{" })).resolves.toBe(false);
    expect(invalidFetch.calls).toHaveLength(0);

    const { client, fetch } = clientWith({ "POST /v1/notifications/verify-webhook-signature": { status: 200, json: { verification_status: "FAILURE" } } });
    await expect(client.webhooks.verify({ webhookId: "w", headers, rawBody: "{}" })).resolves.toBe(false);
    expect(resourceCall(fetch.calls).method).toBe("POST");
  });

  it("identity.authorizeUrl uses the environment host and encoded parameters", () => {
    const { client } = clientWith();
    const authorize = new URL(client.identity.authorizeUrl({ redirectUri: "https://example.com/callback?a=1", state: "abc" }));
    expect(authorize.origin).toBe("https://www.sandbox.paypal.com");
    expect(authorize.pathname).toBe("/signin/authorize");
    expect(authorize.searchParams.get("flowEntry")).toBe("static");
    expect(authorize.searchParams.get("client_id")).toBe("merchant-id");
    expect(authorize.searchParams.get("response_type")).toBe("code");
    expect(authorize.searchParams.get("scope")).toBe("openid email profile");
    expect(authorize.searchParams.get("redirect_uri")).toBe("https://example.com/callback?a=1");
    expect(authorize.searchParams.get("state")).toBe("abc");
  });

  it("identity.exchangeCode uses Basic auth and authorization-code form data without the app token", async () => {
    const { client, fetch } = clientWith({
      "POST /v1/oauth2/token": { status: 200, json: { access_token: "user-token", expires_in: 100, token_type: "Bearer" } },
    });
    await client.identity.exchangeCode("code value");
    expect(fetch.calls).toHaveLength(1);
    const call = fetch.calls[0];
    expect(call?.method).toBe("POST");
    expect(pathOf(call!)).toBe("/v1/oauth2/token");
    expect(call?.headers.authorization).toBe(`Basic ${Buffer.from("merchant-id:merchant-secret").toString("base64")}`);
    expect(call?.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(call?.body).toBe("grant_type=authorization_code&code=code+value");
  });

  it("identity.userInfo uses the supplied bearer and schema query", async () => {
    const { client, fetch } = clientWith({ "GET /v1/identity/openidconnect/userinfo": { status: 200, json: { user_id: "user-1" } } });
    await client.identity.userInfo("user-access-token");
    const call = resourceCall(fetch.calls);
    expect(call.method).toBe("GET");
    expect(pathOf(call)).toBe("/v1/identity/openidconnect/userinfo");
    expect(new URL(call.url).searchParams.get("schema")).toBe("openid");
    expect(call.headers.authorization).toBe("Bearer user-access-token");
    expect(fetch.calls.filter((entry) => pathOf(entry) === "/v1/oauth2/token")).toHaveLength(0);
  });
});
