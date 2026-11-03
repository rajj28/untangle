import type { JSX } from "react";
import { useEffect, useRef } from "react";
import { Repeat2, Link2, UserCheck, RefreshCw } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface TrustTile {
  title: string;
  description: string;
  Icon: LucideIcon;
}

const TILES: TrustTile[] = [
  {
    title: "Exactly-once PayPal writes.",
    description:
      "Every payment on an invoice is recorded once, even if the server dies mid-way.",
    Icon: Repeat2,
  },
  {
    title: "Tamper-evident audit log.",
    description:
      "Every step, by people or agents, is hash-chained. The history cannot be changed without detection.",
    Icon: Link2,
  },
  {
    title: "Owners stay in charge.",
    description:
      "Agents act only within each owner's policy, and risky steps wait for approval before anything moves.",
    Icon: UserCheck,
  },
  {
    title: "Checked against PayPal.",
    description:
      "The Watchdog re-reads the invoices from PayPal after every round and surfaces any discrepancy.",
    Icon: RefreshCw,
  },
];

export function TrustSection(): JSX.Element {
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
      { threshold: 0.15 },
    );
    el.querySelectorAll(".reveal").forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);

  return (
    <section id="trust" ref={ref} className="ln-section bg-white" aria-labelledby="trust-heading">
      <div className="ln-container">
        {/* Heading */}
        <div className="text-center max-w-xl mx-auto mb-16 reveal">
          <p className="ln-eyebrow mb-3">Security & reliability</p>
          <h2 id="trust-heading" className="text-4xl font-bold text-zinc-900 leading-tight tracking-tight">
            Built to be trusted
          </h2>
        </div>

        {/* Tiles */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {TILES.map((tile, i) => (
            <div
              key={tile.title}
              className="ln-trust-tile reveal"
              style={{ transitionDelay: `${i * 80}ms` }}
            >
              <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-teal-50 mb-5">
                <tile.Icon size={22} className="text-teal-700" aria-hidden="true" />
              </div>
              <h3 className="font-semibold text-zinc-900 text-base leading-snug mb-2">
                {tile.title}
              </h3>
              <p className="text-sm text-zinc-500 leading-relaxed">
                {tile.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
