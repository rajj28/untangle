import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { canonicalJson, sha256Hex } from "@untangle/db";
import type { SettlementPlan } from "@untangle/engine";
import { planSettlement } from "@untangle/engine";
import { consents, obligations, rounds, setoffs, statements, transferLegs, transfers, networks } from "@untangle/db";
import { executeSetoffs } from "@untangle/executor";
import type { AppContext } from "../context.ts";
import type { JobResult } from "../jobs.ts";
import { consentSignature } from "../crypto.ts";
import { DomainError } from "../errors.ts";
import { makeExecutorDeps } from "../adapters/executor-deps.ts";
import { syncObligations } from "./obligations.ts";

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

interface RoundStatement {
  roundId: string;
  businessId: string;
  networkId: string;
  currency: string;
  planHash: string;
  setoffs: { obligationId: string; invoiceId: string; role: "creditor" | "debtor"; counterpartyId: string; amountMinor: number; outstandingBeforeMinor: number; remainingAfterMinor: number }[];
  pays: { transferId: string; payeeId: string; amountMinor: number }[];
  receives: { transferId: string; payerId: string; amountMinor: number }[];
  passThrough: { transferId: string; obligationId: string; role: "creditor" | "debtor"; amountMinor: number }[];
  totals: { clearedMinor: number; paysMinor: number; receivesMinor: number };
}

export interface RoundView {
  id: string;
  networkId: string;
  status: string;
  planHash: string | null;
  stats: SettlementPlan["stats"] | null;
  setoffs: { obligationId: string; debtorId: string; creditorId: string; amountMinor: number; status: string; paypalPaymentId: string | null }[];
  transfers: {
    id: string;
    payerId: string;
    payeeId: string;
    amountMinor: number;
    currency: string;
    instrument: string | null;
    status: string;
    paypalOrderId: string | null;
    paypalCaptureId: string | null;
    payoutBatchId: string | null;
    payoutItemId: string | null;
    legs: { obligationId: string; position: number; amountMinor: number; status: string; paypalPaymentId: string | null }[];
  }[];
  statements: { businessId: string; statementHash: string; body: unknown }[];
  consents: { businessId: string; method: string; createdAt: Date }[];
  pendingConsents: string[];
}

export async function planRound(ctx: AppContext, networkId: string): Promise<RoundView> {
  const created = await ctx.db.transaction(async (tx) => {
    await tx.execute(sql`select id from networks where id = ${networkId} for update`);
    const [network] = await tx.select().from(networks).where(eq(networks.id, networkId)).limit(1);
    if (network === undefined) throw new DomainError(404, "NETWORK_NOT_FOUND", "Network was not found");
    const active = await tx.select({ id: rounds.id }).from(rounds).where(and(
      eq(rounds.networkId, networkId),
      inArray(rounds.status, ["consenting", "executing", "settling"]),
    )).limit(1);
    if (active.length > 0) throw new DomainError(409, "ROUND_IN_PROGRESS", "A settlement round is already in progress");

    const eligible = await tx.select().from(obligations).where(and(
      eq(obligations.networkId, networkId),
      inArray(obligations.status, ["invoiced", "partially_settled"]),
      sql`${obligations.outstandingMinor} > 0`,
      eq(obligations.protected, false),
      sql`${obligations.paypalInvoiceId} is not null`,
      eq(obligations.currency, network.currency),
    ));
    if (eligible.length === 0) throw new DomainError(409, "NOTHING_TO_SETTLE", "There are no eligible obligations to settle");

    const plan = planSettlement(eligible.map((row) => ({
      id: row.id,
      debtor: row.debtorId,
      creditor: row.creditorId,
      amount: row.outstandingMinor,
    })));
    const positiveSetoffs = Object.fromEntries(Object.entries(plan.setoffs).filter(([, amount]) => amount > 0));
    const planHash = sha256Hex(canonicalJson({ setoffs: positiveSetoffs, transfers: plan.transfers }));
    const roundId = randomUUID();
    const transferData = plan.transfers.map((transfer) => ({ ...transfer, id: randomUUID() }));
    const obligationById = new Map(eligible.map((row) => [row.id, row]));

    await tx.insert(rounds).values({ id: roundId, networkId, status: "consenting", plan, planHash });

    const setoffRows = Object.entries(positiveSetoffs).map(([obligationId, amountMinor]) => ({ roundId, obligationId, amountMinor, status: "pending" }));
    if (setoffRows.length > 0) await tx.insert(setoffs).values(setoffRows);

    if (transferData.length > 0) {
      await tx.insert(transfers).values(transferData.map((transfer) => ({
        id: transfer.id,
        roundId,
        payerId: transfer.payer,
        payeeId: transfer.payee,
        amountMinor: transfer.amount,
        currency: network.currency,
        status: "planned",
      })));
      await tx.insert(transferLegs).values(transferData.flatMap((transfer) => transfer.legs.map((leg, position) => ({
        transferId: transfer.id,
        obligationId: leg.obligationId,
        position,
        amountMinor: leg.amount,
        status: "pending",
      }))));
    }

    const statementBusinesses = new Set<string>();
    const statementBodies = new Map<string, RoundStatement>();
    const getBody = (businessId: string): RoundStatement => {
      statementBusinesses.add(businessId);
      let body = statementBodies.get(businessId);
      if (body === undefined) {
        body = {
          roundId, businessId, networkId, currency: network.currency, planHash,
          setoffs: [], pays: [], receives: [], passThrough: [],
          totals: { clearedMinor: 0, paysMinor: 0, receivesMinor: 0 },
        };
        statementBodies.set(businessId, body);
      }
      return body;
    };

    for (const [obligationId, amountMinor] of Object.entries(positiveSetoffs)) {
      const row = obligationById.get(obligationId);
      if (row === undefined || row.paypalInvoiceId === null) throw new Error("set-off obligation was not in the planning snapshot");
      for (const party of [
        { businessId: row.creditorId, role: "creditor" as const, counterpartyId: row.debtorId },
        { businessId: row.debtorId, role: "debtor" as const, counterpartyId: row.creditorId },
      ]) {
        const body = getBody(party.businessId);
        body.setoffs.push({
          obligationId, invoiceId: row.paypalInvoiceId, role: party.role, counterpartyId: party.counterpartyId,
          amountMinor, outstandingBeforeMinor: row.outstandingMinor, remainingAfterMinor: row.outstandingMinor - amountMinor,
        });
        body.totals.clearedMinor += amountMinor;
      }
    }

    for (const transfer of transferData) {
      const payer = getBody(transfer.payer);
      payer.pays.push({ transferId: transfer.id, payeeId: transfer.payee, amountMinor: transfer.amount });
      payer.totals.paysMinor += transfer.amount;
      const payee = getBody(transfer.payee);
      payee.receives.push({ transferId: transfer.id, payerId: transfer.payer, amountMinor: transfer.amount });
      payee.totals.receivesMinor += transfer.amount;
      for (const leg of transfer.legs) {
        const obligation = obligationById.get(leg.obligationId);
        if (obligation === undefined) throw new Error("transfer leg was not in the planning snapshot");
        for (const party of [
          { businessId: obligation.creditorId, role: "creditor" as const },
          { businessId: obligation.debtorId, role: "debtor" as const },
        ]) {
          if (party.businessId !== transfer.payer && party.businessId !== transfer.payee) {
            getBody(party.businessId).passThrough.push({ transferId: transfer.id, obligationId: leg.obligationId, role: party.role, amountMinor: leg.amount });
          }
        }
      }
    }

    const statementRows = [...statementBusinesses].map((businessId) => {
      const body = statementBodies.get(businessId)!;
      body.setoffs.sort((a, b) => compare(a.obligationId, b.obligationId) || compare(a.role, b.role));
      body.pays.sort((a, b) => compare(a.transferId, b.transferId));
      body.receives.sort((a, b) => compare(a.transferId, b.transferId));
      body.passThrough.sort((a, b) => compare(a.transferId, b.transferId) || compare(a.obligationId, b.obligationId) || compare(a.role, b.role));
      return { roundId, businessId, statementHash: sha256Hex(canonicalJson(body)), body };
    });
    if (statementRows.length > 0) await tx.insert(statements).values(statementRows);
    return { roundId, planHash, stats: plan.stats };
  });

  await ctx.bus.emit(`network:${networkId}`, "round.planned", {
    roundId: created.roundId,
    planHash: created.planHash,
    stats: { ...created.stats, leverage: created.stats.leverage === null ? null : String(created.stats.leverage) },
  });
  return getRound(ctx, created.roundId);
}

export async function getRound(ctx: AppContext, roundId: string): Promise<RoundView> {
  const [round] = await ctx.db.select().from(rounds).where(eq(rounds.id, roundId)).limit(1);
  if (round === undefined) throw new DomainError(404, "ROUND_NOT_FOUND", "Round was not found");
  const [setoffRows, transferRows, legRows, statementRows, consentRows] = await Promise.all([
    ctx.db.select({ obligationId: setoffs.obligationId, amountMinor: setoffs.amountMinor, status: setoffs.status, paypalPaymentId: setoffs.paypalPaymentId, debtorId: obligations.debtorId, creditorId: obligations.creditorId })
      .from(setoffs).innerJoin(obligations, eq(setoffs.obligationId, obligations.id)).where(eq(setoffs.roundId, roundId)).orderBy(asc(setoffs.obligationId)),
    ctx.db.select().from(transfers).where(eq(transfers.roundId, roundId)).orderBy(asc(transfers.payerId), asc(transfers.payeeId)),
    ctx.db.select().from(transferLegs).innerJoin(transfers, eq(transferLegs.transferId, transfers.id)).where(eq(transfers.roundId, roundId)).orderBy(asc(transferLegs.position)),
    ctx.db.select().from(statements).where(eq(statements.roundId, roundId)).orderBy(asc(statements.businessId)),
    ctx.db.select().from(consents).where(eq(consents.roundId, roundId)).orderBy(asc(consents.createdAt)),
  ]);
  const legsByTransfer = new Map<string, RoundView["transfers"][number]["legs"]>();
  for (const row of legRows) {
    const transferId = row.transfer_legs.transferId;
    const legs = legsByTransfer.get(transferId) ?? [];
    legs.push({
      obligationId: row.transfer_legs.obligationId,
      position: row.transfer_legs.position,
      amountMinor: row.transfer_legs.amountMinor,
      status: row.transfer_legs.status,
      paypalPaymentId: row.transfer_legs.paypalPaymentId,
    });
    legsByTransfer.set(transferId, legs);
  }
  const consented = new Set(consentRows.map((row) => row.businessId));
  const plan = round.plan as SettlementPlan | null;
  return {
    id: round.id,
    networkId: round.networkId,
    status: round.status,
    planHash: round.planHash,
    stats: plan?.stats ?? null,
    setoffs: setoffRows,
    transfers: transferRows.map((row) => ({
      id: row.id,
      payerId: row.payerId,
      payeeId: row.payeeId,
      amountMinor: row.amountMinor,
      currency: row.currency,
      instrument: row.instrument,
      status: row.status,
      paypalOrderId: row.paypalOrderId,
      paypalCaptureId: row.paypalCaptureId,
      payoutBatchId: row.payoutBatchId,
      payoutItemId: row.payoutItemId,
      legs: legsByTransfer.get(row.id) ?? [],
    })),
    statements: statementRows.map((row) => ({ businessId: row.businessId, statementHash: row.statementHash, body: row.body })),
    consents: consentRows.map((row) => ({ businessId: row.businessId, method: row.method, createdAt: row.createdAt })),
    pendingConsents: statementRows.map((row) => row.businessId).filter((businessId) => !consented.has(businessId)).sort(),
  };
}

export async function recordConsent(ctx: AppContext, roundId: string, businessId: string, method: "demo" | "policy" = "demo"): Promise<RoundView> {
  const result = await ctx.db.transaction(async (tx) => {
    // Locking the round makes concurrent consents take turns, so the last one always sees every other.
    const [round] = await tx.select().from(rounds).where(eq(rounds.id, roundId)).limit(1).for("update");
    if (round === undefined) throw new DomainError(404, "ROUND_NOT_FOUND", "Round was not found");
    if (round.status !== "consenting") throw new DomainError(409, "ROUND_NOT_CONSENTING", "Round is not accepting consent");
    const [statement] = await tx.select().from(statements).where(and(eq(statements.roundId, roundId), eq(statements.businessId, businessId))).limit(1);
    if (statement === undefined) throw new DomainError(422, "NOT_IN_ROUND", "Business has no statement in this round");
    const [existing] = await tx.select({ id: consents.id }).from(consents).where(and(eq(consents.roundId, roundId), eq(consents.businessId, businessId))).limit(1);
    if (existing !== undefined) return { inserted: false, ready: false };
    const inserted = await tx.insert(consents).values({
      roundId,
      businessId,
      statementHash: statement.statementHash,
      method,
      signature: consentSignature(ctx.config.masterKey, roundId, businessId, statement.statementHash),
    }).onConflictDoNothing().returning({ id: consents.id });
    if (inserted.length === 0) return { inserted: false, ready: false };
    const allStatements = await tx.select({ businessId: statements.businessId }).from(statements).where(eq(statements.roundId, roundId));
    const allConsents = await tx.select({ businessId: consents.businessId }).from(consents).where(eq(consents.roundId, roundId));
    const signed = new Set(allConsents.map((row) => row.businessId));
    const allSigned = allStatements.every((row) => signed.has(row.businessId));
    let ready = false;
    if (allSigned) {
      const changed = await tx.update(rounds).set({ status: "executing", updatedAt: ctx.now() })
        .where(and(eq(rounds.id, roundId), eq(rounds.status, "consenting"))).returning({ id: rounds.id });
      ready = changed.length > 0;
    }
    return { inserted: true, ready };
  });

  if (result.inserted) await ctx.bus.emit(`round:${roundId}`, "round.consented", { roundId, businessId });
  if (result.ready) {
    await ctx.bus.emit(`round:${roundId}`, "round.ready", { roundId });
    await ctx.jobs.schedule("round.execute", { roundId });
  }
  return getRound(ctx, roundId);
}

/**
 * Last resort once a round's execution job has died: free the network and ask for a person.
 * Outstanding amounts are copied from PayPal, so the ledger stays true whatever got recorded.
 */
export async function abandonRound(ctx: AppContext, roundId: string, reason: string): Promise<void> {
  await ctx.locks.run(`round:${roundId}`, async () => {
    const changed = await ctx.db.update(rounds).set({ status: "failed", updatedAt: ctx.now() })
      .where(and(eq(rounds.id, roundId), eq(rounds.status, "executing"))).returning({ id: rounds.id });
    if (changed.length === 0) return;
    await ctx.bus.emit(`round:${roundId}`, "round.needs_attention", { roundId, problems: [`execution stopped: ${reason}`] });
    const rows = await ctx.db.select({ obligationId: setoffs.obligationId }).from(setoffs).where(eq(setoffs.roundId, roundId));
    await syncObligations(ctx, rows.map((row) => row.obligationId));
  });
}

export async function executeRound(ctx: AppContext, roundId: string): Promise<JobResult> {
  return ctx.locks.run(`round:${roundId}`, async () => {
    const [round] = await ctx.db.select().from(rounds).where(eq(rounds.id, roundId)).limit(1);
    if (round === undefined) throw new DomainError(404, "ROUND_NOT_FOUND", "Round was not found");
    if (round.status !== "executing") return { done: true };
    const rows = await ctx.db.select({
      obligationId: setoffs.obligationId,
      invoiceId: obligations.paypalInvoiceId,
      owner: obligations.creditorId,
      currency: obligations.currency,
      amountMinor: setoffs.amountMinor,
    }).from(setoffs).innerJoin(obligations, eq(setoffs.obligationId, obligations.id)).where(eq(setoffs.roundId, roundId)).orderBy(asc(setoffs.obligationId));
    const payments = rows.map((row) => {
      if (row.invoiceId === null) throw new Error(`set-off obligation ${row.obligationId} has no PayPal invoice`);
      return { ...row, invoiceId: row.invoiceId };
    });
    const outcome = await executeSetoffs(roundId, payments, makeExecutorDeps(ctx, `round:${roundId}`));
    if (outcome.status === "retry_later") {
      await ctx.bus.emit(`round:${roundId}`, "round.retrying", { roundId, error: outcome.error });
      return { retryInMs: 30_000 };
    }
    const obligationIds = rows.map((row) => row.obligationId);
    if (outcome.status === "recorded") {
      const completed = await ctx.db.transaction(async (tx) => {
        for (const payment of outcome.payments) {
          await tx.update(setoffs).set({ status: "recorded", paypalPaymentId: payment.paymentId, updatedAt: ctx.now() })
            .where(and(eq(setoffs.roundId, roundId), eq(setoffs.obligationId, payment.obligationId), eq(setoffs.status, "pending")));
        }
        const readied = await tx.update(transfers).set({ status: "ready", updatedAt: ctx.now() })
          .where(and(eq(transfers.roundId, roundId), eq(transfers.status, "planned"))).returning({ id: transfers.id });
        const transferRows = await tx.select({ id: transfers.id }).from(transfers).where(eq(transfers.roundId, roundId));
        // Can't happen while the round is executing; if it ever does, stop and say so instead of retrying forever.
        const consistent = readied.length === transferRows.length;
        const nextStatus = !consistent ? "failed" : transferRows.length === 0 ? "closed" : "settling";
        const changed = await tx.update(rounds).set({ status: nextStatus, updatedAt: ctx.now() })
          .where(and(eq(rounds.id, roundId), eq(rounds.status, "executing"))).returning({ id: rounds.id });
        return { changed: changed.length > 0, closed: nextStatus === "closed", consistent };
      });
      if (completed.changed && completed.consistent) {
        await ctx.bus.emit(`round:${roundId}`, "round.setoffs_recorded", { roundId, payments: outcome.payments, closed: completed.closed });
      } else if (completed.changed) {
        await ctx.bus.emit(`round:${roundId}`, "round.needs_attention", { roundId, problems: ["set-offs are recorded but not every transfer was still planned"] });
      }
      await syncObligations(ctx, obligationIds);
      return { done: true };
    }

    if (outcome.status === "aborted" || outcome.status === "compensated") {
      const nextSetoffStatus = outcome.status === "aborted" ? "failed" : "compensated";
      const completed = await ctx.db.transaction(async (tx) => {
        await tx.update(setoffs).set({ status: nextSetoffStatus, updatedAt: ctx.now() }).where(and(eq(setoffs.roundId, roundId), eq(setoffs.status, "pending")));
        const changed = await tx.update(rounds).set({ status: "failed", updatedAt: ctx.now() })
          .where(and(eq(rounds.id, roundId), eq(rounds.status, "executing"))).returning({ id: rounds.id });
        return changed.length > 0;
      });
      if (completed) await ctx.bus.emit(`round:${roundId}`, "round.failed", { roundId, problems: outcome.problems });
      // A failed round often means an invoice changed under it (paid, cancelled), so pick that up.
      await syncObligations(ctx, obligationIds);
      return { done: true };
    }

    const completed = await ctx.db.update(rounds).set({ status: "failed", updatedAt: ctx.now() })
      .where(and(eq(rounds.id, roundId), eq(rounds.status, "executing"))).returning({ id: rounds.id });
    if (completed.length > 0) await ctx.bus.emit(`round:${roundId}`, "round.needs_attention", { roundId, problems: outcome.problems });
    await syncObligations(ctx, obligationIds);
    return { done: true };
  });
}
