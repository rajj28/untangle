import type React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { C } from "../theme";

/** Deep navy with two slow-drifting glows and a faint dot grid. */
export const Backdrop: React.FC<{ tint?: number }> = ({ tint = 1 }) => {
  const frame = useCurrentFrame();
  const a = frame / 240;
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <AbsoluteFill style={{
        opacity: 0.9 * tint,
        background: `radial-gradient(ellipse 55% 50% at ${32 + Math.sin(a) * 6}% ${40 + Math.cos(a * 0.8) * 6}%, rgba(15,118,110,0.32), transparent 70%),
          radial-gradient(ellipse 50% 45% at ${72 + Math.cos(a * 0.7) * 6}% ${60 + Math.sin(a * 0.9) * 5}%, rgba(0,112,224,0.22), transparent 70%)`,
      }} />
      <AbsoluteFill style={{
        opacity: 0.35,
        backgroundImage: "radial-gradient(rgba(148,163,184,0.22) 1.2px, transparent 1.2px)",
        backgroundSize: "36px 36px",
        backgroundPosition: `${(frame * 0.15) % 36}px ${(frame * 0.08) % 36}px`,
        maskImage: "radial-gradient(ellipse 75% 70% at 50% 50%, black 30%, transparent 85%)",
      }} />
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 90% 85% at 50% 50%, transparent 55%, rgba(0,0,0,0.55) 100%)" }} />
    </AbsoluteFill>
  );
};
