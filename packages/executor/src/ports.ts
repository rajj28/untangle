/** What the executor needs from PayPal invoicing, the operation log and the event log. */

export interface InvoicePayment {
  readonly paymentId: string;
  readonly amountMinor: number;
  readonly note: string;
}

export interface InvoiceSnapshot {
  readonly id: string;
  readonly status: string;
  readonly currency: string;
  readonly dueMinor: number;
  readonly payments: readonly InvoicePayment[];
}

export interface RecordInput {
  readonly amountMinor: number;
  readonly currency: string;
  readonly date: string; // YYYY-MM-DD
  readonly note: string;
}

/** `owner` is the business that issued the invoice: its credentials record payments on it. */
export interface InvoiceGateway {
  get(owner: string, invoiceId: string): Promise<InvoiceSnapshot>;
  record(owner: string, invoiceId: string, input: RecordInput): Promise<string>;
  remove(owner: string, invoiceId: string, paymentId: string): Promise<void>;
}

export type OpStatus = "in_flight" | "succeeded" | "failed_retryable" | "failed_permanent";

export interface OpRecord {
  readonly key: string;
  readonly status: OpStatus;
  readonly attempts: number;
  /** PayPal payment id once known. */
  readonly ref: string | null;
  readonly error: string | null;
}

export interface OperationLog {
  get(key: string): Promise<OpRecord | undefined>;
  put(op: OpRecord): Promise<void>;
}

export interface ExecutorDeps {
  readonly invoices: InvoiceGateway;
  readonly ops: OperationLog;
  emit(type: string, payload: Record<string, unknown>): Promise<void>;
  today(): string;
  sleep(ms: number): Promise<void>;
  /** True when PayPal may not have applied the call and it is safe to look and try again. */
  isRetryable(error: unknown): boolean;
  /** True when the PayPal resource no longer exists (a delete that already happened). */
  isNotFound(error: unknown): boolean;
  /** Attempts per call before handing back to the job runner. Default 3. */
  readonly maxAttempts?: number;
}

/** One payment to write onto one invoice. */
export interface PaymentLine {
  readonly obligationId: string;
  readonly invoiceId: string;
  readonly owner: string;
  readonly currency: string;
  readonly amountMinor: number;
}
