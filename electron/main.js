// PokéScan 2 – desktop entry point (Electron). `node build/main.js --server-only` runs just the server.
const path = require('path');
const { startServer } = require('./server');

const root = path.join(__dirname, '..');
const webDir = path.join(root, 'dist');
const vendorDir = path.join(__dirname, 'vendor');

if (!process.versions.electron) {
  startServer({ webDir, vendorDir, dataDir: path.join(root, '.data') }).catch(e => {
    console.error(e.code === 'EADDRINUSE' ? 'Port jest zajęty – czy PokéScan 2 już działa?' : e);
    process.exit(1);
  });
} else {
  const { app, BrowserWindow, shell, session, dialog } = require('electron');
  const prices = require('./prices');

  if (!app.requestSingleInstanceLock()) app.quit();
  let win = null;

  async function createWindow() {
    let srv;
    try {
      srv = await startServer({
        webDir, vendorDir,
        dataDir: app.getPath('userData'),
        prices,
        onOpenExternal: url => shell.openExternal(url),
      });
    } catch (e) {
      dialog.showErrorBox('PokéScan 2', e.code === 'EADDRINUSE'
        ? 'Port 8766 jest zajęty. Czy PokéScan 2 jest już uruchomiony?'
        : `Nie udało się uruchomić: ${e.message}`);
      app.quit();
      return;
    }
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'));

    win = new BrowserWindow({
      width: 1360,
      height: 900,
      minWidth: 960,
      minHeight: 640,
      backgroundColor: '#07070d',
      title: 'PokéScan 2',
      icon: path.join(root, 'build', 'icon.png'),
      autoHideMenuBar: true,
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#07070d', symbolColor: '#c9c9e0', height: 40 },
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    win.on('closed', () => { prices.destroy(); win = null; });
    win.loadURL(`http://localhost:${srv.port}/`);
  }

  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
}
