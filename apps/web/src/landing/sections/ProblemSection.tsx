import type { JSX } from "react";
import { useEffect, useRef } from "react";

// Avatar colours (matching src/ui/Avatar.tsx PALETTE)
const PALETTE = [
  "#0f766e", "#2563eb", "#7c3aed",
  "#be123c", "#b45309", "#0e7490",
  "#4d7c0f", "#9333ea",
] as const;

const PALETTE_FALLBACK = "#0f766e";

function colorForId(id: string): string {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return PALETTE[(hash >>> 0) % PALETTE.length] ?? PALETTE_FALLBACK;
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((w) => w[0]?.toLocaleUpperCase() ?? "")
    .join("") || "U";
}

function BusinessAvatar({ name, id }: { name: string; id: string }): JSX.Element {
  const bg = colorForId(id);
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white h-14 w-14 text-base"
      style={{ backgroundColor: bg }}
    >
      {initials(name)}
    </span>
  );
}

interface Business {
  id: string;
  name: string;
  owes: string;
  waiting: string;
}

const BUSINESSES: Business[] = [
  {
    id: "rosas",
    name: "Rosa's Bakery",
    owes:    "Owes the mill $3,000 for flour.",
    waiting: "Waiting on $2,800 from the trucking company.",
  },
  {
    id: "rossi",
    name: "Rossi Mill",
    owes:    "Owes the trucker $2,400.",
    waiting: "Waiting on Rosa's $3,000.",
  },
  {
    id: "ortega",
    name: "Ortega Trucking",
    owes:    "Owes Rosa $2,800 for catering.",
    waiting: "Waiting on the mill's $2,400.",
  },
];

function BusinessCard({ business }: { business: Business }): JSX.Element {
  return (
    <article className="ln-problem-card flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <BusinessAvatar name={business.name} id={business.id} />
        <h3 className="font-semibold text-lg text-zinc-900 leading-snug">
          {business.name}
        </h3>
      </div>
      <div className="flex flex-col gap-2 text-sm text-zinc-600 leading-relaxed">
        <p>
          <span className="font-medium text-red-700">↑ Owes: </span>
          {business.owes}
        </p>
        <p>
          <span className="font-medium text-amber-700">⏳ Waiting: </span>
          {business.waiting}
        </p>
      </div>
    </article>
  );
}

function LoopArrowSVG(): JSX.Element {
  return (
    <figure aria-label="The three businesses form a loop: Rosa owes the Mill, the Mill owes Ortega, Ortega owes Rosa." className="flex justify-center my-6">
      <svg
        viewBox="0 0 340 120"
        width="340"
        height="120"
        className="max-w-full"
        role="img"
        aria-hidden="true"
      >
        {/* Circular arrow connecting the three cards conceptually */}
        <defs>
          <marker id="arrow-head" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#0f766e" />
          </marker>
        </defs>
        {/* Label dots for the three businesses */}
        <circle cx="60"  cy="60" r="22" fill="#0f766e" opacity="0.12" />
        <circle cx="60"  cy="60" r="16" fill="#0f766e" />
        <text x="60"  y="65" textAnchor="middle" fill="white" fontSize="10" fontWeight="700">R</text>

        <circle cx="170" cy="24" r="22" fill="#2563eb" opacity="0.12" />
        <circle cx="170" cy="24" r="16" fill="#2563eb" />
        <text x="170" y="29" textAnchor="middle" fill="white" fontSize="10" fontWeight="700">M</text>

        <circle cx="280" cy="60" r="22" fill="#7c3aed" opacity="0.12" />
        <circle cx="280" cy="60" r="16" fill="#7c3aed" />
        <text x="280" y="65" textAnchor="middle" fill="white" fontSize="10" fontWeight="700">T</text>

        {/* Animated arc: R → M → T → R */}
        <path
          d="M 76 52 Q 120 -10 154 26"
          fill="none"
          stroke="#0f766e"
          strokeWidth="2"
          strokeLinecap="round"
          markerEnd="url(#arrow-head)"
          className="loop-arrow-path"
        />
        <path
          d="M 186 26 Q 250 -5 264 48"
          fill="none"
          stroke="#0f766e"
          strokeWidth="2"
          strokeLinecap="round"
          markerEnd="url(#arrow-head)"
          className="loop-arrow-path"
          style={{ animationDelay: "0.4s" }}
        />
        <path
          d="M 264 76 Q 220 130 76 72"
          fill="none"
          stroke="#0f766e"
          strokeWidth="2"
          strokeLinecap="round"
          markerEnd="url(#arrow-head)"
          className="loop-arrow-path"
          style={{ animationDelay: "0.8s" }}
        />

        {/* Amount labels */}
        <text x="105" y="12" textAnchor="middle" fontSize="9" fill="#52525b" fontWeight="500">$3,000</text>
        <text x="238" y="12" textAnchor="middle" fontSize="9" fill="#52525b" fontWeight="500">$2,400</text>
        <text x="170" y="108" textAnchor="middle" fontSize="9" fill="#52525b" fontWeight="500">$2,800</text>
      </svg>
    </figure>
  );
}

export function ProblemSection(): JSX.Element {
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
    <section ref={ref} className="ln-section bg-zinc-50">
      <div className="ln-container">
        {/* Heading */}
        <div className="text-center max-w-2xl mx-auto mb-14 reveal">
          <p className="ln-eyebrow mb-3">The problem</p>
          <h2 className="text-4xl font-bold text-zinc-900 leading-tight tracking-tight mb-4">
            Everyone is owed. Nobody can pay.
          </h2>
          <p className="text-zinc-500 text-lg leading-relaxed">
            Three businesses, three invoices, zero cash flow. It happens on every Main Street, every week.
          </p>
        </div>

        {/* Business cards */}
        <div className="grid md:grid-cols-3 gap-6 mb-10 reveal">
          {BUSINESSES.map((b) => (
            <BusinessCard key={b.id} business={b} />
          ))}
        </div>

        {/* Loop arrow */}
        <div className="reveal">
          <LoopArrowSVG />
        </div>

        {/* Caption */}
        <p className="text-center text-zinc-600 font-medium text-base mb-10 reveal">
          It's a loop. <span className="text-teal-700 font-semibold">$2,400 of it can simply cancel.</span>
        </p>

        {/* Fact strip */}
        <div className="rounded-2xl bg-teal-50 border border-teal-100 px-8 py-6 text-center max-w-2xl mx-auto reveal">
          <p className="text-xl font-semibold text-zinc-800 leading-snug mb-1">
            56% of US small businesses are owed money right now,{" "}
            <span className="text-teal-700">about $17,500 each.</span>
          </p>
          <p className="text-xs text-zinc-400 mt-2">
            QuickBooks small business late payments report, 2025
          </p>
        </div>
      </div>
    </section>
  );
}
