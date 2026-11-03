# @untangle/paypal: implementation spec

A typed, dependency-free PayPal REST client. One client instance = one merchant account (each demo business has its own sandbox REST app). The server, executor and agents call PayPal only through this package.

## Hard rules

1. **No runtime dependencies.** Use global `fetch`, `AbortController`, `FormData`, `Blob`, `URL`, `URLSearchParams`, `Buffer`.
2. **TypeScript, ESM, strict.** `tsconfig.base.json` enables `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and `verbatimModuleSyntax`.
   - Use `import type` for types.
   - Use `.ts` extensions in relative imports, e.g. `import { x } from "./money.ts"`.
   - No enums, no namespaces, no parameter properties (keep the syntax erasable).
3. **Style.** Match `packages/engine/src`: 2-space indent, double quotes, semicolons, short comments only where the reason isn't obvious.
4. **Write files only inside `packages/paypal/`.** Do not edit `package.json` or `tsconfig.json`.
5. **No network in tests.** Every test injects a fake `fetch`.
6. **Never put secrets in errors or logs.** Never include the client secret, access tokens or the `Authorization` header in error messages, `cause` or log callbacks.

## Files to create

```
src/index.ts          public exports
src/types.ts          shared types (Money and resource shapes)
src/money.ts          toMoney / fromMoney / payoutAmount
src/errors.ts         PayPalError, parsePayPalError
src/http.ts           HttpCore: token cache, request(), retries, timeouts
src/client.ts         createPayPalClient(): wires resources together
src/resources/invoicing.ts
src/resources/orders.ts
src/resources/payments.ts
src/resources/payouts.ts
src/resources/reporting.ts
src/resources/disputes.ts
src/resources/webhooks.ts
src/resources/identity.ts
test/fake-fetch.ts    test helper (see Tests)
test/http.test.ts
test/money.test.ts
test/resources.test.ts
```

## Configuration

```ts
export interface PayPalClientConfig {
  clientId: string;
  clientSecret: string;
  environment: "sandbox" | "live";
  allowLive?: boolean;          // live is refused unless this is true
  fetch?: typeof fetch;         // default globalThis.fetch
  sleep?: (ms: number) => Promise<void>; // default setTimeout-based; tests inject a recorder
  now?: () => number;           // epoch ms, default Date.now; used for token expiry
  maxRetries?: number;          // default 3 (retries after the first attempt)
  timeoutMs?: number;           // default 15000 per attempt
  onRequest?: (info: RequestInfoLog) => void; // observability hook, called once per attempt
}
export interface RequestInfoLog {
  method: string; path: string; status: number | null; attempt: number;
  durationMs: number; debugId: string | null; retrying: boolean;
}
```

- **Base URLs**
  - API: `https://api-m.sandbox.paypal.com` (sandbox) and `https://api-m.paypal.com` (live).
  - Web (for the Log in with PayPal authorize URL): `https://www.sandbox.paypal.com` and `https://www.paypal.com`.
- **Live is refused by default.** `createPayPalClient` throws `Error("Live PayPal is disabled; pass allowLive: true")` when `environment === "live"` and `allowLive !== true`.
- **Required fields.** Throw `TypeError` if `clientId` or `clientSecret` is empty.

## Money (`src/money.ts`)

```ts
export interface Money { currency_code: string; value: string }   // Orders, Payments, Invoicing
export interface PayoutAmount { currency: string; value: string } // Payouts uses "currency", not "currency_code"
export function toMoney(minor: number, currency: string): Money;
export function fromMoney(money: Money | PayoutAmount): number;   // returns minor units
export function payoutAmount(minor: number, currency: string): PayoutAmount;
export function currencyExponent(currency: string): number;       // 0 for HUF, JPY, TWD; else 2
```

**`toMoney`:**
- Requires a safe, non-negative integer for `minor` and a 3-letter uppercase currency code. Throws `TypeError` otherwise.
- Formats with exactly `currencyExponent` decimals using integer arithmetic only, never float division:
  - 1010 USD → `"10.10"`
  - 5 USD → `"0.05"`
  - 500 JPY → `"500"`

**`fromMoney`:**
- Parses the string exactly; never use `parseFloat`.
- Accepts `"10"`, `"10.1"`, `"10.10"` for 2-decimal currencies (giving 1000, 1010, 1010).
- Rejects with `TypeError`:
  - more decimals than the exponent (`"1.234"` USD, `"5.5"` JPY);
  - signs, spaces or empty strings;
  - results that are not safe integers.

## Errors (`src/errors.ts`)

```ts
export class PayPalError extends Error {
  readonly status: number | null;      // null for network or timeout errors
  readonly code: string;               // PayPal "name", OAuth "error", or "NETWORK_ERROR" / "TIMEOUT"
  readonly details: readonly { issue?: string; description?: string; field?: string; value?: string; location?: string }[];
  readonly debugId: string | null;     // "paypal-debug-id" response header, else body.debug_id
  readonly method: string;
  readonly path: string;               // path only: no query, no host
  readonly retryable: boolean;
}
export function parsePayPalError(status: number, body: unknown, debugIdHeader: string | null, method: string, path: string): PayPalError;
```

**Body shapes to handle:**
- **v2 and Payouts:** `{ name, message, debug_id, details: [{ issue, description, field, value, location }] }`.
- **OAuth:** `{ error, error_description }`.
- **Unknown or empty body:** code becomes `"HTTP_" + status`.

**Fields:**
- `message`: `` `${method} ${path} → ${status} ${code}: ${message or description}` ``. If `details[0].issue` exists, append it.
- `retryable`: true for status 408, 429 and ≥ 500, and for `NETWORK_ERROR` and `TIMEOUT`. False otherwise.

## HTTP core (`src/http.ts`)

```ts
export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;                 // JSON-serialised
  form?: FormData;                // multipart (disputes evidence); mutually exclusive with body
  idempotencyKey?: string;        // sent as PayPal-Request-Id
  preferRepresentation?: boolean; // sends Prefer: return=representation
  accessToken?: string;           // use this bearer instead of the app token (identity userinfo)
  expectText?: boolean;           // return raw text instead of JSON (QR codes)
}
export class HttpCore {
  constructor(config: Required<Pick<PayPalClientConfig, "clientId" | "clientSecret" | "environment">> & PayPalClientConfig);
  request<T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, options?: RequestOptions): Promise<T>;
  getAppToken(): Promise<string>;
  readonly apiBase: string;
  readonly webBase: string;
}
```

**Access token**
- Request: `POST {apiBase}/v1/oauth2/token`.
  - Header `Authorization: Basic base64(clientId:clientSecret)`.
  - `Content-Type: application/x-www-form-urlencoded`.
  - Body `grant_type=client_credentials`.
- Caching: keep the token until `now() >= obtainedAt + (expires_in - 60) * 1000`.
- Single flight: concurrent callers share one in-flight token request, and only one token request is made.
- A token request that fails throws `PayPalError`, and the failure is not cached.

**Every API request**
- Headers:
  - `Authorization: Bearer <token>`
  - `Accept: application/json`
  - `Content-Type: application/json` when a JSON `body` is present. Do not set it for `form`: let fetch set the multipart boundary.
  - `PayPal-Request-Id` when `idempotencyKey` is set.
  - `Prefer: return=representation` when `preferRepresentation` is set.
- Query: built with `URLSearchParams`, skipping `undefined` values.
- Response handling:
  - 204 or an empty body resolves `undefined`.
  - JSON responses are parsed.
  - `expectText` returns the raw text.
  - Non-2xx throws `parsePayPalError`.

**Retry policy (important)**
- **Never retry a POST or PATCH that has no `idempotencyKey`.** Throw on the first failure, because PayPal may have applied it.
- **GET and DELETE, and POST or PATCH that have an `idempotencyKey`,** are retried when `retryable` is true, up to `maxRetries` times.
- **Backoff:** `min(5000, 300 * 2 ** attempt)` ms plus a random jitter of 0–100 ms.
  - If the response has a `Retry-After` header in seconds, wait `max(backoff, seconds * 1000)` instead.
  - Use `config.sleep`.
- **401 on an API call:** drop the cached token, fetch a new one, and retry that call once. This applies to every method; it is safe because a 401 means PayPal rejected the request before processing it. A second 401 throws.
- **Timeout:** abort each attempt after `timeoutMs` with `AbortController`. A timeout becomes `PayPalError` with code `"TIMEOUT"` and status `null`.
- **Network error** (fetch rejects): becomes `PayPalError` with code `"NETWORK_ERROR"` and status `null`. Set `cause` to the original error's message only.
- **Logging:** call `onRequest` once per attempt with `retrying: true` when another attempt will follow. The `path` passed contains no query string.

## Resources

All methods are `async`. Path parameters are always passed through `encodeURIComponent`. Return types must be specific interfaces in `src/types.ts`. Model only the fields listed here, plus `[key: string]: unknown` so unknown fields survive.

### Invoicing v2 (`client.invoicing`)

| Method | HTTP | Notes |
|---|---|---|
| `createDraft(input: InvoiceInput, opts?: { idempotencyKey?: string }): Promise<Invoice>` | POST `/v2/invoicing/invoices` | `preferRepresentation: true` |
| `send(id, input?: { send_to_recipient?: boolean; send_to_invoicer?: boolean; subject?: string; note?: string }, opts?: { idempotencyKey?: string }): Promise<void>` | POST `/v2/invoicing/invoices/{id}/send` | body `{}` when input is omitted |
| `get(id): Promise<Invoice>` | GET `/v2/invoicing/invoices/{id}` | |
| `search(filter: InvoiceSearch, page = 1, pageSize = 100): Promise<{ items: Invoice[]; total_items?: number; total_pages?: number }>` | POST `/v2/invoicing/search-invoices` | query `page`, `page_size`, `total_required=true`. A missing `items` becomes `[]`. Searching is read-only, so this POST **is** retryable: always pass an `idempotencyKey` of `"search-" + a random UUID` |
| `recordPayment(id, input: { method: "BANK_TRANSFER" \| "CASH" \| "CHECK" \| "CREDIT_CARD" \| "DEBIT_CARD" \| "PAYPAL" \| "WIRE_TRANSFER" \| "OTHER"; payment_date: string; amount: Money; note?: string }): Promise<{ payment_id: string }>` | POST `/v2/invoicing/invoices/{id}/payments` | `payment_date` must match `YYYY-MM-DD`, else `TypeError`. **No idempotency key and no retries**; the executor reconciles |
| `deleteExternalPayment(id, transactionId): Promise<void>` | DELETE `/v2/invoicing/invoices/{id}/payments/{transactionId}` | |
| `remind(id, input?: { subject?: string; note?: string }): Promise<void>` | POST `/v2/invoicing/invoices/{id}/remind` | |
| `cancel(id, input?: { subject?: string; note?: string; send_to_recipient?: boolean }): Promise<void>` | POST `/v2/invoicing/invoices/{id}/cancel` | |
| `qrCode(id, size?: { width?: number; height?: number }): Promise<string>` | POST `/v2/invoicing/invoices/{id}/generate-qr-code` | `expectText: true`; returns the base64 PNG text |
| `nextInvoiceNumber(): Promise<string>` | POST `/v2/invoicing/generate-next-invoice-number` | returns `invoice_number` |

**Types**

`InvoiceInput`:
- `detail: { currency_code: string; invoice_number?: string; invoice_date?: string; note?: string; memo?: string; reference?: string; payment_term?: { term_type?: string; due_date?: string } }`
- `primary_recipients: { billing_info: { email_address: string; name?: { given_name?: string; surname?: string; business_name?: string } } }[]`
- `items: { name: string; description?: string; quantity: string; unit_amount: Money }[]`
- `configuration?: { partial_payment?: { allow_partial_payment: boolean; minimum_amount_due?: Money }; allow_tip?: boolean }`

`Invoice`:
- `id: string`
- `status: InvoiceStatus`
- `detail: { invoice_number?: string; currency_code: string; reference?: string; note?: string }`
- `amount?: { value: string; currency_code: string }`
- `due_amount?: Money`
- `payments?: { paid_amount?: Money; transactions?: { payment_id?: string; type?: string; method?: string; amount?: Money; note?: string; payment_date?: string }[] }`
- `primary_recipients?: InvoiceInput["primary_recipients"]`
- `[key: string]: unknown`

`InvoiceStatus` is one of:
`"DRAFT" | "SENT" | "SCHEDULED" | "PAID" | "MARKED_AS_PAID" | "CANCELLED" | "REFUNDED" | "PARTIALLY_PAID" | "PARTIALLY_REFUNDED" | "MARKED_AS_REFUNDED" | "UNPAID" | "PAYMENT_PENDING"`

`InvoiceSearch`:
`{ status?: InvoiceStatus[]; recipient_email?: string; invoice_number?: string; currency_code?: string; invoice_date_range?: { start: string; end: string } }`

### Orders v2 (`client.orders`)

| Method | HTTP | Notes |
|---|---|---|
| `create(input: OrderInput, opts: { idempotencyKey: string }): Promise<Order>` | POST `/v2/checkout/orders` | key is **required**; `preferRepresentation: true` |
| `get(id): Promise<Order>` | GET `/v2/checkout/orders/{id}` | |
| `capture(id, opts: { idempotencyKey: string }): Promise<Order>` | POST `/v2/checkout/orders/{id}/capture` | body `{}`; key **required**; `preferRepresentation: true` |

**Types**

`OrderInput`:
`{ intent: "CAPTURE"; purchase_units: { reference_id?: string; custom_id?: string; invoice_id?: string; description?: string; amount: Money; payee?: { email_address?: string; merchant_id?: string } }[] }`

`Order`:
- `id: string`
- `status: string`
- `purchase_units?: { reference_id?: string; custom_id?: string; payments?: { captures?: Capture[] } }[]`
- `links?: { href: string; rel: string; method?: string }[]`
- `[key: string]: unknown`

### Payments v2 (`client.payments`)

| Method | HTTP |
|---|---|
| `getCapture(id): Promise<Capture>` | GET `/v2/payments/captures/{id}` |
| `refundCapture(id, input: { amount?: Money; note_to_payer?: string; invoice_id?: string }, opts: { idempotencyKey: string }): Promise<Refund>` | POST `/v2/payments/captures/{id}/refund` with `preferRepresentation: true` |
| `getRefund(id): Promise<Refund>` | GET `/v2/payments/refunds/{id}` |

**Types**
- `Capture`: `{ id: string; status: string; amount?: Money; custom_id?: string; invoice_id?: string; create_time?: string; [key: string]: unknown }`
- `Refund`: `{ id: string; status: string; amount?: Money; [key: string]: unknown }`

### Payouts v1 (`client.payouts`)

| Method | HTTP | Notes |
|---|---|---|
| `create(input: PayoutInput): Promise<PayoutBatchHeaderResponse>` | POST `/v1/payments/payouts` | Use `sender_batch_id` as the `idempotencyKey`, so the call is retryable. If the error details or message mention that the sender batch id was already used, throw a `PayPalError` with code `"DUPLICATE_SENDER_BATCH_ID"` so the executor can reconcile |
| `getBatch(batchId, page = 1, pageSize = 100): Promise<PayoutBatch>` | GET `/v1/payments/payouts/{batchId}` | query `page`, `page_size`, `total_required=true` |
| `getItem(itemId): Promise<PayoutItem>` | GET `/v1/payments/payouts-item/{itemId}` | |
| `cancelUnclaimedItem(itemId): Promise<PayoutItem>` | POST `/v1/payments/payouts-item/{itemId}/cancel` | Retryable: cancelling twice is harmless. Pass `idempotencyKey: "cancel-" + itemId` |

**Types**

`PayoutInput`:
- `sender_batch_header: { sender_batch_id: string; email_subject?: string; email_message?: string }`
- `items: { recipient_type: "EMAIL" | "PHONE" | "PAYPAL_ID" | "USER_HANDLE"; receiver: string; amount: PayoutAmount; note?: string; sender_item_id?: string; recipient_wallet?: "PAYPAL" | "VENMO" }[]`
- Validate before sending, throwing `TypeError`:
  - 1–15000 items;
  - `sender_batch_id` is 1–256 characters;
  - every amount parses with `fromMoney`.

`PayoutBatchHeaderResponse`:
`{ batch_header: { payout_batch_id: string; batch_status: string; sender_batch_header?: { sender_batch_id?: string } }; [key: string]: unknown }`

`PayoutBatch`:
`{ batch_header: { payout_batch_id: string; batch_status: string }; items?: PayoutItem[]; [key: string]: unknown }`

`PayoutItem`:
`{ payout_item_id: string; transaction_id?: string; transaction_status?: string; payout_batch_id?: string; payout_item?: { recipient_type?: string; receiver?: string; amount?: PayoutAmount; sender_item_id?: string; recipient_wallet?: string }; errors?: unknown; [key: string]: unknown }`

### Reporting v1 (`client.reporting`)

| Method | HTTP | Notes |
|---|---|---|
| `listTransactions(q: { start_date: string; end_date: string; transaction_id?: string; transaction_status?: "D" \| "P" \| "S" \| "V"; fields?: string; page?: number; page_size?: number }): Promise<TransactionSearchPage>` | GET `/v1/reporting/transactions` | `fields` defaults to `"all"` and `page_size` to 500. Throw `TypeError` if either date fails to parse, if end < start, or if the range is longer than 31 days |
| `listBalances(q?: { as_of_time?: string; currency_code?: string }): Promise<BalancesResponse>` | GET `/v1/reporting/balances` | |

**Types**

`TransactionSearchPage`:
`{ transaction_details: { transaction_info: { transaction_id: string; transaction_status?: string; transaction_amount?: Money; transaction_initiation_date?: string; custom_field?: string; invoice_id?: string }; payer_info?: { email_address?: string; account_id?: string } }[]; total_items?: number; total_pages?: number; page?: number }`

A missing `transaction_details` becomes `[]`.

`BalancesResponse`:
`{ balances: { currency: string; primary?: boolean; total_balance: Money; available_balance?: Money; withheld_balance?: Money }[]; as_of_time?: string; last_refresh_time?: string }`

### Disputes v1 (`client.disputes`)

| Method | HTTP | Notes |
|---|---|---|
| `list(q?: { disputed_transaction_id?: string; start_time?: string; dispute_state?: string; page_size?: number; next_page_token?: string }): Promise<{ items: DisputeSummary[]; links?: unknown }>` | GET `/v1/customer/disputes` | A missing `items` becomes `[]` |
| `get(id): Promise<Dispute>` | GET `/v1/customer/disputes/{id}` | |
| `provideEvidence(id, input: { evidences: { evidence_type: string; evidence_info?: unknown; notes?: string }[] }, files?: { name: string; contentType: string; data: Uint8Array }[]): Promise<void>` | POST `/v1/customer/disputes/{id}/provide-evidence` | Multipart via `FormData`: part `input` holds the JSON as a `Blob` of type application/json, and each file is appended as part `evidence-file` with its filename. **Not retried** (no idempotency key) |

**Types**
- `DisputeSummary`: `{ dispute_id: string; status?: string; reason?: string; dispute_amount?: Money; create_time?: string; [key: string]: unknown }`
- `Dispute`: `DisputeSummary & { disputed_transactions?: { seller_transaction_id?: string; buyer_transaction_id?: string }[]; dispute_state?: string; [key: string]: unknown }`

### Webhooks v1 (`client.webhooks`)

| Method | HTTP | Notes |
|---|---|---|
| `create(input: { url: string; event_types: { name: string }[] }): Promise<{ id: string; url: string; event_types: { name: string }[] }>` | POST `/v1/notifications/webhooks` | Use `idempotencyKey: "webhook-" + url` so retries can't create duplicates |
| `list(): Promise<{ id: string; url: string; event_types: { name: string }[] }[]>` | GET `/v1/notifications/webhooks` | Returns the `webhooks` array, or `[]` |
| `delete(id): Promise<void>` | DELETE `/v1/notifications/webhooks/{id}` | |
| `verify(input: { webhookId: string; headers: Record<string, string \| string[] \| undefined>; rawBody: string }): Promise<boolean>` | POST `/v1/notifications/verify-webhook-signature` | See below |

**`verify` details:**
- Reads these headers case-insensitively, taking the first element of an array value:
  - `paypal-auth-algo`
  - `paypal-cert-url`
  - `paypal-transmission-id`
  - `paypal-transmission-sig`
  - `paypal-transmission-time`
- If any header is missing, return `false` without calling PayPal.
- Request body: `{ auth_algo, cert_url, transmission_id, transmission_sig, transmission_time, webhook_id, webhook_event: JSON.parse(rawBody) }`.
- If `rawBody` is not valid JSON, return `false`.
- Returns `verification_status === "SUCCESS"`.
- Retryable, with `idempotencyKey: "verify-" + transmission_id`.

Also export the type `WebhookEvent`:
`{ id: string; event_type: string; resource_type?: string; resource: Record<string, unknown>; create_time?: string; summary?: string }`

### Identity: Log in with PayPal (`client.identity`)

| Method | Notes |
|---|---|
| `authorizeUrl(q: { redirectUri: string; state: string; scope?: string }): string` | Synchronous. Builds `{webBase}/signin/authorize?flowEntry=static&client_id=…&response_type=code&scope=…&redirect_uri=…&state=…` with `URLSearchParams`. `scope` defaults to `"openid email profile"` |
| `exchangeCode(code: string): Promise<{ access_token: string; refresh_token?: string; id_token?: string; expires_in: number; token_type: string }>` | POST `{apiBase}/v1/oauth2/token`, Basic auth, form body `grant_type=authorization_code&code=…`. Does **not** use or touch the app-token cache |
| `userInfo(accessToken: string): Promise<{ user_id: string; name?: string; email?: string; emails?: { value: string; primary?: boolean; confirmed?: boolean }[]; verified_account?: string \| boolean; payer_id?: string; [key: string]: unknown }>` | GET `/v1/identity/openidconnect/userinfo` with query `schema=openid`, using the passed access token as the bearer |

## Public API (`src/index.ts`)

Export:
- `createPayPalClient(config): PayPalClient`
- `PayPalClient` (type): `{ invoicing; orders; payments; payouts; reporting; disputes; webhooks; identity; environment: "sandbox" | "live" }`
- `PayPalError`, `toMoney`, `fromMoney`, `payoutAmount`, `currencyExponent`
- all resource types

## Tests (Vitest)

`test/fake-fetch.ts` exports `fakeFetch(routes)`.
- It returns a `typeof fetch` that records every call: method, URL, headers as a lowercase map, and body as a string, or the `FormData` instance.
- It answers from a queue of `{ status, json?, text?, headers? }` per `"METHOD path"` key, or from a handler function.
- `/v1/oauth2/token` answers `{ access_token: "tok-1", expires_in: 32400, token_type: "Bearer" }` automatically unless overridden.

Each bullet below must be a separate test.

**`test/money.test.ts`**
- `toMoney`: 1010 USD → "10.10"; 5 USD → "0.05"; 0 USD → "0.00"; 500 JPY → "500".
- Throws on −1, on 1.5, and on currency "usd".
- `fromMoney`: "10" → 1000, "10.1" → 1010, "10.10" → 1010, "500" JPY → 500.
- `fromMoney` throws on "1.234" USD, "5.5" JPY, "-1.00", " 1.00", "", "1e3".
- `payoutAmount(250, "USD")` → `{ currency: "USD", value: "2.50" }`.
- Round trip: `fromMoney(toMoney(n, c)) === n` for 200 random values of n in [0, 1e12] and c in USD, EUR, JPY.

**`test/http.test.ts`**
- Token request: `POST /v1/oauth2/token` with Basic auth (base64 of `id:secret`), form body `grant_type=client_credentials`.
- Token reuse: two sequential API calls make only one token request.
- Single flight: two concurrent calls make only one token request.
- Refresh: the token is fetched again after expiry (advance the injected `now`).
- 401: on an API call, refetch the token and retry exactly once; a second 401 throws `PayPalError` with status 401.
- GET 503 then 200: resolves; `sleep` was called once with a value between 600 and 700 (backoff 2×300 for attempt 1 plus jitter up to 100). The exact formula is fine; assert the 300–700 range for the first retry.
- 429 with `Retry-After: 2`: sleep ≥ 2000 before the retry.
- POST without `idempotencyKey` getting 503: throws immediately, with exactly 1 API call.
- POST with `idempotencyKey` getting 503 then 201: retries, and `PayPal-Request-Id` was sent on both attempts.
- After `maxRetries` (3) failures of a retryable GET: throws, with 4 attempts in total.
- Timeout: the fake fetch never resolves until its abort signal fires; use `timeoutMs: 20`. Expect `PayPalError` with code `"TIMEOUT"`.
- Network error: the fake fetch rejects. Expect `NETWORK_ERROR`, and a GET is retried.
- Error parsing:
  - a v2 body becomes `code === name`, `details[0].issue` is present, and `debugId` comes from the `paypal-debug-id` header;
  - an OAuth body becomes `code === "invalid_client"`;
  - an empty 500 body becomes `"HTTP_500"`.
- No secrets: an error message contains neither the client secret, the token, nor "Basic ".
- Live: `environment: "live"` without `allowLive` throws; with `allowLive: true` it uses `https://api-m.paypal.com`.
- `onRequest`: called once per attempt, with `retrying` true on attempts that will be followed by another.
- JSON 204: resolves `undefined`.

**`test/resources.test.ts`**
- For **every** method above, assert the exact HTTP method, path (including `encodeURIComponent` of an id containing `/`), query, JSON body and special headers. For `Prefer`, the idempotency key and the bearer, check these:
  - `orders.capture` sends `Prefer: return=representation` and `PayPal-Request-Id`.
  - `invoicing.recordPayment` sends **no** `PayPal-Request-Id`.
  - `identity.userInfo` uses the passed token, not the app token.
- `invoicing.recordPayment` rejects `payment_date` "2026/11/05" with a `TypeError`, without calling fetch.
- `payouts.create`:
  - rejects 0 items without calling fetch;
  - turns a 400 whose message contains "sender_batch_id" and "already" into `DUPLICATE_SENDER_BATCH_ID`;
  - sends `PayPal-Request-Id` equal to `sender_batch_id`.
- `reporting.listTransactions` rejects a 32-day range without calling fetch, and defaults `fields=all`.
- `webhooks.verify`:
  - returns false without calling fetch when a header is missing;
  - reads mixed-case header names;
  - sends `webhook_event` equal to the parsed raw body;
  - returns true on SUCCESS and false on FAILURE.
- `disputes.provideEvidence` sends `FormData` with an `input` part and an `evidence-file` part, and no JSON `Content-Type` header.
- `identity.authorizeUrl` for sandbox starts with `https://www.sandbox.paypal.com/signin/authorize?` and includes `flowEntry=static`, `response_type=code` and the encoded `redirect_uri`.

## Done means

- `pnpm --filter @untangle/paypal typecheck` passes with zero errors.
- `pnpm --filter @untangle/paypal test` passes.
- No file outside `packages/paypal/` was changed.
- No runtime dependency was added.
