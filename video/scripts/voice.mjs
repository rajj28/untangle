// Narration with Gemini text-to-speech: one WAV per line (24 kHz mono PCM), skipping lines already made,
// plus voice/manifest.json with each line's duration so scenes can be timed to the audio.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const { style, voice, lines } = JSON.parse(readFileSync("voice/lines.json", "utf8"));
const models = ["gemini-3.8-flash-lite-tts", "gemini-3.8-flash-tts"];
const only = process.argv.slice(2);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function wav(pcm, rate) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVE", 8); header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function speak(text) {
  for (let attempt = 0; attempt < 4; attempt++) {
    for (const model of models) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST", headers: { "x-goog-api-key": process.env.GEMINI_API_KEY, "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: style ? `${style} ${text}` : text }] }],
          generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } }),
      });
      const json = await res.json().catch(() => ({}));
      const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
      if (res.ok && part) return { pcm: Buffer.from(part.inlineData.data, "base64"), rate: Number(/rate=(\d+)/.exec(part.inlineData.mimeType)?.[1] ?? 24000), model };
      console.log(`  ${model}: ${res.status} ${String(json.error?.message ?? "no audio").slice(0, 120)}`);
    }
    await sleep(30_000);
  }
  throw new Error(`no audio for: ${text}`);
}

const manifestPath = "voice/manifest.json";
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : {};
for (const line of lines) {
  if (only.length > 0 && !only.includes(line.id)) continue;
  const file = `voice/${line.id}.wav`;
  if (existsSync(file) && manifest[line.id]?.text === line.text) continue;
  const { pcm, rate, model } = await speak(line.text);
  writeFileSync(file, wav(pcm, rate));
  manifest[line.id] = { text: line.text, seconds: Number((pcm.length / rate / 2).toFixed(2)), model };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`${line.id}: ${manifest[line.id].seconds}s (${model})`);
  await sleep(21_000);
}
