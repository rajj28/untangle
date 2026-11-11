// Records the real app for the demo video: headless Chrome over the DevTools protocol, screencast frames
// streamed into ffmpeg as constant-frame-rate MP4. A drawn cursor glides to each click
// target and ripples, because headless Chrome draws no pointer.
//
// Usage: node scripts/record.mjs steps/<session>.json
// Steps: {viewport:[w,h,dpr,mobile]} {goto:url} {gotoJs:"async expr returning url"} {wait:ms} {waitFor:"text", timeout} {click:{text|selector}, moveMs, double}
//        {type:"text"} {key:"Enter"} {scroll:y} {scrollTo:selector} {eval:"js"} {record:"clip"} {stop:true} {shot:"file.png"}
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9335;
const ROOT = resolve("recordings");
const steps = JSON.parse(readFileSync(process.argv[2], "utf8"));
mkdirSync(ROOT, { recursive: true });

const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`, "--disable-gpu", "--no-first-run", "--hide-scrollbars",
  "--force-color-profile=srgb", "--font-render-hinting=none", `--user-data-dir=${resolve("recordings/.chrome")}`, "--window-size=1920,1080", "about:blank",
], { stdio: "ignore" });

const KEYCODE = { Enter: 13, Escape: 27, Tab: 9, Backspace: 8, ArrowDown: 40, ArrowUp: 38 };
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
let target;
for (let i = 0; i < 60 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page"); } catch { await sleep(250); }
}
if (!target) { console.log("chrome did not start"); chrome.kill(); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((done) => ws.addEventListener("open", done, { once: true }));
let nextId = 1;
const pending = new Map();
const problems = [];
let clip = null;
ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === "Page.screencastFrame") {
    send("Page.screencastFrameAck", { sessionId: msg.params.sessionId });
    if (clip) clip.latest = Buffer.from(msg.params.data, "base64");
  }
  if (msg.method === "Runtime.exceptionThrown") problems.push(`EXCEPTION ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`.slice(0, 1500));
  if (msg.method === "Network.responseReceived" && msg.params.response.status >= 400) problems.push(`HTTP ${msg.params.response.status} ${msg.params.response.url}`);
});
const send = (method, params = {}) => new Promise((done) => {
  const id = nextId++;
  pending.set(id, done);
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const res = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (res.result?.exceptionDetails) throw new Error(`eval failed: ${res.result.exceptionDetails.exception?.description ?? res.result.exceptionDetails.text}`);
  return res.result?.result?.value;
};

const CURSOR = `(() => {
  if (window.__moveCursor) return;
  const install = () => {
    if (document.getElementById("__cursor")) return;
    const cursor = document.createElement("div");
    cursor.id = "__cursor";
    cursor.style.cssText = "position:fixed;left:0;top:0;width:30px;height:30px;z-index:2147483647;pointer-events:none;transform:translate(-200px,-200px);filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))";
    cursor.innerHTML = '<svg width="30" height="30" viewBox="0 0 28 28"><path d="M5 3 L5 22 L10 17 L14 26 L17.5 24.5 L13.5 15.8 L20.5 15.8 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    const ripple = document.createElement("div");
    ripple.id = "__ripple";
    ripple.style.cssText = "position:fixed;left:0;top:0;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;background:rgba(0,112,224,.32);border:2px solid rgba(0,112,224,.55);z-index:2147483646;pointer-events:none;opacity:0";
    document.documentElement.append(cursor, ripple);
  };
  window.__cursorAt = window.__cursorAt ?? { x: innerWidth * 0.62, y: innerHeight * 0.72 };
  window.__moveCursor = (x, y, ms) => new Promise((done) => {
    install();
    const cursor = document.getElementById("__cursor");
    const from = { ...window.__cursorAt };
    const start = performance.now();
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const frame = (now) => {
      const t = Math.min(1, (now - start) / ms);
      const e = ease(t);
      const cx = from.x + (x - from.x) * e;
      const cy = from.y + (y - from.y) * e;
      cursor.style.transform = "translate(" + (cx - 5) + "px," + (cy - 3) + "px)";
      window.__cursorAt = { x: cx, y: cy };
      if (t < 1) requestAnimationFrame(frame); else done(true);
    };
    requestAnimationFrame(frame);
  });
  window.__ripple = (x, y) => {
    const ripple = document.getElementById("__ripple");
    ripple.style.left = x + "px";
    ripple.style.top = y + "px";
    ripple.animate([{ opacity: 1, transform: "scale(.25)" }, { opacity: 0, transform: "scale(1.5)" }], { duration: 550, easing: "ease-out" });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install); else install();
})()`;

const FIND = (spec) => `(() => {
  const spec = ${JSON.stringify(spec)};
  let el = null;
  if (spec.selector) el = [...document.querySelectorAll(spec.selector)][spec.nth ?? 0] ?? null;
  else {
    const candidates = [...document.querySelectorAll("button, a, [role=tab], [role=button], [role=radio], label, summary, li, input, select, textarea")]
      .filter((e) => e.offsetParent !== null || e.getClientRects().length > 0);
    const exact = candidates.filter((e) => (e.textContent || e.value || e.placeholder || "").trim() === spec.text);
    const partial = candidates.filter((e) => (e.textContent || e.value || e.placeholder || "").trim().includes(spec.text));
    el = (exact.length ? exact : partial)[spec.nth ?? 0] ?? null;
  }
  if (!el) return null;
  const rect0 = el.getBoundingClientRect();
  const clipped = (() => { for (let p = el.parentElement; p; p = p.parentElement) { const r = p.getBoundingClientRect(); if (p.scrollWidth > p.clientWidth && (rect0.left < r.left || rect0.right > r.right)) return true; } return rect0.left < 0 || rect0.right > innerWidth; })();
  if (rect0.top < 70 || rect0.bottom > innerHeight - 20 || clipped) el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  const rect = el.getBoundingClientRect();
  return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2), label: (el.textContent || el.placeholder || el.tagName).trim().slice(0, 50) };
})()`;

await send("Runtime.enable");
await send("Network.enable");
await send("Page.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: CURSOR });
let viewport = { width: 1440, height: 810, dpr: 4 / 3, mobile: false };
const applyViewport = async () => {
  await send("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: viewport.dpr, mobile: viewport.mobile });
  await send("Emulation.setTouchEmulationEnabled", { enabled: false });
};
await applyViewport();

// Chrome only sends a frame when the page repaints, so a 25 fps clock feeds ffmpeg the latest frame:
// constant frame rate, real-time timing, and nothing written to disk but the MP4.
const FPS = 25;
async function startClip(name) {
  const out = join(ROOT, `${name}.mp4`);
  const encoder = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(FPS), "-i", "-",
    "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", out], { stdio: ["pipe", "ignore", "inherit"] });
  clip = { name, encoder, latest: null, written: 0, started: Date.now() };
  const tick = () => {
    if (!clip || clip.encoder !== encoder) return;
    const due = Math.floor(((Date.now() - clip.started) / 1000) * FPS);
    while (clip.latest && clip.written < due) { encoder.stdin.write(clip.latest); clip.written++; }
    clip.timer = setTimeout(tick, 1000 / FPS / 2);
  };
  const width = Math.round(viewport.width * viewport.dpr);
  const height = Math.round(viewport.height * viewport.dpr);
  await send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: width, maxHeight: height, everyNthFrame: 1 });
  tick();
  console.log(`recording ${name} at ${width}x${height}`);
}

async function stopClip() {
  if (!clip) return;
  await sleep(300);
  await send("Page.stopScreencast");
  const { name, encoder, written, started } = clip;
  clearTimeout(clip.timer);
  clip = null;
  const done = new Promise((finish) => encoder.on("close", finish));
  encoder.stdin.end();
  await done;
  console.log(`${name}.mp4: ${written} frames, ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

for (const step of steps) {
  try {
    if (step.note) console.log(`# ${step.note}`);
    if (step.viewport) {
      const [width, height, dpr = 1, mobile = false] = step.viewport;
      viewport = { width, height, dpr, mobile };
      await applyViewport();
    }
    if (step.gotoJs) {
      const url = await evaluate(`(async () => { try { return await (${step.gotoJs}); } catch (e) { return null; } })()`);
      console.log(`gotoJs -> ${url}`);
      if (url) { await send("Page.navigate", { url }); await sleep(300); await evaluate(CURSOR); }
    }
    if (step.goto) { await send("Page.navigate", { url: step.goto }); await sleep(300); await evaluate(CURSOR); }
    if (step.record) await startClip(step.record);
    if (step.wait) await sleep(step.wait);
    if (step.waitFor) {
      const deadline = Date.now() + (step.timeout ?? 60_000);
      let found = false;
      while (Date.now() < deadline && !found) {
        found = await evaluate(`document.body.innerText.includes(${JSON.stringify(step.waitFor)})`);
        if (!found) await sleep(500);
      }
      console.log(found ? `saw "${step.waitFor}"` : `TIMEOUT waiting for "${step.waitFor}"`);
    }
    if (step.waitForJs) {
      // An async page expression, e.g. polling the API until an agent run finishes.
      const deadline = Date.now() + (step.timeout ?? 300_000);
      let value = null;
      while (Date.now() < deadline) {
        value = await evaluate(`(async () => { try { return await (${step.waitForJs}); } catch { return null; } })()`);
        if (value) break;
        await sleep(step.every ?? 2000);
      }
      console.log(value ? `condition met: ${JSON.stringify(value).slice(0, 160)}` : `TIMEOUT: ${step.waitForJs.slice(0, 80)}`);
    }
    if (step.click) {
      const spec = typeof step.click === "string" ? { text: step.click } : step.click;
      await evaluate(CURSOR);
      let point = await evaluate(FIND(spec));
      if (point) { await sleep(250); point = await evaluate(FIND(spec)); }
      if (!point) { console.log(`not found: ${JSON.stringify(spec)}`); continue; }
      await evaluate(`window.__moveCursor(${point.x}, ${point.y}, ${step.moveMs ?? 750})`);
      await sleep(120);
      await evaluate(`window.__ripple(${point.x}, ${point.y})`);
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
      await sleep(70);
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
      if (step.double) {
        await sleep(60);
        await send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 2 });
        await sleep(50);
        await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 2 });
      }
      console.log(`clicked ${point.label}`);
      await sleep(step.after ?? 400);
    }
    if (step.hover) {
      const point = await evaluate(FIND(typeof step.hover === "string" ? { text: step.hover } : step.hover));
      if (point) await evaluate(`window.__moveCursor(${point.x}, ${point.y}, ${step.moveMs ?? 750})`);
    }
    if (step.type) {
      for (const char of step.type) {
        await send("Input.insertText", { text: char });
        await sleep(35 + Math.random() * 45);
      }
    }
    if (step.key) {
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: step.key, code: step.key, windowsVirtualKeyCode: KEYCODE[step.key] ?? 0 });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: step.key, code: step.key, windowsVirtualKeyCode: KEYCODE[step.key] ?? 0 });
    }
    if (step.scroll !== undefined) await evaluate(`window.scrollTo({ top: ${step.scroll}, behavior: "smooth" })`);
    if (step.scrollTo) await evaluate(`document.querySelector(${JSON.stringify(step.scrollTo)})?.scrollIntoView({ behavior: "smooth", block: ${JSON.stringify(step.block ?? "start")} })`);
    // Save browser downloads (e.g. the real audit-pack .xlsx) into recordings/<dir>.
    if (step.downloads) await send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: join(ROOT, step.downloads).replace(/\//g, "\\") });
    if (step.eval) console.log("eval:", JSON.stringify(await evaluate(step.eval)).slice(0, 400));
    if (step.shot) {
      const shot = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(ROOT, step.shot), Buffer.from(shot.result.data, "base64"));
      console.log(`shot ${step.shot}`);
    }
    if (step.stop) await stopClip();
  } catch (error) {
    console.log(`step failed ${JSON.stringify(step).slice(0, 120)}: ${error instanceof Error ? error.message : error}`);
  }
}
await stopClip();
console.log(problems.length ? `problems:\n${[...new Set(problems)].slice(0, 20).join("\n")}` : "no page errors");
ws.close();
chrome.kill();
process.exit(0);
