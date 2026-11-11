# Untangle

An AI clearing house for small-business debts on PayPal.

## The problem

Small businesses owe each other in loops: the bakery owes the mill, the mill owes the trucker, and the trucker owes the bakery. Each one waits on another to get paid before paying out, so cash sits stuck in the middle of the local economy. No single business can see the whole loop, so nobody can clear it.

## How it works

1. AI intake turns informal debt records into PayPal invoices. Dockets, PDFs, photos, voice notes, and chat exports are read by a Gemini model and become structured claims (both sides of each debt).
2. Both sides confirm the amount. If the two versions differ, the negotiation agents work out an agreed figure; a debt is real only once both parties agree on it, and it becomes a PayPal invoice.
3. The engine cancels debt loops by set-off. Loops are identified inside the debt graph and cancelled with no money moving, recorded on each PayPal invoice as an external payment via `POST /v2/invoicing/invoices/{id}/payments` with method `OTHER`.
4. What remains is settled in chains. The leftover debts are decomposed into chains that run from net debtors to net creditors, and each chain is settled with one real PayPal payment: Orders v2 plus the JS SDK v6 checkout (the "pay my net" button), or Payouts under a signed treasurer policy for auto-settle.
5. Webhooks, refunds, and disputes unwind a chain. A chain counts as settled only once PayPal confirms the payment; a refund or a lost dispute reverses it, reopens the obligations, and the next round re-plans.

## Demo numbers

- Main Street demo town: 25 invoices, $28,100 owed, settled with $2,200 of PayPal payments, for 12.8x settlement leverage.
- City mode, run in the browser: a 10,000-business / 60,000-invoice network solved in about 1.1 seconds.

## PayPal APIs used

| API | What Untangle uses it for |
| --- | --- |
| Invoicing | The record of every debt: create, send, search, remind, record external set-off payments, delete external payments, QR codes. |
| Orders v2 | The chain-settling checkout order for a debtor's "pay my net" payment. |
| JS SDK v6 | The PayPal button in the browser that a payer approves. |
| Payouts | Auto-settle: a treasurer agent pays a business's net debt to several creditors in one batch. |
| Webhooks | The signals to commit or unwind a chain (invoices, captures, payout items, disputes). |
| Payments v2 | Capture details for evidence and handling refunds. |
| Disputes | Submit the signed chain record as evidence when a settlement payment is disputed. |
| Transaction Search | Agents read the business's history to find trading partners and choose timing; also used for reconciliation. |
| PayPal Agent Toolkit | The treasurer agents' PayPal tools, scoped to each business's own token. |

## AI agents

Agents run on Gemini Flash models with their own tool loop in `apps/server/src/ai/agent.ts`:

- orchestrator: planning and coordinating a settlement round.
- discovery: reads PayPal history to map trading partners and suggest invites.
- intake: turns evidence (PDF, photo, voice, chat) into structured claims.
- invoicing / approvals: drafts PayPal invoices and routes them for approval.
- treasurer: checks balances and proposes or executes payments under a signed policy.
- insight: explains statements and answers "ask-the-ledger" questions inside the AG Grid.
- watchdog: monitors webhooks, reconciliations, and failure states.
- collections: follows up on overdue invoices.
- negotiation: reaches agreed amounts between the two sides of a debt.

No agent can move money directly. Agents propose; the engine decides; owners sign; the executor executes against PayPal.

## Tech stack

Node + TypeScript, Postgres (Neon) via drizzle, React 19, AG Grid 36 Enterprise, TanStack Query, Tailwind CSS 4, Vite, Vitest.

## Live demo

https://untangle-5isb.onrender.com (PayPal sandbox, free Render plan; the first load after idle can take about 50 seconds).

## Run it locally

Prerequisites: Node 22+ and pnpm.

```
pnpm install
```

Simulator mode (no credentials required):

```
pnpm --filter @untangle/server dev:sim
pnpm --filter @untangle/web dev
```

Real PayPal sandbox:

1. Copy `.env.example` to `.env`.
2. Fill in the sandbox values (Neon Postgres, master key, Gemini key, AG Grid trial key, PayPal app credentials).
3. Verify and seed, then run:

```
pnpm --filter @untangle/server check
pnpm --filter @untangle/server seed
pnpm --filter @untangle/server dev
```

Tests:

```
pnpm test
```

## Repo layout

- packages/engine: pure settlement math (loops and chains), no I/O.
- packages/paypal: typed PayPal client.
- packages/executor: set-off saga, chain payments, commits, unwind.
- packages/db: schema, migrations, seed data.
- apps/server: Fastify API, AI agents, engine, webhooks.
- apps/web: React + AG Grid Clearing Desk.
- video: demo assets.

## License

MIT.
