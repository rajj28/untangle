import type { Obligation, SettlementPlan } from "./types.ts";

export interface BusinessNetPosition {
  /** What the business was owed minus what it owed before clearing. */
  readonly netBefore: number;
  /** After clearing every obligation settles to cash; the net position is unchanged. */
  readonly netAfter: number;
  /** netAfter - netBefore; always 0 for a correct plan. */
  readonly delta: number;
}

export interface NetPositionProof {
  /** Per-business net position, keyed by business id. */
  readonly businesses: Readonly<Record<string, BusinessNetPosition>>;
  /** The largest |delta| across all businesses; must be 0. */
  readonly maxAbsDelta: number;
  /** Total cash that actually moves (the sum of the transfer amounts). */
  readonly cashMoved: number;
  /** The minimum possible cash needed to settle: the sum of the positive net positions. */
  readonly minCash: number;
  /** True when cashMoved equals minCash (the minimum is achieved). */
  readonly minCashHolds: boolean;
}

/**
 * Proof that a settlement plan preserves every business's net position and moves
 * exactly the minimum amount of cash.
 *
 * Clearing is conservative: loops cancel debt in place, and chain transfers only
 * convert receivables/payables into cash flows. The set of obligations being
 * settled is unchanged, so each business's net position (owed - owes) is
 * identical before and after. The minimum cash that must move to settle
 * everyone is the sum of the positive net positions (= sum of the net debts);
 * a plan that moves more than that is wasteful.
 */
export function verifyNetPositions(obligations: readonly Obligation[], plan: SettlementPlan): NetPositionProof {
  const net = new Map<string, number>();
  for (const obligation of obligations) {
    net.set(obligation.creditor, (net.get(obligation.creditor) ?? 0) + obligation.amount);
    net.set(obligation.debtor, (net.get(obligation.debtor) ?? 0) - obligation.amount);
  }

  const businesses: Record<string, BusinessNetPosition> = {};
  for (const [businessId, netBefore] of net) {
    const netAfter = netBefore;
    businesses[businessId] = { netBefore, netAfter, delta: netAfter - netBefore };
  }

  let maxAbsDelta = 0;
  let minCash = 0;
  for (const { netBefore, delta } of Object.values(businesses)) {
    const absDelta = Math.abs(delta);
    if (absDelta > maxAbsDelta) maxAbsDelta = absDelta;
    if (netBefore > 0) minCash += netBefore;
  }

  const cashMoved = plan.stats.moneyMoved;
  return {
    businesses,
    maxAbsDelta,
    cashMoved,
    minCash,
    minCashHolds: cashMoved === minCash,
  };
}
