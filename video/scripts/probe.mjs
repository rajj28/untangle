// Measures the real media the compositions use, so timing is never guessed:
//   src/data/clips.json  { clip: seconds }            from public/clips/*.mp4
//   src/data/voice.json  { id: { text, seconds } }    from public/voice/*.wav + voice/lines.json
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const seconds = (path) => Number(Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], { encoding: "utf8" })).toFixed(3));
const list = (dir, ext) => readdirSync(dir).filter((f) => f.endsWith(ext)).sort();

const clips = {};
for (const f of list("public/clips", ".mp4")) clips[f.slice(0, -4)] = seconds(`public/clips/${f}`);
writeFileSync("src/data/clips.json", JSON.stringify(clips, null, 1) + "\n");

const texts = Object.fromEntries(JSON.parse(readFileSync("voice/lines.json", "utf8")).lines.map((l) => [l.id, l.text]));
const voice = {};
for (const f of list("public/voice", ".wav")) { const id = f.slice(0, -4); voice[id] = { text: texts[id] ?? "", seconds: seconds(`public/voice/${f}`) }; }
writeFileSync("src/data/voice.json", JSON.stringify(voice, null, 1) + "\n");
console.log(`clips ${Object.keys(clips).length}, voice ${Object.keys(voice).length}`);
