import { describe, expect, it } from "vitest";
import { createPayPalClient } from "../src/client.ts";
import { PayPalError, parsePayPalError } from "../src/errors.ts";
import { HttpCore } from "../src/http.ts";
import { fakeFetch, type FakeFetchCall, type FakeResponse } from "./fake-fetch.ts";

function makeHttp(fetch: typeof globalThis.fetch, options: Partial<ConstructorParameters<typeof HttpCore>[0]> = {}): HttpCore {
  return new HttpCore({
    clientId: "id",
    clientSecret: "secret",
    environment: "sandbox",
    fetch,
    ...options,
  });
}

function apiCalls(calls: FakeFetchCall[]): FakeFetchCall[] {
  return calls.filter((call) => !new URL(call.url).pathname.endsWith("/v1/oauth2/token"));
}

describe("HttpCore", () => {
  it("requests an app token with Basic authentication and a form body", async () => {
    const fetch = fakeFetch({ "GET /resource": { status: 200, json: { ok: true } } });
    const http = makeHttp(fetch);
    await http.request("GET", "/resource");

    const tokenCall = fetch.calls[0];
    expect(tokenCall?.method).toBe("POST");
    expect(new URL(tokenCall?.url ?? "").pathname).toBe("/v1/oauth2/token");
    expect(tokenCall?.headers.authorization).toBe(`Basic ${Buffer.from("id:secret").toString("base64")}`);
    expect(tokenCall?.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(tokenCall?.body).toBe("grant_type=client_credentials");
  });

  it("reuses the token for sequential API calls", async () => {
    const fetch = fakeFetch({ "GET /resource": [{ status: 200, json: {} }, { status: 200, json: {} }] });
    const http = makeHttp(fetch);
    await http.request("GET", "/resource");
    await http.request("GET", "/resource");
    expect(fetch.calls.filter((call) => new URL(call.url).pathname === "/v1/oauth2/token")).toHaveLength(1);
  });

  it("shares one in-flight token request between concurrent calls", async () => {
    let release: (() => void) | undefined;
    let tokenCalls = 0;
    const tokenGate = new Promise<void>((resolve) => { release = resolve; });
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path === "/v1/oauth2/token") {
        tokenCalls += 1;
        await tokenGate;
        return new Response(JSON.stringify({ access_token: "tok-1", expires_in: 32400 }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as typeof globalThis.fetch;
    const http = makeHttp(fetch);
    const first = http.request("GET", "/one");
    const second = http.request("GET", "/two");
    await Promise.resolve();
    release?.();
    await Promise.all([first, second]);
    expect(tokenCalls).toBe(1);
  });

  it("does not cache failed token requests", async () => {
    const fetch = fakeFetch({
      "POST /v1/oauth2/token": [
        { status: 401, json: { error: "invalid_client" } },
        { status: 200, json: { access_token: "tok-1", expires_in: 32400 } },
      ],
    });
    const http = makeHttp(fetch);
    await expect(http.getAppToken()).rejects.toBeInstanceOf(PayPalError);
    await expect(http.getAppToken()).resolves.toBe("tok-1");
    expect(fetch.calls).toHaveLength(2);
  });

  it("fetches a new token after the cached token expires", async () => {
    let now = 0;
    let tokenNumber = 0;
    const fetch = (async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === "/v1/oauth2/token") {
        tokenNumber += 1;
        return new Response(JSON.stringify({ access_token: `tok-${tokenNumber}`, expires_in: 61 }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as typeof globalThis.fetch;
    const http = makeHttp(fetch, { now: () => now });
    await http.request("GET", "/one");
    now = 1000;
    await http.request("GET", "/two");
    expect(tokenNumber).toBe(2);
  });

  it("refreshes and retries exactly once after a 401", async () => {
    const fetch = fakeFetch({
      "POST /v1/oauth2/token": [
        { status: 200, json: { access_token: "tok-1", expires_in: 32400 } },
        { status: 200, json: { access_token: "tok-2", expires_in: 32400 } },
      ],
      "GET /resource": [{ status: 401, json: { name: "AUTHENTICATION_FAILURE" } }, { status: 200, json: {} }],
    });
    const http = makeHttp(fetch);
    await http.request("GET", "/resource");
    expect(apiCalls(fetch.calls)).toHaveLength(2);
    expect(apiCalls(fetch.calls).map((call) => call.headers.authorization)).toEqual(["Bearer tok-1", "Bearer tok-2"]);
  });

  it("throws the second 401 without retrying again", async () => {
    const fetch = fakeFetch({
      "POST /v1/oauth2/token": [
        { status: 200, json: { access_token: "tok-1", expires_in: 32400 } },
        { status: 200, json: { access_token: "tok-2", expires_in: 32400 } },
      ],
      "GET /resource": [{ status: 401, json: {} }, { status: 401, json: {} }],
    });
    await expect(makeHttp(fetch).request("GET", "/resource")).rejects.toMatchObject({ status: 401 });
    expect(apiCalls(fetch.calls)).toHaveLength(2);
  });

  it("retries a GET after 503 with exponential backoff and jitter", async () => {
    const sleeps: number[] = [];
    const fetch = fakeFetch({ "GET /resource": [{ status: 503, json: {} }, { status: 200, json: {} }] });
    await makeHttp(fetch, { sleep: async (ms) => { sleeps.push(ms); } }).request("GET", "/resource");
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThanOrEqual(600);
    expect(sleeps[0]).toBeLessThanOrEqual(700);
  });

  it("honors Retry-After when it exceeds the backoff", async () => {
    const sleeps: number[] = [];
    const fetch = fakeFetch({ "GET /resource": [{ status: 429, headers: { "Retry-After": "2" } }, { status: 200, json: {} }] });
    await makeHttp(fetch, { sleep: async (ms) => { sleeps.push(ms); } }).request("GET", "/resource");
    expect(sleeps[0]).toBeGreaterThanOrEqual(2000);
  });

  it("does not retry a POST without an idempotency key", async () => {
    const fetch = fakeFetch({ "POST /resource": [{ status: 503, json: {} }, { status: 200, json: {} }] });
    await expect(makeHttp(fetch).request("POST", "/resource", { body: {} })).rejects.toBeInstanceOf(PayPalError);
    expect(apiCalls(fetch.calls)).toHaveLength(1);
  });

  it("retries a POST with an idempotency key and resends the key", async () => {
    const fetch = fakeFetch({ "POST /resource": [{ status: 503, json: {} }, { status: 201, json: {} }] });
    await makeHttp(fetch, { sleep: async () => {} }).request("POST", "/resource", { body: {}, idempotencyKey: "same" });
    expect(apiCalls(fetch.calls).map((call) => call.headers["paypal-request-id"])).toEqual(["same", "same"]);
  });

  it("stops after maxRetries retryable failures", async () => {
    const fetch = fakeFetch({ "GET /resource": [{ status: 503 }, { status: 503 }, { status: 503 }, { status: 503 }] });
    await expect(makeHttp(fetch, { sleep: async () => {} }).request("GET", "/resource")).rejects.toBeInstanceOf(PayPalError);
    expect(apiCalls(fetch.calls)).toHaveLength(4);
  });

  it("converts an aborted attempt into a timeout PayPalError", async () => {
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(String(input)).pathname === "/v1/oauth2/token") {
        return new Response(JSON.stringify({ access_token: "tok-1", expires_in: 32400 }), { status: 200 });
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
    }) as typeof globalThis.fetch;
    await expect(makeHttp(fetch, { timeoutMs: 20, maxRetries: 0 }).request("GET", "/resource"))
      .rejects.toMatchObject({ code: "TIMEOUT", status: null });
  });

  it("retries network errors for a GET", async () => {
    let count = 0;
    const fetch = (async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === "/v1/oauth2/token") return new Response(JSON.stringify({ access_token: "tok-1", expires_in: 32400 }), { status: 200 });
      count += 1;
      if (count === 1) throw new Error("connection reset");
      return new Response("{}", { status: 200 });
    }) as typeof globalThis.fetch;
    await makeHttp(fetch, { sleep: async () => {} }).request("GET", "/resource");
    expect(count).toBe(2);
  });

  it("parses PayPal v2 errors and their debug id header", () => {
    const error = parsePayPalError(422, { name: "INVALID_REQUEST", message: "Bad input", details: [{ issue: "INVALID_PARAMETER" }] }, "debug-1", "POST", "/resource");
    expect(error.code).toBe("INVALID_REQUEST");
    expect(error.details[0]?.issue).toBe("INVALID_PARAMETER");
    expect(error.debugId).toBe("debug-1");
  });

  it("parses OAuth errors", () => {
    expect(parsePayPalError(401, { error: "invalid_client", error_description: "bad" }, null, "POST", "/oauth").code)
      .toBe("invalid_client");
  });

  it("uses HTTP status when an error body is empty", () => {
    expect(parsePayPalError(500, "", null, "GET", "/resource").code).toBe("HTTP_500");
  });

  it("keeps credentials and bearer tokens out of errors", async () => {
    const fetch = fakeFetch({
      "POST /v1/oauth2/token": { status: 200, json: { access_token: "tok-secret", expires_in: 32400 } },
      "GET /resource": { status: 500, json: { name: "FAILURE", message: "failed" } },
    });
    let error: unknown;
    try {
      await makeHttp(fetch, { maxRetries: 0 }).request("GET", "/resource");
    } catch (caught) {
      error = caught;
    }
    const paypalError = error as PayPalError & { cause?: unknown };
    const combined = `${paypalError.message} ${String(paypalError.cause ?? "")}`;
    expect(combined).not.toContain("secret");
    expect(combined).not.toContain("tok-secret");
    expect(combined).not.toContain("Basic ");
  });

  it("refuses live mode unless allowLive is true and uses the live API base", async () => {
    expect(() => createPayPalClient({ clientId: "id", clientSecret: "secret", environment: "live" })).toThrow(
      "Live PayPal is disabled; pass allowLive: true",
    );
    const fetch = fakeFetch({ "GET /v2/checkout/orders/order": { status: 200, json: { id: "order", status: "CREATED" } } });
    const client = createPayPalClient({ clientId: "id", clientSecret: "secret", environment: "live", allowLive: true, fetch });
    await client.orders.get("order");
    expect(fetch.calls.find((call) => new URL(call.url).pathname === "/v2/checkout/orders/order")?.url)
      .toBe("https://api-m.paypal.com/v2/checkout/orders/order");
  });

  it("logs once per attempt and marks attempts that will be retried", async () => {
    const logs: { status: number | null; attempt: number; retrying: boolean; path: string }[] = [];
    const fetch = fakeFetch({ "GET /resource": [{ status: 503 }, { status: 200, json: {} }] });
    await makeHttp(fetch, {
      sleep: async () => {},
      onRequest: (info) => logs.push({ status: info.status, attempt: info.attempt, retrying: info.retrying, path: info.path }),
    }).request("GET", "/resource");
    expect(logs).toEqual([
      { status: 503, attempt: 1, retrying: true, path: "/resource" },
      { status: 200, attempt: 2, retrying: false, path: "/resource" },
    ]);
  });

  it("resolves JSON 204 responses as undefined", async () => {
    const fetch = fakeFetch({ "DELETE /resource": { status: 204 } });
    await expect(makeHttp(fetch).request("DELETE", "/resource")).resolves.toBeUndefined();
  });
});
