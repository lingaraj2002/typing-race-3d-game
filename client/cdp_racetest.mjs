import { spawn } from "child_process";
import { WebSocket } from "ws";
import http from "http";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9224;
const URL = process.argv[2] || "http://localhost:5177/";

const chrome = spawn(CHROME, [
  "--headless=new",
  "--disable-gpu",
  `--remote-debugging-port=${PORT}`,
  "--user-data-dir=C:/Users/linga/AppData/Local/Temp/opencode/chrome-profile-2",
  "--no-first-run",
  "--no-default-browser-check",
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
      .map((a) => (a.value !== undefined ? a.value : a.description || (a.type || "")))
      .join(" ");
    if (type === "error") events.push("ERROR: " + args);
    else events.push("LOG: " + args);
  }
  if (msg.method === "Runtime.exceptionThrown") {
    const d = msg.params.exceptionDetails;
    events.push("EXCEPTION: " + (d.exception?.description || d.text));
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
  if (res?.exceptionDetails) return "EXC:" + (res.exceptionDetails.exception?.description?.slice(0, 300) || res.exceptionDetails.text);
  return res?.result?.value;
}

// 1. Navigate landing -> name -> mode
for (let i = 0; i < 30; i++) {
  const isLanding = await evalJs(`!!document.getElementById('start-btn')`);
  if (isLanding) {
    console.log("Found landing page, clicking Play...");
    await evalJs(`document.getElementById('start-btn').click()`);
    await sleep(500);
  }
  const isName = await evalJs(`!!document.getElementById('name-submit')`);
  if (isName) {
    console.log("Found name entry page, submitting name...");
    await evalJs(`document.getElementById('name-submit').click()`);
    await sleep(500);
  }
  const hasBots = await evalJs(`!!document.getElementById('btn-bots')`);
  if (hasBots) break;
  await sleep(500);
}

const buttons = await evalJs(
  `['btn-bots','btn-quick','btn-create','btn-join'].map(id => id + '=' + !!document.getElementById(id)).join(' | ')`,
);
console.log("MODE SCREEN:", buttons);

// 2. click Race Bots
await evalJs(`document.getElementById('btn-bots').click()`);
await sleep(1000);

// 3. wait for the world to load (canvas + race ui)
let worldReady = false;
for (let i = 0; i < 60; i++) {
  const state = await evalJs(`JSON.stringify({
    canvas: !!document.querySelector('canvas'),
    countdown: document.getElementById('countdown')?.textContent || '',
    lapBadge: document.getElementById('lap-hud-badge')?.textContent || '',
    lapBanner: document.getElementById('lap-banner')?.textContent || '',
    standings: document.getElementById('race-standings')?.children.length || 0,
  })`);
  const s = JSON.parse(state);
  if (s.canvas && s.standings >= 4) {
    worldReady = true;
    console.log("WORLD LOADED SUCCESSFULLY:", s);
    break;
  }
  await sleep(1000);
}

// 4. wait for countdown to finish -> race starts
for (let i = 0; i < 12; i++) {
  await sleep(1000);
  const cd = await evalJs(`document.getElementById('countdown')?.textContent || ''`);
  const display = await evalJs(`document.getElementById('countdown')?.style?.display || ''`);
  if (display === 'none' || cd === 'GO!') break;
}
await sleep(2000);

// Check Lap HUD during race
const lapHudState = await evalJs(`JSON.stringify({
  lapBadge: document.getElementById('lap-hud-badge')?.textContent,
  lapBanner: document.getElementById('lap-banner')?.textContent,
  standingsSample: document.getElementById('race-standings')?.firstElementChild?.textContent,
  wpm: document.getElementById('wpm-value')?.textContent,
  acc: document.getElementById('accuracy-value')?.textContent,
  words: document.getElementById('words-value')?.textContent,
})`);
console.log("RACE ACTIVE STATE:", lapHudState);

// 5. type a char to exercise the typing engine
await evalJs(`(() => {
  const target = document.getElementById('prompt-text')?.textContent || '';
  if (target) window.dispatchEvent(new KeyboardEvent('keydown', { key: target[0] }));
  return 'typed first char of "' + target.slice(0,10) + '"';
})()`);
await sleep(500);

const finalState = await evalJs(`JSON.stringify({
  lapBadge: document.getElementById('lap-hud-badge')?.textContent,
  wpm: document.getElementById('wpm-value')?.textContent,
  acc: document.getElementById('accuracy-value')?.textContent,
  words: document.getElementById('words-value')?.textContent,
  prompt: document.getElementById('prompt-text')?.textContent?.slice(0, 20),
})`);
console.log("AFTER TYPING:", finalState);

console.log("\n=== CONSOLE / ERRORS ===");
events.forEach((e) => console.log(e));
if (!events.some((e) => e.startsWith("ERROR") || e.startsWith("EXCEPTION"))) {
  console.log("NO ERRORS DETECTED");
}

ws.close();

chrome.kill();
process.exit(0);