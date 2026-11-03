# Untangle AI and agents: API contract

The server (`apps/server`) and the web app (`apps/web`) both follow this contract.

Money is integer cents. Dates are `YYYY-MM-DD`. Timestamps are ISO strings. Ids are uuids unless noted.

## Types

```ts
type AgentName = "orchestrator" | "discovery" | "intake" | "invoicing" | "treasurer" | "watchdog" | "collections" | "explainer";

interface AgentRun {
  id: string; kind: "cycle" | "intake" | "discovery" | "watchdog" | "collections";
  goal: string; status: "running" | "waiting" | "completed" | "failed";
  summary: string | null; stats: Record<string, number>;
  startedAt: string; finishedAt: string | null;
}

interface AgentStep {
  seq: number;                 // event-log sequence (orders steps; also the SSE id)
  runId: string;
  agent: AgentName;
  businessId: string | null;   // whose PayPal account / statement the step is about
  kind: "thought" | "tool_call" | "tool_result" | "handoff" | "decision" | "message" | "error";
  title: string;               // one short human line, e.g. "Searched Corner Cafe's PayPal invoices"
  detail: string | null;       // optional longer text (rationale, result summary)
  tool: string | null;         // "paypal.list_invoices" (PayPal Agent Toolkit) or "untangle.plan_round" (ours)
  at: string;
}

interface Approval {
  id: string; runId: string | null;
  businessId: string; businessName: string;
  agent: AgentName;
  kind: "issue_invoice" | "import_invoices" | "send_reminder" | "pay_checkout";
  title: string;               // "Send a $3,000.00 PayPal invoice to Rosa's Bakery"
  detail: string;              // why, in plain words
  payload: unknown;
  status: "pending" | "approved" | "rejected" | "executed" | "failed";
  result: unknown | null;      // e.g. { invoiceId, qrCodeUrl? } after execution
  createdAt: string; decidedAt: string | null;
}

interface ClaimView {
  id: string; evidenceId: string | null;
  debtorId: string | null; debtorName: string;
  creditorId: string | null; creditorName: string;
  amountMinor: number; currency: string;
  item: string | null; dueOn: string | null; reference: string | null;
  confidence: number;          // 0..1
  quote: string | null;        // verbatim snippet, or "0:12–0:18" for audio
  status: "open" | "matched" | "rejected";
  obligationId: string | null; approvalId: string | null;
}

interface EvidenceView {
  id: string; businessId: string;
  kind: "image" | "pdf" | "audio" | "text"; mime: string; fileName: string | null; size: number;
  status: "pending" | "extracted" | "failed";
  language: string | null; summary: string | null; warnings: string[];
  claims: ClaimView[]; createdAt: string;
}

interface Explanation { language: string; headline: string; paragraphs: string[]; actions: string[]; model: string }

interface Advice {
  businessId: string; summary: string; model: string;
  recommendations: {
    title: string; reason: string;
    action: "sign_statement" | "pay_checkout" | "send_payouts" | "review_approval" | "upload_evidence" | "none";
    targetId: string | null;   // transfer id, approval id or round id the action applies to
    urgency: "now" | "soon" | "fyi";
  }[];
}

interface EvidenceSample { id: string; title: string; kind: EvidenceView["kind"]; mime: string; fileName: string; url: string; uploaderBusinessId: string }
```

## Routes

Writes need the `x-demo-token` header when `/api/config` says `writeProtected: true`.

| Method & path | Body | Returns |
|---|---|---|
| GET `/api/ai/status` | | `{ enabled: boolean, model: string \| null }` |
| POST `/api/agents/cycle` | `{ networkId }` | 202 `{ runId }`. The orchestrator runs in the background. |
| GET `/api/networks/:id/agents/runs` | | `AgentRun[]`, newest first, at most 20 |
| GET `/api/agents/runs/:id` | | `{ run: AgentRun, steps: AgentStep[], approvals: Approval[] }` |
| GET `/api/networks/:id/approvals?status=pending` | | `Approval[]`, newest first |
| POST `/api/approvals/:id/approve` | | `Approval` (executed or failed, with `result`) |
| POST `/api/approvals/:id/reject` | | `Approval` |
| POST `/api/evidence` | `{ businessId, fileName, mime, dataBase64 }`, ≤ 8 MB decoded | 201 `EvidenceView` |
| GET `/api/networks/:id/evidence` | | `EvidenceView[]`, newest first |
| GET `/api/evidence/:id` | | `EvidenceView` |
| GET `/api/evidence/:id/file` | | raw bytes with the original content type |
| GET `/api/demo/evidence-samples` | | `EvidenceSample[]` (`url` points to the sample file) |
| POST `/api/rounds/:id/statements/:businessId/explain` | `{ language }` (BCP-47, e.g. `es`) | `Explanation` |
| GET `/api/businesses/:id/advice` | | `Advice` |
| POST `/api/ai/grid` | `{ question, schema, state }` (AG Grid `getStructuredSchema()` / `getState()`) | `{ gridState, explanation }` |
| POST `/api/obligations/:id/dispute` | `{ byBusinessId, claimedAmountMinor, reason }` | 202 `{ runId }`. The two businesses' treasurer agents negotiate in a run of kind `negotiation`; the invoice is `disputed` until they agree or hand it to the owners. |

After an `issue_invoice` approval executes, its `result` may carry `qrDataUrl` (`data:image/png;base64,…`), the PayPal QR code a customer scans to pay.

AI routes return 503 `AI_UNAVAILABLE` when no Gemini key is configured, and 429 when rate limited.

## Live events (SSE `/api/stream`)

Payloads carry the ids needed to invalidate queries.

| Event | Payload | Notes |
|---|---|---|
| `agent.run_started` | `{ runId, kind, goal }` | |
| `agent.step` | `AgentStep` | without `seq`; use the SSE event's `seq` |
| `agent.approval_requested` | `{ runId, approvalId, businessId, kind, title }` | |
| `agent.approval_decided` | `{ approvalId, status }` | |
| `agent.run_finished` | `{ runId, status, summary }` | |
| `evidence.extracted` | `{ evidenceId, businessId, claims: number }` | |

## Verify a round on PayPal

`POST /api/rounds/:id/verify` → `202 { runId }`

Runs the Watchdog on its own as an agent run of kind `verify`: it re-reads every invoice the round touched from
PayPal (through each creditor's own Agent Toolkit `get_invoice`), compares the amount due with Untangle's records,
counts duplicate `[untangle:…]` payment markers, and lists disputes on the accounts that received chain payments.
`409 ROUND_NOT_EXECUTED` while the round is still `planned` or `consenting`.

## Demo: pull the plug

`POST /api/demo/chaos` with `{ "afterRecords": 1..50 }` → `{ armed, afterRecords }` (demo mode only).
The next set-off writes count down; after that many, the server emits `demo.crashed` and exits with code 75.
`pnpm --filter @untangle/server supervise` restarts it, as a host like Render would. On start, queued jobs
resume and any agent run left `running` is marked `failed` ("Interrupted by a server restart").
