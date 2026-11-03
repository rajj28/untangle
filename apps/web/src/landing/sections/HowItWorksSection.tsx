import type { JSX } from "react";
import { useEffect, useRef } from "react";
import { FileImage, RotateCcw, CreditCard } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface Step {
  number: string;
  title: string;
  description: string;
  Icon: LucideIcon;
  illustration: JSX.Element;
}

// Mini SVG illustrations for each step
function IntakeIllustration(): JSX.Element {
  return (
    <svg viewBox="0 0 120 80" width="120" height="80" aria-hidden="true" className="mx-auto">
      {/* Document */}
      <rect x="20" y="10" width="40" height="52" rx="4" fill="#f4f4f5" stroke="#e4e4e7" strokeWidth="1.5" />
      <rect x="27" y="20" width="26" height="3" rx="1.5" fill="#d4d4d8" />
      <rect x="27" y="27" width="20" height="3" rx="1.5" fill="#d4d4d8" />
      <rect x="27" y="34" width="23" height="3" rx="1.5" fill="#d4d4d8" />
      {/* AI spark */}
      <circle cx="75" cy="36" r="16" fill="#0f766e" opacity="0.12" />
      <text x="75" y="41" textAnchor="middle" fontSize="14" fill="#0f766e">✦</text>
      {/* Invoice out */}
      <rect x="85" y="18" width="26" height="36" rx="3" fill="#ccfbf1" stroke="#0f766e" strokeWidth="1.5" />
      <rect x="89" y="24" width="18" height="2.5" rx="1.5" fill="#0f766e" opacity="0.5" />
      <rect x="89" y="30" width="14" height="2.5" rx="1.5" fill="#0f766e" opacity="0.5" />
      <rect x="89" y="36" width="16" height="2.5" rx="1.5" fill="#0f766e" opacity="0.5" />
      {/* Arrow */}
      <line x1="62" y1="36" x2="72" y2="36" stroke="#0f766e" strokeWidth="1.5" markerEnd="url(#arr)" />
      <line x1="83" y1="36" x2="88" y2="36" stroke="#0f766e" strokeWidth="1.5" />
      <defs>
        <marker id="arr" markerWidth="5" markerHeight="4" refX="4" refY="2" orient="auto">
          <polygon points="0 0,5 2,0 4" fill="#0f766e" />
        </marker>
      </defs>
    </svg>
  );
}

function LoopIllustration(): JSX.Element {
  return (
    <svg viewBox="0 0 120 80" width="120" height="80" aria-hidden="true" className="mx-auto">
      {/* Three nodes forming a triangle */}
      <circle cx="60" cy="18" r="12" fill="#0f766e" opacity="0.15" />
      <circle cx="60" cy="18" r="9" fill="#0f766e" />
      <text x="60" y="22" textAnchor="middle" fill="white" fontSize="8" fontWeight="700">R</text>

      <circle cx="28" cy="62" r="12" fill="#2563eb" opacity="0.15" />
      <circle cx="28" cy="62" r="9" fill="#2563eb" />
      <text x="28" y="66" textAnchor="middle" fill="white" fontSize="8" fontWeight="700">M</text>

      <circle cx="92" cy="62" r="12" fill="#7c3aed" opacity="0.15" />
      <circle cx="92" cy="62" r="9" fill="#7c3aed" />
      <text x="92" y="66" textAnchor="middle" fill="white" fontSize="8" fontWeight="700">T</text>

      {/* Loop arcs with teal glow */}
      <path d="M 52 24 Q 24 38 28 52" fill="none" stroke="#14b8a6" strokeWidth="2" strokeLinecap="round" />
      <path d="M 37 64 Q 60 76 83 64" fill="none" stroke="#14b8a6" strokeWidth="2" strokeLinecap="round" />
      <path d="M 92 52 Q 90 30 68 22" fill="none" stroke="#14b8a6" strokeWidth="2" strokeLinecap="round" />

      {/* Cancel badge */}
      <circle cx="60" cy="50" r="11" fill="#ccfbf1" stroke="#14b8a6" strokeWidth="1.5" />
      <text x="60" y="54" textAnchor="middle" fill="#0f766e" fontSize="10" fontWeight="700">✕</text>
    </svg>
  );
}

function ChainIllustration(): JSX.Element {
  return (
    <svg viewBox="0 0 120 80" width="120" height="80" aria-hidden="true" className="mx-auto">
      {/* Four nodes in a chain */}
      {[14, 42, 70, 98].map((cx, i) => (
        <g key={i}>
          <circle cx={cx} cy="40" r="11" fill="#0070e0" opacity="0.15" />
          <circle cx={cx} cy="40" r="8" fill="#0070e0" />
          <text x={cx} y="44" textAnchor="middle" fill="white" fontSize="7" fontWeight="700">
            {String.fromCharCode(65 + i)}
          </text>
        </g>
      ))}
      {/* One payment arrow from first to last */}
      <defs>
        <marker id="pparr" markerWidth="5" markerHeight="4" refX="4" refY="2" orient="auto">
          <polygon points="0 0,5 2,0 4" fill="#0070e0" />
        </marker>
      </defs>
      <path d="M 25 34 Q 56 14 90 34" fill="none" stroke="#0070e0" strokeWidth="2" strokeDasharray="4 3" strokeLinecap="round" markerEnd="url(#pparr)" />
      {/* Settled badges under the connecting chains */}
      <text x="60" y="72" textAnchor="middle" fill="#0070e0" fontSize="8" fontWeight="600">1 payment → 3 invoices</text>
    </svg>
  );
}

const STEPS: Step[] = [
  {
    number: "01",
    title: "Drop in any proof.",
    description:
      "A photo of a bill, a voice note, a PDF or a chat message. AI reads it and the creditor's PayPal invoice goes out.",
    Icon: FileImage,
    illustration: <IntakeIllustration />,
  },
  {
    number: "02",
    title: "Loops cancel.",
    description:
      "Debts that run in a circle are cleared on every PayPal invoice in the loop, and no money moves.",
    Icon: RotateCcw,
    illustration: <LoopIllustration />,
  },
  {
    number: "03",
    title: "One payment settles a chain.",
    description:
      "What's left is paid through PayPal with the fewest payments possible. One payment can settle several invoices at once.",
    Icon: CreditCard,
    illustration: <ChainIllustration />,
  },
];

export function HowItWorksSection(): JSX.Element {
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
    <section id="how" ref={ref} className="ln-section bg-white" aria-labelledby="how-heading">
      <div className="ln-container">
        {/* Heading */}
        <div className="text-center max-w-xl mx-auto mb-16 reveal">
          <p className="ln-eyebrow mb-3">How it works</p>
          <h2 id="how-heading" className="text-4xl font-bold text-zinc-900 leading-tight tracking-tight">
            From a photo to settled in minutes
          </h2>
        </div>

        {/* Steps grid */}
        <div className="grid md:grid-cols-3 gap-8">
          {STEPS.map((step, i) => (
            <div
              key={step.number}
              className="ln-step-card reveal"
              style={{ transitionDelay: `${i * 80}ms` }}
            >
              <span className="ln-step-number" aria-hidden="true">{step.number}</span>

              {/* Illustration */}
              <div className="my-6">
                {step.illustration}
              </div>

              <div className="flex items-center gap-3 mb-3">
                <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-teal-50 text-teal-700">
                  <step.Icon size={20} aria-hidden="true" />
                </span>
                <h3 className="text-xl font-bold text-zinc-900 leading-snug">
                  {step.title}
                </h3>
              </div>

              <p className="text-zinc-500 text-sm leading-relaxed">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
