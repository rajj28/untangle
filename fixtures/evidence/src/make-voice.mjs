// Generates the Spanish voice-note sample with Gemini text-to-speech (24 kHz mono PCM, wrapped as WAV).
import { writeFileSync } from "node:fs";
const script = "Hola Marco, ¿qué tal? Soy Carlos, de Ortega Trucking. Oye, te llamo por lo del flete de la harina de noviembre, ¿eh? Son quinientos veinte dólares en total. Si puedes, págalo antes del quince de diciembre, que ya tenemos que cubrir el diésel. Bueno, cualquier cosa me llamas. ¡Gracias, hombre! Hasta luego.";
const models = ["gemini-3.8-flash-lite-tts", "gemini-3.8-flash-tts", "gemini-2.5-flash-preview-tts"];
for (const model of models) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST", headers: { "x-goog-api-key": process.env.GEMINI_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: `Read this as a relaxed, friendly voicemail from a small trucking company owner, in natural Mexican Spanish: ${script}` }] }],
      generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } } } }),
  });
  const json = await res.json();
  const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!res.ok || !part) { console.log(model, res.status, JSON.stringify(json.error?.message ?? "no audio").slice(0, 160)); continue; }
  const pcm = Buffer.from(part.inlineData.data, "base64");
  const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType)?.[1] ?? 24000);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVE", 8); header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  writeFileSync("fixtures/evidence/files/voice-note-ortega.wav", Buffer.concat([header, pcm]));
  console.log(`${model}: wrote ${(pcm.length / rate / 2).toFixed(1)} s of audio (${part.inlineData.mimeType})`);
  break;
}
