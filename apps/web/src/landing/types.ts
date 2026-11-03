/**
 * src/landing/types.ts
 * Shared types for the landing page.
 */

export interface LandingStats {
  businesses: number;
  invoices: number;
  currency: string;
  owedMinor: number;
  clearedByLoopsMinor: number;
  settledByChainsMinor: number;
  movedMinor: number;
  leverage: number | null;
}
