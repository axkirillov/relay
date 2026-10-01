import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const work = await mkdtemp(join(tmpdir(), "relay-controls-"));
const queue = join(work, "relay", "queue");
await mkdir(queue, { recursive: true });
const doc = `# Controls\n\nKeep the narrow, centred document.\n\n- [ ] Keep the layout\n\n[Example](https://example.invalid/)\n\n\`\`\`sh\nprintf 'first\\n'; sleep 2; printf 'later\\n'; sleep 30\n\`\`\`\n\n\`\`\`sh\nprintf 'second\\n'; sleep 30\n\`\`\`\n\n\`\`\`sh\nprintf 'queued\\n'\n\`\`\`\n\n\`\`\`sh\nprintf 'success\\n'\n\`\`\`\n\n\`\`\`sh\nprintf 'failure\\n'; exit 7\n\`\`\`\n\n\`\`\`sh\nprintf 'handoff\\n'; sleep 5\n\`\`\`\n\n\`\`\`sh\nprintf 'snapshot\\n'\n\`\`\`\n`;
const documentPath = join(work, "controls.md");
await writeFile(documentPath, doc);
const children = [];
let socket;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const cleanup = () => {
  socket?.close();
  for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
};
const deadline = setTimeout(() => { console.error("FAIL browser controls deadline"); cleanup(); process.exit(1); }, 90000);
process.once("SIGINT", () => { cleanup(); process.exit(1); });
process.once("SIGTERM", () => { cleanup(); process.exit(1); });

function launch(program, args, env = process.env) {
  const child = spawn(program, args, { cwd: repo, env, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  child.output = "";
  child.errors = "";
  child.stdout.on("data", data => { child.output += data; });
  child.stderr.on("data", data => { child.errors += data; });
  child.failure = null;
  child.on("error", error => { child.failure = error; });
  return child;
}
async function until(probe, label, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const result = await probe();
    if (result) return result;
    await sleep(50);
  }
  throw new Error(`Timed out: ${label}`);
}

try {
  const relay = launch(process.execPath, ["dist/relay.js", documentPath], { ...process.env, RELAY_NO_OPEN: "1", RELAY_QUEUE_DIR: queue, RELAY_GATE_STATE: join(work, "gate") });
  const url = await until(() => {
    if (relay.failure || relay.exitCode !== null) throw relay.failure ?? new Error(relay.errors);
    return relay.errors.match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0];
  }, "relay URL");
  const chromePath = process.env.CHROME_PATH ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome");
  const chrome = launch(chromePath, ["--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--hide-scrollbars", "--remote-debugging-port=0", `--user-data-dir=${join(work, "chrome")}`, "about:blank"]);
  const endpoint = await until(() => {
    if (chrome.failure || chrome.exitCode !== null) throw chrome.failure ?? new Error(chrome.errors);
    return chrome.errors.match(/DevTools listening on (ws:\/\/\S+)/)?.[1];
  }, "Chrome debugger");
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const answer = JSON.parse(data);
    const task = pending.get(answer.id);
    if (!task) return;
    pending.delete(answer.id);
    clearTimeout(task.timer);
    if (answer.error) task.reject(new Error(JSON.stringify(answer.error)));
    else task.resolve(answer.result);
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const next = ++id;
    const timer = setTimeout(() => { pending.delete(next); reject(new Error(`CDP timeout: ${method}`)); }, 6000);
    pending.set(next, { resolve, reject, timer });
    socket.send(JSON.stringify({ id: next, method, params, sessionId }));
  });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const call = (method, params = {}) => send(method, params, sessionId);
  const js = async expression => {
    const answer = await call("Runtime.evaluate", { expression, returnByValue: true });
    if (answer.exceptionDetails) throw new Error(JSON.stringify(answer.exceptionDetails));
    return answer.result.value;
  };
  const key = async (key, modifiers = 0) => {
    const virtual = { Enter: 13, Escape: 27, Tab: 9 }[key] ?? key.toUpperCase().charCodeAt(0);
    const text = !modifiers && key.length === 1 ? key : undefined;
    await call("Input.dispatchKeyEvent", { type: "keyDown", key, modifiers, windowsVirtualKeyCode: virtual, text });
    await call("Input.dispatchKeyEvent", { type: "keyUp", key, modifiers, windowsVirtualKeyCode: virtual });
    await sleep(65);
  };
  const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const text = selector => js(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
  const phase = id => text(`[data-run-id="${id}"] .cm-run-phase`);
  const waitPhase = (id, expected) => until(async () => (await phase(id)) === expected, `run ${id}: ${expected}`);
  const goto = async pattern => {
    await key("Escape");
    await js('document.querySelector(".cm-content").focus()');
    await key("g"); await key("g"); await key("/");
    await until(() => js('!!document.querySelector(".cm-vim-panel input")'), "search prompt");
    await call("Input.insertText", { text: pattern });
    assert.equal(await js('document.querySelector(".cm-vim-panel input").value'), pattern);
    await key("Enter");
    await sleep(120);
    const line = await js(`(() => { let n = getSelection().focusNode; while (n && !n.classList?.contains('cm-line')) n = n.parentNode; return n?.textContent ?? ''; })()`);
    assert.ok(line.includes(pattern), `search reached ${pattern}: ${line}`);
  };
  const ex = async command => {
    await key(":");
    await until(() => js('!!document.querySelector(".cm-vim-panel input")'), "ex prompt");
    await call("Input.insertText", { text: command });
    await key("Enter");
  };
  const shot = async name => {
    console.log("DOM", await js('JSON.stringify({mode:document.querySelector("#mode").textContent,context:document.querySelector("#context-action").textContent,runs:[...document.querySelectorAll(".cm-run-status")].map(e=>e.textContent)})'));
    const { data } = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(join(work, `${name}.png`), Buffer.from(data, "base64"));
  };
  await call("Page.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 660, height: 1100, deviceScaleFactor: 1, mobile: false });
  await call("Page.navigate", { url });
  await until(() => js('!!document.querySelector(".cm-content")'), "editor");
  assert.equal(await text("#context-label"), "Edit");
  await click("#context-action");
  assert.equal(await text("#mode"), "INSERT");
  assert.equal(await text("#context-label"), "Normal mode");
  await click("#context-action");
  assert.equal(await text("#mode"), "NORMAL");
  await click("#help");
  assert.equal(await js('document.querySelector("#help-dialog").open'), true);
  await key("x", 2);
  assert.equal(relay.exitCode, null);
  await shot("help");
  await key("Escape");
  assert.equal(await js('document.querySelector("#help-dialog").open'), false);
  assert.equal(await js('document.activeElement.classList.contains("cm-content")'), true);
  await ex("help");
  assert.equal(await js('document.querySelector("#help-dialog").open'), true);
  await click("#help-close");
  await until(() => js('document.activeElement.classList.contains("cm-content")'), "focus after closing Help");
  await goto("Keep the layout");
  assert.equal(await text("#context-label"), "Tick");
  await click("#context-action");
  assert.equal(await text("#context-label"), "Untick");
  await goto("Example");
  assert.equal(await text("#context-label"), "Open link");
  console.log("PASS contextual controls, checkbox, help, and modal acceptance guard");

  await goto("printf 'first"); await key("j", 2); await waitPhase(1, "Running");
  await goto("printf 'second"); await key("j", 2);
  await until(() => js('document.querySelector("#run-choice").hasAttribute("data-show")'), "run chooser");
  await sleep(2100);
  await key("p"); await waitPhase(2, "Running");
  await goto("printf 'queued"); await key("j", 2);
  await until(() => js('document.querySelector("#run-choice").hasAttribute("data-show")'), "queue chooser");
  await key("q"); await waitPhase(3, "Queued");
  await key("A"); await call("Input.insertText", { text: "; printf 'edited\\n'" }); await key("Escape");
  assert.equal(await text('[data-run-id="3"] .cm-run-edited'), "command edited");
  assert.equal(await js('document.querySelector("[data-run-id=\\"3\\"]").title'), "printf 'queued\\n'");
  await sleep(1100);
  assert.notEqual(await text('[data-run-id="1"] .cm-run-time'), "0s");
  const anchor = await js('JSON.stringify(document.querySelector("#accept").getBoundingClientRect().toJSON())');
  await shot("parallel");
  await click('[data-run-id="1"] button');
  await waitPhase(1, "Stopped");
  assert.equal(await phase(2), "Running");
  assert.equal(await phase(3), "Queued");
  await click('[data-run-id="2"] button');
  await waitPhase(2, "Stopped"); await waitPhase(3, "Skipped");
  assert.equal(await js('JSON.stringify(document.querySelector("#accept").getBoundingClientRect().toJSON())'), anchor);
  console.log("PASS output during the chooser, independent stop, queued skip, elapsed time, stable Accept position");

  await goto("printf 'success"); await click("#context-action"); await waitPhase(4, "Succeeded");
  const frozen = await text('[data-run-id="4"] .cm-run-time');
  await sleep(1100);
  assert.equal(await text('[data-run-id="4"] .cm-run-time'), frozen);
  await goto("printf 'failure"); await key("j", 2); await waitPhase(5, "Failed");
  await goto("printf 'success"); await key("j", 2); await waitPhase(6, "Succeeded");
  assert.equal(await phase(4), null);
  await goto("printf 'first"); await key("j", 2); await waitPhase(7, "Running");
  await key("j", 2);
  await until(() => js('document.querySelector("#run-choice").hasAttribute("data-show")'), "same-block chooser");
  await key("p"); await waitPhase(8, "Running");
  assert.equal(await phase(7), "Running");
  await click('[data-run-id="7"] button'); await waitPhase(7, "Stopped");
  assert.equal(await phase(8), "Running");
  await click('[data-run-id="8"] button'); await waitPhase(8, "Stopped");
  console.log("PASS overlapping runs on the same command have independent status and Stop");
  await goto("Controls");
  await key("i"); await call("Input.insertText", { text: "Preface\n\n" }); await key("Escape");
  await goto("printf 'success");
  assert.equal(await phase(6), "Succeeded");
  await call("Emulation.setDeviceMetricsOverride", { width: 430, height: 1000, deviceScaleFactor: 1, mobile: false });
  await goto("Controls");
  await shot("narrow");
  assert.equal(await js('document.documentElement.scrollWidth <= innerWidth'), true);
  assert.ok(await js('document.querySelector("#accept").getBoundingClientRect().right <= innerWidth'));
  await call("Emulation.setDeviceMetricsOverride", { width: 660, height: 1100, deviceScaleFactor: 1, mobile: false });
  await goto("printf 'handoff"); await key("j", 2); await waitPhase(9, "Running");
  await goto("printf 'snapshot"); await key("j", 2);
  await until(() => js('document.querySelector("#run-choice").hasAttribute("data-show")'), "handoff chooser");
  await key("q"); await waitPhase(10, "Queued");
  await key("A"); await call("Input.insertText", { text: "; printf 'changed\\n'" }); await key("Escape");
  assert.equal(await text('[data-run-id="10"] .cm-run-edited'), "command edited");
  await key("x", 2);
  await until(() => relay.exitCode !== null, "accepted diff");
  assert.equal(relay.exitCode, 0, relay.errors);
  assert.ok(relay.output.includes("[x] Keep the layout"));
  assert.ok(relay.output.includes("[stopped]"));
  assert.ok(!relay.output.includes("````[stopped]"), "overlapping runs keep their output inside the replacement fence");
  assert.ok(relay.output.includes("[exit 7]"));
  assert.ok(relay.output.includes("[skipped"));
  assert.ok(!relay.output.includes("cm-run-status"));
  assert.ok(!relay.output.includes("Succeeded"));
  console.log("PASS success/failure/rerun, edit mapping, narrow footer, accepted output without UI metadata");
  assert.ok(relay.output.includes("still running when this was sent"));
  assert.ok(relay.output.includes("queued when this was sent"));
  const round = join(work, "relay", (await readdir(join(work, "relay"))).find(name => /^\d{8}-/.test(name)));
  const report = await until(async () => {
    const entries = JSON.parse(await readFile(join(round, "queue-report.json"), "utf8"));
    return entries.every(entry => entry.status === "succeeded") ? entries : null;
  }, "accepted queue completion");
  assert.equal(report.length, 1);
  assert.equal(report[0].command, "printf 'snapshot\\n'");
  assert.equal(await readFile(report[0].output, "utf8"), "snapshot\n");
  console.log("PASS accepting keeps the active command and queued snapshot running");

  const accepted = await readFile(join(round, "accepted.md"), "utf8");
  const reading = launch(process.execPath, ["dist/relay.js", "--read", round], { ...process.env, RELAY_QUEUE_DIR: queue, RELAY_GATE_STATE: join(work, "gate") });
  const readUrl = await until(() => {
    if (reading.failure || reading.exitCode !== null) throw reading.failure ?? new Error(reading.errors);
    return reading.output.match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0];
  }, "read-only URL");
  await call("Page.addScriptToEvaluateOnNewDocument", { source: "window.close = () => { window.closeRequested = true; };" });
  await call("Page.navigate", { url: readUrl });
  await until(() => js('!!document.querySelector(".cm-content")'), "read-only editor");
  assert.equal(await text("#mode"), "READ ONLY");
  assert.equal(await text("#accept"), null);
  assert.equal(await text("#context-label"), "Close");
  await click("#help");
  assert.equal(await text("#help-close"), "Back to round");
  assert.ok(!(await text("#help-dialog")).includes("Tick or untick"));
  assert.ok(!(await text("#help-dialog")).includes("Accept and send"));
  await key("x", 2);
  assert.equal(await js('document.querySelector("#help-dialog").open'), true);
  await shot("read-help");
  await click("#help-close");
  await goto("Keep the layout");
  assert.equal(await text("#context-label"), "Close");
  await key("j", 2);
  assert.equal(await text("#context-label"), "Close");
  await goto("printf 'success"); await key("j", 2); await waitPhase(1, "Succeeded");
  assert.equal(await readFile(join(round, "accepted.md"), "utf8"), accepted);
  await click("#close");
  assert.equal(await js("window.closeRequested"), true);
  console.log("PASS read-only Help, run controls, unchanged saved round, and Close request");
  console.log(`Screenshots: ${work}`);
} finally {
  clearTimeout(deadline);
  cleanup();
}
