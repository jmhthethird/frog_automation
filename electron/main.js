'use strict';

/**
 * Electron main process for Frog Automation.
 *
 * Responsibilities:
 *   1. Set DATA_DIR to the platform userData path before any app module loads.
 *   2. Start the Express HTTP server (reusing index.js).
 *   3. Open a BrowserWindow that loads the local UI.
 *   4. Add a system-tray icon so the app keeps running when the window is closed.
 */

const { app, BrowserWindow, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');

let mainWindow = null;
let tray = null;

// ── Tray icon (drawn programmatically – no external file required at runtime) ─
function makeTrayIcon() {
  const size = 22; // macOS menu-bar icons are typically 22px
  const buf = Buffer.alloc(size * size * 4); // RGBA
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const inCircle = dx * dx + dy * dy < r * r;
      const i = (y * size + x) * 4;
      buf[i]     = inCircle ? 46  : 0; // R
      buf[i + 1] = inCircle ? 204 : 0; // G  (#2ecc71 green)
      buf[i + 2] = inCircle ? 113 : 0; // B
      buf[i + 3] = inCircle ? 255 : 0; // A
    }
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

// ── BrowserWindow ─────────────────────────────────────────────────────────────
function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    title: 'Frog Automation',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    show: false,
  });

  mainWindow.loadURL(`http://localhost:${port}`);

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Keep links that open in new tabs inside the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── System tray ───────────────────────────────────────────────────────────────
function createTray(port) {
  tray = new Tray(makeTrayIcon());
  tray.setToolTip(`Frog Automation — http://localhost:${port}`);

  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: `Open UI  (localhost:${port})`,
      click() {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow(port);
        }
      },
    },
    {
      label: 'Open in System Browser',
      click() { shell.openExternal(`http://localhost:${port}`); },
    },
    { type: 'separator' },
    {
      label: 'Show Data Folder',
      click() { shell.openPath(app.getPath('userData')); },
    },
    { type: 'separator' },
    { label: 'Quit Frog Automation', click() { app.quit(); } },
  ]));

  // Clicking the tray icon toggles the window
  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
    } else {
      createWindow(port);
    }
  });
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  const port = parseInt(process.env.PORT || '3000', 10);

  // Set DATA_DIR **before** any of our app modules are required, so that
  // src/db.js picks up the Electron user-data path at module initialisation.
  if (!process.env.DATA_DIR) {
    process.env.DATA_DIR = app.getPath('userData');
  }

  // Start the Express server and wait until it is listening.
  const { startServer } = require('../index.js');
  await startServer(port);

  createWindow(port);
  createTray(port);

  app.on('activate', () => {
    // macOS: re-open window when dock icon is clicked and no window is open.
    if (!mainWindow) createWindow(port);
  });
});

// On macOS keep the process alive when all windows are closed (live in tray).
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
