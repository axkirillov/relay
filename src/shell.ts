import { join } from "node:path";

import { app, BrowserWindow, Menu, screen } from "electron";

import { relayHome } from "./paths.js";
import { holdScreen, noteClosed } from "./presence.js";
import * as queue from "./queue.js";

const pollMs = 120;
const graceMs = 600;

app.setName("relay");
app.setPath("userData", join(relayHome(), "window"));

if (!app.requestSingleInstanceLock()) app.exit(0);
else main();

function main() {
  let win: BrowserWindow | null = null;
  let showing: string | null = null;
  let emptySince = 0;
  let release: (() => void) | null = null;
  let spent = false;
  let closed = false;

  app.whenReady().then(() => {
    createMenu();
    release = holdScreen();
    setInterval(tick, pollMs);
    tick();
  });

  const drop = () => release?.();
  app.on("will-quit", drop);
  process.on("exit", drop);
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(sig, () => {
      shut();
      drop();
      app.exit(0);
    });
  }

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
      else if (Date.now() - emptySince >= graceMs) {
        spent = true;
        app.quit();
      }
      return;
    }

    emptySince = 0;
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
      shut();
      app.quit();
    });
    return w;
  }

  function surface() {
    if (!win) return;
    win.show();
    win.focus();
    app.focus({ steal: true });
  }
}

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
