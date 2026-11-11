import type { Loop } from "@untangle/engine";

export interface Config {
  mode: "sandbox" | "sim";
  demo: boolean;
  networkId: string | null;
  currency: string;
  paypalSdkUrl: string | null;
  agGridLicenseKey: string | null;
  /** Writes need the demo access code (x-demo-token). */
  writeProtected: boolean;
}

export interface BusinessSummary {
  id: string;
  name: string;
  email: string;
  owesMinor: number;
  owedMinor: number;
  netMinor: number;
}

export interface NetworkSummary {
  network: { id: string; name: string; currency: string };
  businesses: BusinessSummary[];
  totals: {
    obligations: number;
    owedMinor: number;
    outstandingMinor: number;
    settledMinor: number;
    clearedByLoopsMinor: number;
    settledByChainsMinor: number;
    movedMinor: number;
  };
  latestRound: { id: string; status: string } | null;
}

export interface ObligationView {
  id: string;
  debtorId: string;
  debtorName: string;
  creditorId: string;
  creditorName: string;
  description: string | null;
  amountMinor: number;
  outstandingMinor: number;
  currency: string;
  status: string;
  paypalInvoiceId: string | null;
  protected: boolean;
  dueOn: string | null;
  debtorConfirmedAt: string | null;
  creditorConfirmedAt: string | null;
  disputeReason: string | null;
}

export interface RoundStats {
  totalOwed: number;
  clearedByLoops: number;
  settledByChains: number;
  moneyMoved: number;
  leverage: number | string | null;
}

export interface SetoffView {
  obligationId: string;
  debtorId: string;
  creditorId: string;
  amountMinor: number;
  status: string;
  paypalPaymentId: string | null;
}

export interface TransferLegView {
  obligationId: string;
  position: number;
  amountMinor: number;
  status: string;
  paypalPaymentId: string | null;
}

export interface TransferView {
  id: string;
  roundId?: string;
  payerId: string;
  payeeId: string;
  amountMinor: number;
  currency: string;
  instrument: string | null;
  status: string;
  paypalOrderId: string | null;
  paypalCaptureId: string | null;
  payoutBatchId: string | null;
  payoutItemId: string | null;
  legs: TransferLegView[];
}

export interface StatementBody {
  roundId: string;
  businessId: string;
  networkId: string;
  currency: string;
  planHash: string;
  netBefore: number;
  netAfter: number;
  setoffs: {
    obligationId: string;
    invoiceId: string;
    role: "creditor" | "debtor";
    counterpartyId: string;
    amountMinor: number;
    outstandingBeforeMinor: number;
    remainingAfterMinor: number;
  }[];
  pays: { transferId: string; payeeId: string; amountMinor: number }[];
  receives: { transferId: string; payerId: string; amountMinor: number }[];
  passThrough: { transferId: string; obligationId: string; role: "creditor" | "debtor"; amountMinor: number }[];
  totals: { clearedMinor: number; paysMinor: number; receivesMinor: number };
}

export interface RoundView {
  id: string;
  networkId: string;
  status: string;
  planHash: string | null;
  stats: RoundStats | null;
  setoffs: SetoffView[];
  transfers: TransferView[];
  statements: { businessId: string; statementHash: string; body: StatementBody }[];
  consents: { businessId: string; method: string; createdAt: string | Date }[];
  pendingConsents: string[];
  heldForConfirmation: { obligationId: string; missingSide: "debtor" | "creditor" }[];
  heldForFraudReview: { loopId: string; reasons: string[]; memberIds: readonly string[] }[];
  replanned: { brokeLoops: Loop[]; newLoops: Loop[] } | null;
}

export interface RoundListItem {
  id: string;
  status: string;
  createdAt: string;
  planHash: string | null;
  stats: RoundStats | null;
}

export interface BusEvent {
  seq: number;
  stream: string;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

export interface ObligationHistory {
  obligation: ObligationView;
  setoffs: {
    roundId: string;
    amountMinor: number;
    status: string;
    paypalPaymentId: string | null;
    createdAt: string;
  }[];
  legs: {
    transferId: string;
    roundId: string;
    payerId: string;
    payeeId: string;
    instrument: string | null;
    transferStatus: string;
    amountMinor: number;
    status: string;
    paypalPaymentId: string | null;
  }[];
}

export interface AuditResult {
  ok: boolean;
  count: number;
  brokenSeq?: number;
  reason?: string;
}

export interface ApiErrorBody {
  error?: string;
  code?: string;
  message?: string;
  debugId?: string;
}

// ── AI / Agents ────────────────────────────────────────────────────────────

export type AgentName =
  | "orchestrator"
  | "discovery"
  | "intake"
  | "invoicing"
  | "treasurer"
  | "watchdog"
  | "collections"
  | "explainer";

export interface AgentRun {
  id: string;
  kind: "cycle" | "intake" | "discovery" | "watchdog" | "collections";
  goal: string;
  status: "running" | "waiting" | "completed" | "failed";
  summary: string | null;
  stats: Record<string, number>;
  startedAt: string;
  finishedAt: string | null;
}

export interface AgentStep {
  seq: number;
  runId: string;
  agent: AgentName;
  businessId: string | null;
  kind: "thought" | "tool_call" | "tool_result" | "handoff" | "decision" | "message" | "error";
  title: string;
  detail: string | null;
  tool: string | null;
  at: string;
}

export interface Approval {
  id: string;
  runId: string | null;
  businessId: string;
  businessName: string;
  agent: AgentName;
  kind: "issue_invoice" | "import_invoices" | "send_reminder" | "pay_checkout";
  title: string;
  detail: string;
  payload: unknown;
  status: "pending" | "approved" | "rejected" | "executed" | "failed" | "blocked";
  result: unknown | null;
  blockedRule: string | null;
  blockedExcerpt: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface ClaimView {
  id: string;
  evidenceId: string | null;
  debtorId: string | null;
  debtorName: string;
  creditorId: string | null;
  creditorName: string;
  amountMinor: number;
  currency: string;
  item: string | null;
  dueOn: string | null;
  reference: string | null;
  confidence: number;
  quote: string | null;
  status: "open" | "matched" | "rejected";
  obligationId: string | null;
  approvalId: string | null;
}

export interface EvidenceView {
  id: string;
  businessId: string;
  kind: "image" | "pdf" | "audio" | "text";
  mime: string;
  fileName: string | null;
  size: number;
  status: "pending" | "extracted" | "failed";
  language: string | null;
  summary: string | null;
  warnings: string[];
  claims: ClaimView[];
  createdAt: string;
}

export interface Explanation {
  language: string;
  headline: string;
  paragraphs: string[];
  actions: string[];
  model: string;
}

export interface Advice {
  businessId: string;
  summary: string;
  model: string;
  recommendations: {
    title: string;
    reason: string;
    action: "sign_statement" | "pay_checkout" | "send_payouts" | "review_approval" | "upload_evidence" | "none";
    targetId: string | null;
    urgency: "now" | "soon" | "fyi";
  }[];
}

export interface EvidenceSample {
  id: string;
  title: string;
  kind: EvidenceView["kind"];
  mime: string;
  fileName: string;
  url: string;
  uploaderBusinessId: string;
}

export interface DisputeObligationPayload {
  byBusinessId: string;
  claimedAmountMinor: number;
  reason: string;
}

export interface DisputeRunResponse {
  runId: string;
}

export interface ConfirmView {
  obligationId: string;
  side: "debtor" | "creditor";
  businessId: string;
  businessName: string;
  debtor: { id: string; name: string };
  creditor: { id: string; name: string };
  amountMinor: number;
  currency: string;
  description: string | null;
  status: string;
  disputeReason: string | null;
  debtorConfirmed: boolean;
  creditorConfirmed: boolean;
  evidenceSummary: string | null;
}

export interface ConfirmLinks {
  obligationId: string;
  debtorToken: string;
  creditorToken: string;
}

export interface NetPositionVerifyResult {
  networksChecked: number;
  millis: number;
  maxAbsDelta: number;
  minCashPassed: number;
  minCashTotal: number;
}

export interface PaypalPaymentView {
  method: string | null;
  type: string | null;
  amountMinor: number | null;
  date: string | null;
  note: string | null;
}

export interface PaypalSays {
  obligationId: string;
  connected: boolean;
  status: string | null;
  amountMinor: number | null;
  dueDate: string | null;
  payerViewUrl: string | null;
  payments: PaypalPaymentView[];
}

export interface RecoveryReport {
  roundId: string;
  plannedPayments: number;
  paymentsFoundAlreadyOnPaypal: number;
  paymentsResumed: number;
  paymentsRolledBack: number;
  paidTwice: number;
}

export interface JudgeSessionInfo {
  token: string;
  networkId: string;
  youBusinessId: string | null;
  qrPayload: string;
}

export interface JudgeNetwork {
  network: NetworkSummary;
  obligations: ObligationView[];
  youBusinessId: string | null;
  expiresAt: string;
}
