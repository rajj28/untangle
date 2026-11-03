import { Activity, ArrowUpRight, House, Moon, ReceiptText, Sparkles, Sun } from "lucide-react";
import type { AppRoute } from "../../routes.ts";
import type { BusinessSummary, BusEvent, Config, NetworkSummary, ObligationView } from "../../types.ts";
import type { ThemeMode } from "../../components/Header.tsx";
import type { ToastMessage } from "../../components/Toasts.tsx";
import { BusinessHome } from "./BusinessHome.tsx";
import { BusinessInvoices } from "./BusinessInvoices.tsx";
import { BusinessActivity } from "./BusinessActivity.tsx";
import { BusinessAssistant } from "./BusinessAssistant.tsx";

type PushToast = (toast: Omit<ToastMessage, "id">) => void;

export function BusinessExperience({ route, business, summary, obligations, events, config, onNavigate, onToast, onOpenDesk, theme, onThemeToggle }: {
  route: Extract<AppRoute, { kind: "business" }>;
  business: BusinessSummary;
  summary: NetworkSummary;
  obligations: ObligationView[];
  events: BusEvent[];
  config: Config;
  onNavigate: (route: AppRoute) => void;
  onToast: PushToast;
  onOpenDesk: () => void;
  theme: ThemeMode;
  onThemeToggle: () => void;
}) {
  const tabs = [
    { id: "home", label: "Home", href: `#/me/${encodeURIComponent(business.id)}`, icon: <House size={18} /> },
    { id: "invoices", label: "Invoices", href: `#/me/${encodeURIComponent(business.id)}/invoices`, icon: <ReceiptText size={18} /> },
    { id: "assistant", label: "Assistant", href: `#/me/${encodeURIComponent(business.id)}/assistant`, icon: <Sparkles size={18} /> },
    { id: "activity", label: "Activity", href: `#/me/${encodeURIComponent(business.id)}/activity`, icon: <Activity size={18} /> },
  ] as const;
  const names = Object.fromEntries(summary.businesses.map((item) => [item.id, item.name]));
  const selectPage = (page: "home" | "invoices" | "assistant" | "activity") => onNavigate({ kind: "business", businessId: business.id, page });
  return <div className="me-page">
    <header className="me-topbar me-business-topbar">
      <a href={`#/me/${encodeURIComponent(business.id)}`} className="me-brand" aria-label={`${business.name} home`}><span className="me-mark"><House size={17} /></span><span className="me-brand-name">{business.name}</span><span className="me-owner-badge">My business</span></a>
      <nav className="me-desktop-tabs" aria-label="Business pages">
        {tabs.map((tab) => <a key={tab.id} href={tab.href} aria-current={route.page === tab.id ? "page" : undefined} onClick={(event) => { event.preventDefault(); selectPage(tab.id); }}>{tab.label}</a>)}
      </nav>
      <div className="flex items-center gap-1"><button type="button" className="me-theme-toggle" onClick={onThemeToggle} aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}>{theme === "light" ? <Moon size={16} /> : <Sun size={16} />}</button><button type="button" className="me-open-desk" onClick={onOpenDesk}>Open desk<ArrowUpRight size={15} /></button></div>
    </header>
    <main className="me-column me-content">
      {route.page === "home" && <BusinessHome business={business} summary={summary} obligations={obligations} events={events} names={names} config={config} onNavigate={onNavigate} onToast={onToast} />}
      {route.page === "invoices" && <BusinessInvoices business={business} obligations={obligations} names={names} onPlan={() => onNavigate({ kind: "desk", view: "settlement" })} onToast={onToast} />}
      {route.page === "assistant" && <BusinessAssistant business={business} networkId={summary.network.id} currency={summary.network.currency} onNavigate={onNavigate} onToast={onToast} />}
      {route.page === "activity" && <BusinessActivity business={business} obligations={obligations} events={events} names={names} />}
    </main>
    <nav className="me-mobile-tabs" aria-label="Business pages">
      {tabs.map((tab) => <a key={tab.id} href={tab.href} aria-current={route.page === tab.id ? "page" : undefined} onClick={(event) => { event.preventDefault(); selectPage(tab.id); }}>{tab.icon}<span>{tab.label}</span></a>)}
    </nav>
  </div>;
}
