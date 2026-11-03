import { useState } from "react";
import { ArrowUpRight, Menu, Moon, Network, RotateCcw, ShieldCheck, Sun } from "lucide-react";
import type { NetworkSummary, RoundView } from "../types.ts";
import type { LiveStatus } from "../live.ts";
import type { ThemeMode } from "./Header.tsx";
import { LeverageMeterV2 } from "./LeverageMeterV2.tsx";
import { Button } from "../ui/Button.tsx";
import { Sheet } from "../ui/Sheet.tsx";

export function DeskHeader({ summary, round, actingAs, onActingAs, liveStatus, theme, onThemeToggle, demo, mode, onReset, onViewAsBusiness }: {
  summary: NetworkSummary;
  round: RoundView | null;
  mode: "sandbox" | "sim";
  actingAs: string;
  onActingAs: (value: string) => void;
  liveStatus: LiveStatus;
  theme: ThemeMode;
  onThemeToggle: () => void;
  demo: boolean;
  onReset: () => void;
  onViewAsBusiness: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isSim = mode === "sim";
  return <header className="desk-header">
    <a href="#/desk/settlement" className="desk-brand" aria-label="Untangle clearing desk">
      <span className="desk-brand-mark"><Network size={19} aria-hidden="true" /></span>
      <span className="desk-brand-copy"><strong>Untangle</strong><small>{summary.network.name} · {summary.businesses.length} businesses</small></span>
    </a>
    <div className="desk-header-leverage"><LeverageMeterV2
      cleared={summary.totals.clearedByLoopsMinor + summary.totals.settledByChainsMinor}
      moved={summary.totals.movedMinor} owed={summary.totals.owedMinor}
      loops={summary.totals.clearedByLoopsMinor} chains={summary.totals.settledByChainsMinor}
      currency={summary.network.currency}
      roundStatus={round?.status ?? summary.latestRound?.status ?? "planned"}
      plannedLeverage={round?.stats?.leverage ?? null}
    /></div>
    <div className="desk-header-desktop-controls">
      <span className={`mode-badge ${isSim ? "mode-sim" : ""}`}><ShieldCheck size={13} />{isSim ? "Simulator" : "PayPal Sandbox"}</span>
      <LiveIndicator status={liveStatus} />
      <label htmlFor="desk-acting-as" className="sr-only">Acting as</label>
      <select id="desk-acting-as" className="desk-select acting-select" value={actingAs} onChange={(event) => onActingAs(event.target.value)}>
        <option value="">Operator (everyone)</option>
        {summary.businesses.map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}
      </select>
      <Button variant="ghost" size="sm" onClick={onViewAsBusiness}>View as a business<ArrowUpRight size={14} /></Button>
      {demo && <Button variant="ghost" size="sm" onClick={onReset}><RotateCcw size={14} />Reset demo</Button>}
      <Button variant="ghost" size="sm" className="theme-toggle" onClick={onThemeToggle} aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}>{theme === "light" ? <Moon size={16} /> : <Sun size={16} />}</Button>
    </div>
    <button type="button" className="desk-menu-button" onClick={() => setMenuOpen(true)} aria-label="Open desk menu" aria-haspopup="dialog"><Menu size={20} /></button>
    <Sheet open={menuOpen} title="Desk menu" onClose={() => setMenuOpen(false)}>
      <div className="desk-mobile-menu">
        <div className={`mode-badge menu-mode ${isSim ? "mode-sim" : ""}`}><ShieldCheck size={15} />{isSim ? "Simulator" : "PayPal Sandbox"}</div>
        <LiveIndicator status={liveStatus} />
        <label className="desk-menu-label" htmlFor="desk-acting-as-mobile">Acting as</label>
        <select id="desk-acting-as-mobile" className="desk-select w-full" value={actingAs} onChange={(event) => onActingAs(event.target.value)}>
          <option value="">Operator (everyone)</option>
          {summary.businesses.map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}
        </select>
        <Button variant="secondary" className="w-full" onClick={() => { setMenuOpen(false); onViewAsBusiness(); }}>View as a business<ArrowUpRight size={16} /></Button>
        <Button variant="secondary" className="w-full" onClick={onThemeToggle}>{theme === "light" ? <Moon size={16} /> : <Sun size={16} />}{theme === "light" ? "Use dark theme" : "Use light theme"}</Button>
        {demo && <Button variant="ghost" className="w-full" onClick={onReset}><RotateCcw size={16} />Reset demo</Button>}
      </div>
    </Sheet>
  </header>;
}

export function LiveIndicator({ status }: { status: LiveStatus }) {
  return <span className="live-indicator" aria-label={status === "connected" ? "Live from PayPal" : "Reconnecting to PayPal updates"}>
    <span className={`live-indicator-dot ${status === "connected" ? "live-dot-connected" : "live-dot-reconnecting"}`} aria-hidden="true" />
    <span>{status === "connected" ? "Live from PayPal" : "Reconnecting"}</span>
  </span>;
}
