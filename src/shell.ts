// The relay window. There is exactly one of it, it belongs to no particular
// relay, and it follows the line: it shows whoever is at the head, moves on when
// they are answered, and quits once nobody is left waiting.
//
// All the editing behaviour lives in the page it loads. This is only the frame.
import { join } from "node:path";

import { app, BrowserWindow, Menu, screen } from "electron";

import { relayHome } from "./paths.js";
import { holdScreen } from "./presence.js";
import * as queue from "./queue.js";

/** How often the line is read. Short: this is the lag before the next document. */
const pollMs = 120;
/**
 * How long the line must stay empty before the window goes. A relay whose ticket
 * lands just as the last one is answered should find the window still here
 * rather than watch it go and come back.
 */
const graceMs = 600;

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
  let release: (() => void) | null = null;

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
      drop();
      app.exit(0);
    });
  }

  // Closing the window dismisses every relay in line, not only the one on
  // screen: it is the human saying they are done, and a queued document opening
  // in its place would be the opposite of that.
  app.on("window-all-closed", () => app.quit());

  function tick() {
    const head = queue.line()[0];

    if (!head) {
      if (!emptySince) emptySince = Date.now();
      else if (Date.now() - emptySince >= graceMs) app.quit();
      return;
    }

    emptySince = 0;
    // At the head but not serving yet — it is still coming up. Waiting for it
    // keeps the order the relays arrived in.
    if (!head.url || head.url === showing) return;
    show(head.url);
  }

  function show(url: string) {
    showing = url;
    if (!win) return void (win = create(url));
    win.loadURL(url);
    surface();
  }

  function create(url: string): BrowserWindow {
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
    w.once("ready-to-show", surface);
    w.on("closed", () => {
      win = null;
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
