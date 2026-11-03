import { z } from "zod";

export interface BusinessConfig {
  slot: number;
  name: string;
  email: string;
  clientId: string;
  clientSecret: string;
}

export interface Config {
  databaseUrl: string;
  masterKey: Buffer;
  port: number;
  publicBaseUrl: string;
  demoMode: boolean;
  networkName: string;
  currency: string;
  platform?: { clientId: string; clientSecret: string };
  businesses: BusinessConfig[];
  geminiApiKey?: string;
  /** Tried in order; the first that answers wins. */
  geminiModels: string[];
  aiRequestsPerMinute: number;
  agGridLicenseKey?: string;
  /** When set, every write under /api needs this code in the x-demo-token header (judges get it with the demo link). */
  demoWriteToken?: string;
}

const nonEmpty = z.string().trim().min(1);
const baseSchema = z.object({
  DATABASE_URL: nonEmpty,
  MASTER_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, "must be exactly 64 hexadecimal characters"),
  PORT: z.string().optional(),
  PUBLIC_BASE_URL: z.string().url().optional(),
  DEMO_MODE: z.string().optional(),
  NETWORK_NAME: nonEmpty.optional(),
  NETWORK_CURRENCY: z.string().regex(/^[A-Z]{3}$/).optional(),
  PAYPAL_PLATFORM_CLIENT_ID: z.string().optional(),
  PAYPAL_PLATFORM_CLIENT_SECRET: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODELS: z.string().optional(),
  AI_RPM: z.string().regex(/^\d+$/).optional(),
  AG_GRID_LICENSE_KEY: z.string().optional(),
  DEMO_WRITE_TOKEN: z.string().trim().min(8, "must be at least 8 characters").optional().or(z.literal("")),
});

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const issues: string[] = [];
  const base = baseSchema.safeParse(env);
  if (!base.success) {
    for (const issue of base.error.issues) {
      const key = issue.path.join(".") || "environment";
      const message = issue.message === "Required" ? "is required" : issue.message;
      issues.push(`${key} ${message}`);
    }
  }

  const portText = env.PORT;
  const port = portText === undefined || portText === "" ? 3000 : Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) issues.push("PORT must be an integer from 1 to 65535");

  const platformId = env.PAYPAL_PLATFORM_CLIENT_ID?.trim() ?? "";
  const platformSecret = env.PAYPAL_PLATFORM_CLIENT_SECRET?.trim() ?? "";
  if ((platformId.length === 0) !== (platformSecret.length === 0)) {
    issues.push("PAYPAL_PLATFORM_CLIENT_ID and PAYPAL_PLATFORM_CLIENT_SECRET must be set together");
  }

  const businesses: BusinessConfig[] = [];
  const emails = new Set<string>();
  for (let slot = 1; slot <= 20; slot++) {
    const prefix = `PAYPAL_BIZ_${slot}_`;
    const values = {
      name: env[`${prefix}NAME`]?.trim() ?? "",
      email: env[`${prefix}EMAIL`]?.trim() ?? "",
      clientId: env[`${prefix}CLIENT_ID`]?.trim() ?? "",
      clientSecret: env[`${prefix}CLIENT_SECRET`]?.trim() ?? "",
    };
    const filled = Object.values(values).filter((value) => value.length > 0).length;
    if (filled === 0) continue;
    if (filled !== 4) {
      issues.push(`PAYPAL_BIZ_${slot} is partially filled; set NAME, EMAIL, CLIENT_ID and CLIENT_SECRET`);
      continue;
    }
    if (!z.string().email().safeParse(values.email).success) issues.push(`${prefix}EMAIL must be a valid email address`);
    const normalizedEmail = values.email.toLowerCase();
    if (emails.has(normalizedEmail)) issues.push(`${prefix}EMAIL duplicates another business email`);
    emails.add(normalizedEmail);
    businesses.push({ slot, ...values });
  }

  if (issues.length > 0) throw new Error(`Invalid configuration:\n- ${issues.join("\n- ")}`);

  const parsed = base.data!;
  return {
    databaseUrl: parsed.DATABASE_URL,
    masterKey: Buffer.from(parsed.MASTER_KEY, "hex"),
    port,
    publicBaseUrl: parsed.PUBLIC_BASE_URL ?? "http://localhost:3000",
    demoMode: parsed.DEMO_MODE !== "0",
    networkName: parsed.NETWORK_NAME ?? "Main Street",
    currency: parsed.NETWORK_CURRENCY ?? "USD",
    ...(platformId.length === 0 ? {} : { platform: { clientId: platformId, clientSecret: platformSecret } }),
    businesses: businesses.sort((a, b) => a.slot - b.slot),
    geminiModels: (parsed.GEMINI_MODELS ?? "gemini-flash-lite-latest,gemini-flash-latest,gemini-3.8-flash").split(",").map((model) => model.trim()).filter(Boolean),
    aiRequestsPerMinute: parsed.AI_RPM === undefined ? 14 : Number(parsed.AI_RPM),
    ...(parsed.GEMINI_API_KEY === undefined || parsed.GEMINI_API_KEY.length === 0 ? {} : { geminiApiKey: parsed.GEMINI_API_KEY }),
    ...(parsed.AG_GRID_LICENSE_KEY === undefined || parsed.AG_GRID_LICENSE_KEY.trim().length === 0 ? {} : { agGridLicenseKey: parsed.AG_GRID_LICENSE_KEY.trim() }),
    ...(parsed.DEMO_WRITE_TOKEN === undefined || parsed.DEMO_WRITE_TOKEN === "" ? {} : { demoWriteToken: parsed.DEMO_WRITE_TOKEN }),
  };
}
