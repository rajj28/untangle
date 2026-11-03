import type { JSX } from "react";
import type { NetworkSummary } from "../types.ts";
import { Landing } from "./Landing.tsx";
import { Playground } from "./playground/Playground.tsx";
import type { LandingStats } from "./types.ts";

/** Live figures from the network; before its first round settles, the hero shows the verified sandbox round instead. */
function landingStats(summary: NetworkSummary | undefined): LandingStats | null {
  if (summary === undefined) return null;
  const totals = summary.totals;
  if (totals.movedMinor === 0 && totals.clearedByLoopsMinor === 0) return null;
  return {
    businesses: summary.businesses.length,
    invoices: totals.obligations,
    currency: summary.network.currency,
    owedMinor: totals.owedMinor,
    clearedByLoopsMinor: totals.clearedByLoopsMinor,
    settledByChainsMinor: totals.settledByChainsMinor,
    movedMinor: totals.movedMinor,
    leverage: totals.movedMinor > 0 ? (totals.clearedByLoopsMinor + totals.settledByChainsMinor) / totals.movedMinor : null,
  };
}

export default function LandingPage({ summary, onOpenDesk, onOpenBusiness }: {
  summary: NetworkSummary | undefined;
  onOpenDesk: () => void;
  onOpenBusiness: () => void;
}): JSX.Element {
  const watchDemo = () => {
    const url: unknown = import.meta.env.VITE_DEMO_VIDEO_URL;
    if (typeof url === "string" && url.startsWith("https://")) window.open(url, "_blank", "noopener");
    else document.getElementById("try")?.scrollIntoView({ behavior: "smooth" });
  };
  return <Landing stats={landingStats(summary)} onOpenDesk={onOpenDesk} onOpenBusiness={onOpenBusiness} onWatchDemo={watchDemo} playground={<Playground />} />;
}
