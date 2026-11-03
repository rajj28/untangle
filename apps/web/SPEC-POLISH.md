# Untangle web: AI features and polish

Four features plus small polish, built against `../../docs/AI-API.md`. Read it first.

## Scope

- **Write only these files:**
  - `src/views/me/*`
  - `src/views/Ledger.tsx`
  - `src/views/Settlement.tsx` (its statement drawer only)
  - `src/desk/DeskApp.tsx` (module registration only)
  - `src/agents/ApprovalCard.tsx`
  - `src/api.ts`, `src/types.ts`
  - `test/*`
- **Never touch:** `src/landing/`, `src/views/network/`, `src/AppV2.tsx`, `src/routes.ts`. Others are editing those.
- **TypeScript is strict:** `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `.ts`/`.tsx` import extensions, `import type` for types.
- **Reuse** the components in `src/ui/` and match the existing style. No `window.alert`, `confirm` or `prompt`. Install nothing.

## 1. Explain in plain words (statement sheets)

Wherever a business's round statement is shown (the business home's statement sheet in `src/views/me/`, and the desk statement drawer in `Settlement.tsx`), add an **Explain in plain words** block:
- a language select: English (en), Español (es), Français (fr), हिन्दी (hi), 中文 (zh), Português (pt). Default to `navigator.language` when it's one of those, otherwise English;
- a button that calls `api.explainStatement(roundId, businessId, language)`. It takes 5–15 s, so show "Writing your explanation…";
- render the `headline` (bold), the `paragraphs`, then "What to do next" as a list of `actions`;
- a small note: "Written by Gemini from your signed statement. Every amount is checked against it.";
- errors show a toast plus an inline "Try again".

## 2. Ask the ledger (AG Grid AI Toolkit), in `src/views/Ledger.tsx`

1. In `src/desk/DeskApp.tsx`, where `ModuleRegistry.registerModules([AllEnterpriseModule])` runs, also register `AiToolkitModule` from `ag-grid-enterprise`, if `AllEnterpriseModule` doesn't already include it. Check the type definitions in `node_modules/ag-grid-enterprise`.
2. Above the grid, add a prompt bar: an input with the placeholder "Ask the ledger… e.g. invoices Corner Cafe owes, largest first" and a submit button with a `Sparkles` icon.
3. On submit:
   - `const schema = gridApi.getStructuredSchema(/* params per the typings */); const state = gridApi.getState();`
   - `api.aiGrid({ question, schema, state })`
   - `gridApi.setState(result.gridState)`
   - Show `result.explanation` in a slim inline banner with **Undo**, which restores the previous state with `setState(previous)`.
4. Show 3 suggestion chips under the bar:
   - "Invoices Corner Cafe owes, largest first"
   - "Only partially settled invoices"
   - "Group by creditor"
5. Show a loading state while waiting; on failure, show a toast and keep the grid unchanged.

Read the exact method names and parameter types from `node_modules/ag-grid-enterprise` and `node_modules/ag-grid-community`. **Don't guess.**

## 3. Dispute an amount (business Invoices view, `src/views/me/BusinessInvoices.tsx`)

In the invoice detail sheet, for invoices the current business **owes** (it is the debtor) with status `invoiced` or `partially_settled`, add a **Dispute the amount** button. It opens a small form inside the sheet:
- "The amount we agreed": a money input in dollars, converted to cents;
- "What happened": a textarea of at most 300 characters;
- **Send to the agents**, which calls `api.disputeObligation(obligationId, { byBusinessId, claimedAmountMinor, reason })` (POST `/api/obligations/:id/dispute`, which returns `{ runId }`).

On success:
- show the toast "Your treasurer and theirs are negotiating from the evidence.";
- add a link "Watch the negotiation" to `#/desk/agents`.

Add the helper and types to `api.ts` and `types.ts`.

## 4. QR code in approval results (`src/agents/ApprovalCard.tsx`)

When `approval.kind === "issue_invoice"` and `approval.result.qrDataUrl` is a string, show the image (160 × 160, rounded, white padding) with the caption "Scan to pay with PayPal".

## 5. Polish

- In the business home, the signed state shows two check marks ("✓ Signed ✓ 5:21 PM"). Show one.
- Remove any user-facing jargon ("minor units", "obligation"). Say "invoice" and "amount".

## Done means

- Everything compiles under the strict config. You can't run commands; be meticulous.
- **Report:** the files changed, the exact AG Grid methods and modules you used and where you confirmed them, and anything you're unsure about.
