# @untangle/server: implementation spec

The backend. It ties together `@untangle/engine` (planning), `@untangle/executor` (exactly-once PayPal writes), `@untangle/paypal` (the client) and `@untangle/db` (Postgres).
- Framework: Fastify 5. Validation: zod 3. Runner: `tsx`.
- Read `docs/ARCHITECTURE.md` §3 and §6 for the why. This spec is the what.

## Hard rules

1. **Code style.**
   - TypeScript, ESM and strict, matching `packages/*/src`.
   - `.ts` import extensions; `import type` for types; no enums, namespaces or parameter properties.
2. **Money.**
   - Integer minor units everywhere.
   - Convert only at the PayPal boundary, with `toMoney`, `fromMoney` and `payoutAmount` from `@untangle/paypal`.
3. **Only the executor writes payments onto invoices.**
   - Never call `invoicing.recordPayment` or `deleteExternalPayment` outside the executor adapter.
   - Never move money without the preconditions listed below.
4. **No polling, anywhere.**
   - Work starts from HTTP requests, webhooks and the job runner's single timer, armed for the next due job.
5. **Secrets.**
   - Never log, return or embed the PayPal client secret, `MASTER_KEY` or tokens.
   - PayPal **client ids** are public and may be returned.
6. **Sandbox only.** Every PayPal client is created with `environment: "sandbox"`.
7. **Write scope.** Write only inside `apps/server/`. Do not edit `package.json` or `tsconfig.json`.
8. **Transactions.**
   - Inside a `db.transaction(async (tx) => …)` callback, use only `tx`.
   - Never call PayPal, `ctx.bus.emit`, `ctx.jobs.schedule` or the root `db` from inside it. PGlite runs one transaction at a time, so touching the root `db` there deadlocks.
   - Emit and schedule after the commit. Never hold a transaction open across a PayPal call.
9. **Conditional status changes.**
   - Every status change is a conditional update: `… where id = ? and status in (<allowed from-states>)`.
   - Check the affected row count. Apply side effects only when the row actually changed; obligation decrements are one such side effect.
   - This makes a duplicate or late caller a no-op instead of a regression.
10. **SQL arithmetic for amounts.** Write `outstanding_minor = outstanding_minor - ${x}`. Never read the value, compute in JS, then write it back.
11. **One writer per transfer and round.** Use `ctx.locks` (see Locks). The capture route and PayPal's webhook routinely arrive together; without the lock both would write the same leg payments.

## Files

```
src/config.ts                 loadConfig(env) → Config
src/crypto.ts                 encryptSecret / decryptSecret / consentSignature
src/errors.ts                 DomainError
src/context.ts                AppContext type + createContext(...)
src/bus.ts                    Bus: events table + SSE fan-out
src/jobs.ts                   JobRunner (durable, timer-armed)
src/locks.ts                  KeyedLock: one writer per key in this process
src/paypal-registry.ts        PayPalRegistry: one PayPal client per business
src/bootstrap.ts              ensureNetwork(ctx): network + businesses + paypal_accounts from config
src/adapters/invoice-gateway.ts   PayPalInvoiceGateway implements executor InvoiceGateway
src/adapters/operation-log.ts     DbOperationLog implements executor OperationLog
src/adapters/executor-deps.ts     makeExecutorDeps(ctx, stream) → ExecutorDeps
src/services/obligations.ts   listObligations, networkSummary, refreshObligationFromInvoice
src/services/rounds.ts        planRound, getRound, recordConsent, executeRound
src/services/transfers.ts     createCheckoutOrder, captureCheckout, commitTransfer, unwindTransfer, startPayouts, refreshPayouts, handlePayoutItem
src/services/webhooks.ts      handleWebhook
src/routes/health.ts | network.ts | rounds.ts | transfers.ts | webhooks.ts | stream.ts | audit.ts
src/app.ts                    buildApp(ctx): FastifyInstance (no listen)
src/main.ts                   production entry
test/fake-paypal.ts           stateful PayPal simulator (see Tests)
test/context.ts               makeTestContext()
test/*.test.ts
```

## Config (`src/config.ts`)

`loadConfig(env: Record<string, string | undefined> = process.env): Config` validates with zod and throws one readable error that lists every problem.

```ts
interface BusinessConfig { slot: number; name: string; email: string; clientId: string; clientSecret: string }
interface Config {
  databaseUrl: string;                 // DATABASE_URL, required
  masterKey: Buffer;                   // MASTER_KEY: exactly 64 hex chars → 32 bytes
  port: number;                        // PORT, default 3000
  publicBaseUrl: string;               // PUBLIC_BASE_URL, default http://localhost:3000
  demoMode: boolean;                   // DEMO_MODE "0" disables; default true
  networkName: string;                 // NETWORK_NAME, default "Main Street"
  currency: string;                    // NETWORK_CURRENCY, default "USD"
  platform?: { clientId: string; clientSecret: string };   // PAYPAL_PLATFORM_CLIENT_ID / _SECRET, both or neither
  businesses: BusinessConfig[];        // PAYPAL_BIZ_{n}_NAME/EMAIL/CLIENT_ID/CLIENT_SECRET for n = 1..20
  geminiApiKey?: string;               // GEMINI_API_KEY
}
```

**Business slots:**
- A slot counts only when all four values are non-empty. Partially filled slots are an error that names the slot.
- Emails must be unique.
- Sort businesses by slot.

## Crypto (`src/crypto.ts`)

**`encryptSecret(plain: string, key: Buffer): Uint8Array`** uses AES-256-GCM. The output layout is:

| Bytes | Content |
|---|---|
| 1 | version, `0x01` |
| 12 | random IV |
| 16 | auth tag |
| rest | ciphertext |

**`decryptSecret(blob: Uint8Array, key: Buffer): string`** throws `Error("secret could not be decrypted")` on a wrong version, wrong key or tampering.

**`consentSignature(key: Buffer, roundId: string, businessId: string, statementHash: string): string`** returns the HMAC-SHA256 hex of `` `${roundId}:${businessId}:${statementHash}` ``. This is demo consent, bound to the exact statement.

## Errors (`src/errors.ts`)

```ts
class DomainError extends Error { constructor(readonly status: 400 | 404 | 409 | 422, readonly code: string, message: string) }
```

Write it as a normal class with fields; parameter properties are not allowed. The codes used below are part of the API.

## Context (`src/context.ts`)

```ts
interface AppContext {
  db: Db; config: Config; paypal: PayPalRegistry; bus: Bus; jobs: JobRunner; locks: KeyedLock;
  now(): Date; sleep(ms: number): Promise<void>;
}
function createContext(input: {
  db: Db; config: Config; fetch?: typeof fetch; now?: () => Date; sleep?: (ms: number) => Promise<void>;
}): AppContext
```

`createContext` builds the registry (passing `fetch` and `sleep` through), the bus, the job runner and the locks. It does not start the jobs.
- `sleep` defaults to a real `setTimeout` promise. Tests pass a no-op so backoff costs no time.
- `exactOptionalPropertyTypes` is on, so leave out optional keys rather than passing `undefined`.

## Locks (`src/locks.ts`)

```ts
class KeyedLock { run<T>(key: string, fn: () => Promise<T>): Promise<T> }
```

- Calls with the same key run one after another, in arrival order; different keys run in parallel.
- Implement it as a promise chain per key. Delete the map entry once that key's chain drains. A rejected `fn` must not block the next caller.
- It is **not reentrant**, so a locked function never calls another function that takes the same key.
- It works because the server runs as a single instance (Render free tier). Note in a one-line comment that scaling out would need a database lease.

| Key | Taken by |
|---|---|
| `round:<roundId>` | `executeRound` |
| `commit:<transferId>` | `commitTransfer`, `unwindTransfer` |
| `order:<transferId>` | `createCheckoutOrder` |
| `payouts:<roundId>:<payerId>` | `startPayouts` |

Every locked function re-reads its rows *inside* the lock before deciding anything.

## Bus (`src/bus.ts`)

```ts
interface BusEvent { seq: number; stream: string; type: string; payload: Record<string, unknown>; at: string }
class Bus {
  constructor(db: Db)
  emit(stream: string, type: string, payload: Record<string, unknown>, actor?: string): Promise<BusEvent>;
  subscribe(listener: (e: BusEvent) => void): () => void;
}
```

- `emit` appends via `appendEvents` (from `@untangle/db`), then calls every listener synchronously.
- A listener that throws is removed and ignored.
- `actor` defaults to `"system"`.

## Jobs (`src/jobs.ts`)

```ts
type JobResult = { done: true } | { retryInMs: number };
class JobRunner {
  constructor(db: Db, now: () => Date)
  register(kind: string, handler: (payload: Record<string, unknown>) => Promise<JobResult>): void;
  schedule(kind: string, payload: Record<string, unknown>, delayMs?: number): Promise<string>; // returns job id
  start(): Promise<void>;
  runDue(): Promise<number>;   // runs every due job one at a time; returns how many ran
  stop(): void;
}
```

**`schedule`**
- Inserts a row: `status 'queued'`, `run_at = now + delayMs` (default 0).
- Then calls `arm()`.

**`start`**
- Sets `status 'queued'` on every `running` job whose `lease_until < now`. These are leftovers from a crash.
- Then calls `arm()`.

**`arm()`** (private)
- Clears the existing timer.
- Selects the minimum `run_at` among queued jobs. If there is one, sets **one** `setTimeout` for `max(0, run_at − now)`, capped at 2,147,000,000 ms, which calls `runDue()`.
- No periodic polling.

**`runDue`**
1. Repeatedly claims one due job:
   ```sql
   update jobs set status='running', lease_until=now()+interval '5 minutes', attempts=attempts+1
   where id = (select id from jobs where status='queued' and run_at <= now()
               order by run_at limit 1 for update skip locked)
   returning *
   ```
2. Runs its handler, then:
   - `{ done: true }`: set `status 'done'`.
   - `{ retryInMs }`: set `status 'queued'` and `run_at = now + retryInMs`.
   - Throws, or the kind is unknown:
     - if `attempts >= 8`, set `status 'failed'` and record `last_error`;
     - otherwise set `status 'queued'` with `run_at = now + min(15 min, 5 s × 2^attempts)` and record `last_error`.
3. Stops when no job is due, then calls `arm()`.
4. Reentrancy: if `runDue` is already running, a second call waits for it and then returns 0.

## PayPal registry (`src/paypal-registry.ts`)

```ts
class PayPalRegistry {
  constructor(db: Db, masterKey: Buffer, options?: { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void> })
  forBusiness(businessId: string): Promise<PayPalClient>; // loads paypal_accounts, decrypts, creates the client, caches it per business
  clientIdFor(businessId: string): Promise<string>;      // public client id
  webhookIdFor(businessId: string): Promise<string | null>;
  invalidate(businessId?: string): void;
}
```

- Clients are `createPayPalClient({ clientId, clientSecret, environment: "sandbox", fetch?, sleep? })`. Include `fetch` and `sleep` only when they are given.
- A missing account throws `DomainError(422, "PAYPAL_ACCOUNT_MISSING", …)`.

## Bootstrap (`src/bootstrap.ts`)

`ensureNetwork(ctx): Promise<string>` is idempotent and returns the network id.

1. **Network:** find a network named `config.networkName`, or insert one with `currency = config.currency`.
2. **Businesses:** for each configured business, upsert by `(network_id, email)`: insert `{ name, email }` or update the name.
3. **PayPal accounts:** upsert `paypal_accounts`:
   - `environment 'sandbox'`, `client_id`;
   - `client_secret_enc = encryptSecret(secret, masterKey)`, but only re-encrypt when the stored decrypted value differs.
4. Calls `ctx.paypal.invalidate()`.

## Adapters

### `PayPalInvoiceGateway` (implements `InvoiceGateway` from `@untangle/executor`)

Constructor: `(registry: PayPalRegistry)`. `owner` is a business id.

**`get(owner, invoiceId)`** returns:
```
id: invoice.id
status: invoice.status
currency: invoice.detail.currency_code
dueMinor:
  - if invoice.due_amount exists:            fromMoney(invoice.due_amount)
  - else if status is PAID or MARKED_AS_PAID: 0
  - else:                                     fromMoney(invoice.amount)
payments: (invoice.payments?.transactions ?? []).map(t => ({
  paymentId: t.payment_id ?? "",
  amountMinor: t.amount ? fromMoney(t.amount) : 0,
  note: t.note ?? "",
}))
```

**`record(owner, invoiceId, input)`**
```
recordPayment(invoiceId, {
  method: "OTHER",
  payment_date: input.date,
  amount: toMoney(input.amountMinor, input.currency),
  note: input.note,
})
```
Returns `payment_id`.

**`remove(owner, invoiceId, paymentId)`**: `deleteExternalPayment(invoiceId, paymentId)`.

### `DbOperationLog` (implements `OperationLog`)

- **`get(key)`:** select by `idem_key`. Map `paypal_ref → ref` and `last_error → error`.
- **`put(op)`:**
  ```sql
  insert … on conflict (idem_key) do update
  set status, attempts, paypal_ref, last_error, updated_at = now()
  ```
  - `kind` = the text before the first `:` of the key.
  - `ref_id` = the rest of the key.

### `makeExecutorDeps(ctx, stream: string): ExecutorDeps`

| Field | Value |
|---|---|
| `invoices` | `new PayPalInvoiceGateway(ctx.paypal)` |
| `ops` | `new DbOperationLog(ctx.db)` |
| `emit` | `async (type, payload) => { await ctx.bus.emit(stream, type, payload); }` |
| `today` | `ctx.now()` as a `YYYY-MM-DD` date in `America/Los_Angeles`, via `new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" })`. PayPal works in Pacific time, and a UTC date can be a day ahead of it. |
| `sleep` | `ctx.sleep` |
| `isRetryable` | `e instanceof PayPalError && e.retryable` |
| `isNotFound` | `e instanceof PayPalError && e.status === 404` |

## Services

Every service takes `ctx: AppContext` first. Each multi-row DB update is **one transaction**. Each state change emits a bus event:
- stream `network:<id>`, `round:<id>` or `transfer:<id>`;
- the event types listed below.

### `services/obligations.ts`

**`listObligations(ctx, networkId)`**

Returns `ObligationView[]` ordered by `created_at`:
```
{ id, debtorId, debtorName, creditorId, creditorName, amountMinor, outstandingMinor,
  currency, status, paypalInvoiceId, protected, dueOn }
```

**`networkSummary(ctx, networkId)`**

Returns:
```
network:     { id, name, currency }
businesses:  [{ id, name, email }]
totals: {
  obligations:      count
  owedMinor:        Σ amount
  outstandingMinor: Σ outstanding where status not in ('cancelled')
  settledMinor:     Σ (amount − outstanding) where status not in ('cancelled')
}
latestRound: { id, status } | null
```
An unknown network throws 404 `NETWORK_NOT_FOUND`.

**`refreshObligationFromInvoice(ctx, invoiceId)`**

1. Find the obligation by `paypal_invoice_id`. If there is none, return null.
2. Read the invoice through the creditor's client, using the gateway's `get`.
3. Set `outstanding = clamp(dueMinor, 0, amount)`.
4. Set the status:

| Condition | Status |
|---|---|
| Invoice is CANCELLED | `cancelled` |
| outstanding = 0 | `settled` |
| outstanding < amount | `partially_settled` |
| otherwise | `invoiced` |

5. If anything changed, bump `version` and emit `obligation.updated`.

### `services/rounds.ts`

**`planRound(ctx, networkId): Promise<RoundView>`**

1. **Preconditions.** If the network has a round in status `consenting`, `executing` or `settling`, throw 409 `ROUND_IN_PROGRESS`.
2. **Eligible obligations.** Those in this network with:
   - `status in ('invoiced','partially_settled')`;
   - `outstanding_minor > 0`;
   - `protected = false`;
   - `paypal_invoice_id is not null`;
   - `currency = network.currency`.

   If there are none, throw 409 `NOTHING_TO_SETTLE`.
3. **Run the engine:**
   ```
   plan = planSettlement(eligible.map(o => ({
     id: o.id, debtor: o.debtorId, creditor: o.creditorId, amount: o.outstandingMinor,
   })))
   ```
   Lowercase uuid strings sort deterministically.
4. **Hash the plan:**
   ```
   planHash = sha256Hex(canonicalJson({
     setoffs: <plan.setoffs keeping only values > 0>,
     transfers: plan.transfers,
   }))
   ```
   `stats.leverage` is a float, so it is excluded.
5. **Single transaction:**
   - Insert the `rounds` row with `status 'consenting'`, `plan` = the full plan JSON, and `plan_hash`.
   - Insert one `setoffs` row per obligation with setoff > 0, as `pending`.
   - Insert one `transfers` row per transfer: `planned`, `currency` = the network currency.
   - Insert one `transfer_legs` row per leg: `position` = the leg's index, `pending`.
   - Insert one `statements` row per business that appears as debtor or creditor of any setoff, as payer or payee of any transfer, or as debtor or creditor of any leg obligation.
     - The body is built as below, and `statement_hash = sha256Hex(canonicalJson(body))`.
6. **Emit** `round.planned` with `{ roundId, planHash, stats }`. Return `getRound`.

Statement body for business B. All amounts are integer minor units; arrays are sorted by obligationId or transferId.
```
roundId, businessId: B, networkId, currency, planHash,
setoffs:   [{ obligationId, invoiceId, role: "creditor"|"debtor", counterpartyId,
              amountMinor, outstandingBeforeMinor, remainingAfterMinor }]
pays:      [{ transferId, payeeId, amountMinor }]
receives:  [{ transferId, payerId, amountMinor }]
passThrough: [{ transferId, obligationId, role: "creditor"|"debtor", amountMinor }]
             // legs where B is debtor or creditor but neither payer nor payee of that transfer
totals:    { clearedMinor, paysMinor, receivesMinor }
```

`remainingAfterMinor` = outstanding − setoff amount. This is after loops only; chains settle later.

**`getRound(ctx, roundId): Promise<RoundView>`**

An unknown round throws 404 `ROUND_NOT_FOUND`.
```
RoundView = {
  id, networkId, status, planHash,
  stats,                                           // from rounds.plan.stats
  setoffs:   [{ obligationId, debtorId, creditorId, amountMinor, status, paypalPaymentId }],
  transfers: [{ id, payerId, payeeId, amountMinor, currency, instrument, status,
                paypalOrderId, paypalCaptureId, payoutBatchId, payoutItemId,
                legs: [{ obligationId, position, amountMinor, status, paypalPaymentId }] }],
  statements:      [{ businessId, statementHash, body }],
  consents:        [{ businessId, method, createdAt }],
  pendingConsents: [businessId…],   // statement businesses without a consent, sorted
}
```

**`recordConsent(ctx, roundId, businessId): Promise<RoundView>`**

1. **Preconditions:**
   - The round's status must be `consenting`; otherwise 409 `ROUND_NOT_CONSENTING`.
   - The business must have a statement; otherwise 422 `NOT_IN_ROUND`.
2. **Insert the consent:** `statement_hash` copied from that business's statement, method `'demo'`, and the signature from `consentSignature(masterKey, roundId, businessId, statementHash)`.
   - If a consent already exists for that business, change nothing and return the view (idempotent).
3. **Emit** `round.consented`.
4. **When every statement business has consented:**
   - set the round to `executing`;
   - emit `round.ready`;
   - after the commit, `ctx.jobs.schedule("round.execute", { roundId })`.
   - The status change is conditional (`where status = 'consenting'`), so two last consents arriving together schedule only one job.

**`executeRound(ctx, roundId): Promise<JobResult>`**

Runs under `ctx.locks.run("round:" + roundId, …)`.

1. If the status isn't `executing`, return `{ done: true }`.
2. Build the lines, one per setoff row, joined to its obligation:
   ```
   { obligationId, invoiceId: obligation.paypalInvoiceId, owner: obligation.creditorId,
     currency, amountMinor: setoff.amountMinor }
   ```
3. Call `executeSetoffs(roundId, lines, makeExecutorDeps(ctx, "round:" + roundId))` and handle the result:

| Result | What happens |
|---|---|
| `recorded` | One transaction: (1) each setoff → `recorded` with its `paypal_payment_id`; (2) each obligation: `outstanding −= amount`, status → `settled` if 0 else `partially_settled`, `version + 1`; (3) every transfer of the round → `ready`; (4) the round → `settling`, or `closed` if it has no transfers. Emit `round.setoffs_recorded`. Return `{ done: true }`. |
| `retry_later` | Emit `round.retrying` with the error. Return `{ retryInMs: 30000 }`. |
| `aborted` or `compensated` | Setoffs → `failed` (aborted) or `compensated`. The round → `failed`. Emit `round.failed` with the problems. Return `{ done: true }`. |
| `needs_attention` | The round → `failed`. Emit `round.needs_attention`. Return `{ done: true }`. |

### `services/transfers.ts`

`TransferView` = the transfer object from `RoundView` plus `roundId`.

**`createCheckoutOrder(ctx, transferId): Promise<{ orderId, clientId, amountMinor, currency }>`**

Runs under `ctx.locks.run("order:" + transferId, …)`.

1. **Preconditions:**
   - The round is `settling`.
   - The transfer is `ready` or `awaiting_payer`; otherwise 409 `TRANSFER_NOT_PAYABLE`.
2. **Idempotency.** If `paypal_order_id` is already set, return it. Don't create a second order.
3. **Create the order** with the **payee's** client:
   ```
   orders.create({
     intent: "CAPTURE",
     purchase_units: [{
       reference_id: transferId,
       custom_id: roundId,
       description: `Untangle chain settlement: settles ${legs.length} invoice(s)`,
       amount: toMoney(amountMinor, currency),
     }],
   }, { idempotencyKey: `order-${transferId}` })
   ```
4. **Store** `paypal_order_id`, `instrument 'checkout'`, `status 'awaiting_payer'`.
5. **Emit** `transfer.order_created`.
6. **Return** `clientId` = the payee's public client id. The web page renders PayPal buttons for that merchant.

**`captureCheckout(ctx, transferId, orderId): Promise<TransferView>`**

1. **Preconditions:** `orderId` must equal the stored `paypal_order_id`; otherwise 422 `ORDER_MISMATCH`.
2. **Idempotency.** If the transfer is already `committed`, return its view.
3. **Capture** with the payee's client: `orders.capture(orderId, { idempotencyKey: \`capture-${transferId}\` })`.
4. **Read** `capture = purchase_units[0].payments.captures[0]`.
5. **Store** `paypal_capture_id` and set status `pending_paypal`, only `where status in ('ready','awaiting_payer')`. The webhook may already have committed it. Emit `transfer.captured` if the row changed.
   - `captureCheckout` itself takes no lock. The capture is idempotent through its request id, and `commitTransfer` locks itself.
6. **If the capture status is `COMPLETED`,** call `commitTransfer(ctx, transferId, capture.id)` inline.
   - Otherwise wait for the webhook `PAYMENT.CAPTURE.COMPLETED`.
7. **Return** the view.

**`commitTransfer(ctx, transferId, proofRef): Promise<JobResult>`**

Runs under `ctx.locks.run("commit:" + transferId, …)`.

1. If the transfer is already `committed`, return `{ done: true }`.
2. Build the legs as PaymentLines, ordered by `position`:
   ```
   { obligationId, invoiceId, owner: obligation.creditorId, currency, amountMinor: leg.amountMinor }
   ```
3. Call `commitChain(transferId, proofRef, lines, makeExecutorDeps(ctx, "transfer:" + transferId))` and handle the result:

| Result | What happens |
|---|---|
| `committed` | One transaction: (1) legs → `recorded` with their payment ids; (2) each obligation: `outstanding −= leg amount`, status → `settled` or `partially_settled`, `version + 1`; (3) the transfer → `committed`; (4) if every transfer of the round is committed, the round → `closed`. Emit `transfer.committed`, plus `round.closed` when the round closed. Return `{ done: true }`. |
| `retry_later` | `ctx.jobs.schedule("transfer.commit", { transferId, proofRef }, 30000)`. Return `{ done: true }`. The scheduled job retries; when it is the caller, return `{ retryInMs: 30000 }` instead. Implement this with a flag parameter `fromJob = false`. |
| `needs_attention` | Emit `transfer.needs_attention` with the problems. The status stays `pending_paypal`. Return `{ done: true }`. |

**`unwindTransfer(ctx, transferId): Promise<JobResult>`**

Runs under `ctx.locks.run("commit:" + transferId, …)`.

1. Only applies to a `committed` transfer; for any other status, return done.
2. Call `unwindChain(transferId, lines, deps)` and handle the result:

| Result | What happens |
|---|---|
| `unwound` | One transaction: (1) legs → `compensated`; (2) each obligation: `outstanding += leg amount`, status → `invoiced` if outstanding = amount else `partially_settled`, `version + 1`; (3) the transfer → `unwound`; (4) if the round was `closed`, it goes back to `settling`. Emit `transfer.unwound`. |
| `retry_later` | Schedule `transfer.unwind`, with the same `fromJob` pattern as `commitTransfer`. |
| `needs_attention` | Emit `transfer.needs_attention`. |

**`startPayouts(ctx, roundId, payerId): Promise<RoundView>`**

Runs under `ctx.locks.run("payouts:" + roundId + ":" + payerId, …)`.

1. **Transfers:** those of the round with `payer_id = payerId`, status in `ready`/`awaiting_payer`, and either no `paypal_order_id` or a matching instrument.
   - If there are none, throw 409 `NOTHING_TO_PAY`.
2. **Create the batch** with the **payer's** client:
   ```
   payouts.create({
     sender_batch_header: {
       sender_batch_id: `untangle-${roundId}-${payerId}`,
       email_subject: "You have a payment from Untangle",
     },
     items: transfers.map(t => ({
       recipient_type: "EMAIL",
       receiver: <payee business email>,
       amount: payoutAmount(t.amountMinor, currency),
       sender_item_id: t.id,
       note: "Untangle chain settlement",
     })),
   })
   ```
3. **Store** `payout_batch_id`, `instrument 'payouts'` and `status 'pending_paypal'` on those transfers. Emit `transfer.payout_sent` for each.
4. **On `DUPLICATE_SENDER_BATCH_ID`,** emit `round.needs_attention` and throw 409 `PAYOUT_ALREADY_SENT`.

**`refreshPayouts(ctx, roundId): Promise<RoundView>`**

1. For each distinct `payout_batch_id` in the round, call `payouts.getBatch(batchId)` with the payer's client.
2. For each item, find the transfer by `payout_item.sender_item_id`, store `payout_item_id`, then call `applyPayoutStatus(transfer, item)`.

**`handlePayoutItem(ctx, businessId, payoutItemId)`**

Calls `payouts.getItem(payoutItemId)` with that business's client, finds the transfer by `sender_item_id`, then calls `applyPayoutStatus`.

**`applyPayoutStatus`** (private)

| PayPal status | Action |
|---|---|
| `transaction_status === "SUCCESS"` | `commitTransfer(transferId, payout_item_id)` |
| `PENDING`, `UNCLAIMED`, `ONHOLD` | Nothing. `UNCLAIMED` emits `transfer.unclaimed`. |
| `FAILED`, `BLOCKED`, `DENIED`, `CANCELED` | If the transfer is not committed, set it to `failed` and emit `transfer.failed`. |
| `RETURNED`, `REFUNDED`, `REVERSED` | If the transfer is committed, `unwindTransfer`; otherwise set it to `failed`. |

### `services/webhooks.ts`

`handleWebhook(ctx, businessId, headers, rawBody): Promise<{ status: 200 | 400; body: Record<string, unknown> }>`

1. **Verify the signature:**
   - `webhookId = registry.webhookIdFor(businessId)`. If it is null, return 400 `{ error: "WEBHOOK_NOT_CONFIGURED" }`.
   - `client.webhooks.verify({ webhookId, headers, rawBody })`. If false, return 400 `{ error: "BAD_SIGNATURE" }`.
2. **Store it once:**
   - `event = JSON.parse(rawBody)`.
   - Insert into `webhook_inbox`:
     - `paypal_event_id = event.id`, `business_id = businessId`;
     - `event_type = event.event_type`, `payload = event`;
     - `verified = true`, with `on conflict do nothing` and `returning`.
   - If it already existed, return 200 `{ duplicate: true }`.
3. **Dispatch** on `event_type`. Any other type is ignored.

| Event type | Action |
|---|---|
| `PAYMENT.CAPTURE.COMPLETED` | Find the transfer by `resource.supplementary_data.related_ids.order_id` = `paypal_order_id`. Store the capture id. Call `commitTransfer(transfer.id, resource.id)`. |
| `PAYMENT.CAPTURE.REFUNDED` | Find the capture id from `resource.links` (`rel === "up"`, last path segment), falling back to `resource.id`. Find the transfer by `paypal_capture_id`. Call `unwindTransfer`. |
| `PAYMENT.CAPTURE.REVERSED` | Find the transfer by `paypal_capture_id = resource.id`. Call `unwindTransfer`. |
| `PAYMENT.PAYOUTS-ITEM.*` | `handlePayoutItem(businessId, resource.payout_item_id)` |
| `INVOICING.INVOICE.PAID`, `.UPDATED`, `.CANCELLED` | `refreshObligationFromInvoice(resource.invoice?.id ?? resource.id)` |

4. **Finish:** set `processed_at`. If dispatch threw, store the message in `error` and still return 200. PayPal must not retry forever; the inbox keeps the error for the operator.

## Routes (`src/app.ts` registers everything)

`buildApp(ctx)`:
- creates `Fastify({ logger: false })`;
- registers the routes;
- sets the error handler below.

**Error handler:**

| Error | Response |
|---|---|
| `DomainError` | its status, `{ error: code, message }` |
| `ZodError` | 400 `{ error: "BAD_REQUEST", message }` |
| `PayPalError` | 502 `{ error: "PAYPAL_ERROR", code, debugId, message }` |
| anything else | 500 `{ error: "INTERNAL" }`. The full error goes to `console.error`, never the stack to the client. |

| Method & path | Handler |
|---|---|
| GET `/healthz` | `{ ok: true }`. Must not touch the DB. |
| GET `/readyz` | `select 1` → `{ ok: true }`, or 503 |
| GET `/api/networks` | `[{ id, name, currency }]` |
| GET `/api/networks/:id` | `networkSummary` |
| GET `/api/networks/:id/obligations` | `listObligations` |
| POST `/api/networks/:id/rounds` | `planRound` → 201 |
| GET `/api/rounds/:id` | `getRound` |
| POST `/api/rounds/:id/consents` | body `{ businessId: uuid }` → `recordConsent` |
| POST `/api/rounds/:id/execute` | Round must be `executing`, else 409 `ROUND_NOT_READY`. Runs `executeRound` inline. On `retryInMs`, schedule `round.execute` and reply 202 with the view; otherwise 200 with `getRound`. |
| POST `/api/transfers/:id/order` | `createCheckoutOrder` |
| POST `/api/transfers/:id/capture` | body `{ orderId: string }` → `captureCheckout` |
| POST `/api/rounds/:id/payouts` | body `{ payerId: uuid }` → `startPayouts` |
| POST `/api/rounds/:id/payouts/refresh` | `refreshPayouts` |
| POST `/api/obligations/:id/refresh` | `refreshObligationFromInvoice` with that obligation's invoice → `ObligationView` |
| POST `/webhooks/paypal/:businessId` | raw-string JSON parser scoped to this route → `handleWebhook` |
| GET `/api/stream` | SSE (below) |
| GET `/api/audit/verify` | `verifyChain` |

Path ids are validated as uuids; an invalid one returns 400.

**SSE (`/api/stream`):**
- Reply with the raw response:
  - headers: `content-type: text/event-stream`, `cache-control: no-cache`, `connection: keep-alive`;
  - first write: `retry: 3000\n\n`.
- Subscribe to the bus. Write each event as:
  ```
  id: <seq>
  event: <type>
  data: <json of BusEvent>

  ```
- Every 25 s, send the heartbeat `: ping\n\n`.
- Unsubscribe and clear the interval when the request closes.

## `src/main.ts`

1. `config = loadConfig()`.
2. `{ db } = createDb(config.databaseUrl)`.
3. `runMigrations(db, migrationsFolder, "neon")`, with `migrationsFolder` exported by `@untangle/db`.
4. `ctx = createContext({ db, config })`.
5. `ensureNetwork(ctx)`.
6. Register the job handlers:
   - `round.execute` → `executeRound`;
   - `transfer.commit` → `commitTransfer(…, fromJob = true)`;
   - `transfer.unwind` → `unwindTransfer(…, fromJob = true)`.
7. `ctx.jobs.start()`.
8. `buildApp(ctx).listen({ port: config.port, host: "0.0.0.0" })`.
9. Log a single line with the URL.

## Tests (Vitest + PGlite + simulated PayPal)

### `test/fake-paypal.ts`

`createFakePayPal()` returns `{ fetch: typeof fetch; sim: Sim }`. It is a stateful simulator:

**Merchants:** `sim.addMerchant(clientId, clientSecret, email)`.
- The OAuth Basic auth header picks the merchant, and the token is `tok-<clientId>`.
- Bearer tokens map back to the merchant.

**Invoicing.** Invoices belong to the merchant whose token created them.
- Create a draft (id `INV2-<n>`, status `DRAFT`), send (→ `SENT`), get.
- Record payment:
  - reject with 422 when the status isn't SENT, UNPAID or PARTIALLY_PAID, or when the amount is greater than what's due;
  - payment ids are `EXTR-<n>`;
  - when nothing is due, status → `MARKED_AS_PAID`, else `PARTIALLY_PAID`;
  - `due_amount` is reduced.
- Delete external payment: unknown → 404; otherwise restore the amount due and the status.
- `sim.createSentInvoice(creditorEmail, debtorEmail, amountMinor, currency = "USD")` returns an invoice id and seeds state directly.
- `sim.cancelInvoice(id)`.

**Orders.**
- Create (status `CREATED`, payee = the token's merchant).
- Capture → `COMPLETED`, with `purchase_units[0].payments.captures[0] = { id: "CAP-<n>", status: "COMPLETED" }`.
- Capture is idempotent on `PayPal-Request-Id`.

**Payouts.**
- Create → batch `PB-<n>`, items `PI-<n>` with `transaction_status "PENDING"`.
- `getBatch`, `getItem`.
- `sim.setPayoutStatus(itemId, status)`.
- Idempotent on `sender_batch_id`.

**Webhook verify:** returns `SUCCESS` when `transmission_sig === "valid-sig"`, else `FAILURE`.

**Faults:** `sim.failNext(method, pathPrefix, status, times = 1)` returns that status, with a v2 error body, the next N times.

**Inspection:** `sim.invoice(id)` returns `{ status, dueMinor, payments: [{ id, amountMinor, note }] }`.

### `test/context.ts`

`makeTestContext()`:
1. Creates the database:
   - `db = drizzle(new PGlite(), { schema }) as Db`, with `drizzle` from `drizzle-orm/pglite`, and `schema`, `Db`, `migrationsFolder` and `runMigrations` from `@untangle/db`;
   - then `runMigrations(db, migrationsFolder, "pglite")`.
2. Builds a config with three businesses: bakery, mill and trucker, with fake client ids and secrets.
3. Uses a fixed test `MASTER_KEY` (64 hex chars).
4. Calls `createContext({ db, config, fetch: fake.fetch, sleep: async () => {} })` and `ensureNetwork`.
5. Sets each `paypal_accounts.webhook_id` to `"WH-<slot>"`.
6. Seeds the bakery loop, as obligations with real simulator invoices (`status 'invoiced'`, `outstanding = amount`):
   - a: bakery → mill, 3000; invoice owned by mill;
   - b: mill → trucker, 2400; owned by trucker;
   - c: trucker → bakery, 2800; owned by bakery.
7. Returns `{ ctx, sim, ids: { network, bakery, mill, trucker, a, b, c }, app: buildApp(ctx) }`.

### Required tests

Each bullet below must be a separate test.

- **crypto:** a round trip; a wrong key throws; a flipped byte throws; the consent signature is stable.
- **config:** reads PAYPAL_BIZ slots; rejects a 63-character MASTER_KEY; rejects a half-filled slot; rejects duplicate emails.
- **operation log:** put, then get, then upsert keeps `attempts` and the ref.
- **invoice gateway:** maps `due_amount` and payments; computes due as 0 when MARKED_AS_PAID has no `due_amount`.
- **planRound:**
  - setoffs are 2400 each for a, b and c;
  - transfers are `[bakery→mill 200, trucker→mill 400]`, matching by business ids;
  - there are 3 statements, each with a 64-hex hash;
  - a second plan while consenting returns 409 `ROUND_IN_PROGRESS`.
- **plan determinism:** fail the first round in the DB, plan again, and the `planHash` is identical.
- **consent and execute:**
  - after three consents, the status is `executing` and a job is scheduled;
  - `executeRound` leaves simulator invoices due at mill 600, trucker 0 (`MARKED_AS_PAID`) and bakery 400;
  - DB outstanding is the same;
  - statuses are partially_settled, settled and partially_settled;
  - the round is `settling`; the transfers are `ready`.
- **aborted:** cancel trucker's invoice in the simulator, then execute. The round is `failed`, no simulator invoice has a payment, and the setoffs are `failed`.
- **checkout end to end:**
  - order created by mill (the payee), then capture;
  - the legs are recorded on the bakery and mill invoices;
  - after both transfers, every obligation has outstanding 0 and is `settled`;
  - the round is `closed`;
  - each simulator invoice is `MARKED_AS_PAID`.
- **capture idempotent:** capturing again returns a committed view, and the simulator payment count is unchanged.
- **refund unwinds:** after a committed transfer, send a valid `PAYMENT.CAPTURE.REFUNDED` webhook through `app.inject`. The transfer becomes `unwound`, outstanding is restored, the leg payments are gone from the simulator, and a closed round returns to `settling`.
- **payouts:** `startPayouts(trucker)` leaves the transfer `pending_paypal`. Set the simulator item to SUCCESS, call `refreshPayouts`, and the transfer is committed.
- **webhooks:** a bad signature returns 400; the same event posted twice is processed once (assert the second response says `duplicate: true` and the data is unchanged).
  - Every webhook request in the tests carries all five headers: `paypal-auth-algo`, `paypal-cert-url`, `paypal-transmission-id`, `paypal-transmission-sig` and `paypal-transmission-time`. The client's `verify` returns false without them.
- **one writer:**
  - Run `captureCheckout` and a valid `PAYMENT.CAPTURE.COMPLETED` webhook for the same transfer together with `Promise.all`.
  - Each leg's simulator invoice ends with exactly one payment whose note carries `[untangle:leg:<transferId>:<obligationId>]`.
  - The transfer is `committed`, and obligation outstanding drops by the leg amount only once.
- **jobs:** `sim.failNext("POST", "/v2/invoicing/invoices/", 503, 50)`, then executing the round returns `{ retryInMs }`. Clear the faults, move the job's `run_at` into the past, and `jobs.runDue()` completes the round to `settling`.
- **routes:** through `app.inject`:
  - `/healthz` returns 200;
  - planning a round returns 201;
  - three consents, then execute, returns 200 and `settling`;
  - GET round matches;
  - an unknown round uuid returns 404 `ROUND_NOT_FOUND`;
  - a bad uuid returns 400.
- **audit:** after the checkout flow, `GET /api/audit/verify` returns `ok: true` with count > 0.

## Sandbox notes for the worker

- Vitest cannot spawn esbuild in your sandbox. Run `pnpm typecheck` and make it pass.
- You may add a temporary `vitest.config.mjs` with the TypeScript-transpile workaround to run the tests yourself; I delete it afterwards.
- No network access, and you must not install anything.

## Done means

- `pnpm --filter @untangle/server typecheck` passes.
- `pnpm --filter @untangle/server test` passes (I run it outside the sandbox).
- Nothing outside `apps/server/` changed.
