// Command Deck: main process.
// Owns the window, tray, storage, calendar fetching and command parsing.
const {
  app, BrowserWindow, Tray, Menu, ipcMain, protocol, net, nativeImage,
  session, globalShortcut, screen, shell, dialog, clipboard, powerMonitor
} = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const store = require('./src/store');
const { parseCommand } = require('./src/commands');
const { fetchCalendars } = require('./src/calendar');

let webpush = null; // loaded on first use
let QRCode = null;

// Sound effects and the boot sequence should play without a click first.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// A private "deck://" scheme serves the app's own files. It lets the voice
// engine load its WebAssembly and modules the same way a website would.
protocol.registerSchemesAsPrivileged([
  { scheme: 'deck', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);

app.setAppUserModelId('com.commanddeck.app');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let win = null;
let tray = null;
const ICON = path.join(__dirname, 'assets', 'icon.png');

function settings() {
  return store.get().settings;
}

function defaultBounds() {
  const wa = screen.getPrimaryDisplay().workArea;
  const width = Math.min(1280, Math.round(wa.width * 0.9));
  const height = Math.min(800, Math.round(wa.height * 0.9));
  return { width, height, x: Math.round(wa.x + (wa.width - width) / 2), y: Math.round(wa.y + (wa.height - height) / 2) };
}

function boundsOnScreen(b) {
  if (!b) return false;
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x < a.x + a.width - 80 && b.x + b.width > a.x + 80 && b.y >= a.y - 20 && b.y < a.y + a.height - 80;
  });
}

function applyWindowMode() {
  if (!win) return;
  const top = settings().windowMode === 'top';
  win.setAlwaysOnTop(top, top ? 'floating' : 'normal');
  applyOpacity(settings().opacity);
  rebuildTrayMenu();
}

function applyOpacity(value) {
  if (!win) return;
  const v = Math.min(1, Math.max(0.3, Number(value) || 1));
  win.setOpacity(v);
}

function createWindow() {
  const saved = store.get().window.bounds;
  const b = boundsOnScreen(saved) ? saved : defaultBounds();

  win = new BrowserWindow({
    ...b,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    transparent: true,
    resizable: false, // resized by the console's own corner grip
    hasShadow: false,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#00000000',
    title: settings().consoleName,
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  applyWindowMode();
  win.loadURL('deck://app/renderer/index.html');
  win.once('ready-to-show', () => win.show());

  let saveTimer = null;
  const saveBounds = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      store.set('window', { bounds: win.getBounds() });
    }, 400);
  };
  win.on('move', saveBounds);
  win.on('resize', saveBounds);

  win.on('show', () => {
    if (win && !win.isDestroyed()) win.webContents.send('deck:shown');
    checkAway();
  });
  win.on('hide', () => checkAway());
  win.on('minimize', () => checkAway());
  win.on('restore', () => checkAway());
  win.webContents.on('did-finish-load', () => { awayState = null; checkAway(); });

  // Closing hides to the tray; Quit lives in the tray menu.
  win.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });

  // Never navigate away or open new windows from inside the console.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible() && win.isFocused()) {
    win.hide();
  } else {
    win.show();
    win.focus();
  }
}

function rebuildTrayMenu() {
  if (!tray) return;
  const s = settings();
  tray.setToolTip(s.consoleName);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Show ${s.consoleName}`, click: () => { win.show(); win.focus(); } },
    { label: 'Hide', click: () => win.hide() },
    { type: 'separator' },
    {
      label: 'Always on top', type: 'checkbox', checked: s.windowMode === 'top',
      click: (item) => {
        s.windowMode = item.checked ? 'top' : 'desk';
        store.set('settings', s);
        applyWindowMode();
        win.webContents.send('deck:settings-changed', s);
      }
    },
    {
      label: 'Start with Windows', type: 'checkbox', checked: !!s.autoStart,
      click: (item) => {
        s.autoStart = item.checked;
        store.set('settings', s);
        applyAutoStart();
        win.webContents.send('deck:settings-changed', s);
      }
    },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
  ]));
}

function createTray() {
  let img = nativeImage.createFromPath(ICON);
  if (!img.isEmpty()) img = img.resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.on('click', toggleWindow);
  rebuildTrayMenu();
}

function applyAutoStart() {
  if (!app.isPackaged) return; // only register the installed app, not dev runs
  app.setLoginItemSettings({ openAtLogin: !!settings().autoStart });
}

function serveFiles() {
  const root = path.resolve(__dirname);
  protocol.handle('deck', (request) => {
    const url = new URL(request.url);
    const rel = decodeURIComponent(url.pathname);
    const file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString()).then((res) => {
      // Cross-origin isolation lets the voice engines use multiple CPU threads.
      const headers = new Headers(res.headers);
      headers.set('Cross-Origin-Opener-Policy', 'same-origin');
      headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
      headers.set('Cross-Origin-Resource-Policy', 'same-origin');
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    });
  });
}

function registerIpc() {
  ipcMain.handle('store:get', () => store.get());

  ipcMain.handle('store:set', (_e, key, value) => {
    const ok = store.set(key, value);
    if (key === 'settings') {
      if (win) win.setTitle(value.consoleName || 'Command Deck');
      applyWindowMode();
      applyAutoStart();
    }
    return ok;
  });

  ipcMain.handle('win:minimize', () => win && win.hide());
  ipcMain.handle('win:setOpacity', (_e, v) => applyOpacity(v));
  ipcMain.handle('win:getBounds', () => win && win.getBounds());
  ipcMain.handle('win:setSize', (_e, w, h) => {
    if (!win) return;
    const b = win.getBounds();
    const width = Math.max(960, Math.round(w));
    const height = Math.max(640, Math.round(h));
    win.setBounds({ x: b.x, y: b.y, width, height });
  });

  ipcMain.handle('cmd:parse', (_e, text, ctx) => parseCommand(text, ctx || {}, new Date()));

  ipcMain.handle('cal:fetch', (_e, calendars, startISO, endISO) =>
    fetchCalendars(calendars || [], new Date(startISO), new Date(endISO)));

  // ---- Field Unit: push keys, push delivery and QR codes
  ipcMain.handle('push:keys', () => {
    if (!webpush) webpush = require('web-push');
    const data = store.get();
    if (!data.push || !data.push.publicKey || !data.push.privateKey) {
      const keys = webpush.generateVAPIDKeys();
      store.set('push', { publicKey: keys.publicKey, privateKey: keys.privateKey });
      store.flush();
    }
    return { publicKey: store.get().push.publicKey };
  });

  ipcMain.handle('push:send', async (_e, subs, payload, subject) => {
    if (!webpush) webpush = require('web-push');
    const keys = store.get().push;
    if (!keys || !keys.privateKey) return { sent: 0, gone: [] };
    const contact = /^https:\/\//.test(subject || '') ? subject : 'mailto:command-deck@example.com';
    webpush.setVapidDetails(contact, keys.publicKey, keys.privateKey);
    const gone = [];
    let sent = 0;
    await Promise.all((subs || []).map(async ({ id, sub }) => {
      try {
        const subscription = typeof sub === 'string' ? JSON.parse(sub) : sub;
        await webpush.sendNotification(subscription, JSON.stringify(payload), { TTL: 3600, urgency: 'high' });
        sent++;
      } catch (err) {
        if (err && (err.statusCode === 404 || err.statusCode === 410)) gone.push(id);
      }
    }));
    return { sent, gone };
  });

  ipcMain.handle('qr:make', async (_e, text) => {
    if (!QRCode) QRCode = require('qrcode');
    return QRCode.toDataURL(String(text), { margin: 2, scale: 8, errorCorrectionLevel: 'M', color: { dark: '#14151BFF', light: '#F4EFE9FF' } });
  });

  ipcMain.handle('update:get', () => ({ ...updateState, current: app.getVersion() }));
  ipcMain.handle('update:check', async () => {
    if (!updater) return { ...updateState, current: app.getVersion() };
    try { await updater.checkForUpdates(); } catch (e) { sendUpdate({ state: 'error', message: String(e.message || e).slice(0, 200) }); }
    return { ...updateState, current: app.getVersion() };
  });
  ipcMain.handle('update:install', () => {
    if (!updater || updateState.state !== 'ready') return false;
    app.isQuitting = true;
    store.flush();
    // Silent install, then Command Deck starts again on its own.
    setImmediate(() => updater.quitAndInstall(true, true));
    return true;
  });
  ipcMain.handle('sys:hostname', () => { try { return require('os').hostname(); } catch (e) { return ''; } });
  ipcMain.handle('clip:write', (_e, text) => {
    clipboard.writeText(String(text || '').slice(0, 2000));
    return true;
  });

  ipcMain.handle('shell:open', (_e, url) => {
    if (typeof url === 'string' && /^https:\/\//i.test(url)) shell.openExternal(url);
  });

  ipcMain.handle('data:export', async () => {
    const stamp = new Date().toISOString().slice(0, 10);
    const res = await dialog.showSaveDialog(win, {
      title: 'Save backup',
      defaultPath: path.join(app.getPath('documents'), `command-deck-backup-${stamp}.json`),
      filters: [{ name: 'Command Deck backup', extensions: ['json'] }]
    });
    if (res.canceled || !res.filePath) return { ok: false };
    store.flush();
    const { window: _w, ...rest } = store.get();
    fs.writeFileSync(res.filePath, JSON.stringify(rest, null, 2), 'utf8');
    return { ok: true, path: res.filePath };
  });

  ipcMain.handle('data:import', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Restore backup',
      properties: ['openFile'],
      filters: [{ name: 'Command Deck backup', extensions: ['json'] }]
    });
    if (res.canceled || !res.filePaths[0]) return { ok: false };
    try {
      const incoming = JSON.parse(fs.readFileSync(res.filePaths[0], 'utf8'));
      if (!incoming || typeof incoming !== 'object' || !incoming.settings) throw new Error('Not a Command Deck backup');
      incoming.window = store.get().window;
      const next = store.replaceAll(incoming);
      return { ok: true, data: next };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

// The interface runs on the private deck:// origin. Google's APIs expect a
// normal web origin, so requests to them are sent as coming from the Field
// Unit's own web address, and the answers are marked as allowed for deck://.
function allowFirebaseFromApp() {
  const filter = { urls: ['https://*.googleapis.com/*', 'https://*.firebaseapp.com/*', 'https://*.web.app/*'] };
  session.defaultSession.webRequest.onBeforeSendHeaders(filter, (details, cb) => {
    const headers = details.requestHeaders;
    const url = (store.get().settings.fieldUnit || {}).url;
    if (headers.Origin && headers.Origin.startsWith('deck://') && url) headers.Origin = url;
    cb({ requestHeaders: headers });
  });
  session.defaultSession.webRequest.onHeadersReceived(filter, (details, cb) => {
    const headers = details.responseHeaders || {};
    for (const k of Object.keys(headers)) {
      if (/^access-control-allow-(origin|credentials)$/i.test(k)) delete headers[k];
    }
    headers['Access-Control-Allow-Origin'] = ['deck://app'];
    headers['Access-Control-Allow-Credentials'] = ['true'];
    cb({ responseHeaders: headers });
  });
}

app.on('second-instance', () => {
  if (win) { win.show(); win.focus(); }
});

// ---------------------------------------------------------------- rest when away
// Tells the console to freeze its looping animations while nobody's at the PC
// (no mouse or keyboard for 5 minutes, screen locked) or while it's hidden.
const AWAY_AFTER = 5 * 60; // seconds
let awayState = null;
let screenLocked = false;
function checkAway() {
  if (!win || win.isDestroyed()) return;
  let idle = 0;
  try { idle = powerMonitor.getSystemIdleTime(); } catch (e) { /* not available */ }
  const away = screenLocked || idle >= AWAY_AFTER || !win.isVisible() || win.isMinimized();
  if (away === awayState) return;
  awayState = away;
  win.webContents.send('deck:away', away);
}
// ---- Automatic updates -------------------------------------------------------------------
// New versions are published as GitHub Releases by the build workflow. The app checks shortly
// after starting and every few hours, downloads quietly, then shows UPDATE READY on the deck.
// Installing happens on that tap, or by itself the next time the app quits.
const UPDATE_EVERY = 4 * 3600 * 1000;
let updater = null;
let updateState = { state: 'idle' };
function sendUpdate(next) {
  updateState = { ...updateState, ...next };
  if (win && !win.isDestroyed()) win.webContents.send('update:state', updateState);
}
function setupUpdates() {
  if (!app.isPackaged) { updateState = { state: 'dev' }; return; }
  try { updater = require('electron-updater').autoUpdater; } catch (e) { updateState = { state: 'error', message: 'Updater missing' }; return; }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.on('checking-for-update', () => sendUpdate({ state: 'checking', checkedAt: Date.now() }));
  updater.on('update-available', (info) => sendUpdate({ state: 'downloading', version: info.version, percent: 0 }));
  updater.on('download-progress', (p) => sendUpdate({ state: 'downloading', percent: Math.round(p.percent || 0) }));
  updater.on('update-not-available', () => sendUpdate({ state: 'current', checkedAt: Date.now() }));
  updater.on('update-downloaded', (info) => sendUpdate({ state: 'ready', version: info.version }));
  updater.on('error', (err) => sendUpdate({ state: 'error', message: String((err && err.message) || err).slice(0, 200), checkedAt: Date.now() }));
  const check = () => { if (updateState.state !== 'ready' && updateState.state !== 'downloading') updater.checkForUpdates().catch(() => {}); };
  setTimeout(check, 20000);
  setInterval(check, UPDATE_EVERY);
}

function watchAway() {
  setInterval(checkAway, 2000);
  powerMonitor.on('lock-screen', () => { screenLocked = true; checkAway(); });
  powerMonitor.on('unlock-screen', () => { screenLocked = false; checkAway(); });
  powerMonitor.on('suspend', () => { screenLocked = true; checkAway(); });
  powerMonitor.on('resume', () => { screenLocked = false; checkAway(); });
}

app.whenReady().then(() => {
  if (!gotLock) return;
  store.init(app.getPath('userData'));

  // Only the microphone is ever requested, and only for the voice button.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'media' || permission === 'notifications');
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) =>
    permission === 'media' || permission === 'notifications');

  serveFiles();
  registerIpc();
  allowFirebaseFromApp();
  createWindow();
  watchAway();
  createTray();
  applyAutoStart();
  setupUpdates();

  globalShortcut.register('Control+Alt+Space', toggleWindow);
});

app.on('before-quit', () => {
  app.isQuitting = true;
  store.flush();
});

app.on('will-quit', () => globalShortcut.unregisterAll());

app.on('window-all-closed', (e) => e.preventDefault());
