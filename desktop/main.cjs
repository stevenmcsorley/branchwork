const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  safeStorage,
} = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

let server;
let window;
app.setName("Branchwork");
app
  .whenReady()
  .then(async () => {
    const { createServer } = await import(
      pathToFileURL(path.join(__dirname, "..", "server.mjs")).href
    );
    const { createSettingsStore } = await import(
      pathToFileURL(path.join(__dirname, "..", "settings.mjs")).href
    );
    const secure =
      safeStorage.isEncryptionAvailable() &&
      safeStorage.getSelectedStorageBackend?.() !== "basic_text";
    const settings = createSettingsStore(
      secure
        ? {
            encrypt: (value) =>
              safeStorage.encryptString(value).toString("base64"),
            decrypt: (value) =>
              safeStorage.decryptString(Buffer.from(value, "base64")),
          }
        : {},
    );
    server = createServer({ settings });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    ipcMain.handle("choose-directory", async () => {
      const result = await dialog.showOpenDialog(window, {
        properties: ["openDirectory", "createDirectory"],
      });
      return result.canceled ? null : result.filePaths[0];
    });
    const openWindow = () => {
      window = new BrowserWindow({
        title: "Branchwork",
        width: 1540,
        height: 940,
        minWidth: 1050,
        minHeight: 650,
        backgroundColor: "#151a22",
        autoHideMenuBar: true,
        webPreferences: {
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
          preload: path.join(__dirname, "preload.cjs"),
        },
      });
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.on("will-navigate", (event, url) => {
        if (new URL(url).origin !== origin) event.preventDefault();
      });
      window.loadURL(origin);
    };
    openWindow();
    app.on("activate", () => {
      if (!BrowserWindow.getAllWindows().length) openWindow();
    });
  })
  .catch((error) => {
    dialog.showErrorBox("Branchwork could not start", error.message);
    app.quit();
  });
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
  server?.close();
});
