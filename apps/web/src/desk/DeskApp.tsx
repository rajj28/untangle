import { lazy, Suspense, useEffect, useState } from "react";
import type { KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, Building2, Grid2X2, Network, ReceiptText, Rows3, Workflow } from "lucide-react";
import { ModuleRegistry } from "ag-grid-community";
import { AiToolkitModule, AllEnterpriseModule, LicenseManager } from "ag-grid-enterprise";
import { AgChartsEnterpriseModule } from "ag-charts-enterprise";
import type { NetworkSummary, ObligationView, RoundView, BusEvent, Config } from "../types.ts";
import type { AppRoute, DeskView } from "../routes.ts";
import type { ThemeMode } from "../components/Header.tsx";
import type { LiveStatus } from "../live.ts";
import type { ToastMessage } from "../components/Toasts.tsx";
import { api } from "../api.ts";
import { DeskHeader, LiveIndicator } from "../components/DeskHeader.tsx";
import { HowItWorks } from "../ui/HowItWorks.tsx";
import { Skeleton } from "../ui/Skeleton.tsx";

ModuleRegistry.registerModules([AllEnterpriseModule.with(AgChartsEnterpriseModule), AiToolkitModule]);
let registeredLicense: string | null = null;

const LedgerView = lazy(() => import("../views/Ledger.tsx").then((module) => ({ default: module.Ledger })));
const SettlementView = lazy(() => import("../views/Settlement.tsx").then((module) => ({ default: module.Settlement })));
const MatrixView = lazy(() => import("../views/Matrix.tsx").then((module) => ({ default: module.Matrix })));
const CityView = lazy(() => import("../views/desk/CityView.tsx").then((module) => ({ default: module.CityView })));
const ActivityView = lazy(() => import("../views/Activity.tsx").then((module) => ({ default: module.Activity })));
const NetworkView = lazy(() => import("../views/network/NetworkView.tsx"));
const AgentConsoleView = lazy(() => import("../agents/AgentConsole.tsx").then((module) => ({ default: module.AgentConsole })));

type PushToast = (toast: Omit<ToastMessage, "id">) => void;

/** Recovery panel fed by real recovery results (GET /api/rounds/:id/recovery). */
function RecoveryBanner({ roundId }: { roundId: string }) {
  const query = useQuery({
    queryKey: ["recovery", roundId],
    queryFn: () => api.roundRecovery(roundId),
    enabled: roundId !== "",
    refetchInterval: 4000,
  });
  if (query.isLoading) {
    return <div role="status" className="mx-4 mt-3 rounded-md bg-[var(--brand-tint)] px-4 py-2 text-sm text-[var(--brand-strong)]">Back online. Comparing PayPal-recorded payments against the plan…</div>;
  }
  const report = query.data;
  if (!report) return null;
  const doublePaid = report.paidTwice;
  return (
    <div role="status" className="mx-4 mt-3 rounded-md border border-[var(--brand)]/30 bg-[var(--brand-tint)] px-4 py-2 text-xs text-[var(--brand-strong)]">
      <div className="flex items-center gap-2 text-sm font-semibold"><span className="h-2 w-2 rounded-full bg-[var(--brand)]" />Recovered after the crash</div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
        <span><b className="tabular-nums">{report.plannedPayments}</b> planned set-off payments</span>
        <span>found already on PayPal: <b className="tabular-nums">{report.paymentsFoundAlreadyOnPaypal}</b></span>
        <span>resumed: <b className="tabular-nums">{report.paymentsResumed}</b></span>
        <span>rolled back: <b className="tabular-nums">{report.paymentsRolledBack}</b></span>
        <span className={doublePaid > 0 ? "font-semibold text-[var(--red)]" : ""}>paid twice: <b className="tabular-nums">{doublePaid}</b></span>
      </div>
    </div>
  );
}

const TABS: { id: DeskView; label: string; icon: typeof ReceiptText }[] = [
  { id: "ledger", label: "Ledger", icon: ReceiptText },
  { id: "settlement", label: "Settlement", icon: Rows3 },
  { id: "agents", label: "Agents", icon: Workflow },
  { id: "network", label: "Network", icon: Network },
  { id: "matrix", label: "Matrix", icon: Grid2X2 },
  { id: "city", label: "City", icon: Building2 },
  { id: "activity", label: "Activity", icon: Activity },
];

export default function DeskApp({ route, summary, obligations, round, config, actingAs, liveStatus, theme, events, loading, activityError, onRetryActivity, onNavigate, onActingAs, onThemeToggle, onReset, onViewAsBusiness, onToast }: {
  route: Extract<AppRoute, { kind: "desk" }>;
  summary: NetworkSummary;
  obligations: ObligationView[];
  round: RoundView | null;
  config: Config;
  actingAs: string;
  liveStatus: LiveStatus;
  theme: ThemeMode;
  events: BusEvent[];
  loading: boolean;
  activityError: unknown;
  onRetryActivity: () => void;
  onNavigate: (route: AppRoute) => void;
  onActingAs: (businessId: string) => void;
  onThemeToggle: () => void;
  onReset: () => void;
  onViewAsBusiness: () => void;
  onToast: PushToast;
}) {
  // Set before any grid mounts: a grid created in this same commit validates the key before effects run.
  if (config.agGridLicenseKey && registeredLicense !== config.agGridLicenseKey) {
    LicenseManager.setLicenseKey(config.agGridLicenseKey);
    registeredLicense = config.agGridLicenseKey;
  }

  const names = Object.fromEntries(summary.businesses.map((business) => [business.id, business.name]));
  const latestCrash = events.reduce<BusEvent | null>((latest, event) =>
    event.type === "demo.crashed" && (latest === null || event.seq > latest.seq) ? event : latest, null);
  const latestOther = events.reduce<BusEvent | null>((latest, event) =>
    event.type !== "demo.crashed" && (latest === null || event.seq > latest.seq) ? event : latest, null);
  const crashIsCurrent = latestCrash !== null && (latestOther === null || latestCrash.seq > latestOther.seq);
  const recoveredCrashSeq = latestCrash !== null && latestOther !== null && latestOther.seq > latestCrash.seq ? latestCrash.seq : null;
  const [recoveredBannerSeq, setRecoveredBannerSeq] = useState<number | null>(null);
  useEffect(() => {
    if (recoveredCrashSeq !== null) setRecoveredBannerSeq(recoveredCrashSeq);
  }, [recoveredCrashSeq]);
  useEffect(() => {
    if (recoveredBannerSeq === null) return;
    const timeout = window.setTimeout(() => setRecoveredBannerSeq(null), 8000);
    return () => window.clearTimeout(timeout);
  }, [recoveredBannerSeq]);
  const actingBusiness = summary.businesses.find((business) => business.id === actingAs);
  const selectTab = (view: DeskView) => onNavigate({ kind: "desk", view });
  const onTabKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const index = TABS.findIndex((tab) => tab.id === route.view);
    const next = TABS[(index + (event.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
    if (next) {
      selectTab(next.id);
      event.currentTarget.querySelector<HTMLButtonElement>(`[data-tab="${next.id}"]`)?.focus();
    }
  };

  return <div className="app-shell desk-shell">
    <DeskHeader summary={summary} round={round} actingAs={actingAs} onActingAs={onActingAs} liveStatus={liveStatus} theme={theme} onThemeToggle={onThemeToggle} demo={config.demo} mode={config.mode} onReset={onReset} onViewAsBusiness={onViewAsBusiness} />
    {actingBusiness && <div className="acting-strip"><strong>{actingBusiness.name}</strong><span>owes <b className="tabular-nums">{money(actingBusiness.owesMinor, summary.network.currency)}</b></span><span>is owed <b className="tabular-nums">{money(actingBusiness.owedMinor, summary.network.currency)}</b></span><span>net <b className="tabular-nums">{signedMoney(actingBusiness.netMinor, summary.network.currency)}</b></span></div>}
    <HowItWorks />
    <nav className="desk-tabs" role="tablist" aria-label="Clearing desk views" onKeyDown={onTabKeyDown}>
      {TABS.map(({ id, label, icon: Icon }) => <button key={id} type="button" data-tab={id} role="tab" aria-selected={route.view === id} tabIndex={route.view === id ? 0 : -1} className="desk-tab" onClick={() => selectTab(id)}>
        <Icon size={16} aria-hidden="true" /><span>{label}</span>{id === "ledger" && <span className="desk-tab-count">{obligations.length}</span>}
      </button>)}
      <span className="desk-tab-live"><LiveIndicator status={liveStatus} /></span>
    </nav>
    <main className="desk-view-content" role="tabpanel" aria-label={`${route.view} view`}>
      {crashIsCurrent && <div role="status" className="mx-4 mt-3 rounded-md border border-[var(--red)]/30 bg-[var(--red-tint)] px-4 py-2 text-sm text-[var(--red)]">The server crashed on purpose mid-round. Restarting…</div>}
      {!crashIsCurrent && recoveredCrashSeq !== null && recoveredBannerSeq === recoveredCrashSeq && (
        round !== null
          ? <RecoveryBanner roundId={round.id} />
          : <div role="status" className="mx-4 mt-3 rounded-md bg-[var(--brand-tint)] px-4 py-2 text-sm text-[var(--brand-strong)]">Back online. The round resumes exactly where it stopped.</div>
      )}
      <Suspense fallback={<Skeleton variant="row" count={8} className="h-full p-5" />}>
        {route.view === "ledger" && <LedgerView rows={obligations} actingAs={actingAs} theme={theme} onToast={onToast} loading={loading} onPlan={() => selectTab("settlement")} names={names} demo={config.demo} />}
        {route.view === "settlement" && <SettlementView networkId={summary.network.id} summary={summary} obligations={obligations} actingAs={actingAs} names={names} config={config} theme={theme} events={events} onToast={onToast} />}
        {route.view === "agents" && <AgentConsoleView networkId={summary.network.id} onToast={onToast} onOpenPayDialog={() => selectTab("settlement")} />}
        {route.view === "network" && <NetworkView obligations={obligations} businesses={summary.businesses} round={round} actingAs={actingAs || null} currency={summary.network.currency} />}
        {route.view === "matrix" && <MatrixView obligations={obligations} actingAs={actingAs} theme={theme} currency={summary.network.currency} />}
        {route.view === "city" && <CityView theme={theme} currency={summary.network.currency} />}
        {route.view === "activity" && <ActivityView initialEvents={events} liveEvents={[]} names={names} obligations={obligations} actingAs={actingAs} onToast={onToast} loading={loading} error={activityError} onRetry={onRetryActivity} />}
      </Suspense>
    </main>
  </div>;
}

function money(cents: number, currency: string): string { return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100); }
function signedMoney(cents: number, currency: string): string { return `${cents < 0 ? "−" : cents > 0 ? "+" : ""}${money(Math.abs(cents), currency)}`; }
