import { useEffect, useRef, useState } from "react";
import {
  BellRing,
  ChevronDown,
  CircleAlert,
  FileScan,
  Landmark,
  Languages,
  Loader2,
  ReceiptText,
  RotateCw,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgentName, AgentRun, AgentStep, Approval } from "../types.ts";
import { api, ApiError } from "../api.ts";
import { Avatar } from "../ui/Avatar.tsx";
import { Button } from "../ui/Button.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Skeleton } from "../ui/Skeleton.tsx";
import { groupSteps, classifyTool } from "./timeline.ts";
import type { AgentBlock } from "./timeline.ts";
import { ApprovalCard } from "./ApprovalCard.tsx";
import type { ToastMessage } from "../components/Toasts.tsx";
import { shortDateTime, duration } from "../time.ts";
import { StatusPill } from "../ui/StatusPill.tsx";

type PushToast = (toast: Omit<ToastMessage, "id">) => void;

// ── Agent identity map ────────────────────────────────────────────────────────

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

// ── AgentConsole (exported) ──────────────────────────────────────────────────

export function AgentConsole({
  networkId,
  onToast,
  onOpenPayDialog,
}: {
  networkId: string;
  onToast: PushToast;
  onOpenPayDialog: (transferId: string) => void;
}) {
  const queryClient = useQueryClient();

  const statusQuery = useQuery({
    queryKey: ["ai-status"],
    queryFn: api.aiStatus,
    staleTime: Infinity,
  });

  const runsQuery = useQuery<AgentRun[]>({
    queryKey: ["agent-runs", networkId],
    queryFn: () => api.agentRuns(networkId),
    staleTime: Infinity,
  });

  const runs = runsQuery.data ?? [];
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  // Select the first run by default when runs load
  useEffect(() => {
    if (selectedRunId === null && runs.length > 0 && runs[0] !== undefined) {
      setSelectedRunId(runs[0].id);
    }
  }, [runs, selectedRunId]);

  const runningRun = runs.find((run) => run.status === "running");

  const cycleMutation = useMutation({
    mutationFn: () => api.runCycle(networkId),
    onSuccess: ({ runId }) => {
      setSelectedRunId(runId);
      void queryClient.invalidateQueries({ queryKey: ["agent-runs", networkId] });
      onToast({ kind: "success", title: "Clearing cycle started.", code: null, debugId: null });
    },
    onError: (error) => onToast(errorToast(error)),
  });

  return (
    <section className="agent-console flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex min-h-[54px] items-start gap-4 border-b line bg-[var(--surface)] px-5 py-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-semibold tracking-tight">Agents</h1>
          <p className="mt-0.5 max-w-xl text-xs text-muted">
            An orchestrator runs the clearing cycle and hands work to specialist agents. Each agent works on its own business's PayPal account through the PayPal Agent Toolkit.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {statusQuery.data && (
            <span className="ai-status-chip inline-flex items-center gap-1.5 rounded-full border line px-2.5 py-1 text-[11px] font-medium">
              <Sparkles size={12} className="text-[var(--brand)]" aria-hidden="true" />
              {statusQuery.data.model ?? "AI"}
            </span>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={() => cycleMutation.mutate()}
            loading={cycleMutation.isPending}
            disabled={runningRun !== undefined}
          >
            Run clearing cycle
          </Button>
        </div>
      </div>

      {/* Body: two-pane layout */}
      <div className="flex min-h-0 flex-1 flex-col gap-0 md:flex-row">
        {/* Runs list */}
        <aside className="agent-runs-list w-full border-b line md:w-72 md:shrink-0 md:border-b-0 md:border-r md:overflow-y-auto">
          {runsQuery.isLoading ? (
            <Skeleton variant="row" count={4} className="p-4" />
          ) : runsQuery.error ? (
            <div className="p-4">
              <InlineError title="Runs could not be loaded" error={runsQuery.error} onRetry={() => void runsQuery.refetch()} />
            </div>
          ) : runs.length === 0 ? (
            <EmptyState title="No agent runs yet" detail="Run the clearing cycle to start." />
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {runs.map((run) => (
                <RunListItem
                  key={run.id}
                  run={run}
                  selected={run.id === selectedRunId}
                  onSelect={() => setSelectedRunId(run.id)}
                />
              ))}
            </ul>
          )}
        </aside>

        {/* Run timeline */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {selectedRunId !== null ? (
            <RunTimeline
              runId={selectedRunId}
              networkId={networkId}
              onToast={onToast}
              onOpenPayDialog={onOpenPayDialog}
            />
          ) : (
            <EmptyState title="Select a run" detail="Choose a run from the list to see its timeline." icon={<Workflow size={24} />} />
          )}
        </div>
      </div>
    </section>
  );
}

// ── RunListItem ───────────────────────────────────────────────────────────────

function RunListItem({ run, selected, onSelect }: { run: AgentRun; selected: boolean; onSelect: () => void }) {
  const started = new Date(run.startedAt);
  const durationText = run.finishedAt !== null ? duration(run.startedAt, run.finishedAt) : null;

  return (
    <li>
      <button
        type="button"
        className={`agent-run-item w-full px-4 py-3 text-left transition-colors hover:bg-[var(--surface-muted)] ${selected ? "bg-[var(--surface-muted)] border-l-2 border-[var(--brand)]" : ""}`}
        onClick={onSelect}
        aria-pressed={selected}
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-semibold capitalize">{run.kind.replace("_", " ")}</p>
          <StatusPill status={run.status} compact />
        </div>
        {run.summary !== null && (
          <p className="mt-1 truncate text-[11px] text-soft">{run.summary}</p>
        )}
        <p className="mt-1 text-[10px] text-muted">
          {shortDateTime(started.toISOString())}
          {durationText !== null && <> · {durationText}</>}
        </p>
      </button>
    </li>
  );
}

// ── RunTimeline ───────────────────────────────────────────────────────────────

function RunTimeline({
  runId,
  networkId: _networkId,
  onToast,
  onOpenPayDialog,
}: {
  runId: string;
  networkId: string;
  onToast: PushToast;
  onOpenPayDialog: (transferId: string) => void;
}) {
  const query = useQuery({
    queryKey: ["agent-run", runId],
    queryFn: () => api.agentRun(runId),
    staleTime: Infinity,
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const [userScrolled, setUserScrolled] = useState(false);
  const stepsCount = query.data?.steps.length ?? 0;

  // Auto-scroll to bottom when new steps arrive
  useEffect(() => {
    if (userScrolled || scrollRef.current === null) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [stepsCount, userScrolled]);

  const handleScroll = () => {
    if (scrollRef.current === null) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 40;
    setUserScrolled(!atBottom);
  };

  const jumpToLatest = () => {
    setUserScrolled(false);
    if (scrollRef.current !== null) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  };

  if (query.isLoading) return <Skeleton variant="row" count={6} className="p-5" />;
  if (query.error) return (
    <div className="p-5">
      <InlineError title="Run details could not be loaded" error={query.error} onRetry={() => void query.refetch()} />
    </div>
  );
  if (!query.data) return null;

  const { run, steps, approvals } = query.data;
  const isRunning = run.status === "running";
  const blocks = groupSteps(steps);

  // Map approvals to the seq of the step after which they were requested
  // We simply display them after the block whose lastSeq is ≤ the approval's position.
  // Since we have no seq on approval, we display all approvals after the last block.
  const pendingApprovals = approvals.filter((a) => a.status === "pending");

  return (
    <div className="agent-timeline relative flex h-full flex-col">
      {userScrolled && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center pointer-events-auto">
          <button
            type="button"
            onClick={jumpToLatest}
            className="flex items-center gap-1.5 rounded-full border line bg-[var(--surface)] px-3 py-1.5 text-xs font-medium shadow-md hover:bg-[var(--surface-muted)]"
          >
            <ChevronDown size={13} />Jump to latest
          </button>
        </div>
      )}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-5" onScroll={handleScroll}>
        {blocks.length === 0 ? (
          <p className="text-sm text-muted">No steps recorded yet.</p>
        ) : (
          <div className="space-y-4">
            {blocks.map((block, blockIndex) => {
              const isNewestBlock = blockIndex === blocks.length - 1;
              const showSpinner = isRunning && isNewestBlock;
              // Approvals inline: only the last block gets pending approvals
              const blockApprovals = isNewestBlock ? pendingApprovals : [];
              return (
                <AgentBlockView
                  key={`${block.agent}-${block.lastSeq}`}
                  block={block}
                  showSpinner={showSpinner}
                  approvals={blockApprovals}
                  onToast={onToast}
                  onOpenPayDialog={onOpenPayDialog}
                />
              );
            })}
          </div>
        )}

        {/* Summary card when run is done */}
        {!isRunning && run.summary !== null && (
          <div className="mt-6 rounded-xl border-2 border-[var(--brand)]/20 bg-[var(--brand-tint)] p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--brand)]">Run complete</p>
            <p className="mt-1 text-sm leading-6 text-[var(--ink)]">{run.summary}</p>
            {Object.keys(run.stats).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-3">
                {Object.entries(run.stats).map(([key, value]) => (
                  <div key={key} className="rounded-md border line bg-[var(--surface)] px-2.5 py-1 text-xs">
                    <span className="font-semibold tabular-nums">{value}</span>{" "}
                    <span className="text-muted">{key.replace(/_/g, " ")}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── AgentBlockView ────────────────────────────────────────────────────────────

function AgentBlockView({
  block,
  showSpinner,
  approvals,
  onToast,
  onOpenPayDialog,
}: {
  block: AgentBlock;
  showSpinner: boolean;
  approvals: Approval[];
  onToast: PushToast;
  onOpenPayDialog: (transferId: string) => void;
}) {
  const AgentIcon = AGENT_ICONS[block.agent];
  const label = AGENT_LABELS[block.agent];

  return (
    <div className="agent-block rounded-xl border line bg-[var(--surface-soft)] overflow-hidden">
      {/* Block header */}
      <div className="flex items-center gap-2 border-b line px-3 py-2">
        <span className="agent-icon rounded-md border line bg-[var(--surface)] p-1 text-[var(--ink-soft)]" aria-hidden="true">
          <AgentIcon size={14} />
        </span>
        <span className="text-xs font-semibold">{label}</span>
        {block.businessId !== null && (
          <span className="text-xs text-muted">· {block.businessId}</span>
        )}
        {showSpinner && (
          <Loader2 size={13} className="ml-auto animate-spin text-[var(--brand)]" aria-label="Running" />
        )}
      </div>

      {/* Steps */}
      <div className="divide-y divide-[var(--line)/50] px-3">
        {block.steps.map((step, index) => (
          <StepRow key={`${step.seq}-${index}`} step={step} isLatest={index === block.steps.length - 1 && showSpinner} />
        ))}
      </div>

      {/* Inline approvals */}
      {approvals.length > 0 && (
        <div className="border-t line px-3 py-3 space-y-3">
          {approvals.map((approval) => (
            <ApprovalCard
              key={approval.id}
              approval={approval}
              onToast={onToast}
              onOpenPayDialog={onOpenPayDialog}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── StepRow ───────────────────────────────────────────────────────────────────

function StepRow({ step, isLatest }: { step: AgentStep; isLatest: boolean }) {
  const fadeClass = isLatest ? "agent-step-newest" : "";

  if (step.kind === "thought") {
    return (
      <div className={`py-2 text-xs italic text-muted ${fadeClass}`}>
        {step.title}
        {step.detail !== null && <p className="mt-0.5 text-[11px]">{step.detail}</p>}
      </div>
    );
  }

  if (step.kind === "tool_call" && step.tool !== null) {
    const kind = classifyTool(step.tool);
    const isPayPal = kind === "paypal";
    const isUntangle = kind === "untangle";
    return (
      <div className={`py-2 ${fadeClass}`}>
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={`tool-chip inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[10px] ${
              isPayPal
                ? "border-[#009cde]/30 bg-[#009cde]/10 text-[#003087]"
                : isUntangle
                ? "border-[var(--brand)]/30 bg-[var(--brand-tint)] text-[var(--brand-strong)]"
                : "border-[var(--line)] bg-[var(--surface)] text-[var(--ink-soft)]"
            }`}
            title={isPayPal ? "Called through the PayPal Agent Toolkit" : undefined}
          >
            {isPayPal && <span className="paypal-badge text-[8px] font-bold">PP</span>}
            {step.tool}
          </span>
          {step.title !== step.tool && (
            <span className="text-[11px] text-soft">{step.title}</span>
          )}
        </div>
        {step.detail !== null && <p className="mt-0.5 text-[11px] text-muted">{step.detail}</p>}
      </div>
    );
  }

  if (step.kind === "tool_result") {
    return (
      <div className={`py-1.5 text-[11px] text-soft ${fadeClass}`}>
        ↳ {step.title}
      </div>
    );
  }

  if (step.kind === "decision") {
    return (
      <div className={`my-1.5 rounded-md bg-[var(--brand-tint)] px-3 py-2 text-xs font-medium text-[var(--brand-strong)] ${fadeClass}`}>
        {step.title}
        {step.detail !== null && <p className="mt-0.5 text-[11px] font-normal text-[var(--brand)]">{step.detail}</p>}
      </div>
    );
  }

  if (step.kind === "error") {
    return (
      <div className={`my-1.5 flex items-start gap-1.5 rounded-md border border-[var(--red)]/30 bg-[var(--red-tint)] px-3 py-2 text-xs text-[var(--red)] ${fadeClass}`}>
        <CircleAlert size={13} className="mt-0.5 shrink-0" />
        <div>
          <p className="font-medium">{step.title}</p>
          {step.detail !== null && <p className="mt-0.5 text-[11px]">{step.detail}</p>}
        </div>
      </div>
    );
  }

  if (step.kind === "handoff") {
    return (
      <div className={`flex items-center gap-2 py-2 text-[11px] text-muted ${fadeClass}`}>
        <span className="h-px flex-1 bg-[var(--line)]" />
        <span>→ {step.title}</span>
        <span className="h-px flex-1 bg-[var(--line)]" />
      </div>
    );
  }

  // message / fallback
  return (
    <div className={`py-2 text-xs text-soft ${fadeClass}`}>
      {step.title}
      {step.detail !== null && <p className="mt-0.5 text-[11px] text-muted">{step.detail}</p>}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function InlineError({ title, error, onRetry }: { title: string; error: unknown; onRetry: () => void }) {
  return (
    <div className="rounded-lg border border-[var(--red)]/30 bg-[var(--red-tint)] p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-[var(--red)]">
        <CircleAlert size={16} />{title}
      </p>
      <p className="mt-1 text-sm text-[var(--red)]">{error instanceof Error ? error.message : "Please try again."}</p>
      <Button variant="secondary" className="mt-3" onClick={onRetry} size="sm">
        <RotateCw size={13} />Try again
      </Button>
    </div>
  );
}

function errorToast(error: unknown): Omit<ToastMessage, "id"> {
  if (error instanceof ApiError) {
    return { kind: "error", title: error.message, code: error.code, debugId: error.debugId };
  }
  return { kind: "error", title: error instanceof Error ? error.message : "The request could not be completed.", code: null, debugId: null };
}
