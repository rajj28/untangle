# @untangle/db: implementation spec

The Postgres schema, client, migrations and the tamper-evident event log.
- **Production:** Neon, via `@neondatabase/serverless` and `drizzle-orm/neon-serverless`.
- **Tests:** PGlite (in-process Postgres), via `drizzle-orm/pglite`.

## Hard rules

1. **TypeScript, ESM, strict.** Use the same conventions as `packages/engine` and `packages/paypal`:
   - `.ts` import extensions;
   - `import type` for types;
   - no enums, namespaces or parameter properties.
2. **Money.** Always integer minor units, as `bigint` columns in mode `"number"`. Never store floats.
3. **Write files only inside `packages/db/`.** Do not edit `package.json` or `tsconfig.json`.
4. **The database must be able to sleep.** Neon's free tier sleeps after 5 idle minutes and bills compute hours:
   - nothing in this package may poll;
   - the pool must close idle connections after 10 s (`idleTimeoutMillis: 10_000`, `max: 5`).

## Files

```
src/schema.ts      every table below (drizzle-orm/pg-core)
src/client.ts      createDb(databaseUrl) for Neon; type Db
src/canonical.ts   canonicalJson(value): RFC 8785-style canonical JSON for our value set
src/events.ts      appendEvents, verifyChain
src/migrate.ts     runMigrations(db) under an advisory lock
src/index.ts       public exports
drizzle.config.ts  drizzle-kit config (dialect postgresql, schema ./src/schema.ts, out ./drizzle)
drizzle/           generated SQL migrations (run drizzle-kit generate; commit the output)
test/helpers.ts    makeTestDb(): fresh PGlite db with migrations applied
test/schema.test.ts
test/events.test.ts
test/canonical.test.ts
```

## Conventions

- **Primary keys:** `uuid` with `defaultRandom()`, unless stated otherwise.
- **Timestamps:** `timestamptz` with `defaultNow()`. Use `created_at` everywhere, and `updated_at` where state changes.
- **Status columns:** `text` plus a `check` constraint listing the allowed values. Export each list as a `const` array type, e.g. `export const obligationStatuses = [...] as const`.
- **Foreign keys:** declared with `references()`. Use `onDelete: "cascade"` only where noted.
- **Column names** are snake_case in SQL and camelCase in TypeScript, e.g. `amountMinor: bigint("amount_minor", { mode: "number" })`.

## Tables

| Table | Columns (SQL names) | Constraints / indexes |
|---|---|---|
| `networks` | id, name, currency `char(3)`, created_at | |
| `businesses` | id, network_id → networks, name, email, paypal_payer_id null, verified bool default false, created_at | unique (network_id, email) |
| `users` | id, business_id → businesses null, role, display_name, email null, paypal_sub null, created_at | role ∈ owner, accountant, operator; unique paypal_sub |
| `passkeys` | credential_id text pk, user_id → users cascade, public_key bytea, counter bigint number default 0, transports text[] null, created_at | |
| `paypal_accounts` | business_id pk → businesses cascade, environment, client_id, client_secret_enc bytea, webhook_id null, created_at | environment ∈ sandbox, live |
| `evidence` | id, business_id → businesses, kind, mime, sha256, size int, bytes bytea null, status default 'pending', extraction jsonb null, created_at | kind ∈ image, pdf, audio, text, paypal_invoice; status ∈ pending, extracted, failed; unique (business_id, sha256) |
| `claims` | id, evidence_id → evidence null, claimant_id → businesses, side, counterparty_name, counterparty_email null, counterparty_id → businesses null, amount_minor, currency `char(3)`, issued_on date null, due_on date null, reference null, confidence real, status default 'open', obligation_id → obligations null, created_at | side ∈ creditor, debtor; status ∈ open, matched, rejected; amount_minor > 0 |
| `obligations` | id, network_id → networks, debtor_id → businesses, creditor_id → businesses, amount_minor, outstanding_minor, currency `char(3)`, due_on date null, status, paypal_invoice_id null, debtor_confirmed_at null, creditor_confirmed_at null, protected bool default false, version int default 0, created_at, updated_at | status ∈ claimed, matched, negotiating, confirmed, invoiced, partially_settled, settled, disputed, cancelled; amount_minor > 0; outstanding_minor between 0 and amount_minor; debtor_id <> creditor_id; unique paypal_invoice_id; index (network_id, status) |
| `negotiations` | id, obligation_id → obligations, status, agreed_minor null, transcript jsonb default '[]', created_at, updated_at | status ∈ open, agreed, escalated, resolved |
| `policies` | business_id → businesses, version int, rules jsonb, signature null, created_at | pk (business_id, version) |
| `rounds` | id, network_id → networks, status, plan jsonb null, plan_hash null, created_at, updated_at | status ∈ planned, consenting, executing, settling, closed, failed |
| `setoffs` | id, round_id → rounds, obligation_id → obligations, amount_minor, status default 'pending', paypal_payment_id null, created_at, updated_at | status ∈ pending, recorded, compensated, failed; amount_minor > 0; unique (round_id, obligation_id) |
| `transfers` | id, round_id → rounds, payer_id → businesses, payee_id → businesses, amount_minor, currency `char(3)`, instrument null, status default 'planned', paypal_order_id null, paypal_capture_id null, payout_batch_id null, payout_item_id null, settlement_invoice_id null, created_at, updated_at | instrument ∈ checkout, payouts, invoice; status ∈ planned, ready, awaiting_payer, pending_paypal, committed, failed, unwound; amount_minor > 0; payer_id <> payee_id |
| `transfer_legs` | transfer_id → transfers cascade, obligation_id → obligations, position int, amount_minor, status default 'pending', paypal_payment_id null | status ∈ pending, recorded, compensated; amount_minor > 0; pk (transfer_id, obligation_id) |
| `statements` | round_id → rounds, business_id → businesses, statement_hash, body jsonb, created_at | pk (round_id, business_id) |
| `consents` | id, round_id → rounds, business_id → businesses, statement_hash, method, signature, created_at | method ∈ passkey, policy, demo; unique (round_id, business_id) |
| `operations` | idem_key text pk, kind, ref_id, status default 'pending', attempts int default 0, paypal_ref null, last_error null, created_at, updated_at | status ∈ pending, in_flight, succeeded, failed_retryable, failed_permanent; index (status) |
| `events` | seq bigserial pk (mode number), id uuid unique defaultRandom, stream, type, payload jsonb, actor, at timestamptz defaultNow, prev_hash, hash | unique hash; index (stream, seq) |
| `webhook_inbox` | paypal_event_id text pk, business_id → businesses null, event_type, payload jsonb, verified bool, received_at, processed_at null, error null | |
| `jobs` | id, kind, payload jsonb, run_at timestamptz defaultNow, status default 'queued', attempts int default 0, lease_until null, last_error null, created_at | status ∈ queued, running, done, failed; index (status, run_at) |
| `ai_cache` | input_sha256 text, model, schema_version int, output jsonb, created_at | pk (input_sha256, model, schema_version) |

Note the circular reference: `claims.obligation_id` points to `obligations`. Define `obligations` before `claims`, or use drizzle's lazy `references(() => obligations.id)`.

## `src/client.ts`

```ts
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>; // the shared supertype of the neon-serverless and pglite drizzle instances
export function createDb(databaseUrl: string): { db: Db; close(): Promise<void> };
```

- Uses `Pool` from `@neondatabase/serverless` with `{ connectionString, max: 5, idleTimeoutMillis: 10_000 }` and `drizzle(pool, { schema })`.
- Node 24 has a global `WebSocket`. Do not add `ws`.
- All repository code elsewhere takes a `Db`, so tests can pass a PGlite instance.

## `src/canonical.ts`

`canonicalJson(value: unknown): string`
- Objects: keys sorted by UTF-16 code unit order, no whitespace, `undefined` properties omitted.
- Arrays: kept in order.
- Strings: `JSON.stringify`.
- Numbers:
  - only finite numbers are allowed; integers are emitted as `JSON.stringify`;
  - throw `TypeError` on `NaN`, `Infinity` and non-integer numbers (all money is integer minor units).
- Booleans and null: emitted as is.
- `Date`: throw `TypeError`. Callers must pass ISO strings.
- `bigint`, functions and symbols: throw `TypeError`.

Also export `sha256Hex(text: string): string`, using `node:crypto`.

## `src/events.ts`: tamper-evident log

```ts
export interface NewEvent { stream: string; type: string; payload: Record<string, unknown>; actor: string }
export interface StoredEvent extends NewEvent { seq: number; id: string; at: string; prevHash: string; hash: string }
export async function appendEvents(db: Db, events: NewEvent[]): Promise<StoredEvent[]>;
export async function verifyChain(db: Db): Promise<{ ok: true; count: number } | { ok: false; brokenAtSeq: number; reason: string }>;
export const GENESIS_HASH = "0".repeat(64);
```

**`appendEvents`**
1. Runs in one transaction.
2. First statement: `select pg_advisory_xact_lock(727274)`. This serialises appenders across processes.
3. Reads the hash of the row with the highest `seq`, or `GENESIS_HASH` if the table is empty.
4. For each event, in order:
   - `id = crypto.randomUUID()`
   - `at = new Date().toISOString()`
   - `hash = sha256Hex(prevHash + "\n" + canonicalJson({ id, stream, type, payload, actor, at }))`
   - insert the row with `prev_hash = prevHash`, then set `prevHash = hash`.
5. Returns the stored rows.
6. An empty input array returns `[]` without opening a transaction.

**`verifyChain`**
- Streams through all events ordered by `seq`, in pages of 1000.
- For each row, recompute its hash from the stored fields:
  - `at`: use the ISO string of the stored `timestamptz`. Normalise both sides with `new Date(x).toISOString()` so microseconds don't break equality.
  - Store `at` exactly as `toISOString()` gives it: millisecond precision.
- Check that `prev_hash` equals the previous row's `hash`, starting from `GENESIS_HASH`.
- Returns the first failure with its `seq` and a reason: `"prev_hash mismatch"` or `"hash mismatch"`.

## `src/migrate.ts`

`runMigrations(db: Db, migrationsFolder: string)`:
- Takes `pg_advisory_lock(727273)`.
- Runs the drizzle migrator for the driver behind `db`:
  - Accept a `kind: "neon" | "pglite"` parameter.
  - `"neon"` uses `drizzle-orm/neon-serverless/migrator`; `"pglite"` uses `drizzle-orm/pglite/migrator`.
- Unlocks in `finally`.

## `drizzle.config.ts`

`defineConfig({ dialect: "postgresql", schema: "./src/schema.ts", out: "./drizzle" })`.

Generate the migration with `pnpm exec drizzle-kit generate --name init`. Commit the `drizzle/` folder it produces.

## Tests (Vitest + PGlite)

`test/helpers.ts`: `makeTestDb()` creates `new PGlite()`, wraps it in `drizzle(client, { schema })`, runs `runMigrations(db, "<package>/drizzle", "pglite")`, and returns `{ db, close }`.

Each bullet below must be a separate test.

**`schema.test.ts`**
- All 21 tables exist after migration (query `information_schema.tables`).
- Obligation constraints. Each insert below must be rejected:
  - `amount_minor = 0`;
  - `outstanding_minor > amount_minor`;
  - `debtor_id = creditor_id`;
  - a duplicate `paypal_invoice_id`;
  - a status outside the list.
- A valid obligation inserts and reads back with `amountMinor` as a JS number.
- A `transfer_legs` primary-key duplicate is rejected; deleting the transfer cascades to its legs.
- A duplicate `operations.idem_key` is rejected.

**`canonical.test.ts`**
- Key order doesn't change the output.
- Nested objects and arrays are handled.
- `undefined` properties are omitted.
- Throws on 1.5, NaN, a `Date` and a bigint.
- Unicode string escaping matches `JSON.stringify`.

**`events.test.ts`**
- Appending 3 events gives `seq` 1..3; the first `prevHash` is `GENESIS_HASH`; each `prevHash` equals the previous `hash`.
- `verifyChain` reports ok with count 3.
- Tampering with the payload of seq 2 through a raw SQL update gives `{ ok: false, brokenAtSeq: 2, reason: "hash mismatch" }`.
- Tampering with `prev_hash` of seq 3 gives `brokenAtSeq: 3`, reason `"prev_hash mismatch"`.
- Two `appendEvents` calls, in order: the chain stays continuous.
- An empty append returns `[]`.

## Done means

- `pnpm --filter @untangle/db typecheck` passes.
- `pnpm --filter @untangle/db test` passes.
- The migration SQL exists in `drizzle/`.
- Nothing outside `packages/db/` changed.
