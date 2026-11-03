import type { JSX } from "react";
/**
 * src/landing/Landing.tsx
 *
 * Untangle landing page.
 * Export: Landing (named)
 * Interface: LandingStats, Landing(props)
 *
 * Stack: React 19 + Tailwind 4 + lucide-react
 * Strict TS: exactOptionalPropertyTypes, noUncheckedIndexedAccess
 */
import type { ReactNode } from "react";
import "./landing.css";

import type { LandingStats } from "./types.ts";

import { NavSection }        from "./sections/NavSection.tsx";
import { HeroSection }       from "./sections/HeroSection.tsx";
import { ProblemSection }    from "./sections/ProblemSection.tsx";
import { HowItWorksSection } from "./sections/HowItWorksSection.tsx";
import { AgentsSection }     from "./sections/AgentsSection.tsx";
import { TryItSection }      from "./sections/TryItSection.tsx";
import { TrustSection }      from "./sections/TrustSection.tsx";
import { BuiltWithSection }  from "./sections/BuiltWithSection.tsx";
import { CtaSection }        from "./sections/CtaSection.tsx";

// ── Public interface ───────────────────────────────────────────────────────
export type { LandingStats };

export function Landing(props: {
  stats: LandingStats | null;
  onOpenDesk: () => void;
  onOpenBusiness: () => void;
  onWatchDemo: () => void;
  playground: ReactNode;
}): JSX.Element {
  const { stats, onOpenDesk, onOpenBusiness, onWatchDemo, playground } = props;

  return (
    <div className="min-h-screen" style={{ background: "#ffffff", color: "#18181b" }}>
      {/* ── Navigation ─────────────────────────────────────────────── */}
      <NavSection onOpenDesk={onOpenDesk} />

      {/* ── Main content ───────────────────────────────────────────── */}
      <main id="main-content">
        {/* 1. Hero + Stats ribbon */}
        <HeroSection
          stats={stats}
          onOpenDesk={onOpenDesk}
          onOpenBusiness={onOpenBusiness}
          onWatchDemo={onWatchDemo}
        />

        {/* 2. Problem: a real street */}
        <ProblemSection />

        {/* 3. How it works */}
        <HowItWorksSection />

        {/* 4. Meet the agents */}
        <AgentsSection />

        {/* 5. Try it yourself */}
        <TryItSection playground={playground} />

        {/* 6. Built to be trusted */}
        <TrustSection />

        {/* 7. Built with */}
        <BuiltWithSection />
      </main>

      {/* ── CTA + Footer ───────────────────────────────────────────── */}
      <CtaSection onOpenDesk={onOpenDesk} onWatchDemo={onWatchDemo} />
    </div>
  );
}
