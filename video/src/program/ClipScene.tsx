import type React from "react";
import { AbsoluteFill, Audio, Easing, Freeze, Img, interpolate, Sequence, staticFile, useCurrentFrame } from "remotion";
import { Backdrop } from "../ui/Backdrop";
import { BrowserFrame, Caption, PhoneFrame, SpeedBadge } from "../ui/frames";
import type { Shot } from "../ui/frames";
import { C, FPS, fontFamily, LIVE_URL, monoFamily } from "../theme";
import { clipSeconds, cue, hasVoice, layLines, lineFrames, VOICE_RATE } from "./timing";
import type { Cut } from "./timing";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.bezier(0.22, 1, 0.36, 1);

/** One recorded clip inside a scene. Times are seconds in the source clip. */
export interface Part {
  clip: string;
  from?: number;
  to?: number;
  /** Never play slower than this (1 = real time). */
  minRate?: number;
  /** Share of the scene's screen time; defaults to the clip's real-time length. */
  weight?: number;
  shots?: Shot[];
  url?: string;
  phone?: boolean;
}

export interface ClipSeg {
  key: string;
  cuts: Cut[];
  lines: string[];
  /** Caption switches when the narration reaches `at` (a word in one of the lines). */
  captions: { text: string; at?: string }[];
  parts: Part[];
  chapter?: string;
  /** Show a QR card for the live app (the judge scene). */
  qr?: boolean;
}

const LEAD = 4;
const GAP = 5;
const TAIL = 5;

const sourceSeconds = (part: Part) => {
  const length = clipSeconds(part.clip) ?? 6;
  return Math.max(0.5, Math.min(part.to ?? length, length) - (part.from ?? 0));
};

/** Lays out narration and fits every clip into the narration's length, speeding clips up rather than leaving dead air. */
export function clipLayout(seg: ClipSeg) {
  const voice = layLines(seg.lines, LEAD, GAP, TAIL);
  const total = voice.total;
  const weights = seg.parts.map((part) => part.weight ?? sourceSeconds(part) / (part.minRate ?? 1));
  const sum = weights.reduce((a, b) => a + b, 0);
  let at = 0;
  const parts = seg.parts.map((part, index) => {
    const slot = index === seg.parts.length - 1 ? total - at : Math.round((total * weights[index]!) / sum);
    const src = sourceSeconds(part) * FPS;
    const rate = Math.max(part.minRate ?? 1, src / slot);
    const playing = Math.min(slot, Math.floor(src / rate));
    const placed = { part, from: at, slot, rate, playing };
    at += slot;
    return placed;
  });
  const captions = seg.captions.map((caption) => {
    if (!caption.at) return { text: caption.text, from: 0 };
    const index = seg.lines.findIndex((id) => cue(id, caption.at!) > 0);
    return { text: caption.text, from: index < 0 ? 0 : voice.starts[index]! + cue(seg.lines[index]!, caption.at) };
  });
  return { total, voice, parts, captions };
}

const Pending: React.FC<{ clip: string }> = ({ clip }) => (
  <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
    <div style={{ padding: "40px 60px", borderRadius: 24, border: `2px dashed ${C.soft}`, color: C.soft, fontFamily: monoFamily, fontSize: 40 }}>
      clip not recorded yet: {clip}
    </div>
  </AbsoluteFill>
);

const Screen: React.FC<{ part: Part; rate: number; left?: boolean }> = ({ part, rate, left }) => {
  const src = `clips/${part.clip}.mp4`;
  const startFrom = Math.round((part.from ?? 0) * FPS);
  if (part.phone) return <PhoneFrame src={src} startFrom={startFrom} playbackRate={rate} shots={part.shots} x={left ? 400 : (1920 - 450) / 2} y={70} height={940} />;
  return <BrowserFrame src={src} startFrom={startFrom} playbackRate={rate} shots={part.shots} url={part.url} width={1600} />;
};

const PartView: React.FC<{ part: Part; rate: number; playing: number; slot: number; left?: boolean }> = ({ part, rate, playing, slot, left }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 8], [0, 1], { ...clamp, easing: ease });
  if (clipSeconds(part.clip) === null) return <Pending clip={part.clip} />;
  return (
    <AbsoluteFill style={{ opacity }}>
      <Sequence durationInFrames={playing} layout="none">
        <Screen part={part} rate={rate} left={left} />
      </Sequence>
      {slot > playing && (
        <Sequence from={playing} durationInFrames={slot - playing} layout="none">
          <Freeze frame={playing - 1}>
            <Screen part={part} rate={rate} left={left} />
          </Freeze>
        </Sequence>
      )}
      {rate > 1.5 && <SpeedBadge speed={Math.round(rate)} />}
    </AbsoluteFill>
  );
};

const QrCard: React.FC = () => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [10, 26], [0, 1], { ...clamp, easing: ease });
  return (
    <div style={{ position: "absolute", left: 1150, top: 230, width: 470, opacity: t, transform: `translateY(${(1 - t) * 24}px)`, textAlign: "center" }}>
      <div style={{ background: "#ffffff", borderRadius: 28, padding: 30, boxShadow: "0 40px 100px rgba(0,0,0,0.6)" }}>
        <Img src={staticFile("qr-live.svg")} style={{ width: 410, height: 410, display: "block" }} />
      </div>
      <div style={{ fontFamily: monoFamily, fontSize: 30, color: C.ink, marginTop: 26 }}>{LIVE_URL}</div>
      <div style={{ fontFamily, fontSize: 26, color: C.soft, marginTop: 8 }}>Live demo · try it on your phone</div>
    </div>
  );
};

const Chapter: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [0, 12], [0, 1], { ...clamp, easing: ease });
  return (
    <div style={{
      position: "absolute", left: 70, top: 34, padding: "8px 18px", borderRadius: 10, background: "rgba(15,23,42,0.85)", color: C.teal,
      fontFamily, fontSize: 24, fontWeight: 800, letterSpacing: 3, textTransform: "uppercase", opacity: t, border: "1px solid rgba(45,212,191,0.35)",
    }}>{text}</div>
  );
};

export const ClipScene: React.FC<{ seg: ClipSeg }> = ({ seg }) => {
  const frame = useCurrentFrame();
  const { total, voice, parts, captions } = clipLayout(seg);
  const caption = [...captions].reverse().find((c) => frame >= c.from) ?? captions[0];
  return (
    <AbsoluteFill>
      <Backdrop />
      {parts.map(({ part, from, slot, rate, playing }, index) => (
        <Sequence key={index} from={from} durationInFrames={slot}>
          <PartView part={part} rate={rate} playing={playing} slot={slot} left={seg.qr} />
        </Sequence>
      ))}
      {seg.lines.filter(hasVoice).map((id) => (
        <Sequence key={id} from={voice.starts[seg.lines.indexOf(id)]!} durationInFrames={lineFrames(id) + 4} layout="none">
          <Audio src={staticFile(`voice/${id}.wav`)} playbackRate={VOICE_RATE} />
        </Sequence>
      ))}
      {seg.chapter && <Chapter text={seg.chapter} />}
      {seg.qr && <QrCard />}
      {caption && frame < total && <Caption text={caption.text} />}
    </AbsoluteFill>
  );
};

export const clipWindows = (seg: ClipSeg) => clipLayout(seg).voice.windows;
