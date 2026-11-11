import type React from "react";
import { AbsoluteFill, Audio, Easing, interpolate, Sequence, staticFile, useCurrentFrame } from "remotion";
import { hasVoice, layLines, VOICE_RATE } from "../program/timing";
import { Backdrop } from "../ui/Backdrop";
import { C, fontFamily, LIVE_URL, monoFamily } from "../theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.bezier(0.22, 1, 0.36, 1);

/** d9 = the stats, then d10 with the brand, then o1 "Built on PayPal and AG Grid." */
const layout = () => layLines(["d9", "d10", "o1"], 8, 18, 55);
export const outroDuration = () => layout().total;
export const outroWindows = () => layout().windows;

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
  const { starts } = layout();
  const brandAt = starts[1]!;
  const builtAt = starts[2]!;
  const builtIn = interpolate(frame, [builtAt - 6, builtAt + 10], [0, 1], { ...clamp, easing: ease });
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
        <div style={{ display: "flex", alignItems: "center", gap: 26, marginTop: 70, opacity: builtIn, transform: `translateY(${(1 - builtIn) * 20}px)` }}>
          <span style={{ fontFamily, fontSize: 30, fontWeight: 600, color: C.soft }}>Built on</span>
          <span style={{ fontFamily, fontSize: 40, fontWeight: 800, color: "#ffffff", padding: "10px 26px", borderRadius: 14, background: "#0070E0" }}>PayPal</span>
          <span style={{ fontFamily, fontSize: 30, fontWeight: 600, color: C.soft }}>and</span>
          <span style={{ fontFamily, fontSize: 40, fontWeight: 800, color: "#ffffff", padding: "10px 26px", borderRadius: 14, background: "#1f2937", border: "1px solid rgba(148,163,184,0.35)" }}>AG Grid</span>
        </div>
        <div style={{ fontFamily: monoFamily, fontSize: 34, color: C.ink, marginTop: 46, opacity: builtIn }}>{LIVE_URL}</div>
      </AbsoluteFill>
      {["d9", "d10", "o1"].filter(hasVoice).map((id) => (
        <Sequence key={id} from={starts[["d9", "d10", "o1"].indexOf(id)]!} layout="none"><Audio src={staticFile(`voice/${id}.wav`)} playbackRate={VOICE_RATE} /></Sequence>
      ))}
    </AbsoluteFill>
  );
};
