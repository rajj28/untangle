# AG GRID — CHANGES

This change set makes AG Grid (36.2 Enterprise) do real work in Untangle: it is now the
control surface of the clearing engine, not decoration. Four features were built across the
web app, the Fastify server, and the engine package. No PayPal logic, server PayPal adapters,
or anything under `video/` was touched.

## Feature 1 — What-if scenario (Ledger view)

`apps/web/src/views/Ledger.tsx`

A "What-if" toggle turns the invoice ledger into an editable copy of the current invoices. It
never mutates the real data or the server — edits live only in React state.

- **What-if toggle** in the ledger toolbar.
- While active, the grid shows:
  - an **Include** checkbox column (custom `IncludeCell` renderer) — uncheck an invoice to
    exclude it from clearing;
  - the **amount** column becomes editable (`agNumberCellEditor`);
  - **undo / redo** buttons powered by `undoRedoCellEditing` (limit 20);
  - a **Reset scenario** button.
- On every `cellValueChanged` (or include toggle), the real engine from
  `packages/engine` (`planSettlement` + new `findLoops`) re-runs on the scenario invoices.
- A pinned strip above the grid shows the results as **actual → scenario** with delta for
  loops found, debt cleared, cash needed, and leverage. Changed amount cells flash
  (`enableCellChangeFlash`).
- All numbers come from the engine; none are fabricated.

## Feature 2 — City Desk: server-side row model

Server: `apps/server/src/routes/desk.ts`, `apps/server/src/app.ts`
Web: `apps/web/src/views/desk/CityView.tsx`, `apps/web/src/desk/DeskApp.tsx`,
`apps/web/src/routes.ts`, `apps/web/src/api.ts`

- New Fastify route **POST `/api/desk/rows`** registers alongside the other routes and
  implements the AG Grid **server-side row model** request shape:
  `startRow`, `endRow`, `rowGroupCols`, `groupKeys`, `valueCols` (sum/count), `sortModel`,
  and `filterModel` (text + number). It returns `{ rows, lastRow }`.
- Data is a deterministic synthetic city of **10,000 businesses / 60,000 invoices**
  generated once from a fixed seed and cached in memory. The engine runs once over it; every
  invoice carries a stored `cleared` amount and `loopId`.
- All **grouping, sorting, filtering, and aggregation are done on the server** — not in the
  browser.
- New **City** tab in the desk (`rowModelType="serverSide"`), grouped by **sector → business**,
  with aggregated columns (**owed, cleared by loops, cash needed**) and a totals strip
  (overall owed / cleared / cash / leverage) loaded from the synthetic city.
- The desk POST is a read-only computation, so it is exempt from the demo write-access gate
  (same spirit as the webhook allow-list) so the City tab works even when a demo code is set.

## Feature 3 — Charts that explain the result (Settlement view)

`apps/web/src/views/SettlementAnalysis.tsx`, `apps/web/src/views/Settlement.tsx`

- **Integrated charts**: the settlement grid (and the analysis grid) enable `enableCharts`.
  A **“Chart it”** button opens an analysis drawer whose grid calls `api.createRangeChart`
  (grouped column) over **debt cleared vs cash moved per loop / payment** (loops come from
  the engine via `findLoops`; payments come from the round).
- **Sparkline column** on per-business rows (`agSparklineCellRenderer`, bar series) showing
  net position **before → after** clearing (owed → cleared → cash paid → received → net).
  Rows are built from real statement totals + obligation data.

## Feature 4 — Audit pack export (Settlement view)

`apps/web/src/views/Settlement.tsx` (`AuditPack`)

- **“Export audit pack”** button uses `api.exportMultipleSheetsAsExcel` +
  `api.getSheetDataForExcel` to build one workbook with:
  - a **Summary** sheet (grand total + per-business totals), and
  - **one sheet per business statement** — invoices, set-offs, PayPal invoice IDs, and cash
    paid.
- Numbers are currency-formatted through `excelStyles` (`numberFormat` `$#,##0.00`).
- Export works by filtering one hidden, off-screen grid per sheet (client-side row model),
  then collecting per-sheet data and emitting the multi-sheet workbook.

## Engine support

- `packages/engine/src/loops.ts` (new): `findLoops` — exact decomposition of the cleared
  flow into cycles, shared by the what-if scenario and the settlement charts.
- `packages/engine/src/index.ts`: exports `findLoops` and the `Loop` type.

## Files changed

- `packages/engine/src/loops.ts` (new)
- `packages/engine/src/index.ts`
- `packages/engine/test/engine.test.ts` (added `findLoops` tests)
- `apps/server/src/routes/desk.ts` (new — city data + SSRM request handling)
- `apps/server/src/app.ts` (register `deskRoutes`; exempt `/api/desk/` from write gate)
- `apps/server/test/desk.test.ts` (unit tests + a route-level HTTP test)
- `apps/web/src/routes.ts` (`DeskView` and `DESK_VIEWS` include `"city"`)
- `apps/web/src/api.ts` (`deskRows` client method)
- `apps/web/src/views/desk/CityView.tsx` (new)
- `apps/web/src/desk/DeskApp.tsx` (City tab + lazy import + render)
- `apps/web/src/views/Ledger.tsx` (what-if scenario)
- `apps/web/src/views/SettlementAnalysis.tsx` (new — charts + sparkline)
- `apps/web/src/views/Settlement.tsx` (Chart it drawer + audit export)
- `packages/db/test/schema.test.ts` (updated expected table list to the current schema —
  `agent_runs`, `approvals`, and `networks` were present in the schema but missing from the
  test's expected list; this was a pre-existing failure, unrelated to this feature work)

## How to try it

### What-if scenario (Ledger)
1. Open the app → Desk → **Ledger** tab.
2. Click **What-if** in the toolbar.
3. The grid becomes an editable copy: an **Include** checkbox column appears on the left and
   the **Amount** cells become editable.
4. Double-click an amount and change it, or uncheck an invoice.
5. The pinned strip above the grid recomputes **loops found / debt cleared / cash needed /
   leverage** as `actual → scenario` with a delta, using the real engine on the edited set.
6. Use **Undo** / **Redo** to step edits, or **Reset scenario** to restore the original
   invoices. Toggle **What-if** off to return to the live ledger (nothing is written to the
   server).

### City Desk (server-side row model)
1. Open the app → Desk → **City** tab.
2. The grid loads via `rowModelType="serverSide"`; expand **Sector → Business** groups.
3. Try sorting numeric columns and typing into the text/number filters — every request hits
   the server (`POST /api/desk/rows`), which does the grouping/sorting/filtering/aggregation.
4. The totals strip at the top shows overall owed / cleared / cash / leverage for the
   10,000-business synthetic city.

### Charts (Settlement)
1. Desk → **Settlement** → plan a round (or open an existing one).
2. Click **Chart it**.
3. The drawer shows an integrated grouped-column chart of **debt cleared vs cash moved per
   loop/payment**, and a **Business positions** table with sparklines showing each business's
   position before → after clearing.

### Audit pack (Settlement)
1. Desk → **Settlement** → open any round.
2. Click **Export audit pack**.
3. A workbook downloads with a **Summary** sheet plus one sheet per business statement
   (invoices, set-offs, PayPal invoice IDs, cash paid), currency-formatted.

## Verification

- **Typecheck** — `pnpm -r typecheck` (root): all 6 workspace projects pass (exit 0).
- **Tests** — `pnpm -r test` (root): all pass.
  - `@untangle/executor`: 14/14
  - `@untangle/paypal`: 65/65
  - `@untangle/engine`: 16/16 (includes new `findLoops` tests)
  - `@untangle/db`: 24/24
  - `@untangle/web`: 45/45
  - `@untangle/server`: 48/48 (includes city desk unit tests + a route-level HTTP test)
- **Web build** — `pnpm --filter @untangle/web build` (vite): succeeds (exit 0). Note: the
  existing "chunk larger than 500 kB" warning for the desk bundle is pre-existing (AG Grid
  Enterprise is large); it is a warning, not an error.

Nothing was committed. No AI attribution was added.
