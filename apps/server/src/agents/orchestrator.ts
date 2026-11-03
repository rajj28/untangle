import { and, desc, eq, inArray } from "drizzle-orm";
import { agentRuns, approvals, obligations, rounds } from "@untangle/db";
import type { AppContext } from "../context.ts";
import { runAgent } from "../ai/agent.ts";
import type { AgentTool } from "../ai/agent.ts";
import { DomainError } from "../errors.ts";
import { getRound, planRound } from "../services/rounds.ts";
import { refreshPayouts, startPayouts } from "../services/transfers.ts";
import { requireGemini, usd } from "./common.ts";
import { runDiscovery } from "./discovery.ts";
import { policyFor } from "./policies.ts";
import { finishRun, requestApproval, startRun, stepper } from "./runs.ts";
import { runTreasurers } from "./treasurer.ts";
import { runCollections, runWatchdog } from "./watchdog.ts";

const ORDER = ["discover_invoices", "plan_round", "run_treasurers", "wait_for_setoffs", "settle_payments", "run_watchdog", "run_collections"] as const;
type Stage = typeof ORDER[number];

const DESCRIPTIONS: Record<Stage, string> = {
  discover_invoices: "Search every business's PayPal account through the PayPal Agent Toolkit for unpaid invoices between members that the network does not track yet.",
  plan_round: "Run Untangle's clearing engine: find every loop of debt to cancel and the fewest PayPal payments for the rest. Creates a round with one statement per business.",
  run_treasurers: "Ask each business's AI treasurer to review its statement and sign within its owner's policy.",
  wait_for_setoffs: "Wait while the executor records the loop set-offs on the PayPal invoices, exactly once.",
  settle_payments: "Start the chain payments: PayPal Payouts where the payer's policy allows, otherwise ask the payer to pay by PayPal checkout.",
  run_watchdog: "Re-read every invoice the round touched from PayPal and check for disputes.",
  run_collections: "Draft reminders for invoices that are still open and due soon.",
};

const SYSTEM = `You are the Orchestrator of Untangle, an AI clearing house for small businesses that invoice each other through PayPal.
You run one clearing cycle by calling stage tools; each stage is carried out by specialist agents or by Untangle's deterministic engine and executor.
The usual order is: discover_invoices, plan_round, run_treasurers, wait_for_setoffs, settle_payments, run_watchdog, run_collections, then finish.
Skip a stage only when the facts clearly show it cannot apply. Before each tool call, say in one short sentence why you are calling it.
If wait_for_setoffs reports that owners still have to sign, nothing later can happen yet: run collections, then finish and name who must sign.
You coordinate; you never move money yourself. When done, call finish with a two-sentence summary for the operator.`;

const sleep = (ctx: AppContext, ms: number) => ctx.sleep(ms);

/** Starts a cycle in the background and returns its run id at once; progress streams to the agent console. */
export async function startCycle(ctx: AppContext, networkId: string): Promise<string> {
  requireGemini(ctx);
  const [busy] = await ctx.db.select({ id: agentRuns.id }).from(agentRuns).where(and(eq(agentRuns.networkId, networkId), eq(agentRuns.kind, "cycle"), eq(agentRuns.status, "running"))).limit(1);
  if (busy !== undefined) throw new DomainError(409, "CYCLE_RUNNING", "A clearing cycle is already running.");
  const runId = await startRun(ctx, networkId, "cycle", "Run a clearing cycle across the network");
  void runCycle(ctx, networkId, runId).catch(async (error: unknown) => {
    await finishRun(ctx, runId, "failed", `The cycle stopped: ${error instanceof Error ? error.message : String(error)}`).catch(() => undefined);
  });
  return runId;
}

export async function runCycle(ctx: AppContext, networkId: string, runId: string): Promise<void> {
  const gemini = requireGemini(ctx);
  const step = stepper(ctx, runId, "orchestrator");
  const stats: Record<string, number> = {};
  const done = new Set<Stage>();
  let roundId: string | null = null;
  let waitingFor: string[] = [];
  let finalSummary = "";
  // Set when the engine finds nothing to settle: the round stages then have nothing to act on.
  let nothingToSettle = false;

  const latestRound = async () => {
    const [row] = await ctx.db.select({ id: rounds.id, status: rounds.status }).from(rounds).where(eq(rounds.networkId, networkId)).orderBy(desc(rounds.createdAt)).limit(1);
    return row ?? null;
  };

  const stages: Record<Stage, () => Promise<{ done: boolean; result: string }>> = {
    async discover_invoices() {
      await step.handoff("Handed to the Discovery agent");
      const result = await runDiscovery(ctx, networkId, runId);
      stats.invoicesFound = result.found;
      stats.paypalCalls = (stats.paypalCalls ?? 0) + result.paypalCalls;
      return { done: true, result: result.found === 0 ? "Discovery: every unpaid invoice between members is already in the network." : `Discovery found ${result.found} unpaid PayPal invoice(s) outside the network and asked ${result.approvals} owner(s) to add them.` };
    },
    async plan_round() {
      try {
        const round = await planRound(ctx, networkId);
        roundId = round.id;
        const s = round.stats!;
        stats.loopsClearedMinor = s.clearedByLoops;
        stats.movedMinor = s.moneyMoved;
        return { done: true, result: `Planned a round: ${usd(s.totalOwed)} owed; loops clear ${usd(s.clearedByLoops)} with no money moving; ${round.transfers.length} PayPal payment(s) move ${usd(s.moneyMoved)} to settle the rest${s.leverage === null ? "" : ` (${s.leverage.toFixed(1)}× leverage)`}.` };
      } catch (error) {
        if (error instanceof DomainError && error.code === "ROUND_IN_PROGRESS") {
          roundId = (await latestRound())?.id ?? null;
          return { done: true, result: "A round is already in progress; continuing it." };
        }
        if (error instanceof DomainError && error.code === "NOTHING_TO_SETTLE") {
          nothingToSettle = true;
          return { done: true, result: "Nothing to settle: no open invoices are eligible." };
        }
        throw error;
      }
    },
    async run_treasurers() {
      roundId ??= (await latestRound())?.id ?? null;
      if (roundId === null) return { done: false, result: "There is no round to review yet; plan one first." };
      const round = await getRound(ctx, roundId);
      if (round.status !== "consenting") return { done: true, result: "Every statement in the round is already signed." };
      await step.handoff(`Handed to ${round.pendingConsents.length} Treasurer agents`);
      const { signed, held } = await runTreasurers(ctx, runId, roundId);
      stats.signed = signed.length;
      waitingFor = held.map((item) => item.name);
      return { done: true, result: `Treasurers signed for ${signed.length} business(es)${held.length === 0 ? "." : `; ${held.length} held for their owner: ${held.map((item) => item.name).join(", ")}.`}` };
    },
    async wait_for_setoffs() {
      roundId ??= (await latestRound())?.id ?? null;
      if (roundId === null) return { done: false, result: "There is no round yet." };
      for (let waited = 0; waited < 240_000; waited += 3000) {
        const round = await getRound(ctx, roundId);
        if (round.status === "consenting") return { done: false, result: `Waiting for ${round.pendingConsents.length} owner(s) to sign before set-offs can be recorded.` };
        if (round.status !== "executing") {
          const recorded = round.setoffs.filter((setoff) => setoff.status === "recorded").length;
          stats.setoffsRecorded = recorded;
          return { done: true, result: round.status === "failed" ? "The round failed while recording set-offs; nothing was left half-done." : `Recorded ${recorded} set-off(s) on the PayPal invoices; the round is ${round.status}.` };
        }
        await sleep(ctx, 3000);
      }
      return { done: false, result: "Set-offs are still being recorded." };
    },
    async settle_payments() {
      roundId ??= (await latestRound())?.id ?? null;
      if (roundId === null) return { done: false, result: "There is no round yet." };
      let round = await getRound(ctx, roundId);
      if (round.status !== "settling") return { done: round.status === "closed", result: round.status === "closed" ? "The round is already settled." : "The round is not ready for payments yet." };
      const lines: string[] = [];
      const payers = new Set(round.transfers.filter((transfer) => transfer.status === "ready").map((transfer) => transfer.payerId));
      for (const payerId of payers) {
        const policy = await policyFor(ctx, payerId);
        const owed = round.transfers.filter((transfer) => transfer.payerId === payerId && transfer.status === "ready");
        const total = owed.reduce((sum, transfer) => sum + transfer.amountMinor, 0);
        if (policy.payVia === "payouts" && total <= policy.autoPayoutMaxMinor) {
          await step({ kind: "tool_call", title: "Called untangle.send_payouts", detail: `${usd(total)} under the owner's auto-pay policy`, tool: "untangle.send_payouts", businessId: payerId });
          round = await startPayouts(ctx, roundId, payerId);
          lines.push(`sent ${usd(total)} by PayPal Payouts`);
        } else {
          for (const transfer of owed) {
            const [existing] = await ctx.db.select({ id: approvals.id }).from(approvals).where(and(eq(approvals.kind, "pay_checkout"), eq(approvals.businessId, payerId), inArray(approvals.status, ["pending", "approved"]))).limit(1);
            if (existing !== undefined) continue;
            await requestApproval(ctx, {
              runId, networkId, businessId: payerId, agent: "treasurer", kind: "pay_checkout",
              title: `Pay ${usd(transfer.amountMinor, transfer.currency)} with PayPal to settle ${transfer.legs.length} invoice(s)`,
              detail: `One PayPal checkout settles this whole chain of invoices. The payment is above the owner's auto-pay limit, so the owner pays it.`,
              payload: { transferId: transfer.id, roundId },
            });
          }
          lines.push(`asked the payer to pay ${usd(total)} by PayPal checkout`);
        }
      }
      // Payouts land in seconds to minutes; follow them so the watchdog sees the final state.
      for (let waited = 0; waited < 120_000 && round.transfers.some((transfer) => transfer.instrument === "payouts" && transfer.status === "pending_paypal"); waited += 15_000) {
        await sleep(ctx, 15_000);
        round = await refreshPayouts(ctx, roundId);
      }
      const committed = round.transfers.filter((transfer) => transfer.status === "committed").length;
      stats.paymentsCommitted = committed;
      return { done: true, result: lines.length === 0 ? "No payments were waiting." : `Payments: ${lines.join("; ")}. ${committed} of ${round.transfers.length} confirmed by PayPal so far.` };
    },
    async run_watchdog() {
      roundId ??= (await latestRound())?.id ?? null;
      if (roundId === null) return { done: true, result: "No round to verify." };
      const { status } = await getRound(ctx, roundId);
      if (status === "planned" || status === "consenting" || status === "executing") {
        return { done: false, result: "Nothing to verify yet: the set-offs are not recorded on PayPal." };
      }
      await step.handoff("Handed to the Watchdog agent");
      const result = await runWatchdog(ctx, runId, roundId);
      stats.verified = result.matched;
      stats.paypalCalls = (stats.paypalCalls ?? 0) + (result.paypalCalls ?? 0);
      return { done: true, result: result.mismatches.length === 0 ? `Watchdog: all ${result.matched} invoices match PayPal${result.disputes === 0 ? ", no disputes" : `, ${result.disputes} dispute(s)`}.` : `Watchdog: ${result.mismatches.length} invoice(s) differ from PayPal.` };
    },
    async run_collections() {
      await step.handoff("Handed to the Collections agent");
      const result = await runCollections(ctx, runId, networkId);
      stats.reminders = result.reminders;
      return { done: true, result: result.reminders === 0 ? "Collections: nothing to chase." : `Collections drafted ${result.reminders} reminder(s) for approval.` };
    },
  };

  const run = async (stage: Stage, viaModel = false) => {
    const outcome = await stages[stage]();
    if (outcome.done) done.add(stage);
    // A stage the model called already shows its result as the tool result; say it only for stages run directly.
    if (!viaModel) await step({ kind: "message", title: outcome.result, tool: `untangle.${stage}` });
    return outcome.result;
  };

  const tools: AgentTool[] = [
    ...ORDER.map((stage) => ({
      name: stage, label: `untangle.${stage}`, description: DESCRIPTIONS[stage],
      parameters: { type: "object", properties: {} },
      run: async () => ({ result: await run(stage, true) }),
      summarize: (result: unknown) => (result as { result: string }).result,
    })),
    {
      name: "finish", label: "untangle.finish", description: "End the cycle with a two-sentence summary for the operator.",
      parameters: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] },
      run: async (args: Record<string, unknown>) => { finalSummary = String(args.summary ?? ""); return { ok: true }; },
      summarize: () => "Cycle summary written",
    },
  ];

  const openCount = (await ctx.db.select({ id: obligations.id }).from(obligations).where(and(eq(obligations.networkId, networkId), inArray(obligations.status, ["invoiced", "partially_settled"])))).length;
  const current = await latestRound();
  const pendingApprovals = (await ctx.db.select({ id: approvals.id }).from(approvals).where(and(eq(approvals.networkId, networkId), eq(approvals.status, "pending")))).length;
  try {
    await runAgent(gemini, {
      system: SYSTEM,
      prompt: [{ text: `Network facts: ${openCount} open invoice(s); latest round: ${current === null ? "none" : current.status}; ${pendingApprovals} approval(s) waiting for owners. Run the cycle.` }],
      tools,
      onStep: step,
      maxSteps: 14,
    });
  } catch (error) {
    await step({ kind: "error", title: "The orchestrator model is unavailable; continuing with the standard sequence", detail: error instanceof Error ? error.message : String(error) });
  }
  // Whatever the model did, every stage that still applies runs, in order.
  const AFTER_SIGNING: Stage[] = ["wait_for_setoffs", "settle_payments", "run_watchdog"];
  for (const stage of ORDER) {
    if (done.has(stage)) continue;
    if (nothingToSettle && stage !== "discover_invoices" && stage !== "run_collections") continue;
    // While owners still have to sign, nothing after signing can happen in this cycle.
    if (AFTER_SIGNING.includes(stage) && (await latestRound())?.status === "consenting") continue;
    await step({ kind: "message", title: `Continuing with ${stage.replaceAll("_", " ")}` });
    await run(stage);
  }

  const waiting = (await ctx.db.select({ id: approvals.id }).from(approvals).where(and(eq(approvals.runId, runId), eq(approvals.status, "pending")))).length;
  const latest = await latestRound();
  const status = waiting > 0 || waitingFor.length > 0 || (latest !== null && ["consenting", "settling"].includes(latest.status)) ? "waiting" : "completed";
  const summary = finalSummary.trim() !== "" ? finalSummary : status === "waiting" ? `The cycle is waiting on owners: ${waiting} approval(s)${waitingFor.length > 0 ? `, and signatures from ${waitingFor.join(", ")}` : ""}.` : "The cycle is complete.";
  await finishRun(ctx, runId, status, summary, stats);
}
