import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AudioLines, FileText, ImageIcon, Landmark, RefreshCw, Sparkles, Upload, Workflow } from "lucide-react";
import { api, ApiError } from "../../api.ts";
import type { AppRoute } from "../../routes.ts";
import type { Advice, BusinessSummary, EvidenceSample, EvidenceView } from "../../types.ts";
import type { ToastMessage } from "../../components/Toasts.tsx";
import { Button } from "../../ui/Button.tsx";
import { Card } from "../../ui/Card.tsx";
import { ApprovalsPanel } from "../../agents/ApprovalsPanel.tsx";
import { formatMoney } from "../../money.ts";

type PushToast = (toast: Omit<ToastMessage, "id">) => void;

const MAX_BYTES = 8 * 1024 * 1024;
const URGENCY: Record<Advice["recommendations"][number]["urgency"], string> = {
  now: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  soon: "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-200",
  fyi: "bg-[var(--surface-muted)] text-muted",
};
const KIND_ICON = { image: ImageIcon, audio: AudioLines, pdf: FileText, text: FileText } as const;

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file"));
    reader.readAsDataURL(blob);
  });
}

function errorToast(error: unknown): Omit<ToastMessage, "id"> {
  if (error instanceof ApiError) return { kind: "error", title: error.message, code: error.code, debugId: error.debugId };
  return { kind: "error", title: error instanceof Error ? error.message : "Something went wrong.", code: null, debugId: null };
}

function EvidencePreview({ evidence }: { evidence: EvidenceView }) {
  const src = `/api/evidence/${evidence.id}/file`;
  if (evidence.kind === "image") return <img src={src} alt={evidence.fileName ?? "Uploaded evidence"} className="max-h-56 w-full rounded-lg border border-[var(--line)] object-contain bg-[var(--surface-muted)]" />;
  if (evidence.kind === "audio") return <audio controls src={src} className="w-full" />;
  const Icon = KIND_ICON[evidence.kind];
  return <a href={src} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg border border-[var(--line)] p-3 text-sm"><Icon size={18} aria-hidden="true" />{evidence.fileName ?? "Open the file"}</a>;
}

function EvidenceResult({ evidence, currency }: { evidence: EvidenceView; currency: string }) {
  return <div className="mt-4 space-y-3">
    <EvidencePreview evidence={evidence} />
    <p className="text-sm"><span className="font-semibold">Gemini read:</span> {evidence.summary ?? "—"} {evidence.language !== null && <span className="text-muted">({evidence.language})</span>}</p>
    {evidence.claims.length === 0 && <p className="text-sm text-muted">No debt was found in this file.</p>}
    {evidence.claims.map((claim) => <div key={claim.id} className="rounded-lg border border-[var(--line)] p-3">
      <p className="font-semibold">{claim.debtorName} owes {claim.creditorName} <span className="tabular-nums">{formatMoney(claim.amountMinor, claim.currency || currency)}</span></p>
      {claim.item !== null && <p className="text-sm text-muted">{claim.item}{claim.dueOn !== null ? ` · due ${claim.dueOn}` : ""}</p>}
      {claim.quote !== null && <blockquote className="mt-2 border-l-2 border-[var(--brand)] pl-3 text-sm italic">“{claim.quote}”</blockquote>}
      <div className="mt-2 flex items-center gap-2 text-xs text-muted" aria-label={`Confidence ${Math.round(claim.confidence * 100)} percent`}>
        <span>Confidence</span>
        <span className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--surface-muted)]"><span className="block h-full bg-[var(--brand)]" style={{ width: `${Math.round(claim.confidence * 100)}%` }} /></span>
        <span className="tabular-nums">{Math.round(claim.confidence * 100)}%</span>
        <span className="ml-auto">{claim.status === "matched" ? "On PayPal" : claim.status === "rejected" ? "Rejected" : claim.approvalId !== null ? "Waiting for approval" : "Needs a person"}</span>
      </div>
    </div>)}
    {evidence.warnings.length > 0 && <ul className="list-disc pl-5 text-sm text-amber-800 dark:text-amber-300">{evidence.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
  </div>;
}

/**
 * The owner's AI desk: what their treasurer suggests, a way to hand any evidence of a debt to the
 * Intake agent, and everything the agents are waiting for them to approve.
 */
export function BusinessAssistant({ business, networkId, currency, onNavigate, onToast }: {
  business: BusinessSummary;
  networkId: string;
  currency: string;
  onNavigate: (route: AppRoute) => void;
  onToast: PushToast;
}) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [latest, setLatest] = useState<EvidenceView | null>(null);
  const status = useQuery({ queryKey: ["ai-status"], queryFn: api.aiStatus });
  const enabled = status.data?.enabled === true;
  const advice = useQuery({ queryKey: ["advice", business.id], queryFn: () => api.businessAdvice(business.id), enabled, retry: false });
  const samples = useQuery({ queryKey: ["evidence-samples"], queryFn: api.evidenceSamples, enabled });

  const upload = useMutation({
    mutationFn: async (input: { blob: Blob; fileName: string; mime: string; uploader: string }) => {
      if (input.blob.size > MAX_BYTES) throw new Error("Files must be under 8 MB.");
      return api.submitEvidence({ businessId: input.uploader, fileName: input.fileName, mime: input.mime, dataBase64: await toBase64(input.blob) });
    },
    onSuccess: (evidence) => {
      setLatest(evidence);
      void queryClient.invalidateQueries({ queryKey: ["approvals"] });
      void queryClient.invalidateQueries({ queryKey: ["advice", business.id] });
      onToast({ kind: "success", title: evidence.claims.length === 0 ? "No debt found in that file." : `Found ${evidence.claims.length} debt${evidence.claims.length === 1 ? "" : "s"}.`, code: null, debugId: null });
    },
    onError: (error) => onToast(errorToast(error)),
  });

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file !== undefined) upload.mutate({ blob: file, fileName: file.name, mime: file.type || "application/octet-stream", uploader: business.id });
  };
  const trySample = async (sample: EvidenceSample) => {
    try {
      const blob = await (await fetch(sample.url)).blob();
      upload.mutate({ blob, fileName: sample.fileName, mime: sample.mime, uploader: sample.uploaderBusinessId ?? business.id });
    } catch (error) {
      onToast(errorToast(error));
    }
  };
  const act = (item: Advice["recommendations"][number]) => {
    if (item.action === "sign_statement") onNavigate({ kind: "business", businessId: business.id, page: "home" });
    else if (item.action === "pay_checkout" || item.action === "send_payouts") onNavigate({ kind: "desk", view: "settlement" });
    else if (item.action === "upload_evidence") fileInput.current?.click();
    else document.getElementById("assistant-approvals")?.scrollIntoView({ behavior: "smooth" });
  };

  if (status.isSuccess && !enabled) {
    return <section className="business-page-section"><Card><p className="text-sm">AI is not configured on this server, so the agents are switched off.</p></Card></section>;
  }

  return <section className="business-page-section space-y-4">
    <div className="business-page-title"><span className="me-eyebrow">AI agents for {business.name}</span><h1>Assistant</h1><p>Your AI treasurer watches your position, reads evidence of debts for you, and never acts on money without your approval.</p></div>

    <Card aria-labelledby="treasurer-title">
      <div className="flex items-center gap-2">
        <Landmark size={18} aria-hidden="true" className="text-[var(--brand)]" />
        <h2 id="treasurer-title" className="text-base font-semibold">AI treasurer</h2>
        <span className="text-xs text-muted">{advice.data?.model ?? status.data?.model ?? ""}</span>
        <Button size="sm" variant="ghost" className="ml-auto" aria-label="Refresh advice" loading={advice.isFetching} onClick={() => void advice.refetch()}><RefreshCw size={14} aria-hidden="true" /></Button>
      </div>
      {advice.isLoading && <p className="mt-3 text-sm text-muted">Your treasurer is looking at your position…</p>}
      {advice.isError && <p className="mt-3 text-sm text-muted">The treasurer is busy right now. Try refresh in a minute.</p>}
      {advice.data !== undefined && <>
        <p className="mt-3 text-sm">{advice.data.summary}</p>
        <ul className="mt-3 space-y-2">
          {advice.data.recommendations.slice(0, 3).map((item) => <li key={`${item.action}-${item.title}`} className="flex items-start gap-3 rounded-lg border border-[var(--line)] p-3">
            <span className={`rounded px-2 py-0.5 text-xs font-semibold ${URGENCY[item.urgency]}`}>{item.urgency}</span>
            <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{item.title}</p><p className="text-xs text-muted">{item.reason}</p></div>
            {item.action !== "none" && <Button size="sm" onClick={() => act(item)}>Go</Button>}
          </li>)}
        </ul>
      </>}
      <p className="mt-3 text-xs text-muted">Suggestions only — nothing happens until you approve.</p>
    </Card>

    <Card aria-labelledby="intake-title">
      <div className="flex items-center gap-2"><Sparkles size={18} aria-hidden="true" className="text-[var(--brand)]" /><h2 id="intake-title" className="text-base font-semibold">Add a debt with AI</h2></div>
      <p className="mt-2 text-sm text-muted">A photo of a bill, a voice note, a PDF invoice, a chat screenshot or an email. The Intake agent reads it with Gemini, and the Invoicing agent turns it into a real PayPal invoice once the creditor approves.</p>
      <input ref={fileInput} type="file" className="sr-only" accept="image/*,audio/*,application/pdf,text/plain" onChange={onFile} />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" loading={upload.isPending} onClick={() => fileInput.current?.click()}><Upload size={16} aria-hidden="true" />Upload evidence</Button>
      </div>
      {(samples.data?.length ?? 0) > 0 && <div className="mt-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Or try a sample</p>
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {samples.data!.map((sample) => {
            const Icon = KIND_ICON[sample.kind];
            return <button key={sample.id} type="button" disabled={upload.isPending} onClick={() => void trySample(sample)} className="flex min-w-48 items-center gap-2 rounded-lg border border-[var(--line)] px-3 py-2 text-left text-sm hover:border-[var(--brand)] disabled:opacity-50">
              <Icon size={18} aria-hidden="true" className="shrink-0 text-[var(--brand)]" /><span>{sample.title}</span>
            </button>;
          })}
        </div>
      </div>}
      {upload.isPending && <p className="mt-3 text-sm" role="status">Reading your evidence with Gemini… this takes 10–30 seconds.</p>}
      {latest !== null && <EvidenceResult evidence={latest} currency={currency} />}
    </Card>

    <Card id="assistant-approvals" aria-labelledby="approvals-title">
      <h2 id="approvals-title" className="mb-3 text-base font-semibold">Waiting for your approval</h2>
      <ApprovalsPanel networkId={networkId} filterBusinessId={business.id} onToast={onToast} onOpenPayDialog={() => onNavigate({ kind: "desk", view: "settlement" })} />
    </Card>

    <Button variant="ghost" onClick={() => onNavigate({ kind: "desk", view: "agents" })}><Workflow size={16} aria-hidden="true" />See every step the agents took</Button>
  </section>;
}
