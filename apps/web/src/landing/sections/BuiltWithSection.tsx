import type { JSX } from "react";
const TECH = [
  "PayPal Invoicing",
  "Orders v2 + JS SDK v6",
  "Payouts",
  "Webhooks",
  "Transaction Search",
  "PayPal Agent Toolkit",
  "Google Gemini",
  "AG Grid Enterprise",
  "Neon",
  "Render",
] as const;

export function BuiltWithSection(): JSX.Element {
  return (
    <section className="py-14 bg-zinc-50 border-t border-zinc-200">
      <div className="ln-container">
        <p className="text-center text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-8">
          Built with
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          {TECH.map((name) => (
            <span key={name} className="ln-built-badge">
              {name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
