// The relay window: full display height, a shade over half its width, hosting
// a page served on loopback by the relay CLI. All behaviour lives in the page.
const { app, BrowserWindow, Menu, screen } = require("electron");

const url = process.argv[2] || process.env.RELAY_URL;
if (!url) {
  console.error("relay-shell: no URL given");
  app.exit(2);
}

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const width = Math.max(640, Math.round(workArea.width * 0.6));

  const win = new BrowserWindow({
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

  win.loadURL(url);
  win.once("ready-to-show", () => {
    win.show();
    win.focus();
    app.focus({ steal: true });
  });
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

app.whenReady().then(() => {
  createMenu();
  createWindow();
});

app.on("window-all-closed", () => app.quit());
