import { useState } from "react";
import { BellRing, FileScan, Landmark, ReceiptText, ScanSearch, ShieldCheck, Workflow, Languages } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AgentName, Approval } from "../types.ts";
import { api, ApiError } from "../api.ts";
import { Avatar } from "../ui/Avatar.tsx";
import { Button } from "../ui/Button.tsx";
import { Card } from "../ui/Card.tsx";
import { CopyId } from "../ui/CopyId.tsx";
import type { ToastMessage } from "../components/Toasts.tsx";

type PushToast = (toast: Omit<ToastMessage, "id">) => void;

const AGENT_ICONS: Record<AgentName, typeof Workflow> = {
  orchestrator: Workflow,
  discovery: ScanSearch,
  intake: FileScan,
  invoicing: ReceiptText,
  treasurer: Landmark,
  watchdog: ShieldCheck,
  collections: BellRing,
  explainer: Languages,
};

const AGENT_LABELS: Record<AgentName, string> = {
  orchestrator: "Orchestrator",
  discovery: "Discovery",
  intake: "Intake",
  invoicing: "Invoicing",
  treasurer: "Treasurer",
  watchdog: "Watchdog",
  collections: "Collections",
  explainer: "Explainer",
};

// Typed payload for issue_invoice
interface IssueInvoicePayload {
  debtorName?: string;
  debtorEmail?: string;
  amountMinor?: number;
  currency?: string;
  item?: string;
  dueOn?: string;
  transferId?: string;
}

function isIssueInvoicePayload(payload: unknown): payload is IssueInvoicePayload {
  return typeof payload === "object" && payload !== null;
}

// Typed result for issue_invoice
interface IssueInvoiceResult {
  invoiceId?: string;
  qrCodeUrl?: string;
  qrDataUrl?: unknown;
}

function isIssueInvoiceResult(result: unknown): result is IssueInvoiceResult {
  return typeof result === "object" && result !== null;
}

// Typed payload for pay_checkout
interface PayCheckoutPayload {
  transferId?: string;
}

function isPayCheckoutPayload(payload: unknown): payload is PayCheckoutPayload {
  return typeof payload === "object" && payload !== null;
}

function formatAmount(minor: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 100);
}

export function ApprovalCard({
  approval,
  onToast,
  onOpenPayDialog,
}: {
  approval: Approval;
  onToast: PushToast;
  /** Called for pay_checkout approvals instead of the approve mutation. */
  onOpenPayDialog?: (transferId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [decided, setDecided] = useState<Approval | null>(null);

  const approveMutation = useMutation({
    mutationFn: () => api.approveApproval(approval.id),
    onSuccess: (updated) => {
      setDecided(updated);
      void queryClient.invalidateQueries({ queryKey: ["approvals"] });
      if (approval.runId !== null) void queryClient.invalidateQueries({ queryKey: ["agent-run", approval.runId] });
    },
    onError: (error) => {
      onToast(errorToast(error));
    },
  });

  const rejectMutation = useMutation({
    mutationFn: () => api.rejectApproval(approval.id),
    onSuccess: (updated) => {
      setDecided(updated);
      void queryClient.invalidateQueries({ queryKey: ["approvals"] });
      if (approval.runId !== null) void queryClient.invalidateQueries({ queryKey: ["agent-run", approval.runId] });
    },
    onError: (error) => {
      onToast(errorToast(error));
    },
  });

  const AgentIcon = AGENT_ICONS[approval.agent];
  const agentLabel = AGENT_LABELS[approval.agent];
  const current = decided ?? approval;
  const isPending = current.status === "pending";
  const busy = approveMutation.isPending || rejectMutation.isPending;
  const isPayCheckout = approval.kind === "pay_checkout";
  const invoicePayload = approval.kind === "issue_invoice" && isIssueInvoicePayload(approval.payload) ? approval.payload : null;

  const handleApprove = () => {
    if (isPayCheckout && onOpenPayDialog !== undefined) {
      const payload = isPayCheckoutPayload(approval.payload) ? approval.payload : {};
      const transferId = payload.transferId;
      if (transferId !== undefined) {
        onOpenPayDialog(transferId);
        return;
      }
    }
    approveMutation.mutate();
  };

  const approveLabel = isPayCheckout ? "Pay with PayPal" : "Approve";
  const approveVariant = isPayCheckout ? "paypal" : "primary";

  return (
    <Card className="approval-card">
      <div className="approval-card-header">
        <span className="approval-agent-icon" aria-hidden="true">
          <AgentIcon size={16} />
        </span>
        <Avatar name={approval.businessName} id={approval.businessId} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-5">{approval.title}</p>
          <p className="text-xs text-muted">{agentLabel} · {approval.businessName}</p>
        </div>
        {!isPending && (
          <span className={`approval-status-badge approval-status-${current.status}`}>
            {current.status === "executed" ? "Done" : current.status === "approved" ? "Approved" : current.status === "rejected" ? "Rejected" : current.status === "failed" ? "Failed" : current.status}
          </span>
        )}
      </div>

      <p className="mt-2 text-sm text-soft">{approval.detail}</p>

      {invoicePayload !== null && (
        <table className="approval-invoice-table mt-3">
          <tbody>
            {invoicePayload.debtorName !== undefined && (
              <tr>
                <th scope="row">Debtor</th>
                <td>{invoicePayload.debtorName}</td>
              </tr>
            )}
            {invoicePayload.amountMinor !== undefined && invoicePayload.currency !== undefined && (
              <tr>
                <th scope="row">Amount</th>
                <td className="tabular-nums">{formatAmount(invoicePayload.amountMinor, invoicePayload.currency)}</td>
              </tr>
            )}
            {invoicePayload.item !== undefined && (
              <tr>
                <th scope="row">Item</th>
                <td>{invoicePayload.item}</td>
              </tr>
            )}
            {invoicePayload.dueOn !== undefined && (
              <tr>
                <th scope="row">Due date</th>
                <td>{invoicePayload.dueOn}</td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {/* Result after execution */}
      {!isPending && current.result !== null && (
        <div className="mt-3 rounded-lg bg-[var(--surface-soft)] p-3 text-sm">
          {approval.kind === "issue_invoice" && isIssueInvoiceResult(current.result) ? (
            <div className="space-y-1.5">
              {current.result.invoiceId !== undefined && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted">Invoice</span>
                  <CopyId value={current.result.invoiceId} label="Copy invoice id" />
                </div>
              )}
              {current.result.qrCodeUrl !== undefined && (
                <a href={current.result.qrCodeUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-[var(--brand)] hover:underline">
                  View QR code →
                </a>
              )}
              {typeof current.result.qrDataUrl === "string" && (
                <figure className="mt-3">
                  <img src={current.result.qrDataUrl} alt="PayPal payment QR code" className="h-40 w-40 rounded-xl bg-white p-2 object-contain" />
                  <figcaption className="mt-2 text-xs text-muted">Scan to pay with PayPal</figcaption>
                </figure>
              )}
            </div>
          ) : (
            <p className="text-xs text-soft capitalize">{current.status}</p>
          )}
        </div>
      )}

      {isPending && (
        <div className="mt-4 flex items-center gap-2">
          <Button
            variant={approveVariant}
            size="sm"
            onClick={handleApprove}
            loading={approveMutation.isPending}
            disabled={busy}
          >
            {approveLabel}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => rejectMutation.mutate()}
            loading={rejectMutation.isPending}
            disabled={busy}
          >
            Reject
          </Button>
        </div>
      )}
    </Card>
  );
}

function errorToast(error: unknown): Omit<ToastMessage, "id"> {
  if (error instanceof ApiError) {
    return { kind: "error", title: error.message, code: error.code, debugId: error.debugId };
  }
  return { kind: "error", title: error instanceof Error ? error.message : "The request could not be completed.", code: null, debugId: null };
}
