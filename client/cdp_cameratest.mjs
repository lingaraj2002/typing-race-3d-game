import { spawn } from "child_process";
import { WebSocket } from "ws";
import http from "http";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9226;
const URL = process.argv[2] || "http://localhost:5173/";
const SHOT_DIR =
  process.argv[3] || "C:/Users/linga/AppData/Local/Temp/opencode/camera-shots";

const chrome = spawn(CHROME, [
  "--headless=new",
  "--disable-gpu",
  `--remote-debugging-port=${PORT}`,
  "--user-data-dir=C:/Users/linga/AppData/Local/Temp/opencode/chrome-profile-camt",
  "--no-first-run",
  "--no-default-browser-check",
  "--hide-scrollbars",
  "--window-size=1280,720",
  URL,
]);

async function getJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve(JSON.parse(d)));
      })
      .on("error", reject);
  });
}

async function waitForTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await getJson(`http://localhost:${PORT}/json/list`);
      const page = list.find((t) => t.type === "page");
      if (page) return page;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("chrome target not found");
}

await new Promise((r) => setTimeout(r, 3000));

const wsPath = await waitForTarget();
const ws = new WebSocket(wsPath.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const events = [];
function send(method, params = {}) {
  return new Promise((resolve) => {
    const msgId = ++id;
    pending.set(msgId, resolve);
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
}
ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result);
    pending.delete(msg.id);
  }
  if (msg.method === "Runtime.consoleAPICalled") {
    const type = msg.params.type;
    const args = (msg.params.args || [])
      .map((a) => (a.value !== undefined ? a.value : a.description || ""))
      .join(" ");
    if (type === "error") events.push("ERROR: " + args);
  }
  if (msg.method === "Runtime.exceptionThrown") {
    events.push(
      "EXCEPTION: " + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text),
    );
  }
});

await new Promise((r) => (ws.on("open", r)));
await send("Runtime.enable");
await send("Page.enable");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evalJs(expr) {
  const res = await send("Runtime.evaluate", {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  });
  if (res?.exceptionDetails)
    return (
      "EXC:" +
      (res.exceptionDetails.exception?.description?.slice(0, 300) ||
        res.exceptionDetails.text)
    );
  return res?.result?.value;
}

async function screenshot(name) {
  const shot = await send("Page.captureScreenshot", { format: "png" });
  if (!shot?.data) return;
  const { mkdirSync, writeFileSync } = await import("fs");
  mkdirSync(SHOT_DIR, { recursive: true });
  writeFileSync(`${SHOT_DIR}/${name}.png`, Buffer.from(shot.data, "base64"));
  console.log(`[shot] ${SHOT_DIR}/${name}.png`);
}

// 1. Landing -> name -> mode
for (let i = 0; i < 30; i++) {
  const isLanding = await evalJs(`!!document.getElementById('start-btn')`);
  if (isLanding) await evalJs(`document.getElementById('start-btn').click()`);
  const isName = await evalJs(`!!document.getElementById('name-submit')`);
  if (isName) await evalJs(`document.getElementById('name-submit').click()`);
  const hasBots = await evalJs(`!!document.getElementById('btn-bots')`);
  if (hasBots) break;
  await sleep(500);
}

await evalJs(`document.getElementById('btn-bots').click()`);

// 2. wait for world + race ui
for (let i = 0; i < 60; i++) {
  const ready = await evalJs(
    `!!document.querySelector('canvas') && (document.getElementById('race-standings')?.children.length || 0) >= 4`,
  );
  if (ready) break;
  await sleep(800);
}

// 3. wait for countdown to finish
for (let i = 0; i < 30; i++) {
  const display = await evalJs(
    `document.getElementById('countdown')?.style?.display || ''`,
  );
  if (display === "none") break;
  await sleep(800);
}
await sleep(1200);

// wait until the typing word above the car actually exists (race live)
let wordFound = false;
for (let i = 0; i < 40; i++) {
  const hasWord = await evalJs(`!!document.getElementById('world-word')`);
  if (hasWord) { wordFound = true; break; }
  await sleep(750);
}
if (!wordFound) {
  const state = await evalJs(`(() => {
    const q = (s) => !!document.querySelector(s);
    const counts = (s) => document.querySelectorAll(s).length;
    return JSON.stringify({
      canvas: q('canvas'),
      startBtn: q('#start-btn'), botsBtn: q('#btn-bots'),
      standings: document.getElementById('race-standings')?.children.length ?? -1,
      countdownDisp: document.getElementById('countdown')?.style?.display ?? '-',
      worldWord: q('#world-word'),
      promptText: document.getElementById('prompt-text')?.textContent?.slice(0, 30) ?? '-',
      menu: q('#race-menu'), hud: q('#race-hud'),
      canvasButtons: counts('#start-btn, #btn-bots'),
    });
  })()`);
  console.log("STATE AFTER WORD WAIT:", state);
}
console.log("RACE STARTED — sampling camera framing...");

// 4. sample the typing-word screen position across a couple of laps while
//    auto-typing so the car reaches and holds a high speed. The word element
//    is anchored directly above the car (car pos + 2.6), so it measures both
//    centering and the car's vertical band.
const samples = [];
const start = Date.now();
const DURATION = 26000;
const FINE_WINDOW_MS = 3000;
let lastFine = null;
let maxWordJitter = 0;
let lapBadge = "";

while (Date.now() - start < DURATION) {
  const s = await evalJs(`(() => {
    const word = document.getElementById('world-word');
    const canvas = document.querySelector('canvas');
    if (!word || !canvas) return null;
    const ws = word.style.display;
    const wr = word.getBoundingClientRect();
    const cr = canvas.getBoundingClientRect();
    const fx = ((wr.left + wr.width / 2) - cr.left) / cr.width;
    const fy = ((wr.top + wr.height / 2) - cr.top) / cr.height;
    const badge = document.getElementById('lap-hud-badge')?.textContent || '';
    return JSON.stringify({
      ws, fx: +fx.toFixed(4), fy: +fy.toFixed(4), w: wr.width, h: wr.height, badge
    });
  })()`);
  const p = s ? JSON.parse(s) : null;
  if (!p) {
    await sleep(120);
    continue;
  }

  if (p.ws === "block") {
    samples.push({ t: Date.now() - start, fx: p.fx, fy: p.fy });
    if (lastFine !== null && Date.now() - start < FINE_WINDOW_MS * 7) {
      const jx = Math.abs(p.fx - lastFine.fx);
      const jy = Math.abs(p.fy - lastFine.fy);
      maxWordJitter = Math.max(maxWordJitter, jx, jy);
    }
    lastFine = { fx: p.fx, fy: p.fy, t: Date.now() - start };
  }
  if (p.badge && p.badge !== lapBadge) {
    lapBadge = p.badge;
    console.log(`  [lap] ${lapBadge} (word at fx=${p.fx} fy=${p.fy})`);
  }

  await evalJs(`(() => {
    const active = document.querySelector('#prompt-text .active-character')?.textContent;
    if (active) window.dispatchEvent(new KeyboardEvent('keydown', { key: active }));
  })()`);

  if (samples.length % 25 === 0) await screenshot(`cam-t${Date.now() - start}`);

  await sleep(120);
}

// 5. stats
const xs = samples.map((s) => s.fx);
const ys = samples.map((s) => s.fy);
const avg = (a) => a.reduce((x, y) => x + y, 0) / Math.max(a.length, 1);
const min = (a) => Math.min(...a);
const max = (a) => Math.max(...a);
const std = (a, m) =>
  Math.sqrt(a.reduce((acc, v) => acc + (v - m) ** 2, 0) / Math.max(a.length, 1));

console.log(`\n=== CAMERA COMPOSITION (${samples.length} samples) ===`);
if (samples.length === 0) {
  console.log("NO SAMPLES — race/word never appeared");
} else {
  console.log(`word horizontal fx  : min ${min(xs).toFixed(3)} max ${max(xs).toFixed(3)} avg ${avg(xs).toFixed(3)} sd ${std(xs, avg(xs)).toFixed(3)}`);
  console.log(`word vertical   fy  : min ${min(ys).toFixed(3)} max ${max(ys).toFixed(3)} avg ${avg(ys).toFixed(3)} sd ${std(ys, avg(ys)).toFixed(3)}`);
  console.log(`(0.5 = screen center, fy measured top->bottom)`);
  console.log(`max word jitter (frame-ish) : ${maxWordJitter.toFixed(4)} NDC`);
  console.log(`car is anchored 2.6 units below the word (~0.16 NDC lower).`);
}
console.log(`final lap badge: ${lapBadge}`);
await screenshot("cam-final");

console.log(`\n=== CONSOLE / ERRORS ===`);
events.forEach((e) => console.log(e));
if (!events.some((e) => e.startsWith("ERROR") || e.startsWith("EXCEPTION"))) {
  console.log("NO ERRORS DETECTED");
}

ws.close();
chrome.kill();
process.exit(0);