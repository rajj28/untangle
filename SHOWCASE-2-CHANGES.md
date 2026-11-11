# SHOWCASE 2 — CHANGES

Second batch of "real behaviour on screen" demo moments, built on top of the AG Grid and
Showcase-1 changes (see `AGGRID-CHANGES.md` and `SHOWCASE-1-CHANGES.md`). Nothing is faked:
every panel is driven by live engine output, live server state, or read-only PayPal sandbox
responses. No PayPal write logic, executor payment/rollback logic, or `video/` was touched.

---

## F. "PayPal says" proof

**What it does.** For every obligation with a `paypalInvoiceId`, a new read-only server route
calls PayPal `GET /v2/invoicing/invoices/{id}` through the existing PayPal client (a new
read-only `getInvoice` path via the existing `invoicing.get` resource; no write paths changed).
It returns the live invoice status, amount, due date, every recorded payment
(method / type / amount / date / note) and the payer-view link
(the `detail.metadata.recipient_view_url`, falling back to the invoice `links` entry that points
at `/view/`). When demo mode has no PayPal account for a creditor it returns **503
`PAYPAL_NOT_CONNECTED`** — never invented data.

**Files.**
- `apps/server/src/routes/obligations.ts` — `GET /api/obligations/:id/paypal` (read-only).
- `apps/web/src/components/PaypalSays.tsx` — `PaypalSaysCell` (ledger cell) and
  `PaypalSaysBadge` (business statement set-off row); both hit the route live, show the live
  status + recorded set-off payments, render "PayPal not connected" on 503, and an
  **Open on PayPal** button (payer-view link, new tab).
- `apps/web/src/views/Ledger.tsx` — new "PayPal says" column (between "PayPal invoice" and
  "Outstanding").
- `apps/web/src/views/Settlement.tsx` — each set-off line in the business statement drawer shows
  the `PaypalSaysBadge`.
- `apps/web/src/types.ts` — `PaypalSays`, `PaypalPaymentView`.
- `apps/web/src/api.ts` — `api.obligationPaypal`.

**Try it.** Open the desk → **Ledger**. Every invoice row shows a live "PayPal says" cell with
the PayPal status (e.g. `SENT` / `PARTIALLY_PAID` / `PAID`), the recorded set-off payments, and
an **Open on PayPal** button that opens the payer view in a new tab. In the **Settlement**
workspace, open any business statement and each "Set-offs" line carries the same live badge.

---

## G. Before → after collapse (Settlement view)

**What it does.** A graph panel showing businesses as nodes and every open obligation as an edge
(thickness ∝ amount). Pressing **Clear** animates the engine's *actual* plan
(`planSettlement` + `findLoops` over the live obligations): each cleared loop flashes and its
edges disappear in plan order, then chain set-offs appear and the residual obligations fade,
until only the real PayPal transfers remain as edges (dashed green). Live counters during the
animation — debt cleared, cash moved, leverage (debt cleared / cash moved), invoices touched —
are computed from the plan at the current animation instant. Plain SVG + `requestAnimationFrame`
(circle layout, deterministic), ~7 s, with a **Replay** button.

**Files.**
- `apps/web/src/views/CollapseGraph.tsx` — new self-contained component.
- `apps/web/src/views/Settlement.tsx` — **Before → After** button in the round toolbar, opens a
  drawer with the graph; `collapseData` rebuilds the engine plan shape from the live `RoundView`.
- `apps/web/src/views/judge/JudgePage.tsx` — reuses the same graph for judge networks.

**Try it.** Desk → **Settlement** → plan/consent/execute a round → the round toolbar shows
**Before → After**. Press **Clear**: loops flash and fade in plan order, then chain payments
draw in; the counter strip ticks up (debt cleared, cash moved, leverage, invoices touched). Press
**Replay** to watch again.

---

## H. Judge mode

**What it does.** `#/judge` lets a visitor **Start your own network**: the server creates a
fresh, isolated network for that session (a six-business street + "You"), sandbox-only, max 20
per hour, auto-deleted after 2 h (`judge_sessions` table). The seeded debts almost close a loop
(open chain A→B→C→D→E→F→You). A QR code (new `qrcode` dep) links to `#/judge/phone/:token`,
a phone-sized page to add one invoice the visitor owes or is owed (counterparty from a dropdown,
amount). The desk view updates live over the existing SSE stream: the new invoice appears, the
engine finds the loop that includes "You", and the Clear animation (G) shows it cleared. Judge
networks run the engine and show the plan only — PayPal execution stays on the main demo network.
Landing page **Try it yourself** link → `#/judge`.

**Files.**
- `packages/db/src/schema.ts`, `packages/db/drizzle/0006_judge_sessions.sql`,
  `packages/db/drizzle/meta/_journal.json`, `packages/db/drizzle/meta/0006_snapshot.json`,
  `packages/db/test/schema.test.ts` — `judge_sessions` table + migration.
- `apps/server/src/routes/judge.ts` — `POST /api/judge/network`, `GET /api/judge/network/:token`,
  `POST /api/judge/network/:token/obligations`; session expiry sweep, rate limit, isolated cleanup.
- `apps/server/src/app.ts` — registers `judgeRoutes`; `/api/judge/` is exempt from the demo write
  code gate (public sandbox, separate networks).
- `apps/web/src/views/judge/JudgePage.tsx`, `JudgePhonePage.tsx` — desk + phone pages.
- `apps/web/src/routes.ts` — `#/judge` and `#/judge/phone/:token` routes.
- `apps/web/src/AppV2.tsx` — lazy judge routes render before/without main-network bootstrap.
- `apps/web/src/api.ts`, `types.ts` — judge API + `JudgeNetwork`/`JudgeSessionInfo`.
- `apps/web/package.json` — added `qrcode` (+ `@types/qrcode`).
- `apps/web/src/landing/sections/TryItSection.tsx` — **Try it yourself** link.

**Try it.** Landing → **Try it yourself** (or `#/judge`) → **Start your own network**. Scan
the QR (or use **Open on your phone**). On the phone page pick I owe / a business owes me,
choose a counterparty, enter an amount, Add. Back on the desk view the street ledger updates live,
a banner reports the loop that now includes **You** (`N invoices, $X cleared with no money
moving`), and **Before → After** shows the loop clearing around you.

---

## I. Pull the plug, visibly

**What it does.** The demo desk already arms a crash after N PayPal records ("Pull the plug after
N PayPal records" + N input, `POST /api/demo/chaos`). On restart the existing recovery path runs
(`recordOnce` adopts payments already on PayPal; the invoice marker prevents paying twice), and a
new recovery banner is fed by **real** recovery results: a new read-only route computes, per plan
set-off, from the round plan + operation log + the live PayPal invoice, how many set-off payments
were **found already on PayPal**, **resumed**, **rolled back**, and **paid twice** (must be 0).
Payment/rollback logic is untouched.

**Files.**
- `apps/server/src/services/recovery.ts` — `computeRecovery` (read-only).
- `apps/server/src/routes/rounds.ts` — `GET /api/rounds/:id/recovery`.
- `apps/web/src/desk/DeskApp.tsx` — `RecoveryBanner` replaces the "Back online" line after a
  crash; shows the real counters and refreshes every 4 s.
- `apps/web/src/api.ts`, `types.ts` — `api.roundRecovery`, `RecoveryReport`.

**Try it.** Desk → **Settlement** (demo mode) → **Pull the plug**, set N (e.g. 1), **Arm the
crash**. Plan/consent/execute the next round; the server crashes right after PayPal accepts
set-off payment N. The desk shows the "crashed" banner, then the recovery banner on restart:
planned set-off payments, payments found already on PayPal, resumed, rolled back, and
**paid twice: 0**.

---

## J. Keep-alive for judging

**What it does.** A GitHub Actions workflow pings the Render health endpoint every 10 minutes
(cron) so the free-tier instance stays awake during judging; retries 3 times.

**Files.**
- `.github/workflows/keepalive.yml`.

---

## Verification

- `pnpm -r typecheck` — all 6 workspace projects pass (db, engine, executor, paypal, server, web).
- `pnpm -r test` — all pass: **7 test files, 64 tests** (was 61; +3 new showcase-2 tests in
  `apps/server/test/showcase2.test.ts` covering the PayPal-says route, the real recovery report,
  and the judge flow incl. the loop closing through "You").
- `pnpm --filter @untangle/web build` — succeeds (note: the pre-existing >500 kB chunk warning
  for `DeskApp`/AG Grid is unchanged and expected).

Nothing was committed.
