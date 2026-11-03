import { useState } from "react";
import { BookOpen, X } from "lucide-react";

const STORAGE_KEY = "untangle-how-works-hidden";

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function HowItWorks() {
  const [visible, setVisible] = useState(() => !wasDismissed());
  if (!visible) return null;
  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      // Dismissing this explainer still works when storage is unavailable.
    }
  };
  return <aside className="how-it-works" aria-label="How Untangle works">
    <div className="flex items-start gap-3">
      <BookOpen size={18} className="mt-0.5 shrink-0 text-[var(--brand)]" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-sm font-semibold">How Untangle works</h2>
          <button type="button" onClick={dismiss} aria-label="Dismiss How Untangle works" className="-mr-2 -mt-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-[var(--surface-muted)]"><X size={16} /></button>
        </div>
        <ol className="mt-2 space-y-1.5 text-xs leading-5 text-soft">
          <li><span className="mr-1 font-semibold text-[var(--brand)]">1.</span>Your invoices live in PayPal.</li>
          <li><span className="mr-1 font-semibold text-[var(--brand)]">2.</span>Untangle finds loops — debts that cancel out — and clears them with no money moving.</li>
          <li><span className="mr-1 font-semibold text-[var(--brand)]">3.</span>What's left is settled with the fewest PayPal payments: one payment can settle a whole chain of invoices.</li>
        </ol>
      </div>
    </div>
  </aside>;
}
