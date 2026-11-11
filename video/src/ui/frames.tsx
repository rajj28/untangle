import type React from "react";
import { Easing, interpolate, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { C, fontFamily, LIVE_URL, monoFamily } from "../theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Camera keyframes over a clip: at frame `f`, show the region centred on (x, y) (0..1) at zoom `z`. */
export interface Shot { f: number; x: number; y: number; z: number }

function camera(frame: number, shots: Shot[]): { x: number; y: number; z: number } {
  if (shots.length === 0) return { x: 0.5, y: 0.5, z: 1 };
  const frames = shots.map((shot) => shot.f);
  const ease = Easing.bezier(0.65, 0, 0.35, 1);
  const pick = (key: "x" | "y" | "z") => (shots.length === 1 ? shots[0]![key] : interpolate(frame, frames, shots.map((shot) => shot[key]), { ...clamp, easing: ease }));
  return { x: pick("x"), y: pick("y"), z: pick("z") };
}

/** Moves and zooms a full-size layer so the camera's point sits in the middle of the frame. */
const CameraLayer: React.FC<{ shots: Shot[]; width: number; height: number; children: React.ReactNode }> = ({ shots, width, height, children }) => {
  const frame = useCurrentFrame();
  const { x, y, z } = camera(frame, shots);
  const tx = Math.min(0, Math.max(width - width * z, width / 2 - x * width * z));
  const ty = Math.min(0, Math.max(height - height * z, height / 2 - y * height * z));
  return <div style={{ position: "absolute", left: 0, top: 0, width, height, transformOrigin: "0 0", transform: `translate(${tx}px, ${ty}px) scale(${z})` }}>{children}</div>;
};

export const BrowserFrame: React.FC<{
  src: string; startFrom?: number; playbackRate?: number; shots?: Shot[]; url?: string;
  width?: number; x?: number; y?: number; tilt?: number; opacity?: number; scale?: number;
}> = ({ src, startFrom = 0, playbackRate = 1, shots = [], url = LIVE_URL, width = 1600, x = 160, y = 70, tilt = 0, opacity = 1, scale = 1 }) => {
  const height = Math.round((width * 1080) / 1920);
  const bar = 44;
  return (
    <div style={{
      position: "absolute", left: x, top: y, width, height: height + bar, borderRadius: 18, overflow: "hidden", background: "#0b1220", opacity,
      boxShadow: "0 50px 120px rgba(0,0,0,0.65), 0 0 0 1px rgba(148,163,184,0.18)", transform: `perspective(2200px) rotateX(${tilt}deg) scale(${scale})`, transformOrigin: "50% 40%",
    }}>
      <div style={{ height: bar, display: "flex", alignItems: "center", gap: 9, padding: "0 18px", background: "#111827", borderBottom: "1px solid rgba(148,163,184,0.15)" }}>
        {["#f87171", "#fbbf24", "#34d399"].map((color) => <span key={color} style={{ width: 13, height: 13, borderRadius: 7, background: color }} />)}
        <div style={{ marginLeft: 18, flex: 1, height: 26, borderRadius: 8, background: "#0b1220", color: C.soft, fontFamily: monoFamily, fontSize: 15, display: "flex", alignItems: "center", padding: "0 14px" }}>{url}</div>
      </div>
      <div style={{ position: "relative", width, height, overflow: "hidden" }}>
        <CameraLayer shots={shots} width={width} height={height}>
          <OffthreadVideo src={staticFile(src)} trimBefore={startFrom} playbackRate={playbackRate} muted style={{ width, height }} />
        </CameraLayer>
      </div>
    </div>
  );
};

export const PhoneFrame: React.FC<{
  src: string; startFrom?: number; playbackRate?: number; shots?: Shot[]; height?: number; x: number; y?: number; opacity?: number; rotate?: number;
}> = ({ src, startFrom = 0, playbackRate = 1, shots = [], height = 900, x, y = 90, opacity = 1, rotate = 0 }) => {
  const screenH = height - 36;
  const screenW = Math.round((screenH * 390) / 844);
  return (
    <div style={{
      position: "absolute", left: x, top: y, width: screenW + 36, height, borderRadius: 64, background: "#05070c", padding: 18, opacity,
      boxShadow: "0 50px 120px rgba(0,0,0,0.7), inset 0 0 0 2px rgba(148,163,184,0.25)", transform: `rotate(${rotate}deg)`,
    }}>
      <div style={{ position: "relative", width: screenW, height: screenH, borderRadius: 48, overflow: "hidden", background: "#fff" }}>
        <CameraLayer shots={shots} width={screenW} height={screenH}>
          <OffthreadVideo src={staticFile(src)} trimBefore={startFrom} playbackRate={playbackRate} muted style={{ width: screenW, height: screenH }} />
        </CameraLayer>
        <div style={{ position: "absolute", top: 12, left: "50%", width: 120, height: 32, marginLeft: -60, borderRadius: 18, background: "#05070c" }} />
      </div>
    </div>
  );
};

/** "01 / Drop in any proof" */
export const SectionTitle: React.FC<{ index: string; title: string; subtitle?: string; duration: number }> = ({ index, title, subtitle, duration }) => {
  const frame = useCurrentFrame();
  const enter = interpolate(frame, [0, 12], [0, 1], { ...clamp, easing: Easing.bezier(0.22, 1, 0.36, 1) });
  const exit = interpolate(frame, [duration - 10, duration], [0, 1], clamp);
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily, opacity: 1 - exit }}>
      <div style={{ fontFamily: monoFamily, fontSize: 30, fontWeight: 700, color: C.teal, letterSpacing: 6, opacity: enter }}>{index}</div>
      <div style={{ marginTop: 14, fontSize: 112, fontWeight: 900, letterSpacing: -4, color: C.ink, transform: `translateY(${(1 - enter) * 40}px)`, opacity: enter }}>{title}</div>
      {subtitle && <div style={{ marginTop: 16, fontSize: 38, fontWeight: 600, color: C.soft, opacity: interpolate(frame, [6, 18], [0, 1], clamp) }}>{subtitle}</div>}
    </div>
  );
};

/** A label that pops in at `from` and leaves at `to`, e.g. a PayPal Agent Toolkit call. */
export const Callout: React.FC<{ text: string; x: number; y: number; from: number; to: number; tone?: "paypal" | "teal" | "amber" | "ink"; mono?: boolean; size?: number }> = ({
  text, x, y, from, to, tone = "teal", mono = false, size = 30,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < from || frame > to + 8) return null;
  const t = interpolate(frame, [from, from + 8], [0, 1], { ...clamp, easing: Easing.bezier(0.34, 1.56, 0.64, 1) });
  const out = interpolate(frame, [to, to + 8], [0, 1], clamp);
  const colors = { paypal: [C.paypal, "#ffffff"], teal: [C.tealDeep, "#ffffff"], amber: ["#b45309", "#ffffff"], ink: ["#0f172a", "#ffffff"] }[tone];
  void fps;
  return (
    <div style={{
      position: "absolute", left: x, top: y, padding: "12px 22px", borderRadius: 14, background: colors[0], color: colors[1],
      fontFamily: mono ? monoFamily : fontFamily, fontSize: size, fontWeight: 700, boxShadow: "0 18px 40px rgba(0,0,0,0.45)",
      opacity: t * (1 - out), transform: `scale(${0.8 + 0.2 * t}) translateY(${(1 - t) * 14}px)`, transformOrigin: "left center", whiteSpace: "nowrap",
    }}>{text}</div>
  );
};

export const SpeedBadge: React.FC<{ speed: number; from?: number; to?: number }> = ({ speed, from = 0, to = Infinity }) => {
  const frame = useCurrentFrame();
  if (frame < from || frame > to) return null;
  return (
    <div style={{
      position: "absolute", right: 70, top: 38, padding: "8px 16px", borderRadius: 10, background: "rgba(15,23,42,0.85)", color: C.waiting,
      fontFamily: monoFamily, fontSize: 24, fontWeight: 700, border: "1px solid rgba(245,158,11,0.4)",
    }}>▶▶ {speed}× speed</div>
  );
};

/** Narration captions, so the video also works muted. */
export const Caption: React.FC<{ text: string }> = ({ text }) => (
  <div style={{ position: "absolute", left: 0, right: 0, bottom: 34, display: "flex", justifyContent: "center", fontFamily }}>
    <div style={{ maxWidth: 1500, padding: "12px 26px", borderRadius: 14, background: "rgba(2,6,23,0.78)", color: "#f1f5f9", fontSize: 32, fontWeight: 600, lineHeight: 1.3, textAlign: "center" }}>{text}</div>
  </div>
);
