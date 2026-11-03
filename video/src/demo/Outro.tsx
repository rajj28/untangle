import type React from "react";
import { AbsoluteFill, Audio, Easing, interpolate, staticFile, useCurrentFrame } from "remotion";
import voice from "../../voice/manifest.json";
import { Backdrop } from "../ui/Backdrop";
import { C, fontFamily } from "../theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.bezier(0.22, 1, 0.36, 1);

const D9 = voice.d9.seconds;
const D10 = voice.d10.seconds;

/** d9 narration frames + d10 narration frames + 70 frame hold. */
export function outroDuration() {
  return Math.round(D9 * 30) + Math.round(D10 * 30) + 70;
}

const Stat: React.FC<{ from: number; target: number; fmt: (n: number) => string; label: string }> = ({
  from,
  target,
  fmt,
  label,
}) => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [from, from + 55], [0, 1], { ...clamp, easing: ease });
  const appear = interpolate(frame, [from, from + 12], [0, 1], { ...clamp, easing: ease });
  return (
    <div style={{ opacity: appear, transform: `translateY(${(1 - appear) * 36}px)`, textAlign: "center" }}>
      <div style={{ fontFamily, fontWeight: 900, fontSize: 150, letterSpacing: -4, lineHeight: 1, color: C.ink }}>
        {fmt(target * t)}
      </div>
      <div style={{ fontFamily, fontSize: 36, fontWeight: 600, color: C.soft, marginTop: 14 }}>{label}</div>
    </div>
  );
};

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const brandAt = Math.round(D9 * 30) + 20;
  const brandIn = interpolate(frame, [brandAt - 10, brandAt + 8], [0, 1], { ...clamp, easing: ease });
  return (
    <AbsoluteFill>
      <Backdrop />
      <AbsoluteFill style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 52, opacity: 1 - brandIn }}>
        <Stat from={8} target={28100} fmt={(n) => `$${Math.round(n).toLocaleString("en-US")}`} label="debt settled" />
        <Stat from={78} target={2200} fmt={(n) => `$${Math.round(n).toLocaleString("en-US")}`} label="moved through PayPal" />
        <Stat from={148} target={12.8} fmt={(n) => `${n.toFixed(1)}x`} label="leverage" />
      </AbsoluteFill>
      <AbsoluteFill style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", opacity: brandIn }}>
        <div style={{ fontFamily, fontWeight: 900, fontSize: 200, letterSpacing: -6, lineHeight: 1, color: C.ink }}>Untangle</div>
        <div style={{ fontFamily, fontSize: 52, fontWeight: 600, color: C.teal, marginTop: 18 }}>Clear the loop. Pay only the rest.</div>
      </AbsoluteFill>
      <Audio src={staticFile("voice/d9.wav")} startFrom={8} />
      <Audio src={staticFile("voice/d10.wav")} startFrom={brandAt} />
    </AbsoluteFill>
  );
};
