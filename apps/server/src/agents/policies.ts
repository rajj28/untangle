import { desc, eq } from "drizzle-orm";
import { businesses, policies } from "@untangle/db";
import type { AppContext } from "../context.ts";

/**
 * What a business lets its AI treasurer do without asking. The treasurer may always be more
 * careful than its policy; a deterministic referee stops it from ever being less careful.
 */
export interface TreasurerPolicy {
  language: string;
  autoSign: "always" | "if_no_outflow" | "if_pay_under" | "never";
  maxAutoPayMinor: number;
  payVia: "checkout" | "payouts";
  autoPayoutMaxMinor: number;
}

const DEFAULT: TreasurerPolicy = { language: "en", autoSign: "if_no_outflow", maxAutoPayMinor: 0, payVia: "checkout", autoPayoutMaxMinor: 0 };

// The demo town's owners have different habits, so the agents visibly behave differently.
const MAIN_STREET: Record<string, Partial<TreasurerPolicy>> = {
  "Rosa's Bakery": { autoSign: "if_no_outflow" },
  "Rossi Mill": { autoSign: "always", language: "it" },
  "Ortega Trucking": { autoSign: "if_no_outflow", language: "es" },
  "Corner Cafe": { autoSign: "if_pay_under", maxAutoPayMinor: 200_000, payVia: "checkout" },
  "Green Valley Dairy": { autoSign: "if_pay_under", maxAutoPayMinor: 100_000, payVia: "payouts", autoPayoutMaxMinor: 100_000 },
  "Bean & Leaf Roasters": { autoSign: "if_no_outflow" },
  "Main St Print Shop": { autoSign: "if_no_outflow" },
  "Sparkle Cleaning Co": { autoSign: "always", language: "es" },
  "Lee & Patel Accounting": { autoSign: "never", language: "hi" },
};

export async function policyFor(ctx: AppContext, businessId: string): Promise<TreasurerPolicy> {
  const [stored] = await ctx.db.select().from(policies).where(eq(policies.businessId, businessId)).orderBy(desc(policies.version)).limit(1);
  if (stored !== undefined) return { ...DEFAULT, ...(stored.rules as Partial<TreasurerPolicy>) };
  const [business] = await ctx.db.select({ name: businesses.name }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
  return { ...DEFAULT, ...(business === undefined ? {} : MAIN_STREET[business.name] ?? {}) };
}

/** The referee: may the treasurer sign this statement without its owner? */
export function policyAllowsSigning(policy: TreasurerPolicy, paysMinor: number): { allowed: boolean; reason: string } {
  switch (policy.autoSign) {
    case "always":
      return { allowed: true, reason: "Policy lets the treasurer sign every statement." };
    case "never":
      return { allowed: false, reason: "Policy says the owner signs every statement personally." };
    case "if_no_outflow":
      return paysMinor === 0
        ? { allowed: true, reason: "No money leaves the business, which the policy allows." }
        : { allowed: false, reason: "Money would leave the business, so the owner must sign." };
    case "if_pay_under":
      return paysMinor <= policy.maxAutoPayMinor
        ? { allowed: true, reason: `The payment is within the ${(policy.maxAutoPayMinor / 100).toFixed(2)} limit the owner set.` }
        : { allowed: false, reason: "The payment is above the owner's limit, so the owner must sign." };
  }
}
