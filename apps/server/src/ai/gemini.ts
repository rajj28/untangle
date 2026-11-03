// Gemini over REST. We talk to the API directly (not through an SDK) because current models require
// each function call's thought signature to be sent back verbatim, which older SDKs drop.

export interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
  thoughtSignature?: string;
  [key: string]: unknown;
}

export interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

export interface FunctionDeclaration {
  name: string;
  description: string;
  parametersJsonSchema: Record<string, unknown>;
}

export interface GenerateRequest {
  system?: string;
  contents: GeminiContent[];
  tools?: FunctionDeclaration[];
  responseJsonSchema?: Record<string, unknown>;
  temperature?: number;
}

export interface GenerateResult {
  content: GeminiContent;
  text: string;
  functionCalls: { name: string; args: Record<string, unknown> }[];
  model: string;
}

export class AiError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = "AiError";
    this.code = code;
    this.retryable = retryable;
  }
}

export interface Gemini {
  readonly models: readonly string[];
  generate(request: GenerateRequest): Promise<GenerateResult>;
}

export interface GeminiOptions {
  apiKey: string;
  /** Tried in order: a model that is unknown, retired or overloaded hands over to the next. */
  models: readonly string[];
  requestsPerMinute?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const API = "https://generativelanguage.googleapis.com/v1beta/models";

/** Spaces requests out so a free-tier key is never asked for more than its per-minute budget. */
function rateLimiter(perMinute: number, sleep: (ms: number) => Promise<void>) {
  const gap = Math.ceil(60_000 / perMinute);
  let next = 0;
  return async () => {
    const now = Date.now();
    const at = Math.max(now, next);
    next = at + gap;
    if (at > now) await sleep(at - now);
  };
}

function retryDelayMs(body: unknown): number | null {
  const details = (body as { error?: { details?: { "@type"?: string; retryDelay?: string }[] } }).error?.details ?? [];
  const info = details.find((detail) => detail["@type"]?.endsWith("RetryInfo"));
  const match = info?.retryDelay?.match(/^(\d+(?:\.\d+)?)s$/);
  return match ? Math.ceil(Number(match[1]) * 1000) : null;
}

export function createGemini(options: GeminiOptions): Gemini {
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const wait = rateLimiter(options.requestsPerMinute ?? 14, sleep);
  const timeoutMs = options.timeoutMs ?? 90_000;

  async function callModel(model: string, request: GenerateRequest): Promise<GenerateResult> {
    const body: Record<string, unknown> = {
      contents: request.contents,
      generationConfig: {
        temperature: request.temperature ?? 0.2,
        ...(request.responseJsonSchema === undefined ? {} : { responseMimeType: "application/json", responseJsonSchema: request.responseJsonSchema }),
      },
      ...(request.system === undefined ? {} : { systemInstruction: { parts: [{ text: request.system }] } }),
      ...(request.tools === undefined || request.tools.length === 0 ? {} : { tools: [{ functionDeclarations: request.tools }] }),
    };
    for (let attempt = 1; ; attempt++) {
      await wait();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await doFetch(`${API}/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          signal: controller.signal,
          headers: { "content-type": "application/json", "x-goog-api-key": options.apiKey },
          body: JSON.stringify(body),
        });
      } catch (error) {
        clearTimeout(timer);
        if (attempt < 3) { await sleep(1000 * attempt); continue; }
        throw new AiError("AI_NETWORK", `Gemini ${model} could not be reached: ${error instanceof Error ? error.message : String(error)}`, true);
      }
      clearTimeout(timer);
      const json = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (response.ok) {
        const candidate = (json.candidates as { content?: GeminiContent; finishReason?: string }[] | undefined)?.[0];
        const content: GeminiContent = candidate?.content ?? { role: "model", parts: [] };
        if (!Array.isArray(content.parts)) content.parts = [];
        const text = content.parts.filter((part) => typeof part.text === "string" && part.thought !== true).map((part) => part.text).join("");
        const functionCalls = content.parts
          .filter((part) => part.functionCall !== undefined)
          .map((part) => ({ name: part.functionCall!.name, args: part.functionCall!.args ?? {} }));
        return { content, text, functionCalls, model };
      }
      const message = String((json.error as { message?: string } | undefined)?.message ?? `HTTP ${response.status}`);
      if (response.status === 404) throw new AiError("AI_MODEL_UNAVAILABLE", `${model}: ${message}`, false);
      if ((response.status === 429 || response.status >= 500) && attempt < 3) {
        await sleep(Math.min(20_000, retryDelayMs(json) ?? 1500 * 2 ** attempt));
        continue;
      }
      const retryable = response.status === 429 || response.status >= 500;
      throw new AiError(response.status === 429 ? "AI_RATE_LIMITED" : retryable ? "AI_UNAVAILABLE" : "AI_BAD_REQUEST", `${model}: ${message}`, retryable);
    }
  }

  return {
    models: options.models,
    async generate(request) {
      let lastError: unknown;
      for (const model of options.models) {
        try {
          return await callModel(model, request);
        } catch (error) {
          lastError = error;
          // A bad request is our fault and would fail on every model, so stop there.
          if (error instanceof AiError && error.code === "AI_BAD_REQUEST") throw error;
        }
      }
      throw lastError instanceof Error ? lastError : new AiError("AI_UNAVAILABLE", "No Gemini model answered", true);
    },
  };
}

/** Parses a JSON answer, tolerating a fenced block around it. */
export function parseJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  return JSON.parse(trimmed);
}
