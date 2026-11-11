import type { FastifyPluginAsync } from "fastify";
import { eq, inArray } from "drizzle-orm";
import { businesses, obligations } from "@untangle/db";
import { verifyChain } from "@untangle/db";
import type { AppContext } from "../context.ts";
import { getRound } from "../services/rounds.ts";
import { requireUuid } from "./shared.ts";

// Verifying rereads the whole event log; a short cache keeps a public button from hammering the database.
const CACHE_MS = 30_000;

interface JournalLine {
  journalNo: string;
  journalDate: string;
  account: string;
  debits: string;
  credits: string;
  description: string;
  name: string;
}

function csv(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function dollars(minor: number): string {
  return (minor / 100).toFixed(2);
}

export const auditRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, options) => {
  let cached: { at: number; result: Awaited<ReturnType<typeof verifyChain>> } | undefined;
  app.get("/api/audit/verify", async () => {
    const now = Date.now();
    if (cached === undefined || now - cached.at > CACHE_MS) cached = { at: now, result: await verifyChain(options.ctx.db) };
    return cached.result;
  });

  // QuickBooks Online journal-import CSV. Each transaction is a two-line journal
  // entry (debit + credit) so the file imports straight into QBO.
  app.get<{ Params: { roundId: string } }>("/api/audit/:roundId/journal.csv", async (request, reply) => {
    const ctx = options.ctx;
    const roundId = requireUuid(request.params.roundId);
    const round = await getRound(ctx, roundId);
    const [businessRows, setoffObligations] = await Promise.all([
      ctx.db.select({ id: businesses.id, name: businesses.name }).from(businesses),
      round.setoffs.length > 0
        ? ctx.db.select({ id: obligations.id, invoiceId: obligations.paypalInvoiceId }).from(obligations)
            .where(inArray(obligations.id, round.setoffs.map((item) => item.obligationId)))
        : Promise.resolve([]),
    ]);
    const nameById = new Map(businessRows.map((row) => [row.id, row.name]));
    const invoiceById = new Map(setoffObligations.map((row) => [row.id, row.invoiceId]));
    const journalDate = new Date().toISOString().slice(0, 10);

    const lines: JournalLine[] = [];
    let je = 0;
    for (const setoff of round.setoffs) {
      je += 1;
      const no = `JE-${String(je).padStart(4, "0")}`;
      const amount = dollars(setoff.amountMinor);
      const description = `Set-off invoice ${invoiceById.get(setoff.obligationId) ?? ""}`;
      lines.push({ journalNo: no, journalDate, account: "Accounts Payable", debits: amount, credits: "0.00", description, name: nameById.get(setoff.debtorId) ?? "Debtor" });
      lines.push({ journalNo: no, journalDate, account: "Accounts Receivable", debits: "0.00", credits: amount, description, name: nameById.get(setoff.creditorId) ?? "Creditor" });
    }
    for (const transfer of round.transfers) {
      je += 1;
      const no = `JE-${String(je).padStart(4, "0")}`;
      const amount = dollars(transfer.amountMinor);
      const ref = transfer.paypalCaptureId ?? transfer.payoutBatchId ?? transfer.payoutItemId ?? transfer.id;
      const description = `PayPal payment ${ref}`;
      const payerName = nameById.get(transfer.payerId) ?? "Payer";
      const payeeName = nameById.get(transfer.payeeId) ?? "Payee";
      lines.push({ journalNo: no, journalDate, account: "Accounts Payable", debits: amount, credits: "0.00", description, name: payerName });
      lines.push({ journalNo: no, journalDate, account: "PayPal Cash", debits: "0.00", credits: amount, description, name: payerName });
      lines.push({ journalNo: no, journalDate, account: "PayPal Cash", debits: amount, credits: "0.00", description, name: payeeName });
      lines.push({ journalNo: no, journalDate, account: "Accounts Receivable", debits: "0.00", credits: amount, description, name: payeeName });
    }

    const header = ["JournalNo", "JournalDate", "AccountName", "Debits", "Credits", "Description", "Name"];
    const body = lines.map((line) => [line.journalNo, line.journalDate, line.account, line.debits, line.credits, line.description, line.name].map(csv).join(","));
    const csvText = [header.map(csv).join(","), ...body].join("\n");
    return reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="journal-${roundId}.csv"`).send(csvText);
  });
};
