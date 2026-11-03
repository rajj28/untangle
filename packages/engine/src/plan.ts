import { settleChains } from "./chains.ts";
import { clearLoops } from "./clear-loops.ts";
import type { Obligation, SettlementPlan } from "./types.ts";
import { validateObligations } from "./validate.ts";

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Full settlement plan for one currency: loops cancel with no money, then the rest
 * settles in the fewest-money set of chain transfers. Deterministic: the same set
 * of obligations in any order produces the same plan.
 */
export function planSettlement(obligations: readonly Obligation[]): SettlementPlan {
  validateObligations(obligations);
  const sorted = [...obligations].sort((a, b) => compare(a.id, b.id));

  const setoffs = clearLoops(sorted);
  const remaining = sorted
    .map((o) => ({ ...o, amount: o.amount - (setoffs[o.id] ?? 0) }))
    .filter((o) => o.amount > 0);
  const transfers = settleChains(remaining).sort((a, b) => compare(a.payer, b.payer) || compare(a.payee, b.payee));

  let totalOwed = 0;
  let clearedByLoops = 0;
  for (const o of sorted) {
    totalOwed += o.amount;
    clearedByLoops += setoffs[o.id] ?? 0;
  }
  const moneyMoved = transfers.reduce((sum, t) => sum + t.amount, 0);

  return {
    setoffs,
    transfers,
    stats: {
      totalOwed,
      clearedByLoops,
      settledByChains: totalOwed - clearedByLoops,
      moneyMoved,
      leverage: moneyMoved > 0 ? totalOwed / moneyMoved : null,
    },
  };
}
