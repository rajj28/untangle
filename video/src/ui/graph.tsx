import { evolvePath, getLength, getPointAtLength } from "@remotion/paths";
import type React from "react";
import { C, fontFamily, initials } from "../theme";

export interface Pt { x: number; y: number }

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/** A quadratic arrow from one circle to another, bowed by `bend` (share of its length, right of travel). */
export function arrowPath(from: Pt, to: Pt, fromR: number, toR: number, bend: number): { d: string; mid: Pt } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const control = { x: (from.x + to.x) / 2 - (dy / length) * length * bend, y: (from.y + to.y) / 2 + (dx / length) * length * bend };
  const trim = (point: Pt, toward: Pt, by: number): Pt => {
    const tx = toward.x - point.x;
    const ty = toward.y - point.y;
    const distance = Math.hypot(tx, ty) || 1;
    return { x: point.x + (tx / distance) * by, y: point.y + (ty / distance) * by };
  };
  const start = trim(from, control, fromR + 8);
  const end = trim(to, control, toR + 14);
  const mid = { x: 0.25 * start.x + 0.5 * control.x + 0.25 * end.x, y: 0.25 * start.y + 0.5 * control.y + 0.25 * end.y };
  return { d: `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`, mid };
}

/** An arrow that draws itself as `progress` goes 0 → 1, with its head riding the tip. */
export const Arrow: React.FC<{
  d: string; progress: number; color: string; width?: number; opacity?: number; glow?: number; dash?: string; dashOffset?: number;
}> = ({ d, progress, color, width = 4, opacity = 1, glow = 0, dash, dashOffset = 0 }) => {
  const p = clamp01(progress);
  if (p <= 0) return null;
  const { strokeDasharray, strokeDashoffset } = evolvePath(p, d);
  const length = getLength(d);
  const tip = getPointAtLength(d, length * p) ?? { x: 0, y: 0 };
  const back = getPointAtLength(d, Math.max(0, length * p - 1)) ?? tip;
  const angle = (Math.atan2(tip.y - back.y, tip.x - back.x) * 180) / Math.PI;
  const head = width * 3.4;
  return (
    <g opacity={opacity} style={glow > 0 ? { filter: `drop-shadow(0 0 ${glow}px ${color})` } : undefined}>
      <path d={d} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round"
        strokeDasharray={dash ?? strokeDasharray} strokeDashoffset={dash ? dashOffset : strokeDashoffset} />
      <path d={`M 0 0 L ${-head} ${-head * 0.55} L ${-head * 0.72} 0 L ${-head} ${head * 0.55} Z`} fill={color}
        transform={`translate(${tip.x} ${tip.y}) rotate(${angle})`} />
    </g>
  );
};

/** A rounded amount label. */
export const Pill: React.FC<{ at: Pt; text: string; color: string; fill?: string; size?: number; opacity?: number; scale?: number; strike?: boolean }> = ({
  at, text, color, fill = "rgba(6,10,19,0.92)", size = 30, opacity = 1, scale = 1, strike = false,
}) => {
  if (opacity <= 0) return null;
  const width = text.length * size * 0.6 + size * 1.1;
  const height = size * 1.6;
  return (
    <g opacity={opacity} transform={`translate(${at.x} ${at.y}) scale(${scale})`}>
      <rect x={-width / 2} y={-height / 2} width={width} height={height} rx={height / 2} fill={fill} stroke={color} strokeWidth={2} />
      <text y={size * 0.36} textAnchor="middle" fontFamily={fontFamily} fontWeight={800} fontSize={size} fill={color}
        textDecoration={strike ? "line-through" : undefined} style={{ fontVariantNumeric: "tabular-nums" }}>{text}</text>
    </g>
  );
};

/** A business: ringed circle with initials, name underneath. */
export const ShopNode: React.FC<{
  at: Pt; r: number; color: string; name: string; scale?: number; labelSize?: number; glow?: number; label?: "below" | "above" | "none"; dim?: number;
  /** Moves the name smoothly from below (0) to above (1) the circle. */
  labelFlip?: number;
}> = ({ at, r, color, name, scale = 1, labelSize, glow = 0, label = "below", dim = 1, labelFlip }) => {
  if (scale <= 0) return null;
  const size = labelSize ?? Math.max(16, r * 0.42);
  return (
    <g transform={`translate(${at.x} ${at.y}) scale(${scale})`} opacity={dim}>
      {glow > 0 && <circle r={r * 1.5} fill={color} opacity={0.18 * glow} style={{ filter: `blur(${r * 0.5}px)` }} />}
      <circle r={r} fill={C.bg} stroke={color} strokeWidth={Math.max(3, r * 0.08)} />
      <text y={r * 0.17} textAnchor="middle" fontFamily={fontFamily} fontWeight={800} fontSize={r * 0.56} fill={color}>{initials(name)}</text>
      {label !== "none" && (
        <text y={labelFlip !== undefined ? (r + size * 1.35) + (-r - size * 0.75 - (r + size * 1.35)) * labelFlip : label === "below" ? r + size * 1.35 : -r - size * 0.75} textAnchor="middle" fontFamily={fontFamily} fontWeight={600} fontSize={size} fill={C.ink}>{name}</text>
      )}
    </g>
  );
};
