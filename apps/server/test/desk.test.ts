import { describe, expect, it } from "vitest";
import { buildDeskRows } from "../src/routes/desk.ts";
import type { DeskRowsRequest } from "../src/routes/desk.ts";
import { makeTestContext } from "./context.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

const TIMEOUT = 180_000; // the synthetic city is built once and takes a while

const ALL: DeskRowsRequest = {
  startRow: 0,
  endRow: 1e9,
  rowGroupCols: [{ id: "sector", field: "sector", displayName: "Sector" }],
  valueCols: [
    { id: "amountMinor", field: "amountMinor", aggFunc: "sum", displayName: "Owed" },
    { id: "clearedMinor", field: "clearedMinor", aggFunc: "sum", displayName: "Cleared" },
    { id: "cashNeededMinor", field: "cashNeededMinor", aggFunc: "sum", displayName: "Cash needed" },
  ],
  groupKeys: [],
  sortModel: [],
  filterModel: {},
};

const BUSINESS_GROUP_COLS = [
  { id: "sector", field: "sector", displayName: "Sector" },
  { id: "businessName", field: "businessName", displayName: "Business" },
];

function asRows(rows: unknown[]): Row[] {
  return rows as Row[];
}

function sum(rows: Row[], key: string): number {
  return rows.reduce<number>((acc, r) => acc + ((r[key] as number | undefined) ?? 0), 0);
}

describe("desk city server-side rows", () => {
  it("serves the city route through the HTTP server even when a demo write code is configured", async () => {
    const { app } = await makeTestContext({ demoWriteToken: "test-token" });
    const res = await app.inject({
      method: "POST",
      url: "/api/desk/rows",
      payload: {
        startRow: 0,
        endRow: 100,
        rowGroupCols: [{ id: "sector", field: "sector", displayName: "Sector" }],
        groupKeys: [],
        valueCols: [{ id: "amountMinor", field: "amountMinor", aggFunc: "sum", displayName: "Owed" }],
        sortModel: [],
        filterModel: {},
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { rows: unknown[]; lastRow: number };
    expect(Array.isArray(body.rows)).toBe(true);
    expect(body.rows.length).toBeGreaterThan(0);
    expect(typeof body.lastRow).toBe("number");
  }, TIMEOUT);

  it("serves sector groups whose aggregates match the whole city", () => {
    const resp = buildDeskRows(ALL);
    const rows = asRows(resp.rows);
    expect(rows.length).toBeGreaterThan(0);
    const total = sum(rows, "amountMinor");
    const cleared = sum(rows, "clearedMinor");
    const cash = sum(rows, "cashNeededMinor");
    // Fixed-seed city: 60,000 invoices totalling $151,391,593.34 (USD minor).
    expect(total).toBe(15_139_159_334);
    // Every invoice is either cleared by a loop or settled with cash.
    expect(cleared + cash).toBe(total);
    // Cash needed cannot exceed total owed.
    expect(cash).toBeLessThan(total);
  }, TIMEOUT);

  it("flags the injected fraud rings in the Screen column", () => {
    // Five suspicious rings are injected near the end of the city; the screen
    // must hold them for real. The sector aggregate surfaces the held count.
    const top = buildDeskRows(ALL);
    const rows = asRows(top.rows);
    const held = sum(rows, "fraudHeld");
    expect(held).toBeGreaterThan(0);
  }, TIMEOUT);

  it("filters by the Screen column id and drops groups with no matching invoices", () => {
    const req: DeskRowsRequest = { ...ALL, filterModel: { screen: { filterType: "number", type: "equals", filter: 1 } as never } };
    const sectors = asRows(buildDeskRows(req).rows);
    expect(sectors.length).toBeGreaterThan(0);
    expect(sectors.length).toBeLessThan(asRows(buildDeskRows(ALL).rows).length);
    for (const row of sectors) expect(row.amountMinor).toBeGreaterThan(0);
    const businesses = asRows(buildDeskRows({ ...req, rowGroupCols: BUSINESS_GROUP_COLS, groupKeys: [sectors[0].sector] }).rows);
    expect(businesses.length).toBeGreaterThan(0);
    for (const row of businesses) expect(row.amountMinor).toBeGreaterThan(0);
  }, TIMEOUT);

  it("drills from a sector into its businesses, keeping aggregates consistent", () => {
    const top = buildDeskRows(ALL);
    const topRows = asRows(top.rows);
    const sector = topRows[0].sector as string;
    const sectorOwed = topRows[0].amountMinor as number;

    const businessResp = buildDeskRows({
      ...ALL,
      groupKeys: [sector],
      rowGroupCols: BUSINESS_GROUP_COLS,
    });
    const businessRows = asRows(businessResp.rows);
    expect(businessRows.length).toBeGreaterThan(0);
    expect(sum(businessRows, "amountMinor")).toBe(sectorOwed);

    // Drill into the first business, down to its invoices.
    const first = businessRows[0];
    const invoiceResp = buildDeskRows({
      ...ALL,
      groupKeys: [sector, first.businessId as string],
      rowGroupCols: BUSINESS_GROUP_COLS,
    });
    const invoiceRows = asRows(invoiceResp.rows);
    expect(invoiceRows.length).toBe(6);
    expect(sum(invoiceRows, "amountMinor")).toBe(first.amountMinor as number);
  }, TIMEOUT);

  it("filters by number and text, and sorts", () => {
    const top = buildDeskRows(ALL);
    const topRows = asRows(top.rows);
    const sector = topRows[0].sector as string;

    const filtered = buildDeskRows({
      ...ALL,
      groupKeys: [sector],
      rowGroupCols: BUSINESS_GROUP_COLS,
      filterModel: {
        amountMinor: { filterType: "number", type: "greaterThan", filter: 100_000 },
      },
    });
    for (const row of asRows(filtered.rows)) {
      expect(row.amountMinor as number).toBeGreaterThan(100_000);
    }
    const sorted = buildDeskRows({
      ...ALL,
      groupKeys: [sector],
      rowGroupCols: BUSINESS_GROUP_COLS,
      sortModel: [{ colId: "amountMinor", sort: "desc" }],
    });
    const amounts = asRows(sorted.rows).map((r) => r.amountMinor as number);
    expect(amounts).toEqual([...amounts].sort((a, b) => b - a));
  }, TIMEOUT);

  it("paginates with the right lastRow", () => {
    const top = buildDeskRows(ALL);
    const total = top.rows.length;
    const firstPage = buildDeskRows({ ...ALL, startRow: 0, endRow: 3 });
    expect(firstPage.rows.length).toBe(3);
    expect(firstPage.lastRow).toBe(-1);
    const lastPage = buildDeskRows({ ...ALL, startRow: total - 2, endRow: total });
    expect(lastPage.rows.length).toBe(2);
    expect(lastPage.lastRow).toBe(total);
  }, TIMEOUT);
});
