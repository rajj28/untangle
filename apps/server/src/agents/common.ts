import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { aiCache, businesses } from "@untangle/db";
import type { AppContext } from "../context.ts";
import type { Gemini } from "../ai/gemini.ts";
import { DomainError } from "../errors.ts";

export function requireGemini(ctx: AppContext): Gemini {
  if (ctx.ai.gemini === null) throw new DomainError(503, "AI_UNAVAILABLE", "AI is not configured on this server.");
  return ctx.ai.gemini;
}

export function usd(minor: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 100);
}

/** "3,000.50" or "$3000" → 300050 cents; anything else → null. */
export function toMinor(decimal: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(decimal.trim().replace(/[,$\s]/g, ""));
  if (match === null) return null;
  const minor = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

export function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

export async function networkBusinesses(ctx: AppContext, networkId: string) {
  return ctx.db.select({ id: businesses.id, name: businesses.name, email: businesses.email }).from(businesses)
    .where(eq(businesses.networkId, networkId)).orderBy(businesses.name);
}

/** Runs `compute` once per input; the answer is stored, so a repeated question costs nothing. */
export async function cached<T>(ctx: AppContext, key: string, schemaVersion: number, compute: () => Promise<{ value: T; model: string }>): Promise<{ value: T; model: string; cached: boolean }> {
  const inputSha256 = sha256(key);
  const [hit] = await ctx.db.select().from(aiCache).where(and(eq(aiCache.inputSha256, inputSha256), eq(aiCache.schemaVersion, schemaVersion))).limit(1);
  if (hit !== undefined) return { value: hit.output as T, model: hit.model, cached: true };
  const fresh = await compute();
  await ctx.db.insert(aiCache).values({ inputSha256, model: fresh.model, schemaVersion, output: fresh.value as object }).onConflictDoNothing();
  return { ...fresh, cached: false };
}

export function short(text: string, max = 220): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
