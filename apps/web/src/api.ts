import type {
  Advice,
  AgentRun,
  AgentStep,
  ApiErrorBody,
  Approval,
  AuditResult,
  BusEvent,
  Config,
  EvidenceSample,
  EvidenceView,
  Explanation,
  DisputeObligationPayload,
  DisputeRunResponse,
  NetworkSummary,
  ObligationHistory,
  ObligationView,
  RoundListItem,
  RoundView,
  TransferView,
} from "./types.ts";
import type { GridState } from "ag-grid-community";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly debugId: string | null;

  constructor(status: number, code: string, message: string, debugId: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.debugId = debugId;
  }
}

// ── Demo access-code helpers ────────────────────────────────────────────────

const ACCESS_CODE_KEY = "untangle-access-code";

export function readAccessCode(): string | null {
  try {
    return localStorage.getItem(ACCESS_CODE_KEY);
  } catch {
    return null;
  }
}

export function saveAccessCode(code: string): void {
  try {
    localStorage.setItem(ACCESS_CODE_KEY, code);
  } catch {
    // Storage may be unavailable in restricted contexts; this is non-critical.
  }
}

/**
 * If the URL hash contains `?code=XYZ`, store the code and strip it from the
 * hash so it does not appear in the browser history.
 */
export function consumeCodeFromHash(): void {
  try {
    const hash = window.location.hash;
    const sep = hash.indexOf("?");
    if (sep === -1) return;
    const params = new URLSearchParams(hash.slice(sep + 1));
    const code = params.get("code");
    if (code === null) return;
    saveAccessCode(code);
    params.delete("code");
    const remaining = params.toString();
    const newHash = hash.slice(0, sep) + (remaining ? `?${remaining}` : "");
    window.location.replace(newHash || "#/");
  } catch {
    // If anything goes wrong here, silently skip.
  }
}

// ── Access-code dialog callback ─────────────────────────────────────────────
// The API layer calls this when it receives ACCESS_CODE_REQUIRED.
// AppV2 registers the actual handler.
let promptForAccessCode: (() => Promise<string | null>) | null = null;
export function registerAccessCodePrompt(fn: () => Promise<string | null>): void {
  promptForAccessCode = fn;
}

// ── JSON helpers ─────────────────────────────────────────────────────────────

async function readJson<T>(response: Response): Promise<T> {
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorBody = isErrorBody(body) ? body : {};
    const code = errorBody.code ?? errorBody.error ?? "API_ERROR";
    const message = errorBody.message ?? response.statusText ?? "The request could not be completed.";
    throw new ApiError(response.status, code, message, errorBody.debugId ?? null);
  }
  return body as T;
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function get<T>(path: string): Promise<T> {
  return readJson<T>(await fetch(path, { headers: { accept: "application/json" } }));
}

// Config is cached after first load to avoid async dependency in post().
let cachedConfig: Config | null = null;

async function post<T>(path: string, body?: unknown): Promise<T> {
  const config: Config = cachedConfig ?? await get<Config>("/api/config");
  cachedConfig = config;

  const buildHeaders = (token?: string): Record<string, string> => {
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (config.writeProtected && token !== undefined) headers["x-demo-token"] = token;
    return headers;
  };

  const doFetch = (token?: string) =>
    fetch(path, {
      method: "POST",
      headers: buildHeaders(token),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  const existingCode = config.writeProtected ? readAccessCode() : undefined;
  const response = await doFetch(existingCode ?? undefined);

  // If the server rejects our token, ask for the correct code and retry once.
  if (response.status === 401 && config.writeProtected) {
    const bodyJson: unknown = await response.json().catch(() => ({}));
    const code = isErrorBody(bodyJson) ? (bodyJson.code ?? bodyJson.error) : undefined;
    if (code === "ACCESS_CODE_REQUIRED") {
      const newCode = promptForAccessCode ? await promptForAccessCode() : null;
      if (newCode !== null) {
        saveAccessCode(newCode);
        const retried = await doFetch(newCode);
        return readJson<T>(retried);
      }
    }
  }

  return readJson<T>(response);
}

// ── Public API ────────────────────────────────────────────────────────────────

export const api = {
  // Core
  config: () => get<Config>("/api/config").then((c) => { cachedConfig = c; return c; }),
  networks: () => get<{ id: string; name: string; currency: string }[]>("/api/networks"),
  network: (id: string) => get<NetworkSummary>(`/api/networks/${id}`),
  obligations: (id: string) => get<ObligationView[]>(`/api/networks/${id}/obligations`),
  rounds: (id: string) => get<RoundListItem[]>(`/api/networks/${id}/rounds`),
  round: (id: string) => get<RoundView>(`/api/rounds/${id}`),
  events: (limit = 300) => get<{ events: BusEvent[] }>(`/api/events?limit=${limit}`),
  history: (id: string) => get<ObligationHistory>(`/api/obligations/${id}/history`),
  verifyAudit: () => get<AuditResult>("/api/audit/verify"),
  planRound: (networkId: string) => post<RoundView>(`/api/networks/${networkId}/rounds`),
  consent: (roundId: string, businessId: string) => post<RoundView>(`/api/rounds/${roundId}/consents`, { businessId }),
  execute: (roundId: string) => post<RoundView>(`/api/rounds/${roundId}/execute`),
  order: (transferId: string) => post<{ orderId: string; clientId: string; amountMinor: number; currency: string }>(`/api/transfers/${transferId}/order`),
  capture: (transferId: string, orderId: string) => post<TransferView>(`/api/transfers/${transferId}/capture`, { orderId }),
  payouts: (roundId: string, payerId: string) => post<RoundView>(`/api/rounds/${roundId}/payouts`, { payerId }),
  refreshPayouts: (roundId: string) => post<RoundView>(`/api/rounds/${roundId}/payouts/refresh`),
  approveSim: (transferId: string) => post<TransferView>(`/api/sim/transfers/${transferId}/approve`),
  simPayout: (transferId: string, status: "SUCCESS" | "FAILED") => post<RoundView>(`/api/sim/transfers/${transferId}/payout/${status}`),
  resetDemo: () => post<{ networkId: string; archived: number; created: number; skipped: number }>("/api/demo/reset"),
  armChaos: (afterRecords: number) => post<{ armed: boolean; afterRecords: number }>("/api/demo/chaos", { afterRecords }),
  verifyRound: (roundId: string) => post<{ runId: string }>(`/api/rounds/${roundId}/verify`, {}),

  // AI / Agents
  aiStatus: () => get<{ enabled: boolean; model: string | null }>("/api/ai/status"),
  runCycle: (networkId: string) => post<{ runId: string }>("/api/agents/cycle", { networkId }),
  agentRuns: (networkId: string) => get<AgentRun[]>(`/api/networks/${networkId}/agents/runs`),
  agentRun: (runId: string) => get<{ run: AgentRun; steps: AgentStep[]; approvals: Approval[] }>(`/api/agents/runs/${runId}`),
  networkApprovals: (networkId: string, status?: string) =>
    get<Approval[]>(`/api/networks/${networkId}/approvals${status !== undefined ? `?status=${encodeURIComponent(status)}` : ""}`),
  approveApproval: (id: string) => post<Approval>(`/api/approvals/${id}/approve`),
  rejectApproval: (id: string) => post<Approval>(`/api/approvals/${id}/reject`),
  submitEvidence: (payload: { businessId: string; fileName: string; mime: string; dataBase64: string }) =>
    post<EvidenceView>("/api/evidence", payload),
  networkEvidence: (networkId: string) => get<EvidenceView[]>(`/api/networks/${networkId}/evidence`),
  evidence: (id: string) => get<EvidenceView>(`/api/evidence/${id}`),
  evidenceSamples: () => get<EvidenceSample[]>("/api/demo/evidence-samples"),
  explainStatement: (roundId: string, businessId: string, language: string) =>
    post<Explanation>(`/api/rounds/${roundId}/statements/${businessId}/explain`, { language }),
  businessAdvice: (businessId: string) => get<Advice>(`/api/businesses/${businessId}/advice`),
  aiGrid: (payload: { question: string; schema: unknown; state: GridState }) =>
    post<{ gridState: GridState; explanation: string }>("/api/ai/grid", payload),
  disputeObligation: (obligationId: string, payload: DisputeObligationPayload) =>
    post<DisputeRunResponse>(`/api/obligations/${obligationId}/dispute`, payload),
};
