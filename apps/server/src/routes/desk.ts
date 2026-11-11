import { findLoops, planSettlement, screenLoops } from "@untangle/engine";
import type { Obligation } from "@untangle/engine";
import type { FastifyPluginAsync } from "fastify";
import type { AppContext } from "../context.ts";

/**
 * The City Desk: a deterministic synthetic city of 10,000 businesses and
 * 60,000 invoices, cleared once by the real engine and then served to the
 * browser through an AG Grid Server-Side Row Model route.
 *
 * The route implements the SSRM request shape (startRow/endRow, rowGroupCols,
 * groupKeys, valueCols, sortModel, filterModel) and does all grouping, sorting,
 * filtering and aggregation server-side — the browser only renders the rows it
 * receives.
 */

const BUSINESS_COUNT = 10_000;
const INVOICES_PER_BUSINESS = 6;
const SEED = 2_024_11_07; // fixed, deterministic
const LOOP_CAP = 6000; // enumerate this many exact loops; the rest get a component id
const CURRENCY = "USD";

// Suspicious rings are injected with the fixed seed so the fraud screen finds
// them for real. Five rings of four businesses each live at the end of the city.
const RING_COUNT = 5;
const RING_SIZE = 4;
const RING_BASE = BUSINESS_COUNT - 40;

const SECTORS = [
  "Food & drink",
  "Construction",
  "Logistics",
  "Manufacturing",
  "Retail",
  "Agriculture",
  "Professional services",
  "Cleaning & facilities",
  "Print & stationery",
  "Healthcare",
  "Hospitality",
  "Transportation",
  "Technology",
  "Utilities",
] as const;

export interface CityBusiness {
  id: string;
  name: string;
  sector: string;
  createdAt: string;
}

export interface CityInvoice {
  id: string;
  debtorId: string;
  creditorId: string;
  debtorName: string;
  creditorName: string;
  businessId: string;
  businessName: string;
  sector: string;
  amountMinor: number;
  clearedMinor: number;
  cashNeededMinor: number;
  loopId: string | null;
  paypalInvoiceId: string;
  dueOn: string;
  createdAt: string;
  description: string;
  currency: string;
  /** 1 when the invoice belongs to a loop held by the fraud screen. */
  fraudHeld: number;
  /** Human-readable reasons when fraudHeld is 1. */
  fraudReasons: string[];
}

interface CityCache {
  sectors: string[];
  businesses: CityBusiness[];
  businessBySector: Map<string, CityBusiness[]>;
  invoicesByBusiness: Map<string, CityInvoice[]>;
}

let cityCache: CityCache | null = null;

function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/**
 * Rewire a handful of businesses at the end of the city into five closed,
 * same-day, round-amount rings. Fixed seed + fixed ring definitions make these
 * the same every run, so the fraud screen reliably finds them.
 */
function injectRings(businesses: CityBusiness[], invoices: CityInvoice[], now: number): string[][] {
  const biz = new Map(businesses.map((business) => [business.id, business]));
  const ringOf = new Map<string, number>();
  const rings: string[][] = [];
  for (let r = 0; r < RING_COUNT; r++) {
    const members: string[] = [];
    for (let k = 0; k < RING_SIZE; k++) {
      const id = `b${RING_BASE + r * RING_SIZE + k}`;
      ringOf.set(id, r);
      members.push(id);
      biz.get(id)!.createdAt = new Date(now - (2 + r) * 86_400_000).toISOString(); // young: 2-6 days old
    }
    rings.push(members);
  }
  const ringCreatedAt = new Date(now - 86_400_000).toISOString(); // all issued the same day
  const baseOf = (member: string) => Math.floor((Number(member.slice(1)) - RING_BASE) / RING_SIZE) * RING_SIZE;
  const ringIdx = (member: string) => Number(member.slice(1)) - RING_BASE - baseOf(member);

  for (const invoice of invoices) {
    const dRing = ringOf.get(invoice.debtorId);
    const cRing = ringOf.get(invoice.creditorId);
    if (dRing === undefined && cRing === undefined) continue;

    let debtorMember: string;
    let creditorMember: string;
    if (dRing !== undefined && cRing !== undefined) {
      if (dRing === cRing) {
        debtorMember = invoice.debtorId;
        creditorMember = invoice.creditorId;
      } else {
        // Two different rings: fold the invoice into the debtor's own ring so
        // each ring truly only trades with itself.
        debtorMember = invoice.debtorId;
        const base = RING_BASE + baseOf(debtorMember);
        creditorMember = `b${base + ((ringIdx(debtorMember) + 1) % RING_SIZE)}`;
      }
    } else if (dRing !== undefined) {
      debtorMember = invoice.debtorId;
      const base = RING_BASE + baseOf(debtorMember);
      creditorMember = `b${base + ((ringIdx(debtorMember) + 1) % RING_SIZE)}`;
    } else {
      creditorMember = invoice.creditorId;
      const base = RING_BASE + baseOf(creditorMember);
      debtorMember = `b${base + ((ringIdx(creditorMember) + 1) % RING_SIZE)}`;
    }

    invoice.debtorId = debtorMember;
    invoice.creditorId = creditorMember;
    invoice.debtorName = biz.get(debtorMember)!.name;
    invoice.creditorName = biz.get(creditorMember)!.name;
    invoice.businessId = debtorMember;
    invoice.businessName = biz.get(debtorMember)!.name;
    invoice.sector = biz.get(debtorMember)!.sector;
    invoice.createdAt = ringCreatedAt;
  }
  return rings;
}

function buildCity(): CityCache {
  const random = generator(SEED);

  const businesses: CityBusiness[] = [];
  const cityNow = Date.UTC(2026, 6, 1);
  for (let b = 0; b < BUSINESS_COUNT; b++) {
    const sector = SECTORS[Math.floor(random() * SECTORS.length)]!;
    businesses.push({ id: `b${b}`, name: `${sector} ${String(b + 1).padStart(4, "0")}`, sector, createdAt: new Date(cityNow - (300 + (b % 700)) * 86_400_000).toISOString() });
  }
  const businessById = new Map(businesses.map((business) => [business.id, business]));

  const invoices: CityInvoice[] = [];
  for (let b = 0; b < BUSINESS_COUNT; b++) {
    for (let k = 0; k < INVOICES_PER_BUSINESS; k++) {
      const idx = b * INVOICES_PER_BUSINESS + k;
      let creditor = random() < 0.6 ? (b + 1 + Math.floor(random() * 25)) % BUSINESS_COUNT : Math.floor(random() * BUSINESS_COUNT);
      if (creditor === b) creditor = (creditor + 1) % BUSINESS_COUNT;
      const business = businessById.get(`b${b}`)!;
      const creditorBusiness = businessById.get(`b${creditor}`)!;
      invoices.push({
        id: `i${idx}`,
        debtorId: `b${b}`,
        creditorId: `b${creditor}`,
        debtorName: business.name,
        creditorName: creditorBusiness.name,
        businessId: business.id,
        businessName: business.name,
        sector: business.sector,
        amountMinor: 5_000 + Math.floor(random() * 495_000),
        clearedMinor: 0,
        cashNeededMinor: 0,
        loopId: null,
        paypalInvoiceId: `PP-INV-${String(idx + 1).padStart(7, "0")}`,
        dueOn: new Date(Date.UTC(2026, 1, 1) + (idx % 90) * 86_400_000).toISOString().slice(0, 10),
        createdAt: new Date(cityNow - (5 + (idx % 120)) * 86_400_000).toISOString(),
        description: `${business.sector} goods & services · invoice ${idx + 1}`,
        currency: CURRENCY,
        fraudHeld: 0,
        fraudReasons: [],
      });
    }
  }

  const rings = injectRings(businesses, invoices, cityNow);
  const byId = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const obligations: Obligation[] = invoices.map((invoice) => ({
    id: invoice.id,
    debtor: invoice.debtorId,
    creditor: invoice.creditorId,
    amount: invoice.amountMinor,
  }));
  const plan = planSettlement(obligations);

  for (const invoice of invoices) {
    invoice.clearedMinor = plan.setoffs[invoice.id] ?? 0;
  }

  const loops = findLoops(obligations, plan.setoffs, LOOP_CAP);
  const loopOf = new Map<string, string>();
  for (const loop of loops) {
    for (const member of loop.memberIds) {
      if (!loopOf.has(member)) loopOf.set(member, loop.id);
    }
  }

  // Fallback for cleared invoices the capped decomposition did not visit: group
  // them by weakly-connected component of the cleared subgraph, so every cleared
  // invoice still has a stable loop id.
  const componentOf = new Map<string, string>();
  {
    const adj = new Map<string, string[]>();
    for (const invoice of invoices) {
      if (invoice.clearedMinor <= 0) continue;
      const a = invoice.debtorId;
      const b = invoice.creditorId;
      const la = adj.get(a) ?? [];
      la.push(b);
      adj.set(a, la);
      const lb = adj.get(b) ?? [];
      lb.push(a);
      adj.set(b, lb);
    }
    const debtorComp = new Map<string, number>();
    let c = 0;
    const visited = new Set<string>();
    for (const start of adj.keys()) {
      if (visited.has(start)) continue;
      const queue = [start];
      visited.add(start);
      while (queue.length > 0) {
        const node = queue.shift()!;
        debtorComp.set(node, c);
        for (const next of adj.get(node) ?? []) {
          if (!visited.has(next)) {
            visited.add(next);
            queue.push(next);
          }
        }
      }
      c += 1;
    }
    for (const invoice of invoices) {
      if (invoice.clearedMinor > 0 && invoice.loopId === null) {
        const dc = debtorComp.get(invoice.debtorId);
        if (dc !== undefined) componentOf.set(invoice.id, `loop-component-${dc}`);
      }
    }
  }

  for (const invoice of invoices) {
    if (invoice.clearedMinor > 0 && invoice.loopId === null) {
      invoice.loopId = componentOf.get(invoice.id) ?? null;
    }
  }

  // Fraud-ring screen: mark invoices that belong to held loops. The injected
  // rings live beyond the capped global loop enumeration, so we add their own
  // subgraph loops to the screening set to guarantee they are found.
  {
    const createdAtByBusiness: Record<string, string> = {};
    for (const business of businesses) createdAtByBusiness[business.id] = business.createdAt;
    const invoiceMeta: Record<string, { debtor: string; creditor: string; createdAt: string; amount: number }> = {};
    for (const invoice of invoices) {
      invoiceMeta[invoice.id] = { debtor: invoice.debtorId, creditor: invoice.creditorId, createdAt: invoice.createdAt, amount: invoice.amountMinor };
    }
    const ringMembers = new Set(rings.flat());
    const ringInvoices = invoices.filter((invoice) => ringMembers.has(invoice.debtorId) && ringMembers.has(invoice.creditorId) && invoice.clearedMinor > 0);
    const ringObligations = ringInvoices.map((invoice) => ({ id: invoice.id, debtor: invoice.debtorId, creditor: invoice.creditorId, amount: invoice.clearedMinor }));
    const ringSetoffs: Record<string, number> = {};
    for (const invoice of ringInvoices) ringSetoffs[invoice.id] = invoice.clearedMinor;
    const ringLoops = findLoops(ringObligations, ringSetoffs);
    // Also present each injected ring as one closed unit so the closure check
    // sees the whole ring (not just one cycle among its members).
    const ringUnitLoops = rings
      .map((members, r) => {
        const ids = ringInvoices.filter((invoice) => members.includes(invoice.debtorId)).map((invoice) => invoice.id);
        return { id: `ring-${r}`, amount: ids.reduce((sum, id) => sum + (ringSetoffs[id] ?? 0), 0), memberIds: ids };
      })
      .filter((loop) => loop.memberIds.length > 0);
    const extraLoops = [...ringLoops, ...ringUnitLoops];
    const screenInput = [...loops, ...extraLoops];
    const screened = screenLoops(screenInput, { createdAtByBusiness, invoices: invoiceMeta });
    const heldLoopIds = new Set(screened.filter((result) => result.held).map((result) => result.loopId));
    if (heldLoopIds.size > 0) {
      const reasonsByLoop = new Map(screened.filter((result) => result.held).map((result) => [result.loopId, [...result.reasons]]));
      for (const invoice of invoices) {
        const loopId = invoice.loopId;
        if (loopId !== null && heldLoopIds.has(loopId)) {
          const loop = screenInput.find((item) => item.id === loopId);
          if (loop !== undefined && loop.memberIds.includes(invoice.id)) {
            invoice.fraudHeld = 1;
            invoice.fraudReasons = reasonsByLoop.get(loopId) ?? [];
          }
        }
      }
      // Ring subgraph loops aren't assigned as the invoices' loopId (that comes
      // from the global enumeration / component fallback), so match held ring
      // loops by membership directly.
      for (const loop of extraLoops) {
        if (!heldLoopIds.has(loop.id)) continue;
        const reasons = reasonsByLoop.get(loop.id) ?? [];
        for (const invoice of invoices) {
          if (loop.memberIds.includes(invoice.id) && invoice.fraudHeld === 0) {
            invoice.fraudHeld = 1;
            invoice.fraudReasons = reasons;
          }
        }
      }
    }
  }


  for (const transfer of plan.transfers) {
    for (const leg of transfer.legs) {
      const invoice = byId.get(leg.obligationId);
      if (invoice) invoice.cashNeededMinor += leg.amount;
    }
  }

  const businessBySector = new Map<string, CityBusiness[]>();
  for (const business of businesses) {
    const list = businessBySector.get(business.sector);
    if (list) {
      list.push(business);
    } else {
      businessBySector.set(business.sector, [business]);
    }
  }
  const invoicesByBusiness = new Map<string, CityInvoice[]>();
  for (const invoice of invoices) {
    const list = invoicesByBusiness.get(invoice.businessId);
    if (list) {
      list.push(invoice);
    } else {
      invoicesByBusiness.set(invoice.businessId, [invoice]);
    }
  }

  const cache: CityCache = {
    sectors: [...businessBySector.keys()],
    businesses,
    businessBySector,
    invoicesByBusiness,
  };
  cityCache = cache;
  return cache;
}

function ensureCity(): CityCache {
  if (cityCache !== null) return cityCache;
  return buildCity();
}

// ── SSRM request handling ───────────────────────────────────────────────────

export type DeskFilterText = { filterType: "text"; type: string; filter?: string };
export type DeskFilterNumber = { filterType: "number"; type: string; filter?: number; filterTo?: number };
export type DeskFilter = DeskFilterText | DeskFilterNumber;

export interface DeskRowsRequest {
  startRow: number;
  endRow: number;
  rowGroupCols?: { id: string; field: string; displayName: string }[];
  groupKeys?: string[];
  valueCols?: { id: string; field: string; aggFunc: string; displayName: string }[];
  sortModel?: { colId: string; sort: "asc" | "desc" }[];
  filterModel?: Record<string, DeskFilter | null>;
  group?: boolean;
  pivotMode?: boolean;
}

export interface DeskRowsResponse {
  rows: unknown[];
  lastRow: number;
}

function matchesText(filter: DeskFilterText, value: unknown): boolean {
  const hay = String(value ?? "").toLowerCase();
  const needle = String(filter.filter ?? "").toLowerCase();
  switch (filter.type) {
    case "contains":
      return hay.includes(needle);
    case "notContains":
      return !hay.includes(needle);
    case "equals":
      return hay === needle;
    case "startsWith":
      return hay.startsWith(needle);
    case "endsWith":
      return hay.endsWith(needle);
    default:
      return true;
  }
}

function matchesNumber(filter: DeskFilterNumber, value: unknown): boolean {
  const v = Number(value);
  if (!Number.isFinite(v)) return false;
  const n = Number(filter.filter);
  const n2 = Number(filter.filterTo);
  switch (filter.type) {
    case "equals":
      return v === n;
    case "notEqual":
      return v !== n;
    case "lessThan":
      return v < n;
    case "lessThanOrEqual":
      return v <= n;
    case "greaterThan":
      return v > n;
    case "greaterThanOrEqual":
      return v >= n;
    case "inRange":
      return v >= n && v <= n2;
    default:
      return true;
  }
}

/** Grid column ids that differ from the invoice field they show. */
const COL_FIELD: Record<string, string> = { screen: "fraudHeld" };

function applyFilter(invoices: CityInvoice[], filterModel: Record<string, DeskFilter | null> | undefined): CityInvoice[] {
  if (!filterModel || Object.keys(filterModel).length === 0) return invoices;
  return invoices.filter((invoice) => {
    for (const [colId, filter] of Object.entries(filterModel)) {
      if (!filter) continue;
      const value = (invoice as unknown as Record<string, unknown>)[COL_FIELD[colId] ?? colId];
      if (filter.filterType === "number") {
        if (!matchesNumber(filter as DeskFilterNumber, value)) return false;
      } else if (!matchesText(filter as DeskFilterText, value)) {
        return false;
      }
    }
    return true;
  });
}

function aggregate(leaves: CityInvoice[], valueCols: NonNullable<DeskRowsRequest["valueCols"]>): Record<string, number> {
  const out: Record<string, number> = { count: leaves.length };
  for (const col of valueCols) {
    if (col.aggFunc === "count") {
      out[col.field] = leaves.length;
      continue;
    }
    let sum = 0;
    for (const leaf of leaves) {
      const x = (leaf as unknown as Record<string, unknown>)[col.field];
      sum += typeof x === "number" ? x : 0;
    }
    out[col.field] = sum;
  }
  let amount = 0;
  let cleared = 0;
  let cash = 0;
  let fraudHeld = 0;
  for (const leaf of leaves) {
    amount += leaf.amountMinor;
    cleared += leaf.clearedMinor;
    cash += leaf.cashNeededMinor;
    fraudHeld += leaf.fraudHeld;
  }
  out.amountMinor = amount;
  out.clearedMinor = cleared;
  out.cashNeededMinor = cash;
  out.fraudHeld = fraudHeld;
  return out;
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

function applySort<T>(rows: T[], sortModel: NonNullable<DeskRowsRequest["sortModel"]>, getValue: (row: T, colId: string) => unknown): T[] {
  if (sortModel.length === 0) return rows;
  const sorted = [...rows];
  sorted.sort((a, b) => {
    for (let col of sortModel) {
      const av = getValue(a, col.colId);
      const bv = getValue(b, col.colId);
      const c = compare(av, bv);
      if (c !== 0) return col.sort === "desc" ? -c : c;
    }
    return 0;
  });
  return sorted;
}

function paginate<T>(rows: T[], startRow: number, endRow: number): { rows: T[]; total: number } {
  const total = rows.length;
  if (startRow >= total) return { rows: [], total };
  return { rows: rows.slice(startRow, Math.min(endRow, total)), total };
}

interface GroupLike {
  sector: string;
  businessName: string;
}

function groupSortValue(row: unknown, colId: string): unknown {
  const group = row as Record<string, unknown>;
  if (colId in group) return group[colId];
  if (typeof (row as GroupLike).sector === "string") return (row as GroupLike).sector;
  if (typeof (row as GroupLike).businessName === "string") return (row as GroupLike).businessName;
  return "";
}

function sectorRows(cache: CityCache, req: DeskRowsRequest): { rows: unknown[]; total: number } {
  const valueCols = req.valueCols ?? [];
  const sortModel = req.sortModel ?? [];
  const perSector = new Map<string, CityInvoice[]>();
  for (const sector of cache.sectors) {
    const list = cache.businessBySector.get(sector) ?? [];
    let leaves: CityInvoice[] = [];
    for (const business of list) leaves.push(...(cache.invoicesByBusiness.get(business.id) ?? []));
    perSector.set(sector, applyFilter(leaves, req.filterModel));
  }
  const filtering = Object.values(req.filterModel ?? {}).some(Boolean);
  const rows = cache.sectors.filter((sector) => !filtering || (perSector.get(sector)?.length ?? 0) > 0).map((sector) => {
    const agg = aggregate(perSector.get(sector) ?? [], valueCols);
    return { id: `sector:${sector}`, sector, sectorName: sector, ...agg };
  });
  const sorted = applySort(rows, sortModel, groupSortValue);
  return paginate(sorted, req.startRow, req.endRow);
}

function businessRows(cache: CityCache, sector: string, req: DeskRowsRequest): { rows: unknown[]; total: number } {
  const valueCols = req.valueCols ?? [];
  const sortModel = req.sortModel ?? [];
  const businesses = cache.businessBySector.get(sector) ?? [];
  const filtering = Object.values(req.filterModel ?? {}).some(Boolean);
  const rows = businesses.flatMap((business) => {
    const leaves = applyFilter(cache.invoicesByBusiness.get(business.id) ?? [], req.filterModel);
    if (filtering && leaves.length === 0) return [];
    const agg = aggregate(leaves, valueCols);
    return [{ id: `business:${business.id}`, businessId: business.id, businessName: business.name, sector: business.sector, ...agg }];
  });
  const sorted = applySort(rows, sortModel, groupSortValue);
  return paginate(sorted, req.startRow, req.endRow);
}

function invoiceRows(cache: CityCache, businessId: string, req: DeskRowsRequest): { rows: unknown[]; total: number } {
  let leaves = applyFilter(cache.invoicesByBusiness.get(businessId) ?? [], req.filterModel);
  leaves = applySort(leaves, req.sortModel ?? [], (row, colId) => (row as unknown as Record<string, unknown>)[colId] ?? row.id);
  return paginate(leaves, req.startRow, req.endRow);
}

export function buildDeskRows(req: DeskRowsRequest): DeskRowsResponse {
  const cache = ensureCity();
  const depth = req.groupKeys?.length ?? 0;
  const valueCols = req.valueCols ?? [];
  const sortModel = req.sortModel ?? [];

  const filterModel = req.filterModel ?? {};
  const reqWithDefaults: DeskRowsRequest = { ...req, valueCols, sortModel, filterModel };

  let result: { rows: unknown[]; total: number };
  if (depth === 0) {
    result = sectorRows(cache, reqWithDefaults);
  } else if (depth === 1) {
    const sector = req.groupKeys![0] ?? "";
    result = businessRows(cache, sector, reqWithDefaults);
  } else {
    const businessId = req.groupKeys![1] ?? "";
    result = invoiceRows(cache, businessId, reqWithDefaults);
  }

  return { rows: result.rows, lastRow: req.endRow >= result.total ? result.total : -1 };
}

export const deskRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app) => {
  app.post<{ Body: DeskRowsRequest }>("/api/desk/rows", async (request) => {
    return buildDeskRows(request.body ?? ({} as DeskRowsRequest));
  });
};
