import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { agentRuns, approvals, claims, consents, obligations } from "@untangle/db";
import type { Gemini, GenerateRequest, GenerateResult } from "../src/ai/gemini.ts";
import { decideApproval } from "../src/agents/approvals.ts";
import { ingestEvidence } from "../src/agents/intake.ts";
import { explainStatement, gridQuery } from "../src/agents/insight.ts";
import { runCycle } from "../src/agents/orchestrator.ts";
import { interruptOrphanedRuns, startRun } from "../src/agents/runs.ts";
import { startVerification } from "../src/agents/watchdog.ts";
import { startDispute } from "../src/agents/negotiation.ts";
import { planRound } from "../src/services/rounds.ts";
import { makeTestContext } from "./context.ts";

/** A scripted Gemini: answers by which agent is asking, and records every request. */
function fakeGemini(answers: Partial<Record<"intake" | "invoicing" | "treasurer" | "explainer" | "collections", (request: GenerateRequest) => unknown>>) {
  const requests: GenerateRequest[] = [];
  const gemini: Gemini = {
    models: ["fake-model"],
    async generate(request): Promise<GenerateResult> {
      requests.push(request);
      const system = request.system ?? "";
      const agent = system.includes("Intake agent") ? "intake"
        : system.includes("Invoicing agent") ? "invoicing"
          : system.includes("AI treasurer") ? "treasurer"
            : system.includes("explain clearing statements") ? "explainer"
              : system.includes("Collections agent") ? "collections" : null;
      const answer = agent === null ? undefined : answers[agent]?.(request);
      // Agents without a scripted answer (orchestrator, discovery, watchdog) just reply in words, calling no tools.
      const text = answer === undefined ? "Done." : JSON.stringify(answer);
      return { content: { role: "model", parts: [{ text }] }, text, functionCalls: [], model: "fake-model" };
    },
  };
  return { gemini, requests };
}

const chat = Buffer.from("Mill: the extra rye flour is $640, due Nov 30.\nBakery: ok, $640.").toString("base64");

describe("ai agents", () => {
  it("reads evidence into a claim, then issues a PayPal invoice through the toolkit tools once approved", async () => {
    const { gemini } = fakeGemini({
      intake: () => ({ language: "en", summary: "Chat about rye flour", isDebtEvidence: true, warnings: [],
        debts: [{ debtor: "Bakery", creditor: "Mill", amount: "640.00", currency: "USD", item: "Rye flour", dueOn: "2026-11-30", confidence: 0.95, quote: "$640" }] }),
      invoicing: () => ({ note: "Thanks for your order of rye flour." }),
    });
    const test = await makeTestContext({ gemini });
    const evidence = await ingestEvidence(test.ctx, { businessId: test.ids.mill, fileName: "chat.txt", mime: "text/plain", dataBase64: chat });
    expect(evidence.status).toBe("extracted");
    expect(evidence.claims).toHaveLength(1);
    const claim = evidence.claims[0]!;
    expect(claim).toMatchObject({ debtorId: test.ids.bakery, creditorId: test.ids.mill, amountMinor: 64_000, quote: "$640" });
    expect(claim.approvalId).not.toBeNull();

    const approved = await decideApproval(test.ctx, claim.approvalId!, "approve");
    expect(approved.status).toBe("executed");
    const invoiceId = (approved.result as { invoiceId: string }).invoiceId;
    expect(test.sim.invoice(invoiceId)).toMatchObject({ status: "SENT", dueMinor: 64_000 });
    const [row] = await test.ctx.db.select().from(obligations).where(eq(obligations.paypalInvoiceId, invoiceId));
    expect(row).toMatchObject({ debtorId: test.ids.bakery, creditorId: test.ids.mill, amountMinor: 64_000, status: "invoiced" });
    expect((await test.ctx.db.select().from(claims).where(eq(claims.id, claim.id)))[0]?.status).toBe("matched");

    // The same file again is recognised, not read twice.
    const again = await ingestEvidence(test.ctx, { businessId: test.ids.mill, fileName: "chat.txt", mime: "text/plain", dataBase64: chat });
    expect(again.id).toBe(evidence.id);
  });

  it("lets treasurers sign only within their owner's policy, whatever the model says", async () => {
    const { gemini } = fakeGemini({ treasurer: () => ({ decision: "sign", rationale: "Looks good.", ownerNote: "Signed." }) });
    const test = await makeTestContext({ gemini });
    const runId = await startRun(test.ctx, test.ids.network, "cycle", "test cycle");
    await runCycle(test.ctx, test.ids.network, runId);

    // Default policy signs only when no money leaves: the mill only receives; the bakery and trucker would pay.
    const signed = await test.ctx.db.select({ businessId: consents.businessId, method: consents.method }).from(consents);
    expect(signed).toEqual([{ businessId: test.ids.mill, method: "policy" }]);
    const [run] = await test.ctx.db.select().from(agentRuns).where(eq(agentRuns.id, runId));
    expect(run?.status).toBe("waiting");
  });

  it("falls back to the statement's own facts when the model invents an amount", async () => {
    const { gemini, requests } = fakeGemini({ explainer: () => ({ headline: "Your round", paragraphs: ["You will receive $9,999.00 today."], actions: [] }) });
    const test = await makeTestContext({ gemini });
    const round = await planRound(test.ctx, test.ids.network);
    const explanation = await explainStatement(test.ctx, round.id, test.ids.mill, "es");
    expect(explanation.model).toBe("statement");
    expect(explanation.paragraphs.join(" ")).not.toContain("9,999");
    expect(requests.filter((request) => request.system?.includes("explain clearing statements"))).toHaveLength(2);
    // Cached by statement and language: asking again costs no model call.
    await explainStatement(test.ctx, round.id, test.ids.mill, "es");
    expect(requests.filter((request) => request.system?.includes("explain clearing statements"))).toHaveLength(2);
  });

  it("refuses AI work when no model is configured", async () => {
    const test = await makeTestContext();
    await expect(ingestEvidence(test.ctx, { businessId: test.ids.mill, fileName: "chat.txt", mime: "text/plain", dataBase64: chat }))
      .rejects.toMatchObject({ status: 503, code: "AI_UNAVAILABLE" });
    expect(await test.ctx.db.select().from(approvals).where(and(eq(approvals.status, "pending")))).toHaveLength(0);
  });
});

describe("negotiation", () => {
  it("lets two treasurers settle a disputed amount from the evidence, and keeps the invoice out of clearing meanwhile", async () => {
    const turns: string[] = [];
    const gemini: Gemini = {
      models: ["fake-model"],
      async generate(request) {
        const system = request.system ?? "";
        const debtorTurn = system.startsWith("You are Trucker's");
        turns.push(debtorTurn ? "debtor" : "creditor");
        // The debtor opens low; the creditor quotes the correction; the debtor sees the evidence and accepts.
        const answer = !debtorTurn ? { position: "28.00", argument: "The invoice says $28 and the chat corrects it to that.", accept: false }
          : turns.filter((side) => side === "debtor").length === 1 ? { position: "25.00", argument: "We agreed $25.", accept: false }
            : { position: "28.00", argument: "The evidence shows $28; we accept.", accept: true };
        const text = JSON.stringify(answer);
        return { content: { role: "model", parts: [{ text }] }, text, functionCalls: [], model: "fake-model" };
      },
    };
    const test = await makeTestContext({ gemini });
    const runId = await startDispute(test.ctx, test.ids.c, { byBusinessId: test.ids.trucker, claimedAmountMinor: 2_500, reason: "We agreed $25 on the phone" });
    // Disputed invoices are frozen out of clearing until the negotiation ends.
    expect((await test.ctx.db.select().from(obligations).where(eq(obligations.id, test.ids.c)))[0]?.status).toBe("disputed");
    for (let i = 0; i < 50; i++) {
      const [run] = await test.ctx.db.select().from(agentRuns).where(eq(agentRuns.id, runId));
      if (run?.status !== "running") break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const [run] = await test.ctx.db.select().from(agentRuns).where(eq(agentRuns.id, runId));
    expect(run?.status).toBe("completed");
    expect(turns).toEqual(["debtor", "creditor", "debtor"]);
    expect((await test.ctx.db.select().from(obligations).where(eq(obligations.id, test.ids.c)))[0]?.status).toBe("invoiced");
  });

  it("only lets a party dispute, and only an amount below the invoice", async () => {
    const test = await makeTestContext({ gemini: fakeGemini({}).gemini });
    await expect(startDispute(test.ctx, test.ids.c, { byBusinessId: test.ids.mill, claimedAmountMinor: 100, reason: "not mine" })).rejects.toMatchObject({ code: "NOT_A_PARTY" });
    await expect(startDispute(test.ctx, test.ids.c, { byBusinessId: test.ids.trucker, claimedAmountMinor: 999_999, reason: "too much" })).rejects.toMatchObject({ code: "BAD_AMOUNT" });
  });
});

describe("ask the ledger", () => {
  it("keeps AG Grid's schema references resolvable when nesting it under gridState", async () => {
    const requests: GenerateRequest[] = [];
    const gemini: Gemini = {
      models: ["fake-model"],
      async generate(request) {
        requests.push(request);
        const text = JSON.stringify({ gridState: { sort: "amountMinor" }, explanation: "Sorted by amount." });
        return { content: { role: "model", parts: [{ text }] }, text, functionCalls: [], model: "fake-model" };
      },
    };
    const test = await makeTestContext({ gemini });
    const schema = { type: "object", properties: { sort: { $ref: "#/$defs/colId" } }, $defs: { colId: { type: "string", enum: ["amountMinor"] } } };
    const result = await gridQuery(test.ctx, { question: "largest first", schema, state: {} });
    expect(result.explanation).toBe("Sorted by amount.");
    const sent = requests[0]?.responseJsonSchema as { $defs?: unknown; properties: { gridState: Record<string, unknown> } };
    expect(sent.$defs).toEqual(schema.$defs);
    expect(sent.properties.gridState).not.toHaveProperty("$defs");
    expect(sent.properties.gridState).toMatchObject({ properties: { sort: { $ref: "#/$defs/colId" } } });
  });
});

describe("after a crash", () => {
  it("marks runs that were running when the process died as interrupted", async () => {
    const test = await makeTestContext({ gemini: fakeGemini({}).gemini });
    const runId = await startRun(test.ctx, test.ids.network, "cycle", "a cycle the crash interrupted");
    expect(await interruptOrphanedRuns(test.ctx)).toBe(1);
    const [run] = await test.ctx.db.select().from(agentRuns).where(eq(agentRuns.id, runId));
    expect(run).toMatchObject({ status: "failed", summary: "Interrupted by a server restart" });
  });

  it("only verifies rounds that have written to PayPal", async () => {
    const test = await makeTestContext({ gemini: fakeGemini({}).gemini });
    const round = await planRound(test.ctx, test.ids.network);
    await expect(startVerification(test.ctx, round.id)).rejects.toMatchObject({ code: "ROUND_NOT_EXECUTED" });
  });
});
