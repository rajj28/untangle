# Untangle web, pass 2: production-grade, mobile-first UI

The Clearing Desk works end to end against the real PayPal sandbox:
- 22 set-offs recorded;
- 3 PayPal payments;
- the round closed at 12.8× leverage.

Now make it something a small-business owner understands in ten seconds on a phone, and something judges remember. Every rule in `SPEC.md` still applies:
- strict TypeScript;
- AG Grid 36 Theming API;
- cents only at display;
- no polling, SSE invalidation;
- no window dialogs;
- no secrets.

Write only inside `apps/web/`, with one exception: **do not edit anything under `src/views/network/`**. Another worker is building the network graph there in parallel. Use its default export through the props in `src/views/network/NetworkView.tsx`.

Packages are installed (including `d3-force`, which is for the network worker). Install nothing.

## 1. Two experiences, one app

Hash routing, no router library:
- `#/me` → business picker;
- `#/me/<businessId>` → "My business" home, plus sub-routes `#/me/<businessId>/invoices` and `#/me/<businessId>/activity`;
- `#/desk/<ledger|settlement|network|matrix|activity>` → the Clearing Desk.

The first visit picks a default:
- viewport width < 768 px goes to `#/me`, or `#/me/<id>` if a business was remembered (`localStorage`, wrapped in try/catch);
- otherwise `#/desk/settlement`.

Both experiences link to each other: "Open desk" / "View as a business".

### 1a. "My business": mobile-first, the owner's view

Design at 375 px first, then let it grow into a centered 560 px column on desktop.

- **Business picker.** Untangle intro line, then a list of the network's businesses as large tappable rows:
  - an avatar with initials and a stable color from a hash of the id;
  - the name;
  - the net position, colored: owes in amber, is owed in teal, settled in muted.
  - Footnote: "Demo: in production each business signs in with PayPal."
- **Home** (`#/me/<id>`), top to bottom:
  1. **Position card:** "You owe $4,750 · You're owed $3,250", then big "Net −$1,500" with one plain sentence: "If everyone settled today, you'd pay $1,500 in total."
  2. **This round card,** only when the latest round involves this business (it has a statement):
     - a compact stepper;
     - "Cleared with no money moving: $6,500 of your invoices";
     - "You pay: $1,500 to settle the rest" or "You receive: $1,000";
     - CTA **Review & sign**, shown when consent is pending for this business. It opens the **statement sheet**:
       - plain-language lines built by a pure function `statementLines(body, names, currency)` in `src/statement.ts`, e.g. "Your invoice to Rosa's Bakery ($400) is cleared by set-off — no money moves";
       - "You pay Sparkle Cleaning Co $1,000 with PayPal. This one payment also settles 2 other invoices along the chain";
       - pass-through lines explained as "settled on your behalf";
       - the statement hash, shortened, with copy;
       - **Sign statement** (demo consent). After signing: "Signed ✓ 5:21 PM".
     - If the round is closed, a short "Settled ✓" summary instead.
  3. **Payments card,** for each transfer where this business is the payer in a `settling` round:
     - **Pay $1,000 with PayPal** opens the PayDialog as a full-height bottom sheet on mobile;
     - secondary **Send via Payouts**;
     - status with PayPal reference once paid.

     For each transfer where this business is the payee: "Sparkle Cleaning Co receives $1,000 from Corner Cafe," with its status.
  4. **Recent activity** for this business: the last 5 events whose payload mentions it or its transfers, with a link to all activity.
- **Invoices** (`/invoices`): segmented control "You owe · Owed to you · Settled". Card list sorted by outstanding, each card showing:
  - counterparty and description;
  - amount and outstanding, with a thin "% settled" bar;
  - a status pill.

  Tapping a card opens a sheet with the obligation history timeline (`/api/obligations/:id/history`) and the PayPal invoice id with copy.
- **Activity** (`/activity`): human sentences grouped by day.
- **Bottom tab bar** (fixed, safe-area aware): Home · Invoices · Activity. Desktop shows the same tabs inline at the top.

**This experience must not load AG Grid.** Lazy-load every desk view with `React.lazy` + `Suspense`, so the `#/me` bundle stays small. Report the gzipped size of the entry chunk in your report.

### 1b. Clearing Desk: desktop-first, responsive

Keep the four existing views. Add **Network** (lazy `src/views/network/NetworkView.tsx`, receiving `{ obligations, businesses, round, actingAs, currency }`) between Settlement and Matrix.

| Width | Layout |
|---|---|
| ≥ 1024 px | Today's layout, polished. |
| 640–1023 px | The consent panel moves below the grid; the header collapses secondary items into a menu sheet. |
| < 640 px | Desk tabs become a horizontally scrollable tab strip. The Ledger shows the same card list as 1b's Invoices. Settlement shows stacked sections (stat tiles 2-up, loops list, chains with legs as cards, consent cards). The Matrix keeps the grid with a pinned first column. |

## 2. Design system (`src/ui/`)

Build small, typed components and use them everywhere:
- `Button`: primary, secondary, ghost, danger and **paypal** variants, plus sm/md/lg sizes. Each has a loading spinner and a min height of 44 px on touch (`@media (pointer: coarse)`).
- `Card`
- `Sheet`: a bottom sheet under 768 px and a right drawer above. It has a focus trap, closes on Esc, has a close button and an `aria-labelledby` title, and locks body scroll.
- `Stepper` (compact | full)
- `StatTile`
- `Money` (tabular-nums; a sign option for net)
- `StatusPill` (all statuses, with an icon plus text, never color alone)
- `Avatar`
- `Segmented`
- `EmptyState`
- `Skeleton`
- `Toasts` (stack bottom-center on mobile, bottom-right on desktop)
- `CopyId` (shortened mono id plus a copy button with "Copied" feedback)

**Tokens in `index.css`:**
- **Type scale:** 12 / 14 / 16 / 20 / 28 / 40, with body 14 on desktop and 16 on mobile.
- **Spacing:** a 4 px scale.
- **Radii and shadows:** 2 levels each.
- **Focus ring:** 2 px, brand color, `:focus-visible` only.
- **Contrast:** WCAG AA for all text in light and dark, including muted text on surfaces.
- **Dark mode:** real dark surfaces, not inverted. Keep both AG Grid themes in sync with it.
- **Motion:** 150–250 ms ease-out. Keep the count-up on the leverage number. Nothing else moves without a reason, and everything respects `prefers-reduced-motion`.

## 3. Fix list (all required)

1. Remove the "Balances shown in minor units from PayPal invoices" text. Replace it with a small "Live from PayPal" indicator that reuses the SSE status dot.
2. The progress cell says "% open" while the bar shows the paid share. Make the label and the bar agree as "% settled".
3. The Ledger side bar is collapsed by default (still available on its edge).
4. The quick-filter input's icon overlaps the placeholder. Fix the padding.
5. **The PayDialog overflowed horizontally and clipped the PayPal button at ~1450 px wide.** No horizontal overflow at any width from 320 to 1920. The PayPal button is always fully visible: below the legs list on narrow widths, beside it on wide ones.
6. Settlement grid:
   - drop the duplicate "From → To" column (the group column already says it);
   - pin the Actions column right and size it so buttons never clip;
   - keep the PayPal blue only on PayPal actions.
7. Leverage meter:
   - while a round is not closed, show the current value with the label "so far", and the plan's value "12.8× when this round completes" as a secondary line;
   - when closed, "Round complete · 12.8×".
8. Header on narrow widths: logo, leverage pill and a menu button. The menu sheet holds mode badge, live status, "acting as", reset demo and theme.
9. Make every async state explicit:
   - loading skeletons;
   - empty states with a next action;
   - error states with retry;
   - mutation buttons that disable and show progress.
10. The Activity view uses `describeEvent` sentences; group them by round with sticky day headers.

## 4. First-run explainer

A dismissible "How Untangle works" card on the picker and the desk (remembered in localStorage):
1. "Your invoices live in PayPal."
2. "Untangle finds loops — debts that cancel out — and clears them with no money moving."
3. "What's left is settled with the fewest PayPal payments: one payment can settle a whole chain of invoices."

Keep it short; final copy may be revised later.

## 5. Accessibility

- Landmarks (`header`, `nav`, `main`).
- Each view has a heading.
- Tabs use `role="tablist"` with arrow-key navigation.
- Every icon-only button has an `aria-label`.
- Live regions announce toast text and "Paid ✓" confirmations.
- Touch targets are ≥ 44 px on coarse pointers.
- Dialogs and sheets trap focus and return it when they close.

## 6. Tests (`test/`)

Keep every existing test. Add:
- **route parsing:** each route form and the default-by-width rule (pure function);
- **`statementLines`:** set-off creditor, set-off debtor, pays, receives, pass-through, totals;
- **`businessPosition(obligations, id)`:** owes, owed and net, ignoring cancelled obligations;
- **leverage label:** in-progress vs closed, ∞ and —.

## Done means

- `pnpm typecheck` passes with zero errors. Vite and Vitest may not run in your sandbox; I run `pnpm build` and `pnpm test` and take screenshots at 375, 768 and 1440 px.
- **Report:**
  - the files changed;
  - every deviation from this spec and why;
  - the entry-chunk sizes if you could measure them;
  - anything you're unsure about.
