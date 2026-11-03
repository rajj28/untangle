# Untangle web, pass 3: the AI and agents UI

AI is now a headline feature.

An orchestrator agent runs each clearing cycle and hands work to specialist agents:
- **Discovery** searches every business's PayPal invoices.
- **Intake** reads photos, voice notes, PDFs and chats.
- **Invoicing** issues PayPal invoices through the PayPal Agent Toolkit.
- **Treasurer** agents, one per business, sign or hold under their owner's policy.
- **Watchdog** checks everything against PayPal.
- **Collections** sends reminders.

The server side is built in parallel. **The contract is `../../docs/AI-API.md`. Read it first and follow it exactly.**

## Rules

These carry over from `SPEC.md` and `SPEC-UI.md`:
- Strict TypeScript, `.ts`/`.tsx` import extensions, `import type` for types.
- Cents only at display; no polling (SSE invalidation); no `window.alert` / `confirm` / `prompt`.
- Mobile-first for the business experience; desktop-first for the desk.
- Use the existing design system in `src/ui/` (Button, Card, Sheet, StatusPill, Avatar, Segmented, EmptyState, Skeleton, CopyId, Money, Toasts) and the tokens in `src/index.css`. Match the look of `src/views/me/*` and `src/desk/*`.
- **Write only inside `apps/web/src` and `apps/web/test`.** Do not change `package.json`, configs or `index.html`. Install nothing.

## 1. Data layer

- **`src/types.ts`:** add the types from `AI-API.md`.
- **`src/api.ts`:** add a typed helper per route.
- **Access code.** When `config.writeProtected` is true, every POST sends `x-demo-token`.
  - The value comes from `localStorage` (`untangle-access-code`, wrapped in try/catch).
  - A 401 `ACCESS_CODE_REQUIRED` opens an "Enter demo access code" dialog (a Sheet with one input). Save the code and retry the request once.
  - A link `#/...?code=XYZ`, i.e. `?code=` in the hash query, stores the code automatically and removes it from the URL.
- **`src/live.ts`:**
  - On every successful `onopen` (including reconnects), invalidate all server queries. The server now replays missed events from `Last-Event-ID`, but stale caches must still refresh.
  - Handle the new events from `AI-API.md`:
    - `agent.*` invalidates `["agent-runs"]`, `["agent-run", runId]` and `["approvals"]`;
    - `evidence.*` and `claim.*` invalidate `["evidence"]`, `["obligations"]` and `["network"]`.
- **`src/paypal/sdk.ts`:** when a script load or `createInstance` rejects, remove its cached promise (and the failed `<script>` element), so a later attempt can retry without reloading the page.

## 2. Agent Console (`src/agents/`)

- A desk tab **Agents**, between Settlement and Network, lazy-loaded like the other desk views.
- A **Assistant** tab in the business experience's bottom bar: Home · Invoices · Assistant · Activity.

### `AgentConsole.tsx` (desk)

- **Header:**
  - title "Agents";
  - one line: "An orchestrator runs the clearing cycle and hands work to specialist agents. Each agent works on its own business's PayPal account through the PayPal Agent Toolkit.";
  - primary button **Run clearing cycle** (POST `/api/agents/cycle`), disabled while a run is `running`;
  - an AI status chip with the model name from `/api/ai/status`.
- **Body:** two panes on desktop; stacked on mobile.
  - **Runs list:** each run shows status, kind, start time, duration and its one-line summary. The latest run is selected by default.
  - **Run timeline:** the steps of the selected run, live.
    - Group consecutive steps by agent into **agent blocks**. Each block has the agent's icon and name, the business name when `businessId` is set, and a status (a spinner while it's the newest block of a running run).
    - Inside a block, render each step by kind:

| Kind | Rendering |
|---|---|
| `thought` | muted italic sentence |
| `tool_call` | a chip with the tool name. Tools starting with `paypal.` get a small PayPal badge and PayPal blue, plus a tooltip "Called through the PayPal Agent Toolkit". `untangle.*` tools get the brand color. |
| `tool_result` | a compact one-liner under its call |
| `decision` | a highlighted callout |
| `error` | red |
| `handoff` | a thin divider "→ handed to Treasurer agents" |

    - Pending approvals for that run appear inline at the point they were requested, using the `ApprovalCard` component.
    - When the run finishes, a summary card shows the run's `summary` and stats (e.g. invoices found, claims, signed, PayPal calls).
- **Agent identities:**

| Agent | Label | lucide icon |
|---|---|---|
| orchestrator | "Orchestrator" | `Workflow` |
| discovery | "Discovery" | `ScanSearch` |
| intake | "Intake" | `FileScan` |
| invoicing | "Invoicing" | `ReceiptText` |
| treasurer | "Treasurer" | `Landmark` |
| watchdog | "Watchdog" | `ShieldCheck` |
| collections | "Collections" | `BellRing` |
| explainer | "Explainer" | `Languages` |

- **Motion:** the newest step fades in (respect `prefers-reduced-motion`). Auto-scroll to the newest step while the user hasn't scrolled up; show "Jump to latest" when they have.

### `ApprovalCard.tsx` (shared)

- Contents: the agent icon, business avatar and name, title and detail. For `issue_invoice`, show a small table from the payload: debtor, amount, item, due date.
- Buttons: **Approve** (primary, or the PayPal variant when it sends something through PayPal) and **Reject** (ghost).
- After execution, show the result:
  - for `issue_invoice`: the invoice id via `CopyId`, and a "QR code" link if `result.qrCodeUrl` exists;
  - otherwise a short status line.
- `ApprovalsPanel.tsx` lists pending approvals for the network (desk) or for one business (Assistant). Its empty state: "Nothing waiting for you."

### Business Assistant (`src/views/me/BusinessAssistant.tsx`)

1. **AI treasurer card** (GET `/api/businesses/:id/advice`):
   - the summary sentence;
   - up to 3 recommendations with urgency pills (now = amber, soon = blue, fyi = muted);
   - each recommendation's action button navigates or acts:
     - `sign_statement` opens the statement sheet;
     - `pay_checkout` opens the PayDialog for that transfer;
     - `review_approval` scrolls to the approval;
     - `upload_evidence` focuses the upload.
   - Refresh button.
   - Label it "AI treasurer · {model}" with a note: "Suggestions only — nothing happens until you approve."
2. **Add a debt with AI:**
   - A drop zone and a button with `accept="image/*,audio/*,application/pdf,text/plain"`. On mobile the button offers camera or file.
   - Also **Try a sample**: a horizontal list from `/api/demo/evidence-samples` (handwritten bill photo, Spanish voice note, PDF invoice, chat screenshot, email). Choosing one fetches its `url` and uploads it as if picked.
   - Read the file to base64 (FileReader). Limit 8 MB with a friendly error.
   - POST `/api/evidence` (it takes 5–20 s). Show a progress state: "Reading your evidence with Gemini…".
   - Show the result card:
     - the evidence preview: an image thumbnail, an `<audio controls>`, a PDF icon, or the text;
     - the detected language and summary;
     - each claim: "Rosa's Bakery owes Rossi Mill $3,000.00 · Bread flour…", a confidence meter, the quote in a quote style, and any warnings, e.g. "Amount corrected from 600 to 650 in a later message";
     - each claim's linked approval as an `ApprovalCard` ("Send a $3,000 PayPal invoice to Rosa's Bakery").
3. **Approvals** for this business (`ApprovalsPanel`).
4. **What the agents did for you:** the latest cycle's steps where `businessId` is this business, as a compact list linked to the full run in the desk.

## 3. Explain my statement

In the statement sheet (`src/views/me/*` and the desk statement drawer), add **Explain in plain words**:
- a language select with English, Español, Français, हिन्दी, 中文 and Português, defaulting to the browser language when it is one of those;
- POST `/api/rounds/:id/statements/:businessId/explain`;
- render the headline, paragraphs and an "What to do next" list;
- a small "Written by Gemini from your signed statement. Amounts are checked against the statement." note.

## 4. Ask the ledger (AG Grid AI Toolkit)

Above the Ledger grid, add a prompt bar: "Ask the ledger… e.g. 'invoices Corner Cafe owes over $500, largest first'".

On submit:
1. `const schema = gridApi.getStructuredSchema(); const state = gridApi.getState();`
   - Check the method names in `node_modules/ag-grid-community` / `ag-grid-enterprise` typings. They may need options; follow the types.
   - If the method doesn't exist, hide the bar and write that in your report.
2. POST `/api/ai/grid { question, schema, state }`.
3. `gridApi.setState(response.gridState)`, then show the `explanation` as an inline message with **Undo** (restore the previous state).

Also add 3 suggestion chips under the bar.

## 5. Tests (`test/`)

- The access-code helpers: storing the code from the hash query, and adding the header.
- Grouping steps into agent blocks (a pure function in `src/agents/timeline.ts`).
- The tool chip classifier (`paypal.*` vs `untangle.*`).
- Urgency → pill mapping.

## Done means

- Every new file compiles under the existing `tsconfig` (you can't run commands; be meticulous with types).
- **Report:** the files you wrote or changed, any deviations from this spec, and anything you're unsure about. Note especially whether `getStructuredSchema` exists in the installed AG Grid.
