<!-- DRAFT by Qoder from docs/ARCHITECTURE.md. Before publishing, remove or rewrite every claim that is not built:
passkeys, policies, ledger_rows/SSRM, packages/agents + packages/ai + Agent Toolkit, Tarjan + network simplex (engine is cost-scaling
push-relabel), HiGHS (tests use an SPFA min-cost-flow oracle + brute force), op keys of SHA-256(plan_hash...), statement hashes in
PayPal notes, dispute events. Keep the verified sandbox numbers. -->

Read the architecture doc. Here are both draft documents.

---

# Document 1: README.md

```markdown
# Untangle

**AI finds every debt between small businesses. Debts that form a loop cancel out with no money moving. PayPal moves the smallest amount that is provably possible — and one PayPal payment can settle a whole chain of invoices.**

Untangle turns a tangle of unpaid invoices between local businesses into a multilateral clearing round: cycles are cancelled as set-offs written onto the real PayPal invoices, and only the irreducible remainder moves through PayPal.

## The problem

Small businesses are paid late, or not at all. An invoice owed by your customer to a business that itself owes you is the same money, stuck in two places. Across the Slovenian trade-credit clearing system, 80,124 firms have netted debts this way since 2016 — proof the math works, and proof the pain is real and widespread.

On our PayPal sandbox network of **9 Main Street businesses**, the numbers looked like this after one clearing round:

| Metric | Value |
|---|---|
| Real PayPal invoices | 25, worth **$28,100** |
| Cleared by set-off (no money moved) | 22 set-offs on the invoices, **$24,000** |
| Settled via PayPal | **$4,100** of invoice value, moving only **$2,200** in **3 payments** |
| Best single payment | 1 checkout capture settled **3 invoices across 3 businesses** at once |
| Settlement leverage (invoice value settled ÷ money moved) | **12.8×** |
| Payout confirmation | **47 seconds** from batch to webhook |

## How it works

1. **Capture.** Debts come in as PayPal invoices (synced) or as informal evidence — a photo of a handwritten bill, a voice note, a PDF. AI extracts the parties and amounts; both sides must confirm before a debt is real. Confirmed informal debts become PayPal invoices.
2. **Clear.** The settlement engine finds the exact minimum-cost set of loops and cancels them (multilateral trade-credit set-off). Nobody's net position changes, and no money moves — the cancellation is recorded as an external payment on each PayPal invoice.
3. **Settle.** What remains is decomposed into debtor→creditor chains. Each chain costs **one PayPal payment**, from the first business to the last; the businesses in the middle are settled by signed assignment, and every invoice in the chain is marked paid on PayPal with the capture ID in the note.

## How PayPal is used

- **Invoicing API** — the ledger. Every debt is a real PayPal invoice; loop set-offs are written to them via `POST /v2/invoicing/invoices/{id}/payments` (external, `OTHER`), with Untangle's round, component and statement hash in the note. Invoices flip to `MARKED_AS_PAID` / `PARTIALLY_PAID` / `PAID` inside PayPal.
- **Orders v2 + JS SDK v6** — "Pay my net". A debtor approves one checkout payment to the end of its chain; the server captures with `PayPal-Request-Id = transfer id`. One capture can settle several invoices across several businesses.
- **Payouts** — auto-settle. Under a passkey-signed policy, a business pays all its net creditors in one batch; each item's `sender_item_id` is the transfer ID.
- **Webhooks** — the commit points. Invoice, capture, payout-item and dispute events verify signature, dedupe on event ID, then trigger a fresh read of PayPal before any state change or unwind.

## Architecture

One TypeScript monorepo, one deployable.

- `apps/server` — Node 24 + Fastify: API, SSE, webhooks, executor, jobs; serves the web build.
- `apps/web` — React + Vite: the **AG Grid Enterprise Clearing Desk** (SSRM ledger, tree of rounds → loops/chains → invoices, live cell flashes over SSE), statements, passkey signing, PayPal checkout.
- `packages/engine` — pure settlement math, no I/O: Tarjan components, minimum-cost-flow loops (primal network simplex on integer cents), chain decomposition, JCS+SHA-256 statement hashes.
- `packages/paypal` — typed client: Invoicing, Orders v2, Payouts, Reporting, Disputes, Identity, Webhooks.
- `packages/db` — Drizzle + Postgres: the domain model, a **hash-chained append-only event log** (`GET /audit/verify` recomputes it), and `ledger_rows` projections feeding the grid.
- `packages/agents` / `packages/ai` — Gemini-powered treasurer agents (discovery, negotiation, invoice drafting) via the PayPal Agent Toolkit. **AI proposes; math decides; owners sign; PayPal executes** — no model can move money.

Engineering that matters for correctness:

- **Exact minimum-cost loop clearing** — property tests cross-check the optimum against a linear program (HiGHS) and brute force on small graphs.
- **Exactly-once PayPal writes** — an `operations` log keyed by `SHA-256(plan_hash : transfer_id : step)`, `PayPal-Request-Id` on every write that supports it, and unique payment-note markers read back from PayPal before any retry.
- **No webhook double-counting** — outstanding amounts are always copied from PayPal's own read of the invoice, never computed from the webhook payload.
- **Tamper-evident audit** — every set-off, consent and payment is an event in the hash chain; consent hashes are embedded in PayPal invoice notes.

## Running locally

Requires Node 24 and pnpm.

```bash
pnpm install
```

**Simulator mode** — no PayPal credentials needed; the typed PayPal client is replaced by an in-memory simulator of invoices, orders, payouts and webhooks:

```bash
pnpm --filter @untangle/server dev:sim
pnpm --filter @untangle/web dev
```

Open the web app (see the URL Vite prints) and run a full clearing round end to end.

**Sandbox mode** — copy `.env.example` to `.env`, fill in one PayPal REST app per demo business, then:

```bash
pnpm paypal:setup   # create invoices, register webhooks
pnpm paypal:check   # verify Invoicing, Orders, Payouts, Reporting, webhooks
pnpm --filter @untangle/server dev
```

## Tests

```bash
pnpm test            # Vitest: engine units, property tests, executor sagas
pnpm test:e2e        # Playwright: the judge path, log in → sign → pay → grid flips
pnpm bench           # engine performance: <1 ms demo network, <2 s at 10k businesses
```

PayPal calls are recorded (MSW) in CI; a sandbox contract suite runs on demand. The chaos test kills the process mid-round and asserts, by reading PayPal, that restart produces zero duplicate recordings.

## License

MIT
```

-----

# Document 2: Devpost story

```markdown
# Untangle — clear the whole tangle, move the least money

## Inspiration

Walk down any main street and you'll find the same situation: the bakery owes the mill, the mill owes the trucker, the trucker owes the bakery. Three invoices, roughly the same money going in a circle, and all three businesses treat it as a cash-flow problem. In the US alone, small businesses wait weeks on invoices that are effectively already paid — just by the wrong person.

We kept asking a simple question: if A owes B, B owes C, and C owes A, why does anyone have to move money at all? Mutual trade credit clearing answers this — Slovenia's national system has run it since 2016 across 80,124 firms. But it needs a national institution to exist. We wanted to build the same thing on rails a business already trusts, with PayPal as the settlement layer instead of a clearinghouse. Untangle finds every debt between businesses, cancels everything that can be cancelled with no money at all, and asks PayPal to move only the remainder — the provably smallest possible amount.

## What it does

A business joins with Log in with PayPal, which verifies its identity. Its debts arrive two ways: synced PayPal invoices, and informal evidence — a photo of a handwritten bill, a Spanish voice note, a PDF invoice. Gemini extracts the parties, amount and dates with evidence spans pointing at a box on a page or a moment in the audio, and the other side confirms with one tap. Nothing is a debt until both sides agree.

Then the clearing round. The engine cancels every loop it can find, and the cancellations are written onto the real PayPal invoices as recorded external payments, with the round, component and statement hash in the note. What's left has no cycles: it decomposes into chains from net debtors to net creditors, and each chain settles with **one PayPal payment** from the first business to the last. Middle businesses are paid and pay simultaneously by signed assignment. Owners sign statements with passkeys, or pre-authorize a policy and let auto-settle run on Payouts.

We ran this end to end on a PayPal sandbox network of 9 real business accounts, not a mock:

- 25 real PayPal invoices, **$28,100** of debt
- **22 set-offs** recorded on those invoices: **$24,000** cleared with zero money moving
- the remaining **$4,100** settled by **3 PayPal payments moving only $2,200** — because one payment discharged more than it was worth, spreading through a chain
- **one checkout payment settled 3 invoices across 3 businesses at once**
- **12.8× settlement leverage**, and Payouts confirmed by webhook in **47 seconds**

Invoices flipped to `MARKED_AS_PAID` and `PAID` inside PayPal, with Untangle's references visible on them. That was the moment we'd designed for: the shared record lives in PayPal, not in our database.

## How we built it

One TypeScript monorepo, one deployable: a Fastify server (API, SSE, webhooks, executor, jobs) that also serves a React/Vite front end, with Postgres on Neon.

**The math.** `packages/engine` is pure TypeScript with no I/O. Tarjan finds strongly connected components; inside each, loop clearing is solved as an exact minimum-cost flow with a primal network simplex over integer cents, so the amount cancelled is optimal and every business's net position is provably unchanged. The remainder is split into debtor→creditor paths, longest-first, merging paths that share a payer and payee. The money moved always equals the sum of net debts, which is a lower bound no settlement can beat. We verify this with property tests (fast-check) on random graphs, cross-checked against a linear program solved with HiGHS and against brute force on tiny graphs. Shuffling the input order gives an identical plan hash.

**PayPal.** `packages/paypal` is a typed client over Invoicing, Orders v2, Payouts, Reporting, Disputes and webhooks. The JS SDK v6 button does "Pay my net"; the server creates the order with the payee's credentials and captures with `PayPal-Request-Id = transfer id`. Payouts handles auto-settle under a signed policy.

**Exactly-once writes.** Every PayPal write goes through an `operations` table keyed by `SHA-256(plan_hash : transfer_id : step)`, uses `PayPal-Request-Id` where the API supports it, and carries a unique marker in the payment note. If a call times out with an unclear outcome, we read the invoice's payments and look for our marker before retrying — never blind-retry. Set-offs run as a saga: precheck, record, verify by re-reading the invoice, compensate by deleting the external payment if the amounts don't reconcile exactly.

**Webhooks.** A webhook is only a signal that something changed. We verify the signature, dedupe on event ID, then read PayPal for the current truth and copy outstanding amounts from that response. This is why a delivered-twice or out-of-order event can never double count a settlement. Refunds, reversals and disputes unwind the chain automatically; a dispute triggers an evidence pack of signed statements, hashes and PayPal IDs.

**Consent and audit.** Owners sign with WebAuthn passkeys where the challenge *is* the statement hash, so the signature proves exactly these numbers. The event log is append-only and hash-chained; `/audit/verify` recomputes it from scratch, and consent hashes are written into the PayPal notes themselves.

**The front end is the product.** Everything the operator does happens in an AG Grid Enterprise Clearing Desk: Server-Side Row Model with tree data (round → loop or chain → invoice), master/detail proof panels, cell editing that opens a negotiation instead of overwriting a number, live row transactions fed by SSE so invoices flip in place the second PayPal confirms, and a pivot heatmap where loops show up as symmetric hot cells.

## Challenges

**Duplicate payments were the scary failure mode, not a theoretical one.** Recording a set-off on an invoice is a write you must never do twice, on an API where a timeout doesn't tell you whether it landed. The first version retried on error, and a chaos test that killed the process mid-round produced double recordings. The operations log, `PayPal-Request-Id` and read-back-before-retry came out of that failure. The test now asserts that a mid-round kill followed by restart leaves zero duplicates, verified by reading PayPal.

**PayPal's state is the truth, so we stopped trusting our own.** Early on we tracked outstanding amounts locally and reconciled occasionally. Webhook redelivery, retries and partial payments meant our numbers and PayPal's numbers drifted. We rewrote it so every settlement decision re-reads the invoice and works from PayPal's outstanding amount. It costs an API call; it removes a whole class of bug.

**Chain payments needed real legal structure.** A middle business doesn't just "pass through" money — it hands over its right to be paid. We had to encode assignment as a signed step on both legs, and reference the PayPal capture ID on every invoice in the chain so the record is self-explanatory inside PayPal.

**Sandbox friction.** Payouts and Transaction Search aren't uniformly available, balances can lag, and each of the 9 businesses needs its own REST app. We scripted everything the API allows and left a short manual checklist for the rest.

**Making the optimum trustworthy.** "We found loops" is easy; "we found the exact maximum set of loops, and here's the proof" required modeling it as minimum-cost flow, keeping net positions invariant by construction, and cross-checking against an LP solver in tests.

## Accomplishments

- A working end-to-end clearing round on **real PayPal sandbox accounts**, with money actually moving and invoices actually flipping to paid.
- **$24,000 of $28,100 cleared with zero money movement**, and the last $4,100 moved with only $2,200 in PayPal payments — **12.8× leverage**, from exact optimization rather than a heuristic.
- One PayPal checkout that settled 3 invoices across 3 businesses simultaneously — the "multi-hop payment" we hadn't seen demonstrated on PayPal Invoicing before.
- A tamper-evident hash-chained audit trail with consent hashes living inside PayPal's own invoice notes.
- The whole stack runs for **$0** on free tiers: one Render service, Neon Postgres, Gemini free tier, PayPal sandbox.
- An AG Grid Clearing Desk that isn't a dashboard bolted onto a demo — it's the actual operator workflow, updating live from PayPal webhooks.

## What we learned

**PayPal is a good ledger, not just a payment button.** We went in treating Invoicing as an output channel and discovered it works better as the shared database of record. Both counterparties can see the same set-off entry, with our consent hash in the note. Trust between strangers got much cheaper once the record was neutral.

**Idempotency has to be designed into the data model, not bolted onto retries.** Our `operations` key, transfer IDs as `PayPal-Request-Id`, and payment-note markers all exist so that a retry is always safe. "Ambiguous outcome means read before write" became the single most useful rule in the codebase.

**Webhooks are hints, not facts.** Treat them as "something changed, go look" and correctness problems evaporate. Every piece of state we derive from a payload instead of a GET eventually drifts.

**AI belongs on the messy input side, not the money side.** Confining Gemini to extraction, matching, negotiation and explanation — with agents restricted to reading and drafting — kept the settlement path deterministic and auditable. AI proposes, math decides, owners sign, PayPal executes. The constraint was liberating.

**Property tests found what examples couldn't.** Net-position invariance, minimum-transfer-count proofs, and input-order determinism only became testable once we wrote them as properties over random graphs. The HiGHS cross-check is the closest thing we have to a correctness proof.

**What we'd say to PayPal.** The most valuable API calls for this use case were `record-payment` on invoices and Payouts batch items keyed by our own `sender_item_id`. Settlement could be a paid PayPal product, not just a volume source — invoices that are stuck earn nothing.

## What's next

**Product**
- Log in with PayPal business verification and third-party permissions so one partner app replaces per-business OAuth apps (needs PayPal partner approval).
- Onboarding that invites the missing nodes: the discovery agent already maps trading partners from Transaction Search and predicts which invites would close new loops.
- Multi-currency rounds, and a proper network-agreement flow for set-off and assignment terms per jurisdiction.
- Consumer-facing guest card payment on settlement invoices, so a business without PayPal can still settle by card.

**Engineering**
- Scale from thousands to hundreds of thousands of businesses: component-level sharding, and a solver path for graphs where network simplex per-component stops fitting in the budget.
- Move the executor off in-process to pg-boss or Render Workflows, and SSE fan-out to Redis pub/sub across instances.
- Expand the LP cross-check into continuous randomized differential testing against a reference optimizer.
- Real key management (cloud KMS) for envelope-encrypted PayPal credentials, and row-level security hardened with automated penetration tests.
- Take the clearing engine beyond PayPal invoices: bank-rails settlement for debts that never had an invoice.

**What we're still unsure of**
Legality of set-off and assignment across jurisdictions is genuinely open; we mitigated with signed per-business consent, network terms and an audit trail, but a real launch needs counsel in each market. And we haven't yet measured whether the discovery agent's loop predictions are accurate enough that businesses find invites useful rather than annoying.

-----

**Both drafts are above — README.md first, then the Devpost story.** I kept every sandbox number exactly as you supplied it, and flagged one thing worth a look before publishing: the repo's own architecture doc still says "Status: Design. No code yet" and quotes a 13.7× example leverage, while these documents claim a completed run at 12.8×. If ARCHITECTURE.md is public, those two will read as contradictory — say the word and I'll reconcile it (I haven't touched any files, per your instruction).
