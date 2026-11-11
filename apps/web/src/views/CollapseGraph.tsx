import { useEffect, useMemo, useRef, useState } from "react";
import type { Loop, SettlementPlan } from "@untangle/engine";
import { findLoops } from "@untangle/engine";
import { formatMoney } from "../money.ts";

interface CollapseNode {
  id: string;
  name: string;
}

interface CollapseObligation {
  id: string;
  debtor: string;
  creditor: string;
  amount: number;
}

interface CollapseGraphProps {
  nodes: CollapseNode[];
  obligations: CollapseObligation[];
  plan: SettlementPlan;
  currency: string;
  names: Readonly<Record<string, string>>;
  height?: number;
}

const W = 800;
const H = 500;
const CX = W / 2;
const CY = H / 2;
const R = 200;
const TOTAL_MS = 7000;

const P_BEFORE = 0.12;
const P_LOOP_START = 0.12;
const P_LOOP_SPAN = 0.43;
const P_CHAIN_START = 0.55;
const P_CHAIN_SPAN = 0.30;

interface LoopEdge {
  obligationId: string;
  loopIndex: number;
}

interface Counters {
  debtCleared: number;
  cashMoved: number;
  leverage: number | null;
  invoicesTouched: number;
  totalLoops: number;
  loopsCleared: number;
  totalTransfers: number;
  transfersShown: number;
}

export function CollapseGraph({ nodes, obligations, plan, currency, names, height = 480 }: CollapseGraphProps) {
  const [playing, setPlaying] = useState(false);
  const [done, setDone] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const raf = useRef<number | null>(null);

  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    nodes.forEach((node, index) => {
      const angle = -Math.PI / 2 + (index / nodes.length) * Math.PI * 2;
      map.set(node.id, { x: CX + R * Math.cos(angle), y: CY + R * Math.sin(angle) });
    });
    return map;
  }, [nodes]);

  const { loops, loopByObligation, maxAmount } = useMemo(() => {
    const loops = findLoops(obligations, plan.setoffs);
    const loopByObligation = new Map<string, number>();
    loops.forEach((loop, li) => loop.memberIds.forEach((id) => { if (!loopByObligation.has(id)) loopByObligation.set(id, li); }));
    const maxAmount = Math.max(1, ...obligations.map((o) => o.amount), ...plan.transfers.map((t) => t.amount));
    return { loops, loopByObligation, maxAmount };
  }, [obligations, plan]);

  const t = Math.min(1, elapsed / TOTAL_MS);

  const loopComplete = useMemo(() => {
    if (loops.length === 0) return [];
    const out: boolean[] = [];
    for (let i = 0; i < loops.length; i++) {
      const start = P_LOOP_START + (i / loops.length) * P_LOOP_SPAN;
      const dur = P_LOOP_SPAN / loops.length;
      out.push(t >= start + dur);
    }
    return out;
  }, [loops.length, t]);

  const counters: Counters = useMemo(() => {
    let debtCleared = 0;
    let loopsCleared = 0;
    loops.forEach((loop, i) => {
      if (loopComplete[i]) { debtCleared += loop.amount * loop.memberIds.length; loopsCleared += 1; }
    });
    const touched = new Set<string>();
    // Loop edges that have fully cleared count as touched.
    loops.forEach((loop, i) => { if (loopComplete[i]) loop.memberIds.forEach((id) => touched.add(id)); });
    // Residual obligations fade during the chain phase and count as touched once gone.
    let cashMoved = 0;
    let transfersShown = 0;
    plan.transfers.forEach((transfer, ti) => {
      const start = P_CHAIN_START + (ti / Math.max(1, plan.transfers.length)) * P_CHAIN_SPAN;
      if (t >= start) { cashMoved += transfer.amount; transfersShown += 1; debtCleared += transfer.legs.reduce((sum, leg) => sum + leg.amount, 0); }
    });
    for (const o of obligations) {
      if (loopByObligation.has(o.id)) continue;
      if (t >= P_CHAIN_START + P_CHAIN_SPAN) touched.add(o.id);
    }
    const leverage = cashMoved > 0 && debtCleared > 0 ? debtCleared / cashMoved : null;
    return { debtCleared, cashMoved, leverage, invoicesTouched: touched.size, totalLoops: loops.length, loopsCleared, totalTransfers: plan.transfers.length, transfersShown };
  }, [loops, loopComplete, plan.transfers, t, loopByObligation, obligations]);

  useEffect(() => {
    if (!playing) return;
    const startTs = performance.now();
    const startedAt = 0;
    const step = (now: number) => {
      const next = Math.min(TOTAL_MS, startedAt + (now - startTs));
      setElapsed(next);
      if (next >= TOTAL_MS) {
        setPlaying(false);
        setDone(true);
        return;
      }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => { if (raf.current !== null) cancelAnimationFrame(raf.current); };
  }, [playing]);

  const clear = () => {
    setElapsed(0);
    setDone(false);
    setPlaying(true);
  };

  const edgeProps = (from: string, to: string, amountMinor: number, baseOpacity: number, highlight: boolean) => {
    const a = positions.get(from);
    const b = positions.get(to);
    if (!a || !b) return null;
    const width = Math.max(1.2, (amountMinor / maxAmount) * 11);
    const color = highlight ? "#f2b037" : "#9aa4bf";
    return {
      x1: a.x, y1: a.y, x2: b.x, y2: b.y,
      opacity: baseOpacity,
      strokeWidth: width,
      stroke: color,
    };
  };

  const obligationEdges = useMemo(() => {
    return obligations.map((o) => {
      const li = loopByObligation.get(o.id);
      let opacity = 1;
      let highlight = false;
      if (li !== undefined) {
        const start = P_LOOP_START + (li / Math.max(1, loops.length)) * P_LOOP_SPAN;
        const dur = P_LOOP_SPAN / Math.max(1, loops.length);
        const local = (t - start) / dur;
        if (local <= 0) opacity = 1;
        else if (local <= 0.18) { opacity = 1; highlight = true; }
        else opacity = Math.max(0, 1 - (local - 0.18) / 0.82);
      } else if (t >= P_CHAIN_START) {
        opacity = Math.max(0, 1 - (t - P_CHAIN_START) / P_CHAIN_SPAN);
      }
      return { obligationId: o.id, from: o.debtor, to: o.creditor, amountMinor: o.amount, opacity, highlight, li };
    });
  }, [obligations, loopByObligation, loops.length, t, maxAmount, positions, plan.transfers.length]);

  const transferEdges = useMemo(() => {
    return plan.transfers.map((transfer, ti) => {
      const start = P_CHAIN_START + (ti / Math.max(1, plan.transfers.length)) * P_CHAIN_SPAN;
      const opacity = t < start ? 0 : Math.min(1, (t - start) / 0.02);
      return { from: transfer.payer, to: transfer.payee, amountMinor: transfer.amount, opacity };
    });
  }, [plan.transfers, t]);

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b line px-4 py-2 text-xs">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Loops clear first</span>
        <span className="tabular-nums">debt cleared <b className="text-[var(--brand)]">{formatMoney(counters.debtCleared, currency)}</b></span>
        <span className="tabular-nums">cash moved <b className="text-[var(--blue)]">{formatMoney(counters.cashMoved, currency)}</b></span>
        <span className="tabular-nums">leverage <b>{counters.leverage === null ? "—" : counters.leverage.toFixed(1) + "×"}</b></span>
        <span className="tabular-nums">invoices touched <b>{counters.invoicesTouched}</b></span>
        <span className="mx-auto" />
        <span className="text-[10px] text-muted">{counters.loopsCleared}/{counters.totalLoops} loops · {counters.transfersShown}/{counters.totalTransfers} PayPal payments</span>
        <button className="desk-button desk-button-primary h-7 min-h-7 px-3 text-[10px]" onClick={clear} disabled={playing}>
          {playing ? "Clearing…" : done ? "Replay" : "Clear"}
        </button>
      </div>
      <div className="min-h-0 flex-1" style={{ height }}>
        <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" role="img" aria-label="Before → after settlement graph">
          {/* obligation edges (drawn underneath) */}
          <g>
            {obligationEdges.map((edge) => {
              const p = edgeProps(edge.from, edge.to, edge.amountMinor, edge.opacity, edge.highlight);
              if (!p) return null;
              return <line key={`ob-${edge.obligationId}`} {...p} strokeLinecap="round" />;
            })}
          </g>
          {/* transfer edges (real PayPal payments, on top) */}
          <g>
            {transferEdges.map((edge, i) => {
              const p = edgeProps(edge.from, edge.to, edge.amountMinor, edge.opacity, false);
              if (!p || p.opacity <= 0.01) return null;
              return <line key={`tx-${i}`} {...p} stroke="#2f9e6e" strokeLinecap="round" strokeDasharray="6 4" />;
            })}
          </g>
          {/* nodes */}
          <g>
            {nodes.map((node) => {
              const p = positions.get(node.id);
              if (!p) return null;
              const isYou = node.name === "You";
              return (
                <g key={node.id}>
                  <circle cx={p.x} cy={p.y} r={isYou ? 26 : 22} fill={isYou ? "var(--brand-tint)" : "#f6f7fb"} stroke={isYou ? "var(--brand)" : "#c9d0df"} strokeWidth={1.5} />
                  <text x={p.x} y={p.y + 3} textAnchor="middle" fontSize={isYou ? 11 : 9} fontWeight={isYou ? 700 : 500} fill="var(--ink)">{node.name}</text>
                </g>
              );
            })}
          </g>
          {!playing && !done && (
            <text x={CX} y={H - 18} textAnchor="middle" fontSize={11} fill="var(--ink-muted)">Press Clear to animate the engine's actual plan for this network.</text>
          )}
        </svg>
      </div>
    </div>
  );
}
