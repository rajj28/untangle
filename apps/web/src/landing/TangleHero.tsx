import type { JSX } from "react";
/* TangleHero.tsx – signature animated SVG for the landing hero.
 * 9 shop nodes on an irregular ellipse; ~14 threads; 8-second CSS loop.
 * Pure SVG + CSS classes from landing.css — no JS animation.
 */
import type { CSSProperties } from "react";

// Node positions (cx, cy) on a slightly irregular ellipse, r≈210 centred at 320,250
// Order: Rosa(R), Rossi(M), Ortega(T), Cafe(C), Bloom(B), Deli(D), Print(P), Salt(S), Ace(A)
// (Ace is the 9th node that completes the network)
const NODES = [
  { id: "R", label: "Rosa's\nBakery",    cx: 320, cy:  50, color: "#0f766e" },
  { id: "M", label: "Rossi\nMill",       cx: 516, cy: 138, color: "#2563eb" },
  { id: "T", label: "Ortega\nTrucking",  cx: 542, cy: 338, color: "#7c3aed" },
  { id: "B", label: "Bloom\nFlowers",    cx: 390, cy: 480, color: "#be123c" },
  { id: "P", label: "Print\nShop",       cx: 190, cy: 480, color: "#b45309" },
  { id: "S", label: "Salt &\nSpice",     cx:  90, cy: 338, color: "#0e7490" },
  { id: "A", label: "Ace\nHardware",     cx: 100, cy: 138, color: "#4d7c0f" },
  { id: "C", label: "Corner\nCafe",      cx: 250, cy: 180, color: "#9333ea" },
  { id: "D", label: "Deli &\nDrinks",    cx: 410, cy: 310, color: "#0070e0" },
] as const;

type NodeId = (typeof NODES)[number]["id"];

// Quadratic bezier: from node cx/cy to node cx/cy with a control point
// We offset the control point perpendicular to the midpoint to create curves
function qPath(
  ax: number, ay: number,
  bx: number, by: number,
  bend: number = 60,
): string {
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  // perpendicular direction
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const cx = mx + nx * bend;
  const cy = my + ny * bend;
  return `M ${ax} ${ay} Q ${cx} ${cy} ${bx} ${by}`;
}

function nodePos(id: NodeId): { cx: number; cy: number } {
  const n = NODES.find((n) => n.id === id);
  return { cx: n?.cx ?? 0, cy: n?.cy ?? 0 };
}

interface Thread {
  from: NodeId;
  to: NodeId;
  bend?: number;
  type: "muted" | "loop" | "paypal";
  delay?: number; // stagger delay in seconds for loop threads
}

const THREADS: Thread[] = [
  // Main Street loop: R→M→T→R
  { from: "R", to: "M", type: "loop",   delay: 0    },
  { from: "M", to: "T", type: "loop",   delay: 0.15 },
  { from: "T", to: "R", type: "loop",   delay: 0.3  },
  // B→P→B loop
  { from: "B", to: "P", type: "loop",   delay: 0.45, bend: -50 },
  { from: "P", to: "B", type: "loop",   delay: 0.6,  bend: 50  },
  // C→D→T loop segment
  { from: "C", to: "D", type: "loop",   delay: 0.75 },
  { from: "D", to: "T", type: "loop",   delay: 0.9,  bend: 40  },
  // Muted background threads
  { from: "C", to: "R", type: "muted",  bend: -40 },
  { from: "C", to: "B", type: "muted",  bend: 40  },
  { from: "R", to: "D", type: "muted",  bend: -30 },
  { from: "B", to: "T", type: "muted",  bend: 30  },
  { from: "A", to: "M", type: "muted",  bend: -30 },
  { from: "S", to: "P", type: "muted",  bend: 30  },
  // PayPal settlement threads: C→S, C→P, D→A
  { from: "C", to: "S", type: "paypal", delay: 0    },
  { from: "C", to: "P", type: "paypal", delay: 0.3  },
  { from: "D", to: "A", type: "paypal", delay: 0.6, bend: -50 },
];

// Spark node IDs (loop nodes that flash when loops dissolve)
const SPARK_NODES: NodeId[] = ["R", "M", "T", "B", "P", "C", "D"];

// PayPal dot paths (offset-path)
const PAYPAL_THREADS = THREADS.filter((t) => t.type === "paypal");

export function TangleHero(): JSX.Element {
  return (
    <figure aria-label="Animated diagram: a network of 9 Main Street businesses with their debts. The debts that form loops cancel out, then a few PayPal payments settle the rest." className="w-full select-none">
      <svg
        viewBox="0 0 640 520"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-auto"
        role="img"
        aria-hidden="true"
      >
        <defs>
          {/* Glow filter for loop threads */}
          <filter id="glow-teal" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* Glow filter for PayPal threads */}
          <filter id="glow-blue" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* Soft glow for nodes */}
          <filter id="node-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* Define offset paths for travelling PayPal dots */}
          {PAYPAL_THREADS.map((t, i) => {
            const a = nodePos(t.from);
            const b = nodePos(t.to);
            const d = qPath(a.cx, a.cy, b.cx, b.cy, t.bend ?? 60);
            return (
              <path
                key={`dot-path-${i}`}
                id={`dot-path-${i}`}
                d={d}
                fill="none"
              />
            );
          })}
        </defs>

        {/* ── Background grid dots (decorative) ─────────────────────────── */}
        <pattern id="dots" x="0" y="0" width="32" height="32" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="1" fill="white" fillOpacity="0.04" />
        </pattern>
        <rect width="640" height="520" fill="url(#dots)" />

        {/* ── Muted threads ────────────────────────────────────────────── */}
        {THREADS.filter((t) => t.type === "muted").map((t, i) => {
          const a = nodePos(t.from);
          const b = nodePos(t.to);
          return (
            <path
              key={`muted-${i}`}
              d={qPath(a.cx, a.cy, b.cx, b.cy, t.bend ?? 60)}
              fill="none"
              stroke="#64748b"
              strokeWidth="1.5"
              strokeLinecap="round"
              className="th-thread-muted th-duration"
            />
          );
        })}

        {/* ── Loop threads (teal) ──────────────────────────────────────── */}
        {THREADS.filter((t) => t.type === "loop").map((t, i) => {
          const a = nodePos(t.from);
          const b = nodePos(t.to);
          const delayStyle: CSSProperties = {
            animationDelay: `${t.delay ?? 0}s`,
          };
          return (
            <path
              key={`loop-${i}`}
              d={qPath(a.cx, a.cy, b.cx, b.cy, t.bend ?? 60)}
              fill="none"
              stroke="#14b8a6"
              strokeWidth="2.5"
              strokeLinecap="round"
              filter="url(#glow-teal)"
              className="th-thread-loop th-duration"
              style={delayStyle}
            />
          );
        })}

        {/* ── PayPal threads (blue) ────────────────────────────────────── */}
        {PAYPAL_THREADS.map((t, i) => {
          const a = nodePos(t.from);
          const b = nodePos(t.to);
          const delayStyle: CSSProperties = {
            animationDelay: `${t.delay ?? 0}s`,
          };
          return (
            <path
              key={`paypal-${i}`}
              d={qPath(a.cx, a.cy, b.cx, b.cy, t.bend ?? 60)}
              fill="none"
              stroke="#0070e0"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray="6 4"
              filter="url(#glow-blue)"
              className="th-thread-paypal th-duration"
              style={delayStyle}
            />
          );
        })}

        {/* ── Travelling PayPal dots ───────────────────────────────────── */}
        {PAYPAL_THREADS.map((t, i) => {
          const dotStyle: CSSProperties = {
            offsetPath: `path('${(() => {
              const a = nodePos(t.from);
              const b = nodePos(t.to);
              return qPath(a.cx, a.cy, b.cx, b.cy, t.bend ?? 60);
            })()}')`,
            animationDelay: `${t.delay ?? 0}s`,
          };
          return (
            <circle
              key={`dot-${i}`}
              r="5"
              fill="#0070e0"
              filter="url(#glow-blue)"
              className="th-dot"
              style={dotStyle}
            />
          );
        })}

        {/* ── Spark circles (flash when loops dissolve) ────────────────── */}
        {SPARK_NODES.map((id) => {
          const n = nodePos(id);
          return (
            <circle
              key={`spark-${id}`}
              cx={n.cx}
              cy={n.cy}
              r="10"
              fill="none"
              stroke="#14b8a6"
              strokeWidth="2"
              opacity="0"
              className="th-node-spark th-duration"
            />
          );
        })}

        {/* ── Nodes ────────────────────────────────────────────────────── */}
        {NODES.map((node) => {
          const lines = node.label.split("\n");
          return (
            <g key={node.id} aria-label={node.label.replace("\n", " ")}>
              {/* Soft glow behind circle */}
              <circle
                cx={node.cx}
                cy={node.cy}
                r="26"
                fill={node.color}
                opacity="0.18"
                filter="url(#node-glow)"
              />
              {/* Main circle */}
              <circle
                cx={node.cx}
                cy={node.cy}
                r="22"
                fill={node.color}
              />
              {/* Initials */}
              <text
                x={node.cx}
                y={node.cy + 5}
                textAnchor="middle"
                fontSize="11"
                fontWeight="700"
                fontFamily="ui-sans-serif, system-ui, sans-serif"
                fill="#ffffff"
              >
                {node.id}
              </text>
              {/* Name label */}
              {lines.map((line, li) => (
                <text
                  key={li}
                  x={node.cx}
                  y={node.cy + 36 + li * 13}
                  textAnchor="middle"
                  fontSize="9"
                  fontWeight="500"
                  fontFamily="ui-sans-serif, system-ui, sans-serif"
                  fill="#94a3b8"
                >
                  {line}
                </text>
              ))}
            </g>
          );
        })}

        {/* ── "Loops cancel" teal label ────────────────────────────────── */}
        <text
          x="320"
          y="490"
          textAnchor="middle"
          fontSize="11"
          fontWeight="600"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
          fill="#14b8a6"
          className="th-label-teal th-duration"
        >
          Loops cancel — no money moves
        </text>

        {/* ── "1 PayPal payment" blue label ───────────────────────────── */}
        <text
          x="320"
          y="490"
          textAnchor="middle"
          fontSize="11"
          fontWeight="600"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
          fill="#0070e0"
          className="th-label-blue th-duration"
        >
          1 PayPal payment settles a chain
        </text>
      </svg>
    </figure>
  );
}
