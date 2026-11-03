export interface FakeResponse {
  status: number;
  json?: unknown;
  text?: string;
  headers?: Record<string, string>;
}

export interface FakeFetchCall {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | FormData | undefined;
}

export type FakeResponseHandler = (call: FakeFetchCall) => FakeResponse | Promise<FakeResponse>;
export type FakeRoutes = Record<string, FakeResponse | FakeResponse[] | FakeResponseHandler> | FakeResponseHandler;

export type RecordedFetch = typeof fetch & { calls: FakeFetchCall[] };

function isHandler(value: unknown): value is FakeResponseHandler {
  return typeof value === "function";
}

function toResponse(spec: FakeResponse): Response {
  const headers = new Headers(spec.headers);
  const body = spec.json === undefined ? spec.text ?? null : JSON.stringify(spec.json);
  return new Response(spec.status === 204 ? null : body, { status: spec.status, headers });
}

export function fakeFetch(routes: FakeRoutes = {}): RecordedFetch {
  const calls: FakeFetchCall[] = [];
  const fetcher = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const request = input instanceof Request ? input : undefined;
    const url = String(request?.url ?? input);
    const method = String(init.method ?? request?.method ?? "GET").toUpperCase();
    const headers = new Headers(request?.headers);
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    const rawBody = init.body ?? request?.body;
    let body: FakeFetchCall["body"];
    if (rawBody instanceof FormData) body = rawBody;
    else if (rawBody === undefined || rawBody === null) body = undefined;
    else if (typeof rawBody === "string") body = rawBody;
    else if (rawBody instanceof URLSearchParams) body = rawBody.toString();
    else body = String(rawBody);

    const headerMap: Record<string, string> = {};
    headers.forEach((value, key) => { headerMap[key.toLowerCase()] = value; });
    const call: FakeFetchCall = {
      method,
      url,
      headers: headerMap,
      body,
    };
    calls.push(call);

    const path = new URL(url).pathname;
    const key = `${method} ${path}`;
    let route: FakeResponse | FakeResponse[] | FakeResponseHandler | undefined;
    if (isHandler(routes)) route = routes;
    else route = routes[key];

    let spec: FakeResponse;
    if (isHandler(route)) {
      spec = await route(call);
    } else if (Array.isArray(route)) {
      const next = route.shift();
      spec = next ?? { status: 500, json: { name: "NO_FAKE_RESPONSE", message: `No queued response for ${key}` } };
    } else if (route !== undefined) {
      spec = route;
    } else if (path === "/v1/oauth2/token") {
      spec = { status: 200, json: { access_token: "tok-1", expires_in: 32_400, token_type: "Bearer" } };
    } else {
      spec = { status: 200, json: {} };
    }

    return toResponse(spec);
  }) as RecordedFetch;
  fetcher.calls = calls;
  return fetcher;
}
