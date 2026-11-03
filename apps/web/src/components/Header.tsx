import { Activity, Moon, RotateCcw, ShieldCheck, Sun } from "lucide-react";
import type { NetworkSummary } from "../types.ts";
import type { LiveStatus } from "../live.ts";
import { LeverageMeter } from "./LeverageMeter.tsx";

export type ThemeMode = "light" | "dark";

export function Header({
  summary,
  actingAs,
  onActingAs,
  liveStatus,
  theme,
  onThemeToggle,
  demo,
  mode,
  onReset,
}: {
  summary: NetworkSummary;
  mode: "sandbox" | "sim";
  actingAs: string;
  onActingAs: (value: string) => void;
  liveStatus: LiveStatus;
  theme: ThemeMode;
  onThemeToggle: () => void;
  demo: boolean;
  onReset: () => void;
}) {
  const isSim = mode === "sim";
  return (
    <header className="header-container flex min-h-[78px] items-center gap-4 border-b line bg-[var(--surface)] px-5 py-2.5">
      <div className="header-brand flex min-w-[210px] items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--brand)] text-white shadow-sm">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8.3 7.1a3.9 3.9 0 0 1 5.5 0l3.1 3.1a3.9 3.9 0 0 1 0 5.5 3.9 3.9 0 0 1-5.5 0l-1-1M15.7 16.9a3.9 3.9 0 0 1-5.5 0l-3.1-3.1a3.9 3.9 0 0 1 0-5.5 3.9 3.9 0 0 1 5.5 0l1 1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 leading-none"><span className="text-[15px] font-semibold tracking-tight">Untangle</span><span className="rounded border line px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-muted">Clearing desk</span></div>
          <p className="mt-1 truncate text-[11px] text-muted">{summary.network.name} <span className="mx-1">·</span>{summary.businesses.length} businesses</p>
        </div>
      </div>

      <div className="header-leverage hidden min-w-0 flex-1"><LeverageMeter
        cleared={summary.totals.clearedByLoopsMinor + summary.totals.settledByChainsMinor}
        moved={summary.totals.movedMinor}
        owed={summary.totals.owedMinor}
        loops={summary.totals.clearedByLoopsMinor}
        chains={summary.totals.settledByChainsMinor}
        currency={summary.network.currency}
      /></div>

      <div className="header-controls ml-auto flex shrink-0 items-center gap-2">
        <span className={`hidden items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-medium sm:inline-flex ${isSim ? "mode-sim" : "line text-soft"}`}>
          <ShieldCheck size={12} />{isSim ? "Simulator" : "PayPal Sandbox"}
        </span>
        <span className="header-live inline-flex items-center gap-1.5 text-[10px] text-muted" title={liveStatus === "connected" ? "Live updates connected" : "Reconnecting to live updates"}>
          <span className={`h-1.5 w-1.5 rounded-full ${liveStatus === "connected" ? "live-dot-connected" : "live-dot-reconnecting"}`} />
          <span className="header-live-label">{liveStatus === "connected" ? "Live" : "Reconnecting"}</span>
        </span>
        <div className="hidden h-6 w-px bg-[var(--line)] lg:block" />
        <label className="hidden items-center gap-1.5 text-[10px] text-muted md:flex" htmlFor="acting-as">Acting as</label>
        <select id="acting-as" className="acting-select desk-select max-w-[170px] text-[11px]" value={actingAs} onChange={(event) => onActingAs(event.target.value)}>
          <option value="">Operator (everyone)</option>
          {summary.businesses.map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}
        </select>
        {demo && <button className="desk-button desk-button-quiet hidden text-[11px] sm:inline-flex" onClick={onReset} title="Archive invoices and seed a new demo network"><RotateCcw size={13} />Reset demo</button>}
        <button className="desk-button desk-button-quiet h-8 min-h-8 w-8 p-0" onClick={onThemeToggle} aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`} title="Toggle theme">
          {theme === "light" ? <Moon size={15} /> : <Sun size={15} />}
        </button>
      </div>
    </header>
  );
}

export function LiveStatusIcon({ status }: { status: LiveStatus }) {
  return <span className="inline-flex items-center gap-1.5 text-[10px] text-muted"><Activity size={12} className={status === "connected" ? "live-icon-connected" : "live-icon-reconnecting"} />{status === "connected" ? "Live" : "Reconnecting"}</span>;
}
