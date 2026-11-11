import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { ZodError } from "zod";
import { PayPalError } from "@untangle/paypal";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "./context.ts";
import { DomainError } from "./errors.ts";
import { healthRoutes } from "./routes/health.ts";
import { networkRoutes } from "./routes/network.ts";
import { roundRoutes } from "./routes/rounds.ts";
import { transferRoutes } from "./routes/transfers.ts";
import { webhookRoutes } from "./routes/webhooks.ts";
import { streamRoutes } from "./routes/stream.ts";
import { auditRoutes } from "./routes/audit.ts";
import { configRoutes } from "./routes/config.ts";
import { demoRoutes } from "./routes/demo.ts";
import { eventRoutes } from "./routes/events.ts";
import { obligationRoutes } from "./routes/obligations.ts";
import { simRoutes } from "./routes/sim.ts";
import { aiRoutes } from "./routes/ai.ts";
import { deskRoutes } from "./routes/desk.ts";
import { confirmRoutes } from "./routes/confirm.ts";
import { judgeRoutes } from "./routes/judge.ts";
import { AiError } from "./ai/gemini.ts";
import type { Sim } from "./sim/fake-paypal.ts";

export interface BuildAppOptions {
  mode?: "sandbox" | "sim";
  sim?: Sim;
  webRoot?: string;
  /** Folder with the demo evidence samples (samples.json plus the files). */
  samplesDir?: string;
}

function safeErrorText(error: unknown, ctx: AppContext): string {
  let text = error instanceof Error ? error.stack ?? error.message : String(error);
  for (const secret of [ctx.config.masterKey.toString("hex"), ...ctx.config.businesses.map((business) => business.clientSecret), ctx.config.platform?.clientSecret]) {
    if (secret !== undefined && secret.length > 0) text = text.split(secret).join("[redacted]");
  }
  return text.replace(/\bBasic\s+[^\s,;]+/gi, "Basic [redacted]").replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]");
}

function sameToken(given: unknown, expected: string): boolean {
  if (typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function buildApp(ctx: AppContext, options: BuildAppOptions = {}): FastifyInstance {
  // trustProxy: Render puts the visitor's address in X-Forwarded-For, and rate limits key on it.
  const app = Fastify({ logger: false, bodyLimit: 65_536, trustProxy: true, maxParamLength: 512 });
  const mode = options.mode ?? "sandbox";
  // The demo is public: reads are open, but anything that writes needs the judge access code when one is set.
  const writeToken = ctx.config.demoWriteToken;
  if (writeToken !== undefined) {
    app.addHook("onRequest", async (request, reply) => {
      if (request.method !== "POST" || !request.url.startsWith("/api/")) return;
      // The desk is a read-only computation (synthetic city rows); it never writes.
      if (request.url.startsWith("/api/desk/")) return;
      // Signed confirmation links are self-authorizing capabilities; judges use them to confirm/reject.
      if (request.url.startsWith("/api/confirm/")) return;
      // Judge networks are public sandbox playgrounds; their writes are separate, isolated networks.
      if (request.url.startsWith("/api/judge/")) return;
      if (sameToken(request.headers["x-demo-token"], writeToken)) return;
      return reply.code(401).send({ error: "ACCESS_CODE_REQUIRED", message: "Enter the demo access code to make changes." });
    });
  }
  app.register(rateLimit, {
    global: true,
    timeWindow: "1 minute",
    max: (request) => (request.method === "GET" || request.method === "HEAD" ? 600 : 60),
    // PayPal sends webhooks in bursts during a round; their signatures are verified instead.
    // RATE_LIMIT_LOOPBACK_OFF=1 lifts the limit for loopback callers only (local demo recordings).
    allowList: (request) => request.url.startsWith("/webhooks/")
      || (process.env.RATE_LIMIT_LOOPBACK_OFF === "1" && (request.ip === "127.0.0.1" || request.ip === "::1" || request.ip === "::ffff:127.0.0.1")),
  });
  app.register(healthRoutes, { ctx });
  app.register(networkRoutes, { ctx });
  app.register(configRoutes, { ctx, mode });
  app.register(roundRoutes, { ctx });
  app.register(transferRoutes, { ctx });
  app.register(obligationRoutes, { ctx });
  app.register(eventRoutes, { ctx });
  app.register(demoRoutes, { ctx });
  app.register(webhookRoutes, { ctx });
  app.register(streamRoutes, { ctx });
  app.register(auditRoutes, { ctx });
  app.register(aiRoutes, { ctx, ...(options.samplesDir === undefined ? {} : { samplesDir: options.samplesDir }) });
  app.register(deskRoutes, { ctx });
  app.register(confirmRoutes, { ctx });
  app.register(judgeRoutes, { ctx });
  if (options.sim !== undefined) app.register(simRoutes, { ctx, sim: options.sim });
  const hasWeb = options.webRoot !== undefined && existsSync(join(options.webRoot, "index.html"));
  if (hasWeb) {
    app.register(fastifyStatic, {
      root: options.webRoot!,
      // Hashed build assets never change; the page itself is always revalidated.
      setHeaders: (reply, filePath) => {
        if (/[\/]assets[\/]/.test(filePath)) reply.header("cache-control", "public, max-age=31536000, immutable");
      },
    });
  }
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DomainError) return reply.code(error.status).send({ error: error.code, message: error.message });
    if (error instanceof ZodError) return reply.code(400).send({ error: "BAD_REQUEST", message: error.message });
    if (error instanceof AiError) {
      return reply.code(error.code === "AI_RATE_LIMITED" ? 429 : 502).send({ error: error.code, message: "The AI service is busy or unavailable; try again in a minute." });
    }
    if (error instanceof PayPalError) return reply.code(502).send({ error: "PAYPAL_ERROR", code: error.code, debugId: error.debugId, message: error.message });
    // Fastify's own client errors (bad JSON, wrong content type) keep their status.
    const statusCode = typeof error === "object" && error !== null && "statusCode" in error ? error.statusCode : undefined;
    if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({ error: "BAD_REQUEST", message: error instanceof Error ? error.message : "Bad request" });
    }
    console.error(safeErrorText(error, ctx));
    return reply.code(500).send({ error: "INTERNAL" });
  });
  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split("?", 1)[0] ?? request.url;
    const acceptsHtml = request.headers.accept?.includes("text/html") ?? false;
    if (hasWeb && request.method === "GET" && !path.startsWith("/api/") && !path.startsWith("/webhooks/") && acceptsHtml) {
      return reply.type("text/html").sendFile("index.html");
    }
    return reply.code(404).send({ error: "NOT_FOUND" });
  });
  return app;
}
