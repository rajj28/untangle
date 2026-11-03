/** A debt: `debtor` owes `creditor` `amount` in minor units (cents). */
export interface Obligation {
  readonly id: string;
  readonly debtor: string;
  readonly creditor: string;
  readonly amount: number;
}

/** Part of one obligation paid off by a transfer. */
export interface Leg {
  readonly obligationId: string;
  readonly amount: number;
}

/**
 * One PayPal payment from a net debtor to a net creditor. It pays off every
 * leg along the chains between them; businesses in the middle step out by
 * assignment.
 */
export interface Transfer {
  readonly payer: string;
  readonly payee: string;
  readonly amount: number;
  readonly legs: readonly Leg[];
}

export interface SettlementStats {
  readonly totalOwed: number;
  /** Debt cancelled by loops: no money moves. */
  readonly clearedByLoops: number;
  /** Debt paid off by chain transfers. */
  readonly settledByChains: number;
  /** Money that actually moves through PayPal: the sum of net debts. */
  readonly moneyMoved: number;
  /** Invoice value settled per unit of money moved; null when nothing moves. */
  readonly leverage: number | null;
}

export interface SettlementPlan {
  /** Amount of each obligation cancelled by loops, keyed by obligation id. */
  readonly setoffs: Readonly<Record<string, number>>;
  readonly transfers: readonly Transfer[];
  readonly stats: SettlementStats;
}
