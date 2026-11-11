import type { JSX } from "react";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

interface TryItProps {
  playground: ReactNode;
}

export function TryItSection({ playground }: TryItProps): JSX.Element {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
          }
        });
      },
      { threshold: 0.1 },
    );
    el.querySelectorAll(".reveal").forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);

  return (
    <section id="try" ref={ref} className="ln-section bg-white" aria-labelledby="try-heading">
      <div className="ln-container">
        {/* Heading */}
        <div className="max-w-2xl mx-auto text-center mb-12 reveal">
          <p className="ln-eyebrow mb-3">Interactive</p>
          <h2 id="try-heading" className="text-4xl font-bold text-zinc-900 leading-tight tracking-tight mb-4">
            Untangle your street
          </h2>
          <p className="text-zinc-500 text-lg leading-relaxed">
            Add a few debts between neighbours, then press Untangle. This runs the same clearing engine as the real network, right in your browser.
          </p>
          <a href="#/judge" className="mt-5 inline-flex items-center gap-2 rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-700">
            Try it yourself on a real street
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
          </a>
        </div>

        {/* Playground frame */}
        <div className="ln-playground-frame reveal">
          {playground}
        </div>
      </div>
    </section>
  );
}
