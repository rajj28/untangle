import { useEffect, useState } from "react";
import { calculateLeverage, formatLeverage, formatMoney } from "../money.ts";

export function LeverageMeter(props: {
  cleared: number;
  moved: number;
  owed: number;
  loops: number;
  chains: number;
  currency: string;
}) {
  const { cleared, moved, owed, loops, chains, currency } = props;
  const value = calculateLeverage(cleared, moved);
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    if (typeof value !== "number") {
      setDisplay(value);
      return;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setDisplay(value);
      return;
    }
    const startValue = typeof display === "number" ? display : 0;
    let frame = 0;
    const startedAt = performance.now();
    const animate = (time: number) => {
      const progress = Math.min(1, (time - startedAt) / 300);
      const eased = 1 - (1 - progress) ** 3;
      setDisplay(startValue + (value - startValue) * eased);
      if (progress < 1) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
    // display is intentionally a start value only; updates are driven by the server metric.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="min-w-0 text-center">
      <div className="flex items-baseline justify-center gap-2 leading-none">
        <span className="text-[9px] font-semibold uppercase tracking-[.16em] text-muted">Leverage</span>
        <span className="tabular-nums text-[25px] font-semibold tracking-[-.055em] text-[var(--brand)]">{formatLeverage(display)}</span>
      </div>
      <p className="mt-1 text-[10px] text-muted">of invoices settled per $1 moved through PayPal</p>
      <p className="mt-1.5 truncate text-[10px] text-soft">
        <span className="tabular-nums">{formatMoney(owed, currency)}</span> owed
        <span className="mx-1.5 text-muted">·</span><span className="tabular-nums">{formatMoney(loops, currency)}</span> cleared by loops
        <span className="mx-1.5 text-muted">·</span><span className="tabular-nums">{formatMoney(chains, currency)}</span> by chains
        <span className="mx-1.5 text-muted">·</span><span className="tabular-nums">{formatMoney(moved, currency)}</span> moved
      </p>
    </div>
  );
}
