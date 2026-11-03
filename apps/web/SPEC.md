# @untangle/web: the Clearing Desk

The web app that judges see. It is one screen where small businesses watch their debts untangle:
- loops cancel with no money moving;
- what's left settles in a few PayPal payments;
- every invoice flips in place the moment PayPal confirms.

It is also our entry for the AG Grid sponsor prize, so it must use AG Grid Enterprise deeply and well.

Read first:
- `../../docs/ARCHITECTURE.md` §2, §3, §9 and §13.
- `../server/SPEC.md` and `../server/SPEC-2.md`. These define the API you call; the server is being extended in parallel exactly as specified there.
- `../server/src/services/*.ts`, for the exact response shapes.

## Hard rules

1. Write only inside `apps/web/`. Don't change `package.json`, `tsconfig.json`, `vite.config.ts` or `index.html`; they are set up. Install nothing.
   - Packages available: React 19.3, AG Grid 36.2 (`ag-grid-community`, `ag-grid-enterprise`, `ag-grid-react`), TanStack Query 5, Tailwind CSS 4 (via `@tailwindcss/vite`), `lucide-react` icons, Vitest 5.
2. Strict TypeScript.
   - `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are on.
   - Use `.ts`/`.tsx` import extensions and `import type` for types.
   - Function components and hooks only. No `any`.
3. **AG Grid 36:**
   - Register `AllEnterpriseModule` once:
     ```ts
     import { ModuleRegistry } from "ag-grid-community";
     import { AllEnterpriseModule, LicenseManager } from "ag-grid-enterprise";
     ModuleRegistry.registerModules([AllEnterpriseModule]);
     ```
   - Call `LicenseManager.setLicenseKey(key)` only when `/api/config` returns a key.
   - Style with the **Theming API**: `themeQuartz.withParams({...})` plus `colorSchemeLight`/`colorSchemeDark` parts, passed as the `theme` prop. Never import legacy theme CSS.
   - Current option names:
     - `cellSelection: true`;
     - `rowSelection: { mode: "singleRow" | "multiRow" }`;
     - `treeData` with `getDataPath`;
     - `masterDetail` with `detailCellRenderer` and `isRowMaster`;
     - `getRowId`;
     - `enableCellChangeFlash` on column definitions;
     - `statusBar`, `sideBar`;
     - `pivotMode`, and `rowGroup`/`pivot`/`aggFunc` on columns.
   - When unsure, read the type definitions under `node_modules/ag-grid-community` and `node_modules/ag-grid-enterprise`. They are the source of truth for v36.
4. **Money:** amounts arrive as integer cents. Format only at display: `Intl.NumberFormat("en-US", { style: "currency", currency })`. Use `tabular-nums` everywhere numbers line up.
5. **No polling.**
   - Data loads once through TanStack Query.
   - Live changes come from the SSE stream at `GET /api/stream`. On each event, invalidate the affected queries, debounced to 150 ms.
   - Use `staleTime: Infinity` for server data, because SSE invalidation keeps it fresh.
6. **No `window.alert`, `window.confirm` or `window.prompt`.** Use in-app dialogs and toasts.
7. **Never show secrets.** The PayPal client id and the AG Grid key are public by design. Nothing else sensitive reaches the browser.

## Files

```
src/main.tsx            module registration, QueryClient, <App/>
src/index.css           @import "tailwindcss"; design tokens (CSS variables), light and dark
src/types.ts            API response types (mirror the server exactly)
src/api.ts              typed fetch helpers. Non-2xx → ApiError { status, code, message } from the JSON body
src/money.ts            formatMoney(cents, currency), formatCompact, percent
src/events.ts           describeEvent(event, names): one short human sentence per known event type
src/round-rows.ts       pure: RoundView + business names → tree rows for the Settlement grid
src/live.ts             useLiveEvents(): EventSource + debounced query invalidation + in-memory feed (last 300)
src/theme.ts            AG Grid themes (light and dark) from the tokens
src/App.tsx             layout, header, tabs, "acting as", theme toggle
src/components/*.tsx    Header, LeverageMeter, StatusPill, MoneyCell, ProgressCell, Toasts, Dialog, Drawer, Empty, Skeleton
src/views/Ledger.tsx      Ledger grid + master/detail history
src/views/Settlement.tsx  round workspace: stepper, stat tiles, tree grid, consent panel, pay actions
src/views/Matrix.tsx      pivot heatmap
src/views/Activity.tsx    event feed + audit verification
src/paypal/PayDialog.tsx  PayPal v6 checkout (sandbox) or simulated approval (sim mode)
src/paypal/sdk.ts         loads the v6 script once, creates one SDK instance per client id
public/favicon.svg        a small knot mark
test/*.test.ts            Vitest unit tests for the pure modules
```

## Data and API

Mirror these shapes in `types.ts`. They come from the server code; read it.
- `Config`, from `GET /api/config`.
- `NetworkSummary`, from `GET /api/networks/:id`.
  - `totals`: `obligations`, `owedMinor`, `outstandingMinor`, `settledMinor`, `clearedByLoopsMinor`, `settledByChainsMinor`, `movedMinor`.
  - each business: `id`, `name`, `email`, `owesMinor`, `owedMinor`, `netMinor`.
- `ObligationView[]`, from `GET /api/networks/:id/obligations`, now including `description`.
- `RoundView`, from `GET /api/rounds/:id`. `POST /api/networks/:id/rounds` creates one and returns 201.
- Rounds list, from `GET /api/networks/:id/rounds`.
- Events, from `GET /api/events?limit=300` (initial feed), then SSE.
- Obligation history, from `GET /api/obligations/:id/history`.
- Actions:
  - `POST /api/rounds/:id/consents` `{ businessId }`;
  - `POST /api/rounds/:id/execute`;
  - `POST /api/transfers/:id/order` → `{ orderId, clientId, amountMinor, currency }`;
  - `POST /api/transfers/:id/capture` `{ orderId }`;
  - `POST /api/rounds/:id/payouts` `{ payerId }`;
  - `POST /api/rounds/:id/payouts/refresh`;
  - `POST /api/demo/reset`;
  - `GET /api/audit/verify`;
  - simulator only:
    - `POST /api/sim/transfers/:id/approve`;
    - `POST /api/sim/transfers/:id/payout/:status`.

**SSE.** `EventSource("/api/stream")`. Each message has `event: <type>` and `data: BusEvent { seq, stream, type, payload, at }`.
- Listen with `onmessage` and also `addEventListener` for every type you handle. Named events don't reach `onmessage`, so the simplest robust approach is a small list of known types plus a generic handler.
- Invalidation map, debounced (150 ms):

| Event | Invalidate |
|---|---|
| any | `["network"]`, `["events"]` |
| `obligation.*`, `round.*`, `transfer.*`, `setoffs.*`, `chain.*`, `network.seeded`, `demo.reset` | `["obligations"]`, `["round"]`, `["rounds"]` |
| `transfer.*`, `chain.*` | open obligation-history queries too |

- Reconnects are automatic. Show a small "Live" dot in the header: green when connected, amber when reconnecting.

## Design

Calm, precise, trustworthy fintech, the opposite of a template dashboard.

- **Palette.** Neutral zinc surfaces, with one brand accent, deep teal (`#0F766E`), for Untangle actions and "settled".
  - Status colors:
    - invoiced: slate;
    - partially settled: amber;
    - settled: teal/emerald;
    - cancelled: muted gray, strikethrough;
    - failed / needs attention: red;
    - pending PayPal: blue.
  - **PayPal blue (`#0070E0`) only on PayPal actions.**
  - Define everything as CSS variables in `index.css`, with a dark set under `.dark` on `<html>`. Toggle in the header and remember it in `localStorage` (wrapped in try/catch).
- **Type.** System UI stack (`ui-sans-serif, system-ui, "Segoe UI", Roboto, …`). Large numbers in the header and tiles use `tabular-nums` and tight tracking. Ids (invoice, order, capture) are monospace, shortened in the middle (`INV2-8F3K…Q2LM`), with a copy button.
- **Density.** Grids show 28–32 px rows and are the hero of every view. Chrome around them is minimal. Spacing follows a 4 px scale.
- **Motion.** Number count-up on the leverage meter (300 ms, respects `prefers-reduced-motion`), AG Grid cell flash on changes, and nothing else gratuitous.
- **Layout.**
  - Header bar, then a tab strip (Ledger · Settlement · Matrix · Activity), then the view filling the viewport height. Grids fill the remaining height; no page scroll on desktop.
  - On narrow screens (<900 px), stack panels and let grids have a fixed 60vh height.
- **Empty and loading states.** A skeleton while loading. A friendly empty state with the next action ("Plan a settlement round").

### Header
- **Left:** the knot mark and "Untangle", then the network name and a business count ("Main Street · 9 businesses").
- **Center:** the **leverage meter**.
  - Big: `leverage = (clearedByLoopsMinor + settledByChainsMinor) / movedMinor`, shown as `12.8×`. If `movedMinor` is 0 and something was cleared, show `∞`; if nothing was cleared, show `—`.
  - Caption: "of invoices settled per $1 moved through PayPal".
  - Beneath it, one line: `$28,100 owed · $24,000 cleared by loops · $4,100 by chains · $2,200 moved`.
- **Right:**
  - mode badge: "PayPal Sandbox", or "Simulator" in amber;
  - Live dot;
  - **Acting as** select: "Operator (everyone)" plus each business;
  - Reset demo button (only when `config.demo`), which opens a confirm dialog: "Archive all invoices and create a fresh Main Street?";
  - theme toggle.

**"Acting as"** filters every view to that business:
- the Ledger shows only its invoices;
- Settlement highlights its rows and shows only its own sign and pay actions;
- a one-line strip under the header reads "Corner Cafe · owes $4,750 · is owed $3,250 · net −$1,500".

## Views

### Ledger (AG Grid, client-side row model)

**Rows:** obligations. `getRowId = id`.

**Columns:**

| Column | Notes |
|---|---|
| Status | `StatusPill` renderer; set filter; flash on change |
| From (debtor) | set filter |
| To (creditor) | set filter |
| Description | flex |
| PayPal invoice | mono, shortened, copy button |
| Amount | right-aligned money |
| Outstanding | money plus a thin progress bar showing settled %; flash on change |
| Due | date, plus "in 12 days" / "3 days late" in muted text |

**Features:**
- quick filter search box above the grid;
- `sideBar: ["columns", "filters"]`;
- row grouping by dragging (`rowGroupPanelShow: "always"`);
- `cellSelection: true`;
- `statusBar` with `agTotalAndFilteredRowCountComponent` and `agAggregationComponent`;
- an Excel export button (`exportDataAsExcel`, file name `untangle-ledger-YYYY-MM-DD.xlsx`).

**Master/detail.** Each row expands to a custom `detailCellRenderer`: a compact timeline from `/api/obligations/:id/history`.
- "Set off in round 3f9a… · −$2,400 · PayPal payment EXTR-…"
- "Chain payment Corner Cafe → Sparkle Cleaning (PayPal checkout, committed) · −$400 · EXTR-…"
- It fetches when expanded and refetches on relevant SSE events.

### Settlement (the hero view)

**Round selection.**
- The current round is `latestRound` from the summary. A small "History" menu lists earlier rounds (`/api/networks/:id/rounds`) to view them.
- If there is no round, or the latest is `closed` or `failed`, show a hero card: "N open invoices worth $X. Plan a settlement round" → POST → show it.

**Round header:**
- a stepper: Planned → Consent (k of n) → Executing → Settling → Closed;
- `failed` shows red with the reason from the latest `round.failed` / `round.needs_attention` event in the feed;
- the plan hash, shortened, with copy;
- 5 stat tiles: Total owed · Cleared by loops (no money moved) · Settled by chains · Moved through PayPal · Leverage. Use `stats` from the round.

**Tree grid** (AG Grid `treeData`, `getDataPath`). Rows come from `round-rows.ts`:
- **Group "Loops — cleared with no money moving".** Its auto-group label shows the count and the total. Children are the set-offs:
  - From → To, description, invoice;
  - amount cleared;
  - status (pending / recorded / failed / compensated);
  - PayPal payment id.
- **Group "Chains — settled by N PayPal payments".** Its label shows the money moved. Children are the transfers:
  - Payer → Payee, amount, instrument, status;
  - PayPal refs: order, capture, or payout batch/item;
  - an **Actions** cell (below).
  - Each transfer's children are its legs: From → To, description, invoice, amount, status, PayPal payment id.
- `groupDefaultExpanded: -1`, `getRowId` from a stable path key, `enableCellChangeFlash` on status columns. `autoGroupColumnDef` uses an `innerRenderer` that shows icons (loop or chain) and readable labels.
- When "acting as" is set, `rowClassRules` softly highlight rows that involve that business.

**Consent panel.** A side panel on wide screens; below the grid on narrow ones.
- One card per business in `statements`:
  - name;
  - "cleared $… · pays $… · receives $…", from that statement's `totals`;
  - state: "Signed ✓ 14:02" or "Waiting".
- Buttons:
  - "View statement" opens a Drawer with the statement body laid out readably (set-offs, pays, receives, pass-through) and the full statement hash.
  - "Sign as {name}": demo consent, enabled when acting as Operator or as that business.
  - When acting as Operator and some are unsigned, "Sign all (demo)" signs sequentially.
- After the last signature the server executes by itself. Show "Recording set-offs on PayPal invoices…" until `round.setoffs_recorded`, `round.failed` or `round.needs_attention` arrives.
- If the round is still `executing` after 8 s, show an "Execute now" button that POSTs `/execute`.

**Actions cell** on transfer rows, only when the round is `settling`. Show actions to Operator, or to the payer when acting as a business.
- Status `ready` or `awaiting_payer`:
  - **"Pay $1,000 with PayPal"** (PayPal blue) opens `PayDialog`;
  - **"Send via Payouts"** (outline) POSTs `/api/rounds/:id/payouts` `{ payerId }`. It pays every eligible transfer of that payer at once; say so in a tooltip.
- Status `pending_paypal` with instrument `payouts`:
  - "Refresh from PayPal" POSTs `/payouts/refresh`;
  - in sim mode, also small buttons "Simulate success" and "Simulate failure" (`/api/sim/transfers/:id/payout/SUCCESS` and `/FAILED`).
- `committed`: a teal check with "Paid · CAP-…" or "Paid · payout item …".
- `failed` / `unwound`: red text and the reason.

**`PayDialog`:**
- Title: "Pay Sparkle Cleaning Co $1,000.00".
- Body: "This one PayPal payment settles 4 invoices along the chain:" and the legs as a mini list (From → To, amount).
- **Sandbox mode** (`config.paypalSdkUrl` set):
  1. On open, `POST /api/transfers/:id/order` → `{ orderId, clientId }`.
  2. `loadPayPalSdk(config.paypalSdkUrl)` injects `<script async src=…>` once and resolves when `window.paypal` exists.
  3. `sdk = await window.paypal.createInstance({ clientId, components: ["paypal-payments"] })`. Cache one instance per clientId.
  4. `const eligibility = await sdk.findEligibleMethods(); if (!eligibility.isEligible("paypal"))` show an error.
  5. `session = await sdk.createPayPalOneTimePaymentSession({ onApprove, onCancel, onError })`.
  6. Render a `<paypal-button>` custom element inside the dialog. On its click: `session.start({ presentationMode: "auto" }, Promise.resolve({ orderId }))`. Pass the promise; don't await before `start`, because the browser needs the click's activation.
  7. `onApprove({ orderId })` → `POST /api/transfers/:id/capture { orderId }`, then show "Paid. Recording on 4 PayPal invoices…" and close when the transfer turns `committed` (SSE).
  8. `onCancel`: a quiet "Payment cancelled". `onError(err)`: an error toast with `err.message`.
  9. Declare minimal types for `window.paypal`, the session and `<paypal-button>` in `src/paypal/sdk.ts` (a `declare global` with `JSX.IntrinsicElements["paypal-button"]`). Keep the types honest: only what you call.
- **Sim mode:** instead of the PayPal button, a "Simulate PayPal approval" button → `POST /api/sim/transfers/:id/approve`, with the note "Simulator: no real PayPal".

### Matrix (pivot heatmap)
- AG Grid with `pivotMode: true` over obligations that aren't `cancelled`:
  - `rowGroup` debtor name ("Who owes");
  - `pivot` creditor name ("…to whom");
  - value `sum(outstandingMinor)`, formatted as money;
  - `pivotRowTotals: "after"`, `grandTotalRow: "bottom"`.
- Heatmap through a `cellStyle` that scales the teal background alpha by the value ÷ the max value. Zero cells stay blank.
- Toggle: Outstanding / Original amount.
- Caption: "A loop is a cycle in this matrix — debts that run around back to where they started. Untangle finds every one across the whole network and cancels it on the PayPal invoices."

### Activity
- **Feed:** the initial `GET /api/events?limit=300`, plus live SSE events appended (dedupe by `seq`). Newest at the top.
- **Rows:**
  - time;
  - a type badge colored by family (round, transfer, setoffs, chain, obligation, network, demo);
  - the human sentence from `describeEvent`;
  - expandable raw payload, as pretty JSON in a mono block.
- **Header:** "Verify audit chain" → `GET /api/audit/verify` → "✓ 214 events — tamper-evident hash chain intact", or the broken seq and reason in red.

## Errors and toasts
- Every mutation shows a pending state on its button (spinner, disabled).
- Errors show a toast with the server `message` and `code`. 409 `ROUND_IN_PROGRESS` and similar read as plain sentences.
- PayPal errors (502 `PAYPAL_ERROR`) include `debugId` in small mono text, because PayPal support needs it.

## Tests (`test/*.test.ts`)
- **money:** formatting of 0, 5, 123456 and negatives.
- **describeEvent:** a sentence for each known type, plus the fallback.
- **round-rows:** for a fixed RoundView fixture with 3 set-offs and 2 transfers (with 1 and 2 legs):
  - the paths, the group totals, and that leg rows nest under their transfer;
  - stable row ids.
- **leverage helper:** the normal value, ∞, and —.

## Done means
- `pnpm typecheck` passes with zero errors. Vitest and Vite's bundler may not run in your sandbox; I run `pnpm build` and `pnpm test`.
- **Report:**
  - the files written;
  - any deviation from this spec and why;
  - anything you are unsure about, especially AG Grid v36 option names you couldn't confirm from the type definitions.

**How to run it** (for your reference; I do this outside the sandbox): `pnpm --filter @untangle/server dev:sim` (port 3000) and `pnpm --filter @untangle/web dev` (port 5173, which proxies `/api`).
