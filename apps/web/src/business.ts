import type { ObligationView } from "./types.ts";

export interface BusinessPosition {
  owesMinor: number;
  owedMinor: number;
  netMinor: number;
}

export function businessPosition(obligations: readonly ObligationView[], businessId: string): BusinessPosition {
  let owesMinor = 0;
  let owedMinor = 0;
  for (const obligation of obligations) {
    if (obligation.status === "cancelled") continue;
    if (obligation.debtorId === businessId) owesMinor += obligation.outstandingMinor;
    if (obligation.creditorId === businessId) owedMinor += obligation.outstandingMinor;
  }
  return { owesMinor, owedMinor, netMinor: owedMinor - owesMinor };
}
