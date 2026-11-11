import type React from "react";
import { AbsoluteFill, Audio, Easing, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { getLength, getPointAtLength } from "@remotion/paths";
import street from "../data/main-street.json";
import { lineFrames, VOICE_RATE } from "../program/timing";
import { Backdrop } from "../ui/Backdrop";
import { Arrow, arrowPath, Pill, ShopNode } from "../ui/graph";
import type { Pt } from "../ui/graph";
import { C, FPS, fontFamily, SHOP_COLORS, usd } from "../theme";

export const HOOK_LINES = ["h1", "h2", "h3", "h4", "h5", "h6", "h7"] as const;
type LineId = (typeof HOOK_LINES)[number];

const LEAD = 10;
const GAP = 4;
const HOLD = 20;

/** Each narration line starts right after the previous one; scenes are keyed to the same starts. */
export function hookTimeline() {
  const starts = {} as Record<LineId, number>;
  let frame = LEAD;
  for (const id of HOOK_LINES) {
    starts[id] = frame;
    frame += lineFrames(id) + GAP;
  }
  return { starts, total: frame - GAP + HOLD };
}

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.bezier(0.22, 1, 0.36, 1);
const ramp = (frame: number, from: number, to: number, easing = ease) => interpolate(frame, [from, to], [0, 1], { ...clamp, easing });
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

// The story's loop: Rosa's Bakery → Rossi Mill → Ortega Trucking → Rosa's Bakery.
const TRI = { rosa: { x: 960, y: 250 }, mill: { x: 1255, y: 770 }, truck: { x: 665, y: 770 } };
const R = 74;
const LOOP = [
  { id: "rm", from: TRI.rosa, to: TRI.mill, amount: 300_000 },
  { id: "mt", from: TRI.mill, to: TRI.truck, amount: 240_000 },
  { id: "tr", from: TRI.truck, to: TRI.rosa, amount: 280_000 },
].map((edge) => ({ ...edge, ...arrowPath(edge.from, edge.to, R, R, -0.16) }));
const CLEARED = 240_000;

export const Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { starts } = hookTimeline();
  const at = (line: LineId, seconds: number) => starts[line] + Math.round(seconds * fps);
  const pop = (start: number, damping = 13) => spring({ frame: frame - start, fps, config: { damping, stiffness: 170, mass: 0.75 } });

  // Camera for the story's triangle: centred, then left of the text, then far away, then back.
  const shiftIn = ramp(frame, at("h3", 0), at("h3", 0.6));
  const zoomOut = ramp(frame, at("h4", 0), at("h4", 1.1), Easing.bezier(0.65, 0, 0.35, 1));
  const zoomIn = ramp(frame, at("h5", 0), at("h5", 0.9), Easing.bezier(0.65, 0, 0.35, 1));
  const triScale = mix(mix(1, 0.16, zoomOut), 1, zoomIn);
  const triShift = mix(mix(0, -330, shiftIn), 0, zoomOut) + mix(0, -330, zoomIn);
  const triOpacity = 1 - ramp(frame, at("h6", 0), at("h6", 0.45));

  // Rosa starts alone in the middle, then takes her place at the top of the loop.
  const rosaMove = ramp(frame, at("h2", 0), at("h2", 0.7));
  const rosaAt: Pt = { x: 960, y: mix(470, TRI.rosa.y, rosaMove) };
  const millIn = pop(at("h2", 0.9));
  const truckIn = pop(at("h2", 3.0));
  const draw = [ramp(frame, at("h2", 1.1), at("h2", 2.2)), ramp(frame, at("h2", 3.2), at("h2", 4.4)), ramp(frame, at("h2", 6.75), at("h2", 7.5))];
  const closed = ramp(frame, at("h2", 7.4), at("h2", 7.6)) * (1 - ramp(frame, at("h2", 7.7), at("h3", 0.6)));
  const waiting = ramp(frame, at("h3", 0.2), at("h3", 0.7)) * (1 - ramp(frame, at("h5", 0), at("h5", 0.6)));
  const pulse = 0.55 + 0.45 * Math.sin(frame / 4);

  // Loops cancel: a light runs once around the loop, and each invoice drops by the loop's amount as it passes.
  const lap = ramp(frame, at("h5", 0.9), at("h5", 2.9), Easing.inOut(Easing.quad));
  const passed = (index: number) => ramp(frame, at("h5", 0.9 + (index + 0.55) * (2 / 3)), at("h5", 0.9 + (index + 0.85) * (2 / 3)));

  return (
    <AbsoluteFill style={{ fontFamily }}>
      <Backdrop />

      {/* The story's loop */}
      <AbsoluteFill style={{ opacity: triOpacity }}>
        <svg width={1920} height={1080}>
          <g transform={`translate(${960 + triShift} 540) scale(${triScale}) translate(-960 -540)`}>
            {LOOP.map((edge, index) => {
              const cleared = passed(index);
              const gone = edge.amount - CLEARED * cleared <= 0 && cleared >= 1;
              const color = cleared > 0 ? C.teal : waiting > 0 ? C.owed : "#cbd5e1";
              const flash = closed > 0 ? closed : 0;
              return (
                <g key={edge.id}>
                  <Arrow d={edge.d} progress={draw[index] ?? 0} color={color} width={5} glow={flash * 18 + cleared * (1 - cleared) * 30}
                    opacity={gone ? 0.16 : waiting > 0 ? mix(1, pulse, waiting) : 1} />
                  <Pill at={edge.mid} text={usd(Math.round(edge.amount - CLEARED * cleared))} color={cleared > 0 ? C.teal : C.owed}
                    opacity={Math.max(0, Math.min(1, ((draw[index] ?? 0) - 0.45) * 2.2)) * (gone ? 0.35 : 1)} size={30} />
                  {cleared > 0 && cleared < 1 && (
                    <Pill at={{ x: edge.mid.x + 70, y: edge.mid.y - 70 * cleared - 20 }} text={`−${usd(CLEARED)}`} color={C.teal} size={24} opacity={Math.sin(cleared * Math.PI)} />
                  )}
                </g>
              );
            })}
            <ShopNode at={rosaAt} r={R} color={SHOP_COLORS.b1!} name="Rosa's Bakery" scale={pop(starts.h1 - 6, 12)} glow={1} labelFlip={rosaMove} />
            <ShopNode at={TRI.mill} r={R} color={SHOP_COLORS.b2!} name="Rossi Mill" scale={millIn} glow={1} />
            <ShopNode at={TRI.truck} r={R} color={SHOP_COLORS.b3!} name="Ortega Trucking" scale={truckIn} glow={1} />
            {waiting > 0 && [rosaAt, TRI.mill, TRI.truck].map((point, index) => (
              <WaitingBadge key={index} at={{ x: point.x + R * 0.78, y: point.y - R * 0.78 }} opacity={waiting} spin={frame / 6 + index} />
            ))}
            {lap > 0 && lap < 1 && <LoopLight lap={lap} />}
          </g>
        </svg>
      </AbsoluteFill>

      {/* h1: the invoice Rosa is waiting on */}
      <InvoiceCard
        x={interpolate(frame, [at("h1", 2.2), at("h1", 2.9), at("h2", 0), at("h2", 0.5)], [1950, 1290, 1290, 1960], { ...clamp, easing: ease })}
        opacity={ramp(frame, at("h1", 2.2), at("h1", 2.6)) * (1 - ramp(frame, at("h2", 0.1), at("h2", 0.5)))}
        stamp={pop(at("h1", 3.6), 9)}
      />

      {/* h3: everyone waits */}
      <SideText lines={[
        { text: "Everyone is owed.", at: at("h3", 0.25), color: C.ink },
        { text: "Nobody can pay.", at: at("h3", 1.9), color: C.ink },
        { text: "So everyone waits.", at: at("h3", 3.35), color: C.waiting },
      ]} exit={at("h4", 0)} />

      {/* h4: it's everywhere */}
      <Everywhere start={starts.h4} end={starts.h5} at={(seconds) => at("h4", seconds)} />

      {/* h5: loops cancel */}
      <SideText lines={[
        { text: "Loops cancel.", at: at("h5", 0.3), color: C.teal, size: 92 },
        { text: `−${usd(CLEARED)} on all three invoices`, at: at("h5", 1.9), color: C.ink, size: 44 },
        { text: "No money moves.", at: at("h5", 3.3), color: C.teal, size: 92 },
      ]} exit={at("h6", 0)} />

      {/* h6: the whole street */}
      <MainStreet start={starts.h6} end={starts.h7} at={(seconds) => at("h6", seconds)} />

      {/* h7: the name */}
      <Logo start={starts.h7} />

      {HOOK_LINES.map((id) => (
        <Sequence key={id} from={starts[id]} durationInFrames={lineFrames(id) + 2}>
          <Audio src={staticFile(`voice/${id}.wav`)} playbackRate={VOICE_RATE} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

const WaitingBadge: React.FC<{ at: Pt; opacity: number; spin: number }> = ({ at, opacity, spin }) => (
  <g transform={`translate(${at.x} ${at.y})`} opacity={opacity}>
    <circle r={24} fill={C.bg} stroke={C.waiting} strokeWidth={3} />
    <line x1={0} y1={0} x2={0} y2={-13} stroke={C.waiting} strokeWidth={3} strokeLinecap="round" transform={`rotate(${spin * 30})`} />
    <line x1={0} y1={0} x2={9} y2={0} stroke={C.waiting} strokeWidth={3} strokeLinecap="round" />
  </g>
);

/** A bright dot with a short tail that runs once around the loop. */
const LoopLight: React.FC<{ lap: number }> = ({ lap }) => {
  const lengths = LOOP.map((edge) => getLength(edge.d));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  const pointAt = (share: number): Pt => {
    let distance = Math.max(0, Math.min(1, share)) * total;
    for (const [index, edge] of LOOP.entries()) {
      const length = lengths[index]!;
      if (distance <= length) return getPointAtLength(edge.d, distance) ?? { x: 0, y: 0 };
      distance -= length;
    }
    const last = LOOP[LOOP.length - 1]!;
    return getPointAtLength(last.d, lengths[lengths.length - 1]!) ?? { x: 0, y: 0 };
  };
  return (
    <g style={{ filter: `drop-shadow(0 0 16px ${C.teal})` }}>
      {Array.from({ length: 9 }, (_, index) => {
        const point = pointAt(lap - index * 0.012);
        return <circle key={index} cx={point.x} cy={point.y} r={14 - index * 1.3} fill={index === 0 ? "#ffffff" : C.teal} opacity={1 - index * 0.1} />;
      })}
    </g>
  );
};

const InvoiceCard: React.FC<{ x: number; opacity: number; stamp: number }> = ({ x, opacity, stamp }) => {
  if (opacity <= 0) return null;
  return (
    <div style={{
      position: "absolute", left: x, top: 330, width: 470, padding: "30px 34px", borderRadius: 22, background: C.card, color: "#0f172a",
      opacity, boxShadow: "0 40px 90px rgba(0,0,0,0.55)", fontFamily,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: 3, color: "#475569" }}>INVOICE</span>
        <span style={{ fontSize: 18, fontWeight: 700, color: "#64748b" }}>#RB-1042</span>
      </div>
      <div style={{ marginTop: 22, fontSize: 22, color: "#475569" }}>Ortega Trucking owes</div>
      <div style={{ fontSize: 30, fontWeight: 800 }}>Rosa's Bakery</div>
      <div style={{ marginTop: 6, fontSize: 20, color: "#64748b" }}>Catering for the depot open day</div>
      <div style={{ marginTop: 22, fontSize: 64, fontWeight: 900, letterSpacing: -2 }}>$2,800.00</div>
      <div style={{
        position: "absolute", right: 28, top: 96, padding: "8px 16px", border: "4px solid #e11d48", borderRadius: 10, color: "#e11d48",
        fontSize: 28, fontWeight: 900, letterSpacing: 2, transform: `rotate(-12deg) scale(${0.4 + 0.6 * stamp})`, opacity: stamp,
      }}>OVERDUE</div>
    </div>
  );
};

const SideText: React.FC<{ lines: { text: string; at: number; color: string; size?: number }[]; exit: number }> = ({ lines, exit }) => {
  const frame = useCurrentFrame();
  const out = ramp(frame, exit - 8, exit);
  if (frame < (lines[0]?.at ?? 0) - 2 || out >= 1) return null;
  return (
    <div style={{ position: "absolute", left: 1150, top: 300, width: 700, display: "flex", flexDirection: "column", gap: 18, opacity: 1 - out }}>
      {lines.map((line) => {
        const t = ramp(frame, line.at, line.at + 10);
        return (
          <div key={line.text} style={{
            fontSize: line.size ?? 78, fontWeight: 800, letterSpacing: -2, lineHeight: 1.05, color: line.color,
            opacity: t, transform: `translateY(${(1 - t) * 34}px)`, filter: `blur(${(1 - t) * 8}px)`,
          }}>{line.text}</div>
        );
      })}
    </div>
  );
};

/** h4: the camera pulls back and the same knot appears on every street. */
const Everywhere: React.FC<{ start: number; end: number; at: (seconds: number) => number }> = ({ start, end, at }) => {
  const frame = useCurrentFrame();
  if (frame < start - 2 || frame > end + 24) return null;
  const leave = ramp(frame, end - 4, end + 18);
  const count = Math.round(interpolate(frame, [at(0.25), at(1.8)], [0, 56], { ...clamp, easing: Easing.out(Easing.cubic) }));
  const knots = KNOTS;
  return (
    <AbsoluteFill style={{ opacity: 1 - leave }}>
      <svg width={1920} height={1080} style={{ position: "absolute" }}>
        {knots.map((knot, index) => {
          const appear = ramp(frame, at(0.15) + knot.delay, at(0.15) + knot.delay + 10);
          if (appear <= 0) return null;
          const glow = 0.45 + 0.55 * Math.sin(frame / 7 + index);
          const points = [0, 1, 2].map((corner) => {
            const angle = knot.rotation + (corner * Math.PI * 2) / 3;
            return { x: knot.x + Math.cos(angle) * knot.r, y: knot.y + Math.sin(angle) * knot.r };
          });
          return (
            <g key={index} opacity={appear * 0.85}>
              <polygon points={points.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke={C.owed} strokeOpacity={0.35 + 0.35 * glow} strokeWidth={1.6} />
              {points.map((point, corner) => <circle key={corner} cx={point.x} cy={point.y} r={3.4} fill={corner === 0 ? C.owed : C.waiting} opacity={0.9} />)}
            </g>
          );
        })}
      </svg>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 44% 40% at 50% 50%, rgba(6,10,19,0.94) 35%, rgba(6,10,19,0) 100%)" }} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", textAlign: "center" }}>
        <div style={{ fontSize: 250, fontWeight: 900, letterSpacing: -10, lineHeight: 0.9, color: C.ink, opacity: ramp(frame, at(0.1), at(0.4)) }}>
          {count}<span style={{ color: C.owed }}>%</span>
        </div>
        <div style={{ marginTop: 26, fontSize: 46, fontWeight: 600, color: C.ink, opacity: ramp(frame, at(0.9), at(1.3)) }}>
          of U.S. small businesses are owed money right now
        </div>
        <div style={{ marginTop: 26, fontSize: 58, fontWeight: 800, color: C.waiting, opacity: ramp(frame, at(4.25), at(4.6)), transform: `scale(${0.9 + 0.1 * ramp(frame, at(4.25), at(4.6))})` }}>
          about $17,500 each
        </div>
      </AbsoluteFill>
      <div style={{ position: "absolute", left: 80, bottom: 56, fontSize: 22, color: C.muted, opacity: ramp(frame, at(1), at(1.4)) }}>
        Source: Intuit QuickBooks, 2025 Small Business Late Payments Report
      </div>
    </AbsoluteFill>
  );
};

// Little knots scattered across the frame, appearing in a wave from the centre.
const KNOTS = (() => {
  let seed = 7;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const knots: { x: number; y: number; r: number; rotation: number; delay: number }[] = [];
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 16; col++) {
      const x = 60 + col * 120 + (random() - 0.5) * 70;
      const y = 60 + row * 120 + (random() - 0.5) * 70;
      const distance = Math.hypot(x - 960, y - 540);
      knots.push({ x, y, r: 12 + random() * 12, rotation: random() * Math.PI * 2, delay: Math.round(distance / 45) });
    }
  }
  return knots;
})();

/** h6: the real Main Street: 25 invoices, loops clear, three PayPal payments settle the rest. */
const MainStreet: React.FC<{ start: number; end: number; at: (seconds: number) => number }> = ({ start, end, at }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < start - 2 || frame > end + 30) return null;
  const leave = ramp(frame, end - 2, end + 20);
  const center = { x: 700, y: 560 };
  const radius = 330;
  const nodes = new Map(street.businesses.map((business, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / street.businesses.length;
    return [business.id, { ...business, at: { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) } }];
  }));
  const node = (id: string) => nodes.get(id)!;
  const enter = ramp(frame, at(0), at(0.5));
  const clearStart = at(2.0);
  const transfersStart = at(4.5);
  const owed = Math.round(interpolate(frame, [at(0.2), at(1.6)], [0, street.stats.totalOwed], clamp));
  const cleared = Math.round(interpolate(frame, [clearStart, clearStart + 42], [0, street.stats.clearedByLoops], clamp));
  const moved = Math.round(interpolate(frame, [transfersStart, transfersStart + 36], [0, street.stats.moneyMoved], clamp));
  const leverage = spring({ frame: frame - at(6.1), fps, config: { damping: 11, stiffness: 150 } });
  return (
    <AbsoluteFill style={{ opacity: enter * (1 - leave) }}>
      <svg width={1920} height={1080} style={{ position: "absolute" }}>
        {street.invoices.map((invoice, index) => {
          const from = node(invoice.debtor).at;
          const to = node(invoice.creditor).at;
          const { d } = arrowPath(from, to, 40, 40, 0.12);
          const drawn = ramp(frame, at(0.15 + index * 0.045), at(0.55 + index * 0.045));
          const clearAt = clearStart + Math.round((index / street.invoices.length) * 40);
          const clearing = invoice.cleared > 0 ? ramp(frame, clearAt, clearAt + 10) : 0;
          const fade = invoice.cleared > 0 ? ramp(frame, clearAt + 10, clearAt + 26) : ramp(frame, transfersStart - 6, transfersStart + 10);
          return <Arrow key={invoice.id} d={d} progress={drawn} color={clearing > 0 ? C.teal : "#94a3b8"} width={2.6}
            opacity={mix(0.75, 0.08, fade)} glow={clearing * (1 - fade) * 16} />;
        })}
        {street.transfers.map((transfer, index) => {
          const { d } = arrowPath(node(transfer.payer).at, node(transfer.payee).at, 40, 40, -0.22);
          const mid = getPointAtLength(d, getLength(d) * ([0.6, 0.38, 0.66][index] ?? 0.5)) ?? { x: 0, y: 0 };
          const drawn = ramp(frame, transfersStart + index * 10, transfersStart + index * 10 + 16);
          return (
            <g key={`${transfer.payer}-${transfer.payee}`}>
              <Arrow d={d} progress={drawn} color={C.paypalBright} width={8} glow={14} />
              <Pill at={mid} text={usd(transfer.amount)} color="#ffffff" fill={C.paypal} size={26} opacity={ramp(frame, transfersStart + index * 10 + 12, transfersStart + index * 10 + 18)} />
            </g>
          );
        })}
        {[...nodes.values()].map((business, index) => (
          <ShopNode key={business.id} at={business.at} r={38} color={SHOP_COLORS[business.id] ?? C.teal} name={business.name}
            scale={spring({ frame: frame - (start + index * 2), fps, config: { damping: 14 } })} labelSize={19} />
        ))}
      </svg>
      <div style={{ position: "absolute", left: 1210, top: 250, width: 640, display: "flex", flexDirection: "column", gap: 34 }}>
        <Stat label="owed on Main Street, across 25 invoices" value={usd(owed)} color={C.ink} opacity={ramp(frame, at(0.1), at(0.4))} />
        <Stat label="cancelled in loops. No money moved." value={usd(cleared)} color={C.teal} opacity={ramp(frame, clearStart - 4, clearStart + 6)} />
        <Stat label="moved through PayPal, in 3 payments" value={usd(moved)} color={C.paypalBright} opacity={ramp(frame, transfersStart - 4, transfersStart + 6)} />
      </div>
      <div style={{
        position: "absolute", left: 1210, top: 790, display: "flex", alignItems: "baseline", gap: 20, opacity: Math.min(1, leverage),
        transform: `scale(${0.7 + 0.3 * leverage})`, transformOrigin: "left center",
      }}>
        <span style={{ fontSize: 132, fontWeight: 900, letterSpacing: -5, color: C.ink }}>12.8×</span>
        <span style={{ fontSize: 30, fontWeight: 600, color: C.soft, maxWidth: 260, lineHeight: 1.2 }}>settled for every dollar moved</span>
      </div>
    </AbsoluteFill>
  );
};

const Stat: React.FC<{ label: string; value: string; color: string; opacity: number }> = ({ label, value, color, opacity }) => (
  <div style={{ opacity, transform: `translateX(${(1 - opacity) * 30}px)` }}>
    <div style={{ fontSize: 84, fontWeight: 900, letterSpacing: -3, lineHeight: 1, color, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    <div style={{ marginTop: 8, fontSize: 28, fontWeight: 600, color: C.soft }}>{label}</div>
  </div>
);

/** h7: three dots that owed each other in a circle straighten into a line, and the name lands. */
const Logo: React.FC<{ start: number }> = ({ start }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < start - 10) return null;
  const appear = ramp(frame, start - 10, start + 6);
  const straighten = ramp(frame, start + 4, start + 26, Easing.bezier(0.65, 0, 0.35, 1));
  const word = spring({ frame: frame - (start + 12), fps, config: { damping: 15, stiffness: 120 } });
  const sweep = interpolate(frame, [start + 22, start + 52], [-30, 130], clamp);
  const triangle = [{ x: 0, y: -46 }, { x: 40, y: 23 }, { x: -40, y: 23 }];
  const line = [{ x: -70, y: 0 }, { x: 0, y: 0 }, { x: 70, y: 0 }];
  const dots = triangle.map((point, index) => ({ x: mix(point.x, line[index]!.x, straighten), y: mix(point.y, line[index]!.y, straighten) }));
  const colors = [SHOP_COLORS.b1!, SHOP_COLORS.b2!, SHOP_COLORS.b3!];
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: appear }}>
      <svg width={260} height={140} viewBox="-130 -70 260 140" style={{ marginBottom: 30 }}>
        <polygon points={dots.map((dot) => `${dot.x},${dot.y}`).join(" ")} fill="none" stroke={C.teal} strokeWidth={6} strokeLinejoin="round" opacity={1 - straighten * 0.2} />
        {dots.map((dot, index) => <circle key={index} cx={dot.x} cy={dot.y} r={15} fill={C.bg} stroke={colors[index]} strokeWidth={6} />)}
      </svg>
      <div style={{
        fontSize: 168, fontWeight: 900, letterSpacing: -7, lineHeight: 1.18, paddingBottom: 8, color: C.ink, opacity: Math.min(1, word), transform: `translateY(${(1 - word) * 40}px)`,
        backgroundImage: `linear-gradient(100deg, ${C.ink} ${sweep - 20}%, ${C.teal} ${sweep}%, ${C.ink} ${sweep + 20}%)`, WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent",
      }}>Untangle</div>
      <div style={{ marginTop: 22, fontSize: 40, fontWeight: 600, color: C.soft, opacity: ramp(frame, start + 24, start + 36) }}>
        AI clearing for small businesses, on <span style={{ color: C.paypalBright }}>PayPal</span>
      </div>
    </AbsoluteFill>
  );
};
