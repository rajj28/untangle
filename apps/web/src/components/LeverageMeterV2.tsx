import { useEffect, useState } from "react";
import { calculateLeverage, formatLeverage, formatMoney } from "../money.ts";
import type { LeverageValue } from "../money.ts";
import { leverageLabel } from "../leverage.ts";

function asLeverage(value: number | string | null): LeverageValue | null {
  if (typeof value === "number") return value;
  if (value === "∞" || value === "—") return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
  return null;
}

export function LeverageMeterV2({ cleared, moved, owed, loops, chains, currency, roundStatus, plannedLeverage }: {
  cleared: number;
  moved: number;
  owed: number;
  loops: number;
  chains: number;
  currency: string;
  roundStatus: string;
  plannedLeverage: number | string | null;
}) {
  const value = calculateLeverage(cleared, moved);
  const [display, setDisplay] = useState<LeverageValue>(value);
  useEffect(() => {
    if (typeof value !== "number" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(value);
      return;
    }
    const startValue = typeof display === "number" ? display : 0;
    const start = performance.now();
    let frame = 0;
    const animate = (now: number) => {
      const progress = Math.min(1, (now - start) / 300);
      setDisplay(startValue + (value - startValue) * (1 - (1 - progress) ** 3));
      if (progress < 1) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
    // The current display value is only the animation's starting point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const planned = asLeverage(plannedLeverage);
  const labels = leverageLabel(display, roundStatus, planned);
  return <div className="leverage-meter">
    <div className="leverage-meter-main">
      <span className="leverage-meter-label">Leverage</span>
      <span className="leverage-meter-value">{formatLeverage(display)}</span>
      <span className="leverage-meter-state">{roundStatus === "closed" ? "Round complete" : "so far"}</span>
    </div>
    <p className="leverage-meter-caption">{labels.secondary ?? "of invoices settled per $1 moved through PayPal"}</p>
    <p className="leverage-meter-detail">
      <span>{formatMoney(owed, currency)} owed</span><span>{formatMoney(loops, currency)} cleared by loops</span>
      <span>{formatMoney(chains, currency)} by chains</span><span>{formatMoney(moved, currency)} moved</span>
    </p>
  </div>;
}
