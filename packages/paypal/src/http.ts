import { PayPalError, parsePayPalError } from "./errors.ts";
import type { PayPalClientConfig, RequestInfoLog } from "./types.ts";

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  form?: FormData;
  idempotencyKey?: string;
  preferRepresentation?: boolean;
  accessToken?: string;
  expectText?: boolean;
}

type HttpConfig = Required<Pick<PayPalClientConfig, "clientId" | "clientSecret" | "environment">> & PayPalClientConfig;
type RequestMethod = "GET" | "POST" | "PATCH" | "DELETE";

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

interface CachedToken {
  value: string;
  obtainedAt: number;
  expiresIn: number;
}

interface FetchedResponse {
  response: Response;
  text: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 3;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class HttpCore {
  readonly apiBase: string;
  readonly webBase: string;

  private readonly fetchImpl: typeof fetch;
  private readonly sleepImpl: (ms: number) => Promise<void>;
  private readonly nowImpl: () => number;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly onRequest: ((info: RequestInfoLog) => void) | undefined;
  private readonly config: HttpConfig;
  private cachedToken: CachedToken | undefined;
  private tokenFlight: Promise<string> | undefined;

  constructor(config: HttpConfig) {
    this.config = config;
    this.apiBase = config.environment === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
    this.webBase = config.environment === "sandbox" ? "https://www.sandbox.paypal.com" : "https://www.paypal.com";
    this.fetchImpl = config.fetch ?? globalThis.fetch;
    this.sleepImpl = config.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.nowImpl = config.now ?? Date.now;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.onRequest = config.onRequest;
  }

  async getAppToken(): Promise<string> {
    const now = this.nowImpl();
    if (this.cachedToken !== undefined && now < this.cachedToken.obtainedAt + (this.cachedToken.expiresIn - 60) * 1000) {
      return this.cachedToken.value;
    }
    if (this.tokenFlight !== undefined) return this.tokenFlight;

    const flight = this.requestAppToken();
    this.tokenFlight = flight;
    try {
      return await flight;
    } finally {
      if (this.tokenFlight === flight) this.tokenFlight = undefined;
    }
  }

  async request<T>(method: RequestMethod, path: string, options: RequestOptions = {}): Promise<T> {
    if (options.form !== undefined && options.body !== undefined) {
      throw new TypeError("form and body cannot be used together");
    }

    const requestPath = path.split("?", 1)[0] ?? path;
    const url = this.buildUrl(requestPath, options.query);
    const canRetry = method === "GET" || method === "DELETE" ||
      ((method === "POST" || method === "PATCH") && options.idempotencyKey !== undefined);
    let retryCount = 0;
    let unauthorizedRetries = 0;

    while (true) {
      const token = options.accessToken ?? await this.getAppToken();
      const headers = new Headers({
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      });
      if (options.body !== undefined) headers.set("Content-Type", "application/json");
      if (options.idempotencyKey !== undefined) headers.set("PayPal-Request-Id", options.idempotencyKey);
      if (options.preferRepresentation === true) headers.set("Prefer", "return=representation");

      const body = options.form ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
      const startedAt = this.nowImpl();
      let response: Response | undefined;
      let responseText = "";
      let error: PayPalError | undefined;

      try {
        const fetched = await this.fetchText(url, {
          method,
          headers,
          ...(body === undefined ? {} : { body }),
        }, method, requestPath);
        response = fetched.response;
        responseText = fetched.text;
      } catch (caught) {
        error = this.sanitizeError(caught, [token]);
      }

      if (response !== undefined && response.ok) {
        const retrying = false;
        this.logAttempt({ method, path: this.redact(requestPath, [token]), status: response.status, attempt: retryCount + unauthorizedRetries + 1,
          durationMs: Math.max(0, this.nowImpl() - startedAt),
          debugId: this.safeDebugId(response.headers.get("paypal-debug-id"), token), retrying });
        if (response.status === 204 || responseText.length === 0) return undefined as T;
        if (options.expectText === true) return responseText as T;
        return JSON.parse(responseText) as T;
      }

      let retrying = false;
      let retryAfterSeconds: number | undefined;
      if (response !== undefined) {
        const bodyValue = parseJson(responseText) ?? responseText;
        error = this.sanitizeError(
          parsePayPalError(response.status, bodyValue, response.headers.get("paypal-debug-id"), method, requestPath),
          [token],
        );
        const rawRetryAfter = response.headers.get("retry-after");
        const parsedRetryAfter = rawRetryAfter === null ? Number.NaN : Number(rawRetryAfter);
        if (Number.isFinite(parsedRetryAfter) && parsedRetryAfter >= 0) retryAfterSeconds = parsedRetryAfter;
      }

      const isUnauthorized = response?.status === 401 && unauthorizedRetries === 0;
      if (isUnauthorized) {
        unauthorizedRetries += 1;
        this.cachedToken = undefined;
        retrying = true;
      } else if (error?.retryable === true && canRetry && retryCount < this.maxRetries) {
        retryCount += 1;
        retrying = true;
      }

      this.logAttempt({
        method,
        path: this.redact(requestPath, [token]),
        status: response?.status ?? null,
        attempt: retryCount + unauthorizedRetries + (retrying ? 0 : 1),
        durationMs: Math.max(0, this.nowImpl() - startedAt),
        debugId: this.safeDebugId(response?.headers.get("paypal-debug-id") ?? null, token),
        retrying,
      });

      if (isUnauthorized) continue;
      if (retrying) {
        const backoff = Math.min(5000, 300 * 2 ** retryCount) + Math.floor(Math.random() * 101);
        const delay = retryAfterSeconds === undefined ? backoff : Math.max(backoff, retryAfterSeconds * 1000);
        await this.sleepImpl(delay);
        continue;
      }
      throw error ?? this.networkError(method, requestPath, "unknown request failure");
    }
  }

  async exchangeAuthorizationCode<T>(code: string): Promise<T> {
    const path = "/v1/oauth2/token";
    const credentials = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64");
    const headers = new Headers({
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    });
    const form = new URLSearchParams({ grant_type: "authorization_code", code });
    const fetched = await this.fetchText(`${this.apiBase}${path}`, { method: "POST", headers, body: form.toString() }, "POST", path);
    if (!fetched.response.ok) {
      const body = parseJson(fetched.text) ?? fetched.text;
      throw this.sanitizeError(parsePayPalError(fetched.response.status, body,
        fetched.response.headers.get("paypal-debug-id"), "POST", path), [this.config.clientId, this.config.clientSecret]);
    }
    if (fetched.text.length === 0) return undefined as T;
    return JSON.parse(fetched.text) as T;
  }

  private buildUrl(path: string, query?: RequestOptions["query"]): string {
    if (query === undefined) return `${this.apiBase}${path}`;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) params.set(key, String(value));
    }
    const serialized = params.toString();
    return serialized.length === 0 ? `${this.apiBase}${path}` : `${this.apiBase}${path}?${serialized}`;
  }

  private async requestAppToken(): Promise<string> {
    const path = "/v1/oauth2/token";
    const credentials = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64");
    const headers = new Headers({
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    });

    let fetched: FetchedResponse;
    try {
      fetched = await this.fetchText(`${this.apiBase}${path}`, {
        method: "POST",
        headers,
        body: "grant_type=client_credentials",
      }, "POST", path);
    } catch (error) {
      throw this.sanitizeError(error, [this.config.clientId, this.config.clientSecret]);
    }

    if (!fetched.response.ok) {
      const body = parseJson(fetched.text) ?? fetched.text;
      throw this.sanitizeError(parsePayPalError(fetched.response.status, body,
        fetched.response.headers.get("paypal-debug-id"), "POST", path), [this.config.clientId, this.config.clientSecret]);
    }

    const body = parseJson(fetched.text);
    if (!isRecord(body) || typeof body.access_token !== "string" || typeof body.expires_in !== "number") {
      throw new PayPalError({
        status: fetched.response.status,
        code: "INVALID_TOKEN_RESPONSE",
        method: "POST",
        path,
        retryable: false,
        message: `POST ${path} → ${fetched.response.status} INVALID_TOKEN_RESPONSE`,
      });
    }
    const token = body as unknown as TokenResponse;
    this.cachedToken = { value: token.access_token, obtainedAt: this.nowImpl(), expiresIn: token.expires_in };
    return token.access_token;
  }

  private async fetchText(url: string, init: RequestInit, method: string, path: string): Promise<FetchedResponse> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, { ...init, signal: controller.signal });
      const text = await response.text();
      return { response, text };
    } catch (error) {
      if (timedOut) throw this.timeoutError(method, path);
      throw this.networkError(method, path, this.redact(errorMessage(error), [this.config.clientId, this.config.clientSecret]));
    } finally {
      clearTimeout(timer);
    }
  }

  private timeoutError(method: string, path: string): PayPalError {
    return new PayPalError({
      status: null,
      code: "TIMEOUT",
      method,
      path,
      retryable: true,
      message: `${method} ${path} → TIMEOUT`,
    });
  }

  private networkError(method: string, path: string, cause: string): PayPalError {
    const safeCause = this.redact(cause, [this.config.clientId, this.config.clientSecret]);
    return new PayPalError({
      status: null,
      code: "NETWORK_ERROR",
      method,
      path,
      retryable: true,
      message: `${method} ${path} → NETWORK_ERROR`,
      cause: safeCause,
    });
  }

  private sanitizeError(error: unknown, additionalSecrets: readonly string[] = []): PayPalError {
    const paypalError = error instanceof PayPalError
      ? error
      : this.networkError("GET", "/", errorMessage(error));
    const cause = (paypalError as Error & { cause?: unknown }).cause;
    return new PayPalError({
      status: paypalError.status,
      code: this.redact(paypalError.code, additionalSecrets),
      details: paypalError.details.map((detail) => ({
        ...(detail.issue === undefined ? {} : { issue: this.redact(detail.issue, additionalSecrets) }),
        ...(detail.description === undefined ? {} : { description: this.redact(detail.description, additionalSecrets) }),
        ...(detail.field === undefined ? {} : { field: this.redact(detail.field, additionalSecrets) }),
        ...(detail.value === undefined ? {} : { value: this.redact(detail.value, additionalSecrets) }),
        ...(detail.location === undefined ? {} : { location: this.redact(detail.location, additionalSecrets) }),
      })),
      debugId: paypalError.debugId === null ? null : this.redact(paypalError.debugId, additionalSecrets),
      method: this.redact(paypalError.method, additionalSecrets),
      path: this.redact(paypalError.path, additionalSecrets),
      retryable: paypalError.retryable,
      message: this.redact(paypalError.message, additionalSecrets),
      ...(typeof cause === "string" ? { cause: this.redact(cause, additionalSecrets) } : {}),
    });
  }

  private redact(value: string, additionalSecrets: readonly string[]): string {
    let safeValue = value;
    for (const secret of [this.config.clientId, this.config.clientSecret, this.cachedToken?.value, ...additionalSecrets]) {
      if (secret !== undefined && secret.length > 0) safeValue = safeValue.split(secret).join("[redacted]");
    }
    return safeValue.replace(/\bBasic\s+[^\s,;]+/gi, "Basic [redacted]").replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]");
  }

  private safeDebugId(debugId: string | null, token: string): string | null {
    return debugId === null ? null : this.redact(debugId, [token]);
  }

  private logAttempt(info: RequestInfoLog): void {
    try {
      this.onRequest?.(info);
    } catch {
      // Logging must not change the result of the PayPal request.
    }
  }
}
