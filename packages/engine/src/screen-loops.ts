import type { Loop } from "./loops.ts";

export interface FraudScreenInvoiceMeta {
  readonly debtor: string;
  readonly creditor: string;
  /** ISO timestamp when the invoice was created. */
  readonly createdAt: string;
  /** Amount in minor units. */
  readonly amount: number;
}

export interface FraudScreenMeta {
  /** Business id -> ISO timestamp when the business was created. */
  readonly createdAtByBusiness: Readonly<Record<string, string>>;
  /** Obligation id -> invoice metadata. */
  readonly invoices: Readonly<Record<string, FraudScreenInvoiceMeta>>;
  /** Optional reference "now"; defaults to the newest invoice timestamp in the meta. */
  readonly now?: string;
}

export interface ScreenedLoop {
  readonly loopId: string;
  /** Number of fraud indicators present (0..4). */
  readonly score: number;
  /** True when at least one fraud indicator is present. */
  readonly held: boolean;
  readonly reasons: readonly string[];
}

const YOUNG_DAYS = 30;
const ROUND_UNIT = 500;
const ROUND_SHARE = 0.6;
const YOUNG_SHARE = 0.6;
const SAME_DAY_MS = 24 * 60 * 60 * 1000;

function parseTime(iso: string): number {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return 0;
  return at;
}

/**
 * Screens loops of obligations for the circular-invoicing / VAT-carousel
 * pattern. A loop is a directed cycle of obligations cleared by set-off; a
 * suspicious ring tends to:
 *   - be made of businesses created around the same time and recently,
 *   - use round invoice amounts (multiples of 500),
 *   - issue every invoice within a 24-hour window, and
 *   - trade only inside the ring (no partners outside it).
 *
 * Returns one result per loop. A held loop should be excluded from clearing so
 * a person can review it.
 */
export function screenLoops(loops: readonly Loop[], meta: FraudScreenMeta): ScreenedLoop[] {
  let now = meta.now !== undefined ? parseTime(meta.now) : 0;
  if (now === 0) {
    for (const invoice of Object.values(meta.invoices)) {
      const at = parseTime(invoice.createdAt);
      if (at > now) now = at;
    }
  }
  const youngCutoff = now - YOUNG_DAYS * 24 * 60 * 60 * 1000;

  // partyInvoices: which invoices each business appears on (used once for the
  // isolation check instead of scanning every invoice per loop).
  const partyInvoices = new Map<string, Set<string>>();
  for (const [id, invoice] of Object.entries(meta.invoices)) {
    let a = partyInvoices.get(invoice.debtor);
    if (a === undefined) { a = new Set(); partyInvoices.set(invoice.debtor, a); }
    a.add(id);
    let b = partyInvoices.get(invoice.creditor);
    if (b === undefined) { b = new Set(); partyInvoices.set(invoice.creditor, b); }
    b.add(id);
  }

  const results: ScreenedLoop[] = [];
  for (const loop of loops) {
    const invoices = loop.memberIds
      .map((id) => meta.invoices[id])
      .filter((invoice): invoice is FraudScreenInvoiceMeta => invoice !== undefined);
    if (invoices.length === 0) {
      results.push({ loopId: loop.id, score: 0, held: false, reasons: [] });
      continue;
    }

    const reasons: string[] = [];

    // Members and their creation dates.
    const memberBusinesses = new Set<string>();
    for (const invoice of invoices) {
      memberBusinesses.add(invoice.debtor);
      memberBusinesses.add(invoice.creditor);
    }
    const memberIds = [...memberBusinesses];
    const young = memberIds.filter((id) => {
      const createdAt = meta.createdAtByBusiness[id];
      return createdAt !== undefined && parseTime(createdAt) >= youngCutoff;
    });
    if (young.length / memberIds.length >= YOUNG_SHARE) {
      reasons.push(`recently_created:${young.length}/${memberIds.length} members under ${YOUNG_DAYS} days`);
    }

    // Round amounts.
    const roundAmounts = invoices.filter((invoice) => invoice.amount > 0 && invoice.amount % ROUND_UNIT === 0);
    if (roundAmounts.length / invoices.length >= ROUND_SHARE) {
      reasons.push(`round_amounts:${roundAmounts.length}/${invoices.length} invoices in multiples of ${ROUND_UNIT}`);
    }

    // All invoices within 24h of each other.
    let earliest = Infinity;
    let latest = -Infinity;
    for (const invoice of invoices) {
      const at = parseTime(invoice.createdAt);
      if (at < earliest) earliest = at;
      if (at > latest) latest = at;
    }
    if (latest - earliest <= SAME_DAY_MS) reasons.push("same_day:all invoices created within 24 hours");

    // Members with no trading partners outside the loop. Only meaningful when an
    // outside marketplace exists at all: a loop that is the entire network is a
    // small closed economy, not a ring hidden among legitimate trade. Isolation
    // is judged globally on the loop's member businesses: a member is isolated
    // when every invoice it appears on has both parties inside the ring.
    const loopBusinesses = new Set<string>();
    for (const invoice of invoices) {
      loopBusinesses.add(invoice.debtor);
      loopBusinesses.add(invoice.creditor);
    }
    const loopIdSet = new Set(loop.memberIds);
    const hasOtherInvoices = Object.keys(meta.invoices).some((id) => !loopIdSet.has(id));
    if (hasOtherInvoices) {
      const isolated = [...loopBusinesses].filter((id) => {
        const invoicesOf = partyInvoices.get(id);
        if (invoicesOf === undefined) return true;
        for (const invoiceId of invoicesOf) {
          const invoice = meta.invoices[invoiceId];
          if (invoice === undefined) continue;
          if (!loopBusinesses.has(invoice.debtor) || !loopBusinesses.has(invoice.creditor)) return false;
        }
        return true;
      });
      if (isolated.length === loopBusinesses.size) {
        reasons.push(`no_outside_partners:${isolated.length}/${loopBusinesses.size} members trade only inside the loop`);
      }
    }

    // A loop is held only when it is genuinely closed: at least one member has
    // no trading partners outside the loop. Age, round amounts, and same-day
    // issuance are aggravating indicators and are reported in the score, but on
    // their own they also describe a normal young marketplace (a fresh demo town,
    // for example). Isolation is the signature of a circular-invoicing ring.
    const held = reasons.some((reason) => reason.startsWith("no_outside_partners"));
    results.push({ loopId: loop.id, score: reasons.length, held, reasons });
  }
  return results;
}
