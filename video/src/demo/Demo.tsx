import type React from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Freeze,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
} from "remotion";
import voice from "../../voice/manifest.json";
import { Backdrop } from "../ui/Backdrop";
import { BrowserFrame, Caption, SpeedBadge } from "../ui/frames";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.bezier(0.22, 1, 0.36, 1);

interface DemoSeg {
  clip: string;
  start: number; // source start, seconds
  end: number; // source end, seconds
  playbackRate: number;
  id: keyof typeof voice;
  caption: string;
  speed?: number;
}

const SEGS: DemoSeg[] = [
  { clip: "landing-hero", start: 0, end: 8.4, playbackRate: 1, id: "d1", caption: "Untangle: AI debt clearing on PayPal" },
  { clip: "playground-street", start: 0, end: 9.5, playbackRate: 1, id: "d2", caption: "Loops cancel. No money moves." },
  { clip: "playground-city", start: 0, end: 9.2, playbackRate: 1, id: "d3", caption: "10,000 businesses, 60,000 invoices, ~1 s" },
  { clip: "desk-ledger", start: 0, end: 13.6, playbackRate: 1, id: "d4", caption: "25 real PayPal sandbox invoices, $28,100 owed" },
  { clip: "cycle-1", start: 0, end: 170, playbackRate: 8, id: "d5", caption: "AI agents read PayPal invoices", speed: 8 },
  { clip: "setoffs", start: 0, end: 300, playbackRate: 25, id: "d6", caption: "22 set-offs recorded on PayPal invoices", speed: 25 },
  { clip: "cycle-2", start: 0, end: 100, playbackRate: 5, id: "d7", caption: "Treasurer agents sign under owner policy", speed: 5 },
  { clip: "owner-sign", start: 0, end: 10.1, playbackRate: 1, id: "d8", caption: "Owner signs. 3 PayPal payments settle the rest." },
];

/** Clip visible length, frames. */
const clipFrames = (s: DemoSeg) => Math.round(((s.end - s.start) / s.playbackRate) * 30);

/** Narration length + 20 frame hold, frames. */
const narrFrames = (s: DemoSeg) => Math.ceil(voice[s.id].seconds * 30) + 20;

/** A scene plays the clip, freezing on its last frame if narration is longer. */
const sceneFrames = (s: DemoSeg) => Math.max(clipFrames(s), narrFrames(s));

export function demoTimeline() {
  const starts = {} as Record<string, number>;
  let frame = 0;
  for (const s of SEGS) {
    starts[s.id as string] = frame;
    frame += sceneFrames(s);
  }
  return { starts, total: frame };
}

const Scene: React.FC<{ seg: DemoSeg }> = ({ seg }) => {
  const frame = useCurrentFrame();
  const clipLen = clipFrames(seg);
  const len = sceneFrames(seg);
  // Fade each scene in over 10 frames.
  const opacity = interpolate(frame, [0, 10], [0, 1], { ...clamp, easing: ease });
  return (
    <AbsoluteFill>
      <Backdrop />
      <div style={{ position: "absolute", inset: 0, opacity }}>
        <BrowserFrame
          src={`clips/${seg.clip}.mp4`}
          startFrom={seg.start * 30}
          playbackRate={seg.playbackRate}
          width={1600}
        />
      </div>
      {/* If narration outlasts the clip, freeze on the clip's last frame. */}
      <Sequence durationInFrames={clipLen}>
        <BrowserFrame src={`clips/${seg.clip}.mp4`} startFrom={seg.start * 30} playbackRate={seg.playbackRate} width={1600} />
      </Sequence>
      {len > clipLen && (
        <Sequence from={clipLen} durationInFrames={len - clipLen}>
          <Freeze frame={clipLen - 1}>
            <BrowserFrame src={`clips/${seg.clip}.mp4`} startFrom={seg.start * 30} playbackRate={seg.playbackRate} width={1600} />
          </Freeze>
        </Sequence>
      )}
      <Audio src={staticFile(`voice/${seg.id}.wav`)} startFrom={8} />
      <Caption text={seg.caption} />
      {seg.speed !== undefined && <SpeedBadge speed={seg.speed} />}
    </AbsoluteFill>
  );
};

export const Demo: React.FC = () => {
  const { starts } = demoTimeline();
  return (
    <AbsoluteFill>
      {SEGS.map((s) => (
        <Sequence key={s.id} from={starts[s.id as string]} durationInFrames={sceneFrames(s)}>
          <Scene seg={s} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
