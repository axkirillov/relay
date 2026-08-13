// The relay window. There is exactly one of it, it belongs to no particular
// relay, and it follows the line: it shows whoever is at the head, moves on when
// they are answered, and puts up a blank for the human to start a task in once
// nobody is left waiting.
//
// All the editing behaviour lives in the page it loads. This is only the frame.
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

import { app, BrowserWindow, Menu, screen } from "electron";

import { relayHome } from "./paths.js";
import { holdScreen, noteClosed } from "./presence.js";
import * as queue from "./queue.js";

/** How often the line is read. Short: this is the lag before the next document. */
const pollMs = 120;
/**
 * How long to give a blank to come up before another is started. A relay takes a
 * moment to write its ticket, and every tick until then still reads "the line is
 * empty".
 */
const bootMs = 3_000;
/**
 * How long an empty line is tolerated before the window goes after all. It
 * should never come to this — a blank fills an empty line within the second —
 * so this is the old quit-when-dry behaviour kept as the failure path: if no
 * blank can be started, the window leaves rather than sitting there showing a
 * document that has already been answered.
 */
const dryMs = 5_000;

app.setName("relay");
// Electron keys the single-instance lock below on this path, so it has to follow
// the relay home rather than being one global thing: a test relay pointed at a
// temp directory must not find itself locked out by the window a human has open.
app.setPath("userData", join(relayHome(), "window"));

// Whatever else happens, there is one window. A second shell started by a race
// leaves the screen to the one already up rather than becoming a second window.
if (!app.requestSingleInstanceLock()) app.exit(0);
else main();

function main() {
  let win: BrowserWindow | null = null;
  let showing: string | null = null;
  let emptySince = 0;
  let blankAt = 0;
  let release: (() => void) | null = null;
  /**
   * Which of the two ways out this is. The line running out and the human
   * closing the window both end in the window closing, and `closed` fires either
   * way, so the difference has to be remembered rather than read off the event.
   */
  let spent = false;
  let closed = false;

  app.whenReady().then(() => {
    createMenu();
    release = holdScreen();
    setInterval(tick, pollMs);
    tick();
  });

  // However this window goes, the file that says it is here goes with it. What a
  // kill -9 leaves behind is caught by the heartbeat going quiet instead.
  const drop = () => release?.();
  app.on("will-quit", drop);
  process.on("exit", drop);
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(sig, () => {
      // Told to go rather than asked, but still the window leaving the human's
      // screen with documents on it — that is a close.
      shut();
      drop();
      app.exit(0);
    });
  }

  /**
   * The human closed the window. That dismisses every relay in line, not only
   * the one on screen — it is them saying they are done, and a queued document
   * opening in its place would be the opposite of that.
   *
   * Written down rather than left for each relay to have noticed: a document can
   * be closed on before its relay ever looks. Nothing is written when the line
   * simply ran out, or the next relay to arrive would find itself dismissed by a
   * window that was never closed on it.
   *
   * Before `app.quit()`, so the tombstone is on disk before `will-quit` takes
   * the presence file away — a relay reading in between sees a window still up
   * and does not start the one just closed.
   */
  function shut() {
    if (spent || closed) return;
    closed = true;
    noteClosed(showing);
  }

  app.on("window-all-closed", () => {
    shut();
    app.quit();
  });

  function tick() {
    const head = queue.line()[0];

    if (!head) {
      if (!emptySince) emptySince = Date.now();
      blank();
      if (Date.now() - emptySince >= dryMs) {
        spent = true;
        app.quit();
      }
      return;
    }

    emptySince = 0;
    // At the head but not serving yet — it is still coming up. Waiting for it
    // keeps the order the relays arrived in.
    if (!head.url || head.url === showing) return;
    // A blank takes the screen quietly. It is there for want of anyone else, and
    // a window that jumped forward every time the last document was answered
    // would interrupt the human with an empty page — the opposite of somewhere
    // they can leave a task when they feel like it.
    show(head.url, head.rank !== "idle");
  }

  /**
   * Put up a blank document for the human to start a task in.
   *
   * A real relay with an empty document, rather than something this window
   * renders itself: then it queues like everything else, it is dismissed by a
   * close like everything else, and it arrives with the editor, `⌃↵`, the
   * terminal and `gf` already working. It ranks last in the line, so it yields
   * the moment anyone wants the screen.
   *
   * From the human's home directory, because a blank belongs to nobody: the cwd
   * a relay's commands run in would otherwise be whichever worktree happened to
   * start this window.
   */
  function blank() {
    if (Date.now() - blankAt < bootMs) return;
    blankAt = Date.now();
    const child = spawn(process.execPath, [join(__dirname, "relay.js"), "new", "--idle"], {
      cwd: homedir(),
      detached: true,
      stdio: "ignore",
      // This process is Electron, so its own binary has to be told to be node.
      // The relay drops the variable as it starts, or everything it spawns in
      // turn would inherit it — a window among them.
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    });
    child.unref();
  }

  function show(url: string, announce: boolean) {
    showing = url;
    if (!win) return void (win = create(url, announce));
    win.loadURL(url);
    if (announce) surface();
  }

  function create(url: string, announce: boolean): BrowserWindow {
    const { workArea } = screen.getPrimaryDisplay();
    const width = Math.max(640, Math.round(workArea.width * 0.6));

    const w = new BrowserWindow({
      x: workArea.x + Math.round((workArea.width - width) / 2),
      y: workArea.y,
      width,
      height: workArea.height,
      minWidth: 520,
      show: false,
      backgroundColor: "#16161e",
      titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
      title: "relay",
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });

    w.loadURL(url);
    // A window that only exists to hold a blank still has to be shown, or it
    // would sit invisible with a `window.json` saying otherwise. It just does
    // not take the focus with it.
    w.once("ready-to-show", () => (announce ? surface() : w.showInactive()));
    w.on("closed", () => {
      win = null;
      shut();
      app.quit();
    });
    return w;
  }

  /**
   * Forward, every time. A document arriving in a window that is already open is
   * the one thing this feature exists to make obvious: what is on screen is what
   * is waiting to be read.
   */
  function surface() {
    if (!win) return;
    win.show();
    win.focus();
    app.focus({ steal: true });
  }
}

// A bare menu keeps the usual macOS shortcuts without adding accelerators that
// could swallow keys the editor wants.
function createMenu() {
  if (process.platform !== "darwin") return Menu.setApplicationMenu(null);
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: "appMenu" },
      {
        label: "Edit",
        submenu: [{ role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }],
      },
      { label: "View", submenu: [{ role: "reload" }, { role: "toggleDevTools" }] },
      { role: "windowMenu" },
    ]),
  );
}
