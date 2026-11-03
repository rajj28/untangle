import { planSettlement } from "@untangle/engine";
import type { Obligation } from "@untangle/engine";

export interface CityRequest {
  businesses: number;
  invoicesPerBusiness: number;
  seed: number;
}

export interface CityResult {
  businesses: number;
  invoices: number;
  totalOwed: number;
  clearedByLoops: number;
  moneyMoved: number;
  payments: number;
  /** How long the engine took, on this device. */
  millis: number;
}

function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** Synthetic city: most invoices go to businesses nearby, the rest anywhere; $50 to $5,000 each. */
export function makeCity({ businesses, invoicesPerBusiness, seed }: CityRequest): Obligation[] {
  const random = generator(seed);
  const count = businesses * invoicesPerBusiness;
  const obligations: Obligation[] = [];
  for (let i = 0; i < count; i++) {
    const debtor = Math.floor(random() * businesses);
    let creditor = random() < 0.6 ? (debtor + 1 + Math.floor(random() * 25)) % businesses : Math.floor(random() * businesses);
    if (creditor === debtor) creditor = (creditor + 1) % businesses;
    obligations.push({ id: `i${i}`, debtor: `b${debtor}`, creditor: `b${creditor}`, amount: 5_000 + Math.floor(random() * 495_000) });
  }
  return obligations;
}

export function untangleCity(request: CityRequest, now: () => number = () => performance.now()): CityResult {
  const obligations = makeCity(request);
  const started = now();
  const plan = planSettlement(obligations);
  const millis = now() - started;
  return {
    businesses: request.businesses,
    invoices: obligations.length,
    totalOwed: plan.stats.totalOwed,
    clearedByLoops: plan.stats.clearedByLoops,
    moneyMoved: plan.stats.moneyMoved,
    payments: plan.transfers.length,
    millis,
  };
}
