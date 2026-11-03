import type { ExecutorDeps, InvoiceGateway, InvoiceSnapshot, OperationLog, OpRecord, RecordInput } from "../src/ports.ts";

export class TransientError extends Error {}
export class PermanentError extends Error {}
export class NotFoundError extends Error {}
export class CrashError extends Error {}

export type Fault = "transient-before" | "transient-after" | "permanent";
type Call = "get" | "record" | "remove";

interface FakeInvoice {
  owner: string;
  status: string;
  currency: string;
  amountMinor: number;
  dueMinor: number;
  payments: { paymentId: string; amountMinor: number; note: string }[];
}

/** In-memory PayPal invoicing with scripted and random faults. */
export class FakeInvoices implements InvoiceGateway {
  readonly invoices = new Map<string, FakeInvoice>();
  readonly calls = { get: 0, record: 0, remove: 0 };
  /** Invoices PayPal keeps refusing to record on, as a real permanent error would. */
  readonly refusing = new Set<string>();
  chaos: ((call: Call, invoiceId: string) => Fault | undefined) | undefined;
  private scripted: { call: Call; invoiceId: string; fault: Fault }[] = [];
  private nextId = 1;

  add(id: string, owner: string, amountMinor: number, currency = "USD", status = "SENT"): void {
    this.invoices.set(id, { owner, status, currency, amountMinor, dueMinor: amountMinor, payments: [] });
  }

  inject(call: Call, invoiceId: string, fault: Fault, times = 1): void {
    for (let i = 0; i < times; i++) this.scripted.push({ call, invoiceId, fault });
  }

  async get(owner: string, invoiceId: string): Promise<InvoiceSnapshot> {
    this.calls.get++;
    const fault = this.fault("get", invoiceId);
    if (fault === "transient-before" || fault === "transient-after") throw new TransientError("get timed out");
    if (fault === "permanent") throw new PermanentError("get forbidden");
    const inv = this.owned(owner, invoiceId);
    return { id: invoiceId, status: inv.status, currency: inv.currency, dueMinor: inv.dueMinor, payments: inv.payments.map((p) => ({ ...p })) };
  }

  async record(owner: string, invoiceId: string, input: RecordInput): Promise<string> {
    this.calls.record++;
    if (this.refusing.has(invoiceId)) throw new PermanentError("record 422 (invoice refuses payments)");
    const fault = this.fault("record", invoiceId);
    if (fault === "transient-before") throw new TransientError("record 503");
    if (fault === "permanent") throw new PermanentError("record 422");
    const inv = this.owned(owner, invoiceId);
    if (!["SENT", "UNPAID", "PARTIALLY_PAID"].includes(inv.status)) throw new PermanentError(`invoice is ${inv.status}`);
    if (input.currency !== inv.currency || input.amountMinor > inv.dueMinor) throw new PermanentError("amount exceeds due");
    const paymentId = `EXTR-${this.nextId++}`;
    inv.payments.push({ paymentId, amountMinor: input.amountMinor, note: input.note });
    inv.dueMinor -= input.amountMinor;
    inv.status = inv.dueMinor === 0 ? "MARKED_AS_PAID" : "PARTIALLY_PAID";
    if (fault === "transient-after") throw new TransientError("record timed out after PayPal applied it");
    return paymentId;
  }

  async remove(owner: string, invoiceId: string, paymentId: string): Promise<void> {
    this.calls.remove++;
    const fault = this.fault("remove", invoiceId);
    if (fault === "transient-before") throw new TransientError("remove 503");
    if (fault === "permanent") throw new PermanentError("remove 422");
    const inv = this.owned(owner, invoiceId);
    const i = inv.payments.findIndex((p) => p.paymentId === paymentId);
    if (i < 0) throw new NotFoundError("payment not found");
    const [p] = inv.payments.splice(i, 1);
    inv.dueMinor += p!.amountMinor;
    inv.status = inv.dueMinor === inv.amountMinor ? "SENT" : "PARTIALLY_PAID";
    if (fault === "transient-after") throw new TransientError("remove timed out after PayPal applied it");
  }

  markers(invoiceId: string, key: string): number {
    return this.invoices.get(invoiceId)!.payments.filter((p) => p.note.includes(`[untangle:${key}]`)).length;
  }

  private fault(call: Call, invoiceId: string): Fault | undefined {
    const i = this.scripted.findIndex((s) => s.call === call && s.invoiceId === invoiceId);
    if (i >= 0) return this.scripted.splice(i, 1)[0]!.fault;
    return this.chaos?.(call, invoiceId);
  }

  private owned(owner: string, invoiceId: string): FakeInvoice {
    const inv = this.invoices.get(invoiceId);
    if (inv === undefined || inv.owner !== owner) throw new PermanentError(`invoice ${invoiceId} not found for ${owner}`);
    return inv;
  }
}

/** In-memory operation log that can simulate the process dying while saving. */
export class FakeOps implements OperationLog {
  readonly store = new Map<string, OpRecord>();
  crashOn: ((op: OpRecord) => boolean) | undefined;

  async get(key: string): Promise<OpRecord | undefined> {
    return this.store.get(key);
  }

  async put(op: OpRecord): Promise<void> {
    if (this.crashOn?.(op)) throw new CrashError("process died while saving");
    this.store.set(op.key, op);
  }
}

export function makeDeps(invoices: FakeInvoices, ops: FakeOps): ExecutorDeps & { events: { type: string; payload: Record<string, unknown> }[] } {
  const events: { type: string; payload: Record<string, unknown> }[] = [];
  return {
    invoices,
    ops,
    events,
    emit: async (type, payload) => {
      events.push({ type, payload });
    },
    today: () => "2026-11-05",
    sleep: async () => {},
    isRetryable: (e) => e instanceof TransientError,
    isNotFound: (e) => e instanceof NotFoundError,
  };
}

/** mulberry32: well mixed from the first draw, unlike a bare LCG whose first output tracks the seed. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
