export interface PayPalErrorDetail {
  issue?: string;
  description?: string;
  field?: string;
  value?: string;
  location?: string;
}

export interface PayPalErrorOptions {
  status: number | null;
  code: string;
  details?: readonly PayPalErrorDetail[];
  debugId?: string | null;
  method: string;
  path: string;
  retryable: boolean;
  message: string;
  cause?: string;
}

const redactAuthText = (value: string): string =>
  value.replace(/\bBasic\s+[^\s,;]+/gi, "Basic [redacted]").replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]");

export class PayPalError extends Error {
  readonly status: number | null;
  readonly code: string;
  readonly details: readonly PayPalErrorDetail[];
  readonly debugId: string | null;
  readonly method: string;
  readonly path: string;
  readonly retryable: boolean;

  constructor(options: PayPalErrorOptions) {
    const safeMessage = redactAuthText(options.message);
    super(safeMessage, options.cause === undefined ? undefined : { cause: redactAuthText(options.cause) });
    this.name = "PayPalError";
    this.status = options.status;
    this.code = redactAuthText(options.code);
    this.details = (options.details ?? []).map((detail) => ({
      ...(detail.issue === undefined ? {} : { issue: redactAuthText(detail.issue) }),
      ...(detail.description === undefined ? {} : { description: redactAuthText(detail.description) }),
      ...(detail.field === undefined ? {} : { field: redactAuthText(detail.field) }),
      ...(detail.value === undefined ? {} : { value: redactAuthText(detail.value) }),
      ...(detail.location === undefined ? {} : { location: redactAuthText(detail.location) }),
    }));
    this.debugId = options.debugId === undefined || options.debugId === null ? null : redactAuthText(options.debugId);
    this.method = redactAuthText(options.method);
    this.path = redactAuthText(options.path);
    this.retryable = options.retryable;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function parsePayPalError(
  status: number,
  body: unknown,
  debugIdHeader: string | null,
  method: string,
  path: string,
): PayPalError {
  const record = isRecord(body) ? body : {};
  const code = stringField(record, "name") ?? stringField(record, "error") ?? `HTTP_${status}`;
  const description = stringField(record, "message") ?? stringField(record, "error_description");
  const rawDetails = Array.isArray(record.details) ? record.details : [];
  const details = rawDetails.flatMap((value): PayPalErrorDetail[] => {
    if (!isRecord(value)) return [];
    const issue = stringField(value, "issue");
    const detailDescription = stringField(value, "description");
    const field = stringField(value, "field");
    const detailValue = stringField(value, "value");
    const location = stringField(value, "location");
    const detail: PayPalErrorDetail = {
      ...(issue === undefined ? {} : { issue }),
      ...(detailDescription === undefined ? {} : { description: detailDescription }),
      ...(field === undefined ? {} : { field }),
      ...(detailValue === undefined ? {} : { value: detailValue }),
      ...(location === undefined ? {} : { location }),
    };
    return [detail];
  });
  const debugId = debugIdHeader ?? stringField(record, "debug_id") ?? null;
  const issue = details[0]?.issue;
  const message = `${method} ${path} → ${status} ${code}${description === undefined ? "" : `: ${description}`}${issue === undefined ? "" : ` (${issue})`}`;

  return new PayPalError({
    status,
    code,
    details,
    debugId,
    method,
    path,
    retryable: status === 408 || status === 429 || status >= 500,
    message,
  });
}
