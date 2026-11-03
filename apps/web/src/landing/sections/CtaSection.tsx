import type { JSX } from "react";
import { Monitor, Play } from "lucide-react";

interface CtaProps {
  onOpenDesk: () => void;
  onWatchDemo: () => void;
}

export function CtaSection({ onOpenDesk, onWatchDemo }: CtaProps): JSX.Element {
  return (
    <footer className="ln-cta" role="contentinfo">
      {/* Glow */}
      <div className="ln-cta-glow" aria-hidden="true" />

      {/* CTA */}
      <section className="ln-section relative z-10" aria-labelledby="cta-heading">
        <div className="ln-container text-center">
          <p className="ln-eyebrow mb-4" style={{ color: "#14b8a6" }}>
            See it live
          </p>
          <h2
            id="cta-heading"
            className="text-4xl md:text-5xl font-bold text-white leading-tight tracking-tight mb-8 max-w-2xl mx-auto"
          >
            See a whole street settle in minutes.
          </h2>
          <div className="flex flex-wrap justify-center gap-4">
            <button
              onClick={onOpenDesk}
              className="ln-btn-primary text-base py-3.5 px-8"
            >
              <Monitor size={18} aria-hidden="true" />
              Open the clearing desk
            </button>
            <button
              onClick={onWatchDemo}
              className="ln-btn-ghost-white text-base py-3.5 px-8"
            >
              <Play size={16} aria-hidden="true" />
              Watch the 3-minute demo
            </button>
          </div>
        </div>
      </section>

      {/* Footer bar */}
      <div className="relative z-10 border-t border-white/8 py-6">
        <div className="ln-container">
          <p className="text-center text-xs text-slate-500">
            Built for the PayPal AI Hackathon 2026 · Runs on the PayPal sandbox
          </p>
        </div>
      </div>
    </footer>
  );
}
