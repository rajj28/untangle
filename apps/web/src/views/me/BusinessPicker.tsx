import { ArrowRight, ArrowUpRight, CircleDollarSign, Moon, Network, Sun } from "lucide-react";
import type { ThemeMode } from "../../components/Header.tsx";
import type { BusinessSummary, ObligationView } from "../../types.ts";
import { businessPosition } from "../../business.ts";
import { Button } from "../../ui/Button.tsx";
import { HowItWorks } from "../../ui/HowItWorks.tsx";
import { Avatar } from "../../ui/Avatar.tsx";
import { Money } from "../../ui/Money.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { Skeleton } from "../../ui/Skeleton.tsx";

export function BusinessPicker({ businesses, obligations, currency, loading, error, onChoose, onOpenDesk, onRetry, theme, onThemeToggle }: {
  businesses: BusinessSummary[];
  obligations: ObligationView[];
  currency: string;
  loading: boolean;
  error: string | null;
  onChoose: (id: string) => void;
  onOpenDesk: () => void;
  onRetry: () => void;
  theme: ThemeMode;
  onThemeToggle: () => void;
}) {
  return <div className="me-page">
    <header className="me-topbar">
      <a href="#/me" className="me-brand" aria-label="Untangle business picker"><span className="me-mark"><Network size={19} /></span><span>Untangle</span></a>
      <div className="flex items-center gap-1"><Button variant="ghost" size="sm" onClick={onThemeToggle} aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}>{theme === "light" ? <Moon size={16} /> : <Sun size={16} />}</Button><Button variant="ghost" size="sm" onClick={onOpenDesk}>Open desk<ArrowUpRight size={15} /></Button></div>
    </header>
    <main className="me-column me-picker">
      <div className="me-intro">
        <span className="me-eyebrow"><CircleDollarSign size={14} />A clearer way to settle business invoices</span>
        <h1>Choose your business</h1>
        <p>See what you owe, what's owed to you, and what a settlement round means for your PayPal invoices.</p>
      </div>
      <HowItWorks />
      <section aria-labelledby="business-list-heading" className="mt-6">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h2 id="business-list-heading" className="text-xs font-semibold uppercase tracking-[.08em] text-muted">Businesses in this network</h2>
          <span className="text-xs text-muted">{businesses.length}</span>
        </div>
        {loading ? <Skeleton variant="row" count={5} /> : error !== null ? <EmptyState title="Businesses could not be loaded" detail={error} action="Try again" onAction={onRetry} /> : businesses.length === 0 ? <EmptyState title="No businesses in this network yet" detail="A business list will appear once the network is set up." action="Open clearing desk" onAction={onOpenDesk} /> : <div className="ui-card business-picker-list" role="list">
          {businesses.map((business) => {
            const position = businessPosition(obligations, business.id);
            const tone = position.netMinor < 0 ? "owes" : position.netMinor > 0 ? "owed" : "settled";
            const positionLabel = tone === "owes" ? "Owes" : tone === "owed" ? "Owed" : "Settled";
            const amount = Math.abs(position.netMinor);
            return <button key={business.id} type="button" role="listitem" className="business-picker-row" onClick={() => onChoose(business.id)}>
              <Avatar name={business.name} id={business.id} />
              <span className="min-w-0 flex-1 text-left">
                <span className="block truncate text-base font-semibold">{business.name}</span>
                <span className={`mt-1 block text-sm font-medium business-position-${tone}`}>
                  {tone === "settled" ? "Settled up" : <>{positionLabel} <Money cents={amount} currency={currency} /></>}
                </span>
              </span>
              <ArrowRight size={19} className="shrink-0 text-muted" aria-hidden="true" />
            </button>;
          })}
        </div>}
        <p className="mt-3 text-center text-xs leading-5 text-muted">Demo: in production each business signs in with PayPal.</p>
      </section>
      <div className="mt-6 flex justify-center sm:hidden"><Button variant="secondary" className="w-full" onClick={onOpenDesk}>Open clearing desk<ArrowUpRight size={16} /></Button></div>
      <footer className="me-footer">Untangle helps businesses settle invoices fairly and transparently.</footer>
    </main>
  </div>;
}
