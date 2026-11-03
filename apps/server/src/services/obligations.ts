import { and, asc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { businesses, networks, obligations, rounds, setoffs, transferLegs, transfers } from "@untangle/db";
import type { AppContext } from "../context.ts";
import { DomainError } from "../errors.ts";
import { PayPalInvoiceGateway } from "../adapters/invoice-gateway.ts";

export interface ObligationView {
  id: string;
  debtorId: string;
  debtorName: string;
  creditorId: string;
  creditorName: string;
  amountMinor: number;
  outstandingMinor: number;
  currency: string;
  status: string;
  paypalInvoiceId: string | null;
  protected: boolean;
  dueOn: string | null;
  description: string | null;
}

export interface ObligationHistory {
  obligation: ObligationView;
  setoffs: { roundId: string; amountMinor: number; status: string; paypalPaymentId: string | null; createdAt: Date }[];
  legs: { transferId: string; roundId: string; payerId: string; payeeId: string; instrument: string | null; transferStatus: string; amountMinor: number; status: string; paypalPaymentId: string | null }[];
}

export async function listObligations(ctx: AppContext, networkId: string): Promise<ObligationView[]> {
  const debtor = alias(businesses, "debtor_business");
  const creditor = alias(businesses, "creditor_business");
  const rows = await ctx.db.select({
    id: obligations.id,
    debtorId: obligations.debtorId,
    debtorName: debtor.name,
    creditorId: obligations.creditorId,
    creditorName: creditor.name,
    amountMinor: obligations.amountMinor,
    outstandingMinor: obligations.outstandingMinor,
    currency: obligations.currency,
    status: obligations.status,
    paypalInvoiceId: obligations.paypalInvoiceId,
    protected: obligations.protected,
    dueOn: obligations.dueOn,
    description: obligations.description,
  }).from(obligations)
    .innerJoin(debtor, eq(obligations.debtorId, debtor.id))
    .innerJoin(creditor, eq(obligations.creditorId, creditor.id))
    .where(eq(obligations.networkId, networkId))
    .orderBy(asc(obligations.createdAt));
  return rows;
}

export async function networkSummary(ctx: AppContext, networkId: string) {
  const [network] = await ctx.db.select().from(networks).where(eq(networks.id, networkId)).limit(1);
  if (network === undefined) throw new DomainError(404, "NETWORK_NOT_FOUND", "Network was not found");
  const [businessRows, obligationRows, latestRound, recordedSetoffs, recordedLegs, committedTransfers] = await Promise.all([
    ctx.db.select({ id: businesses.id, name: businesses.name, email: businesses.email }).from(businesses).where(eq(businesses.networkId, networkId)),
    ctx.db.select({ debtorId: obligations.debtorId, creditorId: obligations.creditorId, amountMinor: obligations.amountMinor, outstandingMinor: obligations.outstandingMinor, status: obligations.status }).from(obligations).where(eq(obligations.networkId, networkId)),
    ctx.db.select({ id: rounds.id, status: rounds.status }).from(rounds).where(eq(rounds.networkId, networkId)).orderBy(sql`${rounds.createdAt} desc`).limit(1),
    ctx.db.select({ amountMinor: setoffs.amountMinor }).from(setoffs).innerJoin(rounds, eq(setoffs.roundId, rounds.id)).where(and(eq(rounds.networkId, networkId), eq(setoffs.status, "recorded"))),
    ctx.db.select({ amountMinor: transferLegs.amountMinor }).from(transferLegs).innerJoin(transfers, eq(transferLegs.transferId, transfers.id)).innerJoin(rounds, eq(transfers.roundId, rounds.id)).where(and(eq(rounds.networkId, networkId), eq(transferLegs.status, "recorded"))),
    ctx.db.select({ amountMinor: transfers.amountMinor }).from(transfers).innerJoin(rounds, eq(transfers.roundId, rounds.id)).where(and(eq(rounds.networkId, networkId), eq(transfers.status, "committed"))),
  ]);
  const active = obligationRows.filter((row) => row.status !== "cancelled");
  const byBusiness = new Map(businessRows.map((business) => [business.id, { owesMinor: 0, owedMinor: 0 }]));
  for (const row of active) {
    const debtorTotals = byBusiness.get(row.debtorId);
    const creditorTotals = byBusiness.get(row.creditorId);
    if (debtorTotals !== undefined) debtorTotals.owesMinor += row.outstandingMinor;
    if (creditorTotals !== undefined) creditorTotals.owedMinor += row.outstandingMinor;
  }
  return {
    network: { id: network.id, name: network.name, currency: network.currency },
    businesses: businessRows.map((business) => {
      const totals = byBusiness.get(business.id)!;
      return { ...business, ...totals, netMinor: totals.owedMinor - totals.owesMinor };
    }),
    totals: {
      // Cancelled (archived) invoices are history, not debt: totals cover the live ones.
      obligations: active.length,
      owedMinor: active.reduce((sum, row) => sum + row.amountMinor, 0),
      outstandingMinor: active.reduce((sum, row) => sum + row.outstandingMinor, 0),
      settledMinor: active.reduce((sum, row) => sum + row.amountMinor - row.outstandingMinor, 0),
      clearedByLoopsMinor: recordedSetoffs.reduce((sum, row) => sum + row.amountMinor, 0),
      settledByChainsMinor: recordedLegs.reduce((sum, row) => sum + row.amountMinor, 0),
      movedMinor: committedTransfers.reduce((sum, row) => sum + row.amountMinor, 0),
    },
    latestRound: latestRound[0] ?? null,
  };
}

export async function getObligationHistory(ctx: AppContext, obligationId: string): Promise<ObligationHistory> {
  const [row] = await ctx.db.select({ networkId: obligations.networkId }).from(obligations).where(eq(obligations.id, obligationId)).limit(1);
  if (row === undefined) throw new DomainError(404, "OBLIGATION_NOT_FOUND", "Obligation was not found");
  const [obligation, setoffRows, legRows] = await Promise.all([
    listObligations(ctx, row.networkId),
    ctx.db.select({ roundId: setoffs.roundId, amountMinor: setoffs.amountMinor, status: setoffs.status, paypalPaymentId: setoffs.paypalPaymentId, createdAt: setoffs.createdAt })
      .from(setoffs).where(eq(setoffs.obligationId, obligationId)).orderBy(asc(setoffs.createdAt)),
    ctx.db.select({ transferId: transfers.id, roundId: transfers.roundId, payerId: transfers.payerId, payeeId: transfers.payeeId, instrument: transfers.instrument, transferStatus: transfers.status, amountMinor: transferLegs.amountMinor, status: transferLegs.status, paypalPaymentId: transferLegs.paypalPaymentId })
      .from(transferLegs).innerJoin(transfers, eq(transferLegs.transferId, transfers.id)).where(eq(transferLegs.obligationId, obligationId)).orderBy(asc(transfers.createdAt), asc(transferLegs.position)),
  ]);
  const view = obligation.find((item) => item.id === obligationId);
  if (view === undefined) throw new Error("obligation missing from its network view");
  return { obligation: view, setoffs: setoffRows, legs: legRows };
}

// Cancelled is final: a demo reset archives obligations as cancelled, and their old PayPal
// invoices must never bring them back.
const INVOICE_BACKED = ["invoiced", "partially_settled", "settled"];

/**
 * Copies an obligation's outstanding amount and status from its PayPal invoice, the record
 * of the debt. Every change to outstanding goes through here, one call per obligation at a
 * time. Our own payments also fire PayPal invoice webhooks, so applying amounts arithmetically
 * in two places would count the same payment twice.
 */
export async function syncObligation(ctx: AppContext, obligationId: string): Promise<boolean> {
  return ctx.locks.run(`obligation:${obligationId}`, async () => {
    const [obligation] = await ctx.db.select().from(obligations).where(eq(obligations.id, obligationId)).limit(1);
    if (obligation === undefined || obligation.paypalInvoiceId === null || !INVOICE_BACKED.includes(obligation.status)) return false;
    const snapshot = await new PayPalInvoiceGateway(ctx.paypal).get(obligation.creditorId, obligation.paypalInvoiceId);
    const outstandingMinor = Math.min(obligation.amountMinor, Math.max(0, snapshot.dueMinor));
    const status = snapshot.status === "CANCELLED" ? "cancelled"
      : outstandingMinor === 0 ? "settled"
        : outstandingMinor < obligation.amountMinor ? "partially_settled" : "invoiced";
    if (outstandingMinor === obligation.outstandingMinor && status === obligation.status) return false;
    const updated = await ctx.db.update(obligations).set({
      outstandingMinor,
      status,
      version: sql`${obligations.version} + 1`,
      updatedAt: ctx.now(),
    }).where(and(eq(obligations.id, obligation.id), eq(obligations.version, obligation.version))).returning({ id: obligations.id });
    if (updated.length === 0) return false;
    await ctx.bus.emit(`network:${obligation.networkId}`, "obligation.updated", { obligationId: obligation.id, outstandingMinor, status });
    return true;
  });
}

/** Syncs each obligation; one that PayPal can't serve right now is retried by the job runner. */
export async function syncObligations(ctx: AppContext, obligationIds: readonly string[], concurrency = 5): Promise<void> {
  // Each obligation has its own lock, so a few can be read from PayPal at once (sandbox reads take ~1–3 s).
  const queue = [...new Set(obligationIds)].sort();
  const worker = async () => {
    for (let obligationId = queue.shift(); obligationId !== undefined; obligationId = queue.shift()) {
      try {
        await syncObligation(ctx, obligationId);
      } catch {
        await ctx.jobs.schedule("obligation.sync", { obligationId }, 30_000);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
}

export async function refreshObligationFromInvoice(ctx: AppContext, invoiceId: string): Promise<ObligationView | null> {
  const [obligation] = await ctx.db.select({ id: obligations.id, networkId: obligations.networkId }).from(obligations)
    .where(eq(obligations.paypalInvoiceId, invoiceId)).limit(1);
  if (obligation === undefined) return null;
  await syncObligation(ctx, obligation.id);
  return (await listObligations(ctx, obligation.networkId)).find((row) => row.id === obligation.id) ?? null;
}
