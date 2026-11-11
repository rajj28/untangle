import { describe, expect, it } from "vitest";
import { makeTestContext } from "./context.ts";
import { planRound } from "../src/services/rounds.ts";

interface JournalRow {
  journalNo: string;
  journalDate: string;
  account: string;
  debits: number;
  credits: number;
  description: string;
  name: string;
}

function parseCsv(text: string): JournalRow[] {
  const lines = text.trim().split("\n");
  const header = lines[0]!.split(",").map((cell) => cell.replace(/^"|"$/g, ""));
  const rows: JournalRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(",").map((cell) => cell.replace(/^"|"$/g, ""));
    const row: Record<string, string> = {};
    header.forEach((column, index) => { row[column] = cells[index] ?? ""; });
    rows.push({
      journalNo: row.JournalNo!,
      journalDate: row.JournalDate!,
      account: row.AccountName!,
      debits: Number(row.Debits ?? "0"),
      credits: Number(row.Credits ?? "0"),
      description: row.Description!,
      name: row.Name!,
    });
  }
  return rows;
}

describe("audit journal CSV", () => {
  it("exports a balanced double-entry journal for a round (per business and total)", async () => {
    const test = await makeTestContext();
    const round = await planRound(test.ctx, test.ids.network);
    const res = await test.app.inject({ method: "GET", url: `/api/audit/${round.id}/journal.csv` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);

    const rows = parseCsv(res.body);
    expect(rows.length).toBeGreaterThan(0);

    // Every transaction has a debit and a credit.
    for (const row of rows) {
      if (row.debits > 0) expect(row.credits).toBe(0);
      if (row.credits > 0) expect(row.debits).toBe(0);
    }

    // Total debits equal total credits.
    const totalDebits = rows.reduce((sum, row) => sum + row.debits, 0);
    const totalCredits = rows.reduce((sum, row) => sum + row.credits, 0);
    expect(totalDebits).toBe(totalCredits);

    // Per business, debits equal credits.
    const byBusiness = new Map<string, { debits: number; credits: number }>();
    for (const row of rows) {
      const entry = byBusiness.get(row.name) ?? { debits: 0, credits: 0 };
      entry.debits += row.debits;
      entry.credits += row.credits;
      byBusiness.set(row.name, entry);
    }
    for (const [name, entry] of byBusiness) {
      expect(entry.debits, `business ${name}`).toBe(entry.credits);
    }
  });
});
