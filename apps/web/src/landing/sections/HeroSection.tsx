import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";
import { Play, ArrowRight, Monitor } from "lucide-react";
import { TangleHero } from "../TangleHero.tsx";
import type { LandingStats } from "../types.ts";

// ── Count-up hook ──────────────────────────────────────────────────────────
function useCountUp(target: number, active: boolean, duration = 1400): number {
  const [value, setValue] = useState(0);
  const raf = useRef<number | undefined>(undefined);
  const start = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!active) return;
    start.current = undefined;
    function step(ts: number): void {
      if (start.current === undefined) start.current = ts;
      const elapsed = ts - start.current;
      const progress = Math.min(elapsed / duration, 1);
      // ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(target * eased));
      if (progress < 1) {
        raf.current = requestAnimationFrame(step);
      }
    }
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current !== undefined) cancelAnimationFrame(raf.current);
    };
  }, [active, target, duration]);

  return value;
}

// ── Stat tile ──────────────────────────────────────────────────────────────
function StatTile({
  value,
  label,
  prefix = "",
  suffix = "",
  active,
}: {
  value: number;
  label: string;
  prefix?: string;
  suffix?: string;
  active: boolean;
}): JSX.Element {
  const displayed = useCountUp(value, active);
  return (
    <div className="flex flex-col items-center gap-1 px-6 py-5 text-center">
      <span className="ln-stat-number text-white text-3xl md:text-4xl">
        {prefix}
        {displayed.toLocaleString()}
        {suffix}
      </span>
      <span className="text-slate-400 text-xs font-medium uppercase tracking-widest leading-snug max-w-[120px]">
        {label}
      </span>
    </div>
  );
}

// ── Money formatting (minor units → dollars) ───────────────────────────────
function minorToDollars(minor: number): number {
  // minor units (cents) → whole dollars
  return Math.round(minor / 100);
}

// ── Leverage tile (shows one decimal place) ────────────────────────────────
function LeverageTile({ value, active }: { value: number; active: boolean }): JSX.Element {
  const [displayed, setDisplayed] = useState(0);
  const raf = useRef<number | undefined>(undefined);
  const start = useRef<number | undefined>(undefined);
  const DURATION = 1600;

  useEffect(() => {
    if (!active) return;
    start.current = undefined;
    function step(ts: number): void {
      if (start.current === undefined) start.current = ts;
      const elapsed = ts - start.current;
      const progress = Math.min(elapsed / DURATION, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayed(Math.round(value * 10 * eased) / 10);
      if (progress < 1) {
        raf.current = requestAnimationFrame(step);
      }
    }
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current !== undefined) cancelAnimationFrame(raf.current);
    };
  }, [active, value]);

  return (
    <div className="flex flex-col items-center gap-1 px-6 py-5 text-center">
      <span className="ln-stat-number text-white text-3xl md:text-4xl">
        {displayed.toFixed(1)}×
      </span>
      <span className="text-slate-400 text-xs font-medium uppercase tracking-widest leading-snug max-w-[120px]">
        leverage
      </span>
    </div>
  );
}

// ── HeroSection ───────────────────────────────────────────────────────────
interface HeroProps {
  stats: LandingStats | null;
  onOpenDesk: () => void;
  onOpenBusiness: () => void;
  onWatchDemo: () => void;
}

export function HeroSection({ stats, onOpenDesk, onOpenBusiness, onWatchDemo }: HeroProps): JSX.Element {
  const statsRef = useRef<HTMLDivElement | null>(null);
  const [statsVisible, setStatsVisible] = useState(false);

  // Effective stats with fallback
  // Spec fallback: 9 businesses, 25 invoices, $28,100 owed, $24,000 cleared by loops,
  // $4,100 by chains, $2,200 moved, 12.8×
  const s = {
    invoices: stats?.invoices ?? 25,
    settled:  minorToDollars(stats === null ? 2_810_000 : stats.clearedByLoopsMinor + stats.settledByChainsMinor),
    cleared:  minorToDollars(stats?.clearedByLoopsMinor    ?? 2_400_000),
    moved:    minorToDollars(stats?.movedMinor             ?? 220_000),
    leverage: stats?.leverage ?? 12.8,
  };

  useEffect(() => {
    const el = statsRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setStatsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <section className="ln-hero" aria-labelledby="hero-heading">
      {/* Background glows */}
      <div className="ln-hero-glow-teal" aria-hidden="true" />
      <div className="ln-hero-glow-blue" aria-hidden="true" />

      <div className="ln-container relative z-10">
        {/* Two-column layout: copy left, visual right */}
        <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center py-14 md:py-20">
          {/* Left: copy */}
          <div className="flex flex-col gap-6">
            <p className="ln-eyebrow">
              AI clearing for small businesses on PayPal
            </p>

            <h1 id="hero-heading" className="ln-hero-headline">
              Everyone on Main Street is owed money.{" "}
              <span style={{ color: "#14b8a6" }}>Untangle settles it</span>{" "}
              with a fraction of the cash.
            </h1>

            <p className="text-slate-300 text-lg leading-relaxed max-w-xl">
              AI agents find the debts that cancel out across a network of businesses, clear them on their PayPal invoices with no money moving, and settle the rest with the fewest PayPal payments possible.
            </p>

            {/* Buttons */}
            <div className="flex flex-wrap items-center gap-4">
              <button
                onClick={onOpenDesk}
                className="ln-btn-primary"
              >
                <Monitor size={17} aria-hidden="true" />
                Open the live demo
              </button>
              <button
                onClick={onWatchDemo}
                className="ln-btn-ghost-white"
              >
                <Play size={16} aria-hidden="true" />
                Watch the 3-minute demo
              </button>
            </div>

            <button
              onClick={onOpenBusiness}
              className="self-start text-sm text-slate-400 hover:text-white transition-colors bg-transparent border-0 cursor-pointer flex items-center gap-1.5 outline-offset-2 focus-visible:outline-2 focus-visible:outline-teal-400 rounded"
            >
              I run a business
              <ArrowRight size={14} aria-hidden="true" />
            </button>
          </div>

          {/* Right: TangleHero visual */}
          <div className="flex items-center justify-center">
            <TangleHero />
          </div>
        </div>
      </div>

      {/* Stats ribbon */}
      <div ref={statsRef} className="ln-stats-ribbon">
        <div className="ln-container">
          <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-white/8">
            <StatTile
              value={s.settled}
              prefix="$"
              suffix=""
              label="of invoices settled"
              active={statsVisible}
            />
            <StatTile
              value={s.cleared}
              prefix="$"
              suffix=""
              label="cleared with no money moving"
              active={statsVisible}
            />
            <StatTile
              value={s.moved}
              prefix="$"
              suffix=""
              label="moved through PayPal"
              active={statsVisible}
            />
            <LeverageTile value={s.leverage} active={statsVisible} />
          </div>
        </div>
      </div>
    </section>
  );
}
