// A scaffold for driving relay's real window. Copy it into your scratchpad, add
// your checks where the bottom says to, and throw it away afterwards.
//
//   "$(cat scratchpad/electron.path)" scratchpad/mycheck.cjs scratchpad/doc.md scratchpad/shots
//
// Everything above the checks is the part that was hard to get right; SKILL.md
// says why each piece is the way it is.
const { app, BrowserWindow } = require("electron");
const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");

const repo = process.env.RELAY_REPO || process.cwd();
const doc = process.argv[2];
const shots = process.argv[3];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The visible document. Only the viewport is in the DOM — assert on patterns. */
const DOC = `Array.from(document.querySelectorAll(".cm-line")).map(l => l.textContent).join("\\n")`;
const MODE = `document.getElementById("mode").textContent`;
const NOTE = `document.getElementById("note").textContent`;

let failures = 0;
let checks = 0;
function ok(name, pass, detail) {
  checks++;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  if (detail !== undefined && (!pass || process.env.VERBOSE)) console.log(`      ${detail}`);
}

function startRelay() {
  const relay = spawn("node", ["dist/relay.js", doc], {
    cwd: repo,
    env: { ...process.env, RELAY_NO_OPEN: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  relay.stdout.setEncoding("utf8");
  relay.stderr.setEncoding("utf8");
  relay.stdout.on("data", (t) => (out += t));
  const exited = new Promise((resolve) => relay.once("exit", resolve));
  const url = new Promise((resolve, reject) => {
    let err = "";
    relay.stderr.on("data", (t) => {
      err += t;
      const m = err.match(/http:\/\/127\.0\.0\.1:\d+\//);
      if (m) resolve(m[0]);
    });
    relay.once("exit", () => reject(new Error(`relay exited early: ${err}`)));
  });
  return { url, exited, stdout: () => out };
}

function tap(win, keyCode, modifiers = []) {
  win.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
}

/** Normal-mode keys, which a keyDown alone is enough for. */
async function nkeys(win, seq) {
  for (const k of seq) {
    tap(win, k, k !== k.toLowerCase() ? ["shift"] : []);
    await sleep(60);
  }
  await sleep(150);
}

/** Printable text, which needs a char event to reach an input or insert mode. */
async function type(win, text) {
  for (const ch of text) {
    const mods = ch !== ch.toLowerCase() ? ["shift"] : [];
    win.webContents.sendInputEvent({ type: "keyDown", keyCode: ch, modifiers: mods });
    win.webContents.sendInputEvent({ type: "char", keyCode: ch, modifiers: mods });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode: ch, modifiers: mods });
    await sleep(45);
  }
  await sleep(120);
}

/** An ex (`:`) or search (`/`) command: the opener, a pause, then the body. */
async function prompt(win, open, body) {
  const mods = open === ":" ? ["shift"] : [];
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: open, modifiers: mods });
  win.webContents.sendInputEvent({ type: "char", keyCode: open, modifiers: mods });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: open, modifiers: mods });
  await sleep(250);
  await type(win, body);
  tap(win, "Enter");
  await sleep(400);
}

app.whenReady().then(async () => {
  const server = startRelay();
  const url = await server.url;
  console.log(`relay: ${url}\n`);

  const win = new BrowserWindow({
    show: true,
    width: 1000,
    height: 1200,
    backgroundColor: "#16161e",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  await win.loadURL(url);
  win.show();
  win.focus();
  app.focus({ steal: true });
  await sleep(1300);

  const js = (code) => win.webContents.executeJavaScript(code);
  const text = () => js(DOC);
  const shot = async (name) => writeFileSync(join(shots, name), (await win.webContents.capturePage()).toPNG());

  /** The caret onto the first match from the top, by a real `/` search. */
  const goto = async (pattern) => {
    await nkeys(win, "gg");
    await prompt(win, "/", pattern);
  };

  // --- your checks go here ----------------------------------------------------
  await goto("something in the document");
  ok("it is on screen", (await text()).includes("something in the document"));
  await shot("state.png");

  // --- and end with a real accept: its diff is all the agent ever gets --------
  tap(win, "x", ["control"]);
  await sleep(1200);
  ok("relay accepted", (await server.exited) === 0);
  const patch = server.stdout();
  ok("the diff carries what the human did", patch.includes("+"), patch.slice(0, 400));

  console.log(`\n${checks - failures}/${checks} checks passed`);
  win.destroy();
  app.exit(failures ? 1 : 0);
});
