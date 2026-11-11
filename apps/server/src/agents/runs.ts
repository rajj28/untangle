import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { agentRuns, approvals, businesses, events } from "@untangle/db";
import type { AppContext } from "../context.ts";
import type { StepEvent, StepSink } from "../ai/agent.ts";
import { DomainError } from "../errors.ts";

export type AgentName = "orchestrator" | "discovery" | "intake" | "invoicing" | "treasurer" | "watchdog" | "collections" | "explainer";
export type ApprovalKind = "issue_invoice" | "import_invoices" | "send_reminder" | "pay_checkout" | "adjust_invoice";

export interface AgentStepView {
  seq: number;
  runId: string;
  agent: AgentName;
  businessId: string | null;
  kind: StepEvent["kind"] | "handoff";
  title: string;
  detail: string | null;
  tool: string | null;
  at: string;
}

export async function startRun(ctx: AppContext, networkId: string, kind: string, goal: string): Promise<string> {
  const [run] = await ctx.db.insert(agentRuns).values({ networkId, kind, goal, status: "running" }).returning({ id: agentRuns.id });
  if (run === undefined) throw new Error("agent run insert returned nothing");
  await ctx.bus.emit(`agent:${run.id}`, "agent.run_started", { runId: run.id, kind, goal });
  return run.id;
}

/** A step sink that records every step in the tamper-evident event log and streams it to the console. */
export function stepper(ctx: AppContext, runId: string, agent: AgentName, businessId: string | null = null): StepSink & { handoff(title: string): Promise<void> } {
  const sink = async (step: StepEvent) => {
    await ctx.bus.emit(`agent:${runId}`, "agent.step", {
      runId, agent, businessId: step.businessId ?? businessId,
      // A tool called without arguments has nothing worth showing as detail.
      kind: step.kind, title: step.title, detail: step.detail && step.detail !== "{}" ? step.detail : null, tool: step.tool ?? null, at: ctx.now().toISOString(),
    });
  };
  return Object.assign(sink, {
    handoff: (title: string) => ctx.bus.emit(`agent:${runId}`, "agent.step", {
      runId, agent, businessId, kind: "handoff", title, detail: null, tool: null, at: ctx.now().toISOString(),
    }).then(() => undefined),
  });
}

export async function finishRun(ctx: AppContext, runId: string, status: "completed" | "waiting" | "failed", summary: string, stats: Record<string, number> = {}): Promise<void> {
  await ctx.db.update(agentRuns).set({ status, summary, stats, finishedAt: ctx.now() }).where(eq(agentRuns.id, runId));
  await ctx.bus.emit(`agent:${runId}`, "agent.run_finished", { runId, status, summary });
}

/** At startup (single instance): runs still marked running belonged to a process that died, so they never finish by themselves. */
export async function interruptOrphanedRuns(ctx: AppContext): Promise<number> {
  const rows = await ctx.db.update(agentRuns).set({ status: "failed", summary: "Interrupted by a server restart", finishedAt: ctx.now() })
    .where(eq(agentRuns.status, "running")).returning({ id: agentRuns.id });
  return rows.length;
}

export async function requestApproval(ctx: AppContext, input: {
  runId: string | null; networkId: string; businessId: string; agent: AgentName; kind: ApprovalKind;
  title: string; detail: string; payload: Record<string, unknown>;
}): Promise<string> {
  const [row] = await ctx.db.insert(approvals).values({
    runId: input.runId, networkId: input.networkId, businessId: input.businessId, agent: input.agent,
    kind: input.kind, title: input.title, detail: input.detail, payload: input.payload, status: "pending",
  }).returning({ id: approvals.id });
  if (row === undefined) throw new Error("approval insert returned nothing");
  await ctx.bus.emit(input.runId === null ? `network:${input.networkId}` : `agent:${input.runId}`, "agent.approval_requested", {
    runId: input.runId, approvalId: row.id, businessId: input.businessId, kind: input.kind, title: input.title,
  });
  return row.id;
}

/**
 * A transfer can be paid without its checkout approval (for example by PayPal Payouts from the owner's
 * page). Once it commits, any checkout approval still open for it is done, and a run that was only
 * waiting on those approvals is complete.
 */
export async function resolveCheckoutApprovals(ctx: AppContext, transferId: string, instrument: string): Promise<void> {
  const resolved = await ctx.db.update(approvals).set({ status: "executed", decidedAt: ctx.now(), result: { paidBy: instrument } })
    .where(and(eq(approvals.kind, "pay_checkout"), inArray(approvals.status, ["pending", "approved"]), sql`${approvals.payload}->>'transferId' = ${transferId}`))
    .returning({ id: approvals.id, runId: approvals.runId, networkId: approvals.networkId });
  for (const row of resolved) {
    if (row.runId !== null) {
      const [stillPending] = await ctx.db.select({ id: approvals.id }).from(approvals).where(and(eq(approvals.runId, row.runId), eq(approvals.status, "pending"))).limit(1);
      if (stillPending === undefined) await ctx.db.update(agentRuns).set({ status: "completed" }).where(and(eq(agentRuns.id, row.runId), eq(agentRuns.status, "waiting")));
    }
    await ctx.bus.emit(row.runId === null ? `network:${row.networkId}` : `agent:${row.runId}`, "agent.approval_decided", { approvalId: row.id, status: "executed", agent: "treasurer" });
  }
}

function runView(row: typeof agentRuns.$inferSelect) {
  return {
    id: row.id, kind: row.kind, goal: row.goal, status: row.status, summary: row.summary,
    stats: row.stats as Record<string, number>, startedAt: row.startedAt.toISOString(), finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

export async function approvalViews(ctx: AppContext, where: ReturnType<typeof eq> | ReturnType<typeof and>) {
  const rows = await ctx.db.select({ approval: approvals, businessName: businesses.name }).from(approvals)
    .innerJoin(businesses, eq(approvals.businessId, businesses.id)).where(where).orderBy(desc(approvals.createdAt)).limit(100);
  return rows.map(({ approval, businessName }) => ({
    id: approval.id, runId: approval.runId, businessId: approval.businessId, businessName, agent: approval.agent, kind: approval.kind,
    title: approval.title, detail: approval.detail, payload: approval.payload, status: approval.status, result: approval.result,
    blockedRule: approval.blockedRule, blockedExcerpt: approval.blockedExcerpt,
    createdAt: approval.createdAt.toISOString(), decidedAt: approval.decidedAt?.toISOString() ?? null,
  }));
}

export async function listRuns(ctx: AppContext, networkId: string) {
  const rows = await ctx.db.select().from(agentRuns).where(eq(agentRuns.networkId, networkId)).orderBy(desc(agentRuns.startedAt)).limit(20);
  return rows.map(runView);
}

export async function getRunDetail(ctx: AppContext, runId: string) {
  const [run] = await ctx.db.select().from(agentRuns).where(eq(agentRuns.id, runId)).limit(1);
  if (run === undefined) throw new DomainError(404, "RUN_NOT_FOUND", "Agent run was not found");
  const rows = await ctx.db.select().from(events).where(and(eq(events.stream, `agent:${runId}`), eq(events.type, "agent.step"))).orderBy(asc(events.seq));
  const steps: AgentStepView[] = rows.map((row) => {
    const payload = row.payload as Omit<AgentStepView, "seq">;
    return { seq: row.seq, runId, agent: payload.agent, businessId: payload.businessId ?? null, kind: payload.kind, title: payload.title, detail: payload.detail ?? null, tool: payload.tool ?? null, at: payload.at };
  });
  return { run: runView(run), steps, approvals: await approvalViews(ctx, eq(approvals.runId, runId)) };
}
