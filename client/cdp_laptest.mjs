import { spawn } from "child_process";
import { WebSocket } from "ws";
import http from "http";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9225;
const URL = process.argv[2] || "http://localhost:5174/";

const chrome = spawn(CHROME, [
  "--headless=new",
  "--disable-gpu",
  `--remote-debugging-port=${PORT}`,
  "--user-data-dir=C:/Users/linga/AppData/Local/Temp/opencode/chrome-profile-laptest",
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
  if (isLanding) await evalJs(`document.getElementById('start-btn').click()`);
  const isName = await evalJs(`!!document.getElementById('name-submit')`);
  if (isName) await evalJs(`document.getElementById('name-submit').click()`);
  const hasBots = await evalJs(`!!document.getElementById('btn-bots')`);
  if (hasBots) break;
  await sleep(400);
}

await evalJs(`document.getElementById('btn-bots').click()`);

// Wait for world ready
for (let i = 0; i < 60; i++) {
  const ready = await evalJs(`!!document.querySelector('canvas') && (document.getElementById('race-standings')?.children.length || 0) >= 4`);
  if (ready) break;
  await sleep(800);
}

// Wait for countdown to finish
for (let i = 0; i < 15; i++) {
  const display = await evalJs(`document.getElementById('countdown')?.style?.display || ''`);
  if (display === 'none') break;
  await sleep(800);
}
await sleep(1000);

console.log("RACE STARTED! Auto-typing words to test laps...");

// Auto-type words until race finishes or 90 seconds
const startTime = Date.now();
let lastLoggedLap = "";
while (Date.now() - startTime < 90000) {
  const status = await evalJs(`JSON.stringify({
    lapBadge: document.getElementById('lap-hud-badge')?.textContent,
    resultsDisplay: document.getElementById('results-screen')?.style?.display,
    target: document.getElementById('prompt-text')?.textContent,
  })`);
  const s = JSON.parse(status);

  if (s.lapBadge && s.lapBadge !== lastLoggedLap) {
    console.log("--> LAP UPDATE DETECTED:", s.lapBadge);
    lastLoggedLap = s.lapBadge;
  }

  if (s.resultsDisplay === 'flex') {
    console.log("--> FINISH REACHED! Results screen is visible!");
    break;
  }

  // Type next character
  if (s.target && s.target.length > 0) {
    await evalJs(`(() => {
      const active = document.querySelector('#prompt-text .active-character')?.textContent;
      if (active) window.dispatchEvent(new KeyboardEvent('keydown', { key: active }));
    })()`);
  }

  await sleep(18);
}

await sleep(1000);
const finalResults = await evalJs(`JSON.stringify({
  resultsList: document.getElementById('results-list')?.textContent,
  summary: document.getElementById('player-result-summary')?.innerText,
})`);
console.log("FINAL RESULTS SUMMARY:\n", JSON.parse(finalResults));

ws.close();
chrome.kill();
process.exit(0);
