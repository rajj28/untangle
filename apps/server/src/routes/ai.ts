import type { FastifyPluginAsync } from "fastify";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { businesses } from "@untangle/db";
import type { AppContext } from "../context.ts";
import { DomainError } from "../errors.ts";
import { decideApproval, listApprovals } from "../agents/approvals.ts";
import { evidenceFile, evidenceView, ingestEvidence, listEvidence } from "../agents/intake.ts";
import { adviseBusiness, explainStatement, gridQuery } from "../agents/insight.ts";
import { startCycle } from "../agents/orchestrator.ts";
import { startDispute } from "../agents/negotiation.ts";
import { getRunDetail, listRuns } from "../agents/runs.ts";
import { startVerification } from "../agents/watchdog.ts";
import { requireUuid } from "./shared.ts";

// Gemini's free tier allows a few requests a minute, so AI routes have their own, tighter limit.
const aiLimit = { config: { rateLimit: { max: 12, timeWindow: "1 minute" } } };

const evidenceBody = z.object({
  businessId: z.string().uuid(),
  fileName: z.string().min(1).max(200),
  mime: z.string().min(3).max(100),
  dataBase64: z.string().min(4),
});

interface Sample { id: string; title: string; kind: string; mime: string; fileName: string; uploader: string }

export const aiRoutes: FastifyPluginAsync<{ ctx: AppContext; samplesDir?: string }> = async (app, options) => {
  const { ctx } = options;

  app.get("/api/ai/status", async () => ({ enabled: ctx.ai.gemini !== null, model: ctx.ai.gemini?.models[0] ?? null }));

  app.post<{ Body: unknown }>("/api/agents/cycle", aiLimit, async (request, reply) => {
    const body = z.object({ networkId: z.string().uuid() }).parse(request.body);
    reply.code(202);
    return { runId: await startCycle(ctx, body.networkId) };
  });
  app.post<{ Params: { id: string }; Body: unknown }>("/api/obligations/:id/dispute", aiLimit, async (request, reply) => {
    const body = z.object({ byBusinessId: z.string().uuid(), claimedAmountMinor: z.number().int().positive(), reason: z.string().min(3).max(300) }).parse(request.body);
    reply.code(202);
    return { runId: await startDispute(ctx, requireUuid(request.params.id), body) };
  });
  app.post<{ Params: { id: string } }>("/api/rounds/:id/verify", aiLimit, async (request, reply) => {
    reply.code(202);
    return { runId: await startVerification(ctx, requireUuid(request.params.id)) };
  });
  app.get<{ Params: { id: string } }>("/api/networks/:id/agents/runs", async (request) => listRuns(ctx, requireUuid(request.params.id)));
  app.get<{ Params: { id: string } }>("/api/agents/runs/:id", async (request) => getRunDetail(ctx, requireUuid(request.params.id)));

  app.get<{ Params: { id: string }; Querystring: { status?: string } }>("/api/networks/:id/approvals", async (request) => {
    const status = z.enum(["pending", "approved", "rejected", "executed", "failed", "blocked"]).optional().parse(request.query.status);
    return listApprovals(ctx, requireUuid(request.params.id), status);
  });
  app.post<{ Params: { id: string } }>("/api/approvals/:id/approve", aiLimit, async (request) => decideApproval(ctx, requireUuid(request.params.id), "approve"));
  app.post<{ Params: { id: string } }>("/api/approvals/:id/reject", async (request) => decideApproval(ctx, requireUuid(request.params.id), "reject"));

  // Evidence arrives as base64 JSON; 8 MB of file is about 11 MB encoded.
  app.post<{ Body: unknown }>("/api/evidence", { bodyLimit: 12 * 1024 * 1024, ...aiLimit }, async (request, reply) => {
    const body = evidenceBody.parse(request.body);
    reply.code(201);
    return ingestEvidence(ctx, body);
  });
  app.get<{ Params: { id: string } }>("/api/networks/:id/evidence", async (request) => listEvidence(ctx, requireUuid(request.params.id)));
  app.get<{ Params: { id: string } }>("/api/evidence/:id", async (request) => evidenceView(ctx, requireUuid(request.params.id)));
  app.get<{ Params: { id: string } }>("/api/evidence/:id/file", async (request, reply) => {
    const file = await evidenceFile(ctx, requireUuid(request.params.id));
    return reply.type(file.mime).header("cache-control", "private, max-age=3600").send(file.bytes);
  });

  app.post<{ Params: { id: string; businessId: string }; Body: unknown }>("/api/rounds/:id/statements/:businessId/explain", aiLimit, async (request) => {
    const body = z.object({ language: z.string().min(2).max(10) }).parse(request.body);
    return explainStatement(ctx, requireUuid(request.params.id), requireUuid(request.params.businessId), body.language.toLowerCase().slice(0, 2));
  });
  app.get<{ Params: { id: string } }>("/api/businesses/:id/advice", aiLimit, async (request) => adviseBusiness(ctx, requireUuid(request.params.id)));
  app.post<{ Body: unknown }>("/api/ai/grid", { bodyLimit: 512 * 1024, ...aiLimit }, async (request) => {
    const body = z.object({ question: z.string().min(2).max(500), schema: z.record(z.string(), z.unknown()), state: z.record(z.string(), z.unknown()) }).parse(request.body);
    return gridQuery(ctx, body);
  });

  // Ready-made evidence for judges who don't have a bill photo or voice note to hand.
  const loadSamples = async (): Promise<Sample[]> => {
    if (options.samplesDir === undefined) return [];
    try {
      return JSON.parse(await readFile(`${options.samplesDir}/samples.json`, "utf8")) as Sample[];
    } catch {
      return [];
    }
  };
  app.get("/api/demo/evidence-samples", async () => {
    const samples = await loadSamples();
    const rows = await ctx.db.select({ id: businesses.id, name: businesses.name }).from(businesses);
    const idByName = new Map(rows.map((row) => [row.name, row.id]));
    return samples.map((sample) => ({
      id: sample.id, title: sample.title, kind: sample.kind, mime: sample.mime, fileName: sample.fileName,
      url: `/api/demo/evidence-samples/${encodeURIComponent(sample.id)}/file`, uploaderBusinessId: idByName.get(sample.uploader) ?? null,
    }));
  });
  app.get<{ Params: { id: string } }>("/api/demo/evidence-samples/:id/file", async (request, reply) => {
    const sample = (await loadSamples()).find((item) => item.id === request.params.id);
    if (sample === undefined || options.samplesDir === undefined) throw new DomainError(404, "SAMPLE_NOT_FOUND", "Sample was not found");
    return reply.type(sample.mime).send(await readFile(`${options.samplesDir}/${sample.fileName}`));
  });
};
