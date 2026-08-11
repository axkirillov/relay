// The relay window. It renders a document served by the Go binary on
// loopback; all the behaviour lives in the page.
const { app, BrowserWindow, Menu } = require("electron");

const url = process.argv[2] || process.env.RELAY_URL;
if (!url) {
  console.error("relay-shell: no URL given");
  app.exit(2);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 900,
    minWidth: 520,
    backgroundColor: "#16161e",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    title: "relay",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  win.loadURL(url);
  win.once("ready-to-show", () => {
    win.show();
    win.focus();
  });
}

// A bare menu keeps macOS shortcuts (copy/paste, quit) without adding
// accelerators that could swallow keys the editor wants.
function createMenu() {
  if (process.platform !== "darwin") return Menu.setApplicationMenu(null);
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: "appMenu" },
      {
        label: "Edit",
        submenu: [
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
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
