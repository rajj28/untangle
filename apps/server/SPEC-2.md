# @untangle/server, part 2: the desk's API, the demo town, a simulator mode

This builds on the existing server (`SPEC.md`). Every hard rule there still applies:
- code style;
- integer cents;
- only the executor writes payments onto invoices;
- no polling;
- no secrets in output;
- sandbox only;
- transactions use only `tx` and never emit, schedule or call PayPal inside;
- status changes are conditional;
- one writer per lock key.

Write only inside `apps/server/`.

Read first:
- `src/services/*.ts`, which hold the current behaviour. Note `syncObligation` in `obligations.ts`: outstanding amounts are **only** ever copied from PayPal through it.
- `test/server.test.ts`.
- `src/seed/main-street.ts`, the demo dataset. Don't change its numbers.
- `../../packages/db/src/schema.ts`. `obligations.description` is new, added by migration `0001`.

## 1. Move the simulator

- Move `test/fake-paypal.ts` to `src/sim/fake-paypal.ts` with no behaviour change, and update the test imports.
- Add one behaviour: `POST /v2/invoicing/invoices` must reject a duplicate `PayPal-Request-Id` by returning the **same** invoice. PayPal does this; it makes seeding idempotent.

## 2. Seeding (`src/seed/seed.ts`)

```ts
export interface SeedResult { created: number; skipped: number }
export async function seedNetwork(ctx: AppContext, networkId: string, runTag: string): Promise<SeedResult>
```

**Setup.** Map slots to businesses through `ctx.config.businesses` (slot → email) and the network's `businesses` rows (email → id). Skip any invoice whose debtor or creditor slot isn't configured; count it as `skipped`.

**For each `mainStreetInvoices[i]`,** in order, with `n = i + 1`:

1. `due` = the Pacific date of `ctx.now()` plus `dueInDays`, as `YYYY-MM-DD`. Reuse the en-CA formatter idea from `executor-deps.ts`; move it into a small shared helper `src/dates.ts` (`pacificDate(date)`, `addDays(date, days)`).
2. Create the draft with the creditor's client:
   ```
   invoicing.createDraft({
     detail: {
       currency_code,
       invoice_number: `UNT-${runTag}-${pad3(n)}`,
       note: "Sent through Untangle. It may be settled by set-off against what you are owed.",
       payment_term: { term_type: "DUE_ON_DATE_SPECIFIED", due_date: due },
     },
     primary_recipients: [{ billing_info: { email_address: debtorEmail, name: { business_name: debtorName } } }],
     items: [{ name: item, quantity: "1", unit_amount: toMoney(dollars * 100, currency) }],
     configuration: { partial_payment: { allow_partial_payment: true } },
   }, { idempotencyKey: `seed-${runTag}-${n}` })
   ```
3. If the returned status is `DRAFT`, call `invoicing.send(id, { send_to_recipient: true, send_to_invoicer: false })`. A retried seed gets back an invoice that was already sent; don't send it twice.
4. Insert the obligation:
   - `status 'invoiced'`, `amountMinor = outstandingMinor = dollars * 100`, the network currency;
   - `dueOn = due`, `description = item`, `paypalInvoiceId = id`;
   - `debtorConfirmedAt` and `creditorConfirmedAt` = now.
   - Use `onConflictDoNothing()`, since `paypal_invoice_id` is unique.
   - Count it as `created` only when a row was inserted.
5. After the loop, emit one event: stream `network:<id>`, type `network.seeded`, payload `{ networkId, runTag, created, skipped }`.

Run everything one at a time: sandbox rate limits matter more than speed.

## 3. Read-model additions

**`ObligationView` gains `description: string | null`.**

**`networkSummary`:**
- `totals` gains:
  - `clearedByLoopsMinor`: the sum of `setoffs.amount_minor` with status `recorded`;
  - `settledByChainsMinor`: the sum of `transfer_legs.amount_minor` with status `recorded`;
  - `movedMinor`: the sum of `transfers.amount_minor` with status `committed`.
- Each business gains `owesMinor`, `owedMinor` and `netMinor = owedMinor − owesMinor`. They are computed from the outstanding amounts of its obligations whose status isn't `cancelled`.
- `latestRound` keeps its shape.

**New routes** (ids validated as uuids with `requireUuid`):

| Method & path | Returns |
|---|---|
| GET `/api/config` | `{ mode: "sandbox" \| "sim", demo: boolean, networkId: string \| null, currency: string, paypalSdkUrl: string \| null, agGridLicenseKey: string \| null }`. `networkId` is the first network by `created_at`. `paypalSdkUrl` is `"https://www.sandbox.paypal.com/web-sdk/v6/core"` in sandbox mode and null in sim mode. |
| GET `/api/networks/:id/rounds` | `[{ id, status, createdAt, planHash, stats }]`, newest first, at most 20 |
| GET `/api/events?after=<seq>&limit=<n>` | `{ events: BusEvent[] }` in ascending `seq` order. `limit` defaults to 200 (max 500). Without `after`, return the latest `limit` events, still ascending. Validate the query with zod. |
| GET `/api/obligations/:id/history` | `{ obligation: ObligationView, setoffs: [{ roundId, amountMinor, status, paypalPaymentId, createdAt }], legs: [{ transferId, roundId, payerId, payeeId, instrument, transferStatus, amountMinor, status, paypalPaymentId }] }`. Both arrays are oldest first. An unknown id returns 404 `OBLIGATION_NOT_FOUND`. |
| POST `/api/demo/reset` | Below. Returns `{ networkId, archived, created, skipped }`. |

**Config.** Add `agGridLicenseKey?: string` (from `AG_GRID_LICENSE_KEY`, optional) to `Config` and `loadConfig`. The key is shown in the browser by design.

**Demo reset** runs under `ctx.locks.run("demo:reset", …)`. When `!ctx.config.demoMode`, return 404.
1. If any round of the network is `executing`, return 409 `ROUND_IN_PROGRESS`.
2. Set every `consenting` or `settling` round to `failed`, conditionally.
3. For each obligation of the network with status in `invoiced`, `partially_settled` or `settled` and a PayPal invoice:
   - Best effort: `invoicing.cancel(id, { send_to_recipient: false })` with the creditor's client. Ignore errors; a fully paid invoice can't be cancelled, and that's fine.
   - Set the status to `cancelled` (conditional on its old status) and bump `version`.
   - Cancelled is final: `syncObligation` never revives it.
4. Call `seedNetwork(ctx, networkId, runTag)` with `runTag = "R" + Date.now().toString(36).toUpperCase()`.
5. Emit `demo.reset` with `{ networkId, archived, created }`.

## 4. App options, static web, simulator routes

`buildApp(ctx, options: { mode?: "sandbox" | "sim"; sim?: Sim; webRoot?: string } = {})`. `mode` defaults to `"sandbox"`.

**Static web** (production, single service on Render):
- If `webRoot` is given and the folder holds an `index.html`, register `@fastify/static` with `{ root: webRoot, wildcard: false }`. It is already installed.
- Add a not-found handler: a `GET` whose path starts with neither `/api/` nor `/webhooks/` and accepts `text/html` gets `index.html`. Everything else returns 404 JSON `{ error: "NOT_FOUND" }`.
- `main.ts` passes `webRoot` = `apps/web/dist`, resolved from `import.meta.url`.

**Simulator routes,** only when `options.sim` is set:

| Method & path | Behaviour |
|---|---|
| POST `/api/sim/transfers/:id/approve` | Stands in for the buyer approving in the PayPal popup: `createCheckoutOrder`, then `captureCheckout`. Returns the `TransferView`. |
| POST `/api/sim/transfers/:id/payout/:status` | `status` is one of `SUCCESS`, `FAILED`, `RETURNED`, `UNCLAIMED`. Find the transfer's payout item with `sim.payoutItemForTransfer`, call `sim.setPayoutStatus`, then return `refreshPayouts(roundId)`. |

## 5. Simulator mode (`src/sim/dev-sim.ts`)

A dev entry that runs the real server code against an in-memory database and the simulator, seeded with Main Street. It lets the UI be built and demoed offline. It is never the judged demo.

1. `db = drizzle(new PGlite(), { schema }) as Db`, then `runMigrations(db, migrationsFolder, "pglite")`.
2. Build `config` in code:
   - `masterKey`: 32 random bytes;
   - `demoMode: true`, `networkName: "Main Street"`, `currency: "USD"`;
   - `port`: `PORT` or 3000; `publicBaseUrl`: `http://localhost:<port>`;
   - `databaseUrl: "pglite://memory"`;
   - businesses: from `mainStreetBusinesses`, with:
     - email `${slug}@sim.untangle.test` (slug: lowercase, non-alphanumerics → `-`, trimmed);
     - `clientId: \`sim-client-${slot}\``, `clientSecret: \`sim-secret-${slot}\``.
3. `{ fetch, sim } = createFakePayPal()`. Register each merchant.
4. `ctx = createContext({ db, config, fetch })`, then `networkId = await ensureNetwork(ctx)`, then `seedNetwork(ctx, networkId, "SIM")`.
5. Register the same job handlers as `main.ts`; put the registration in a shared `registerJobs(ctx)` in `src/jobs-registry.ts` and use it in both. Then `ctx.jobs.start()`.
6. `buildApp(ctx, { mode: "sim", sim, webRoot })`, then listen on `0.0.0.0:<port>`. Log one line: `Untangle simulator on http://localhost:<port> (Main Street, 25 invoices, no real PayPal)`.

Add the package script: `"dev:sim": "tsx watch src/sim/dev-sim.ts"`. You may edit `package.json` for this script and for `seed` and `webhooks` below; change nothing else in it.

## 6. CLI scripts (`scripts/`)

**`scripts/seed.ts`** — `"seed": "tsx --env-file=../../.env scripts/seed.ts"`
1. `loadConfig`, `createDb`, migrations, `createContext`, `ensureNetwork`.
2. If the network already has obligations whose status isn't `cancelled`, print `Already seeded: <n> open invoices. Use POST /api/demo/reset for a fresh set.` and exit 0.
3. Otherwise, run `seedNetwork` with `runTag = "M" + Date.now().toString(36).toUpperCase()` and print the counts.
4. Close the pool.

**`scripts/webhooks.ts`** — `"webhooks": "tsx --env-file=../../.env scripts/webhooks.ts"`
1. Require `PUBLIC_BASE_URL` to start with `https://`. PayPal only calls https URLs.
2. For each business, the URL is `${PUBLIC_BASE_URL}/webhooks/paypal/${businessId}`.
3. List the app's webhooks.
   - If one has that exact URL, reuse it.
   - Otherwise create one with these event types:
     - `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.CAPTURE.REVERSED`;
     - `PAYMENT.PAYOUTS-ITEM.SUCCEEDED`, `.FAILED`, `.RETURNED`, `.UNCLAIMED`, `.BLOCKED`, `.CANCELED`, `.DENIED`, `.HELD`;
     - `INVOICING.INVOICE.PAID`, `INVOICING.INVOICE.UPDATED`, `INVOICING.INVOICE.CANCELLED`.
4. Store `webhook_id` in `paypal_accounts`.
5. Print one line per business: its name and the webhook id. Ids are not secret.

## 7. Tests

Add these to `test/` and keep every existing test passing.

**Test context.** `makeTestContext(options?: { town?: "trio" | "main-street" })`. The default `"trio"` is today's bakery, mill and trucker. `"main-street"` configures the 9 Main Street businesses as simulator merchants and calls `seedNetwork` instead of inserting the trio. Return the businesses by slot.

Required tests, each its own `it`:
- **seed:**
  - Main Street seeds 25 invoices, each `SENT` in the simulator with a matching obligation (description set, outstanding = amount).
  - A second `seedNetwork` with the same `runTag` creates 0 and leaves the counts unchanged.
- **main street plan:**
  - totalOwed 2,810,000, clearedByLoops 2,400,000, moneyMoved 220,000;
  - exactly 3 transfers: Cafe → Cleaning 100,000, Cafe → Accounting 50,000, Dairy → Accounting 70,000.
- **main street end to end:**
  - plan, every business consents, `runDue()` executes;
  - pay both Cafe transfers through the `sim/approve` route;
  - pay the Dairy transfer through payouts with the `sim/payout/SUCCESS` route;
  - the round is `closed`, every obligation is `settled` with outstanding 0, and every simulator invoice is `MARKED_AS_PAID`;
  - `GET /api/networks/:id` totals: `clearedByLoopsMinor` 2,400,000, `settledByChainsMinor` 410,000, `movedMinor` 220,000.
- **reset:**
  - after the end-to-end flow, `POST /api/demo/reset` archives 25 and creates 25;
  - the old obligations are `cancelled`;
  - a new round plans the same stats;
  - a stray `INVOICING.INVOICE.UPDATED` webhook for an old invoice leaves its obligation `cancelled`.
- **events:** `GET /api/events?after=<seq>` returns only later events, ascending; `limit` is respected.
- **history:** after a set-off and a chain commit, the history of obligation `a` lists both, with their PayPal payment ids.
- **config:** `GET /api/config` in sim mode returns `mode: "sim"` and a null `paypalSdkUrl`.
- **not found:** `GET /api/nope` returns 404 JSON.

## Done means

- `pnpm --filter @untangle/server typecheck` passes. Vitest can't spawn esbuild in your sandbox; I run the tests.
- Every new test is written and reasoned through.
- Report:
  - files changed;
  - any deviation from this spec and why;
  - anything you are unsure about.
