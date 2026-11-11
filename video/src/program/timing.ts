import clipData from "../data/clips.json";
import voiceData from "../data/voice.json";
import { FPS } from "../theme";

export type Cut = "long" | "short";
interface Line { text: string; seconds: number }

const VOICE = voiceData as Record<string, Line>;
const CLIPS = clipData as Record<string, number>;

/** Narration plays a little faster than Gemini's slow Charon read (pitch is kept). */
export const VOICE_RATE = 1.18;

/** True when public/voice/<id>.wav exists (probe.mjs). */
export const hasVoice = (id: string) => id in VOICE;
/** Narration length in frames; a line not generated yet is estimated from its text so previews still work. */
export function lineFrames(id: string, fallbackText = ""): number {
  const line = VOICE[id];
  const seconds = line ? line.seconds : Math.max(2, fallbackText.length / 15);
  return Math.ceil((seconds * FPS) / VOICE_RATE);
}
export const lineText = (id: string) => VOICE[id]?.text ?? "";

/** Frame (relative to the line's start) where `word` is spoken, approximated by its character position. */
export function cue(id: string, word: string): number {
  const text = lineText(id);
  const at = text.toLowerCase().indexOf(word.toLowerCase());
  if (at < 0) return 0;
  return Math.round((at / Math.max(1, text.length)) * lineFrames(id));
}

/** Source clip length in seconds, or null when the clip has not been recorded yet. */
export const clipSeconds = (clip: string): number | null => CLIPS[clip] ?? null;

/** Sequential narration layout: a lead-in, each line, a gap between lines, and a tail. */
export function layLines(ids: string[], lead: number, gap: number, tail: number) {
  const starts: number[] = [];
  let frame = lead;
  ids.forEach((id, index) => {
    starts.push(frame);
    frame += lineFrames(id) + (index < ids.length - 1 ? gap : 0);
  });
  return { starts, total: frame + tail, windows: ids.map((id, index) => [starts[index]!, starts[index]! + lineFrames(id)] as [number, number]) };
}
