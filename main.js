// Command Deck: main process.
// Owns the window, tray, storage, calendar fetching and command parsing.
const {
  app, BrowserWindow, Tray, Menu, ipcMain, protocol, net, nativeImage,
  session, globalShortcut, screen, shell, dialog, clipboard, powerMonitor, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const store = require('./src/store');
const { parseCommand } = require('./src/commands');
const { fetchCalendars } = require('./src/calendar');
const { Lighting, fetchSdkWindows } = require('./src/lighting');
const gemini = require('./src/gemini');

let webpush = null; // loaded on first use
let QRCode = null;

// Sound effects and the boot sequence should play without a click first.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Windows' window-occlusion check can decide a see-through, always-on-top window is hidden and stop
// painting it (Comm Tower 1's dial then looks frozen and ignores clicks). Turn that check off.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

// A private "deck://" scheme serves the app's own files. It lets the voice
// engine load its WebAssembly and modules the same way a website would.
protocol.registerSchemesAsPrivileged([
  { scheme: 'deck', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);

app.setAppUserModelId('com.commanddeck.app');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let win = null;
let tower = null; // Comm Tower 1: the dial (its own small window)
let discord = null; // Discord voice: live mute / deafen (src/discord.js)
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
    minWidth: 720,
    minHeight: 400,
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
    {
      label: `Show ${towerSettings().name.replace(/\w\S*/g, (w) => w[0] + w.slice(1).toLowerCase())}`, type: 'checkbox', checked: towerSettings().on,
      click: (item) => {
        s.tower = { ...(s.tower || {}), on: item.checked };
        store.set('settings', s);
        applyTower();
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
      applyTower();
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

  ipcMain.handle('lights:get', () => (lights ? lights.status() : { status: 'off', devices: [] }));
  ipcMain.handle('lights:configure', (_e, cfg) => (lights ? lights.configure(cfg) : null));
  ipcMain.handle('lights:rescan', () => (lights ? lights.scan() : null));
  ipcMain.handle('lights:test', (_e, name) => (lights ? lights.test(name) : false));
  ipcMain.on('lights:moment', (_e, name, on, data) => { if (lights) lights.moment(name, on, data || {}); });
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
  // ---- Data Recap: recordings live in the app's folder until their audio is deleted
  const recapDir = () => path.join(app.getPath('userData'), 'recaps');
  const recapFile = (id) => {
    const safe = String(id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
    if (!safe) return null;
    const dir = recapDir();
    const hit = fs.existsSync(dir) ? fs.readdirSync(dir).find((f) => f.startsWith(`${safe}.`)) : null;
    return { safe, dir, path: hit ? path.join(dir, hit) : null };
  };
  ipcMain.handle('recap:save', (_e, id, ext, bytes) => {
    const f = recapFile(id);
    if (!f || !bytes) return null;
    fs.mkdirSync(f.dir, { recursive: true });
    const file = path.join(f.dir, `${f.safe}.${String(ext || 'm4a').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'm4a'}`);
    fs.writeFileSync(file, Buffer.from(bytes));
    return { size: fs.statSync(file).size };
  });
  // A meeting recording arrives in pieces while it records, so a crash loses at most a few seconds.
  ipcMain.handle('recap:append', (_e, id, ext, bytes) => {
    const f = recapFile(id);
    if (!f || !bytes) return null;
    fs.mkdirSync(f.dir, { recursive: true });
    const file = f.path || path.join(f.dir, `${f.safe}.${String(ext || 'webm').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'webm'}`);
    fs.appendFileSync(file, Buffer.from(bytes));
    return { size: fs.statSync(file).size };
  });
  ipcMain.handle('recap:read', (_e, id) => {
    const f = recapFile(id);
    if (!f || !f.path) return null;
    return new Uint8Array(fs.readFileSync(f.path));
  });
  ipcMain.handle('recap:delete', (_e, id) => {
    const f = recapFile(id);
    if (!f || !f.path) return false;
    try { fs.unlinkSync(f.path); return true; } catch (e) { return false; }
  });
  ipcMain.handle('recap:info', (_e, id) => {
    const f = recapFile(id);
    if (!f || !f.path) return { exists: false, size: 0 };
    return { exists: true, size: fs.statSync(f.path).size };
  });
  ipcMain.handle('recap:summarize', async (_e, opts) => {
    try { return { ok: true, ...(await gemini.summarize(opts || {})) }; } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  });
  ipcMain.handle('tower:word', async (_e, opts) => {
    try { return { ok: true, ...(await gemini.towerReply(opts || {})) }; } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  });
  ipcMain.handle('tower:lookup', async (_e, opts) => {
    try { return { ok: true, ...(await gemini.towerLookup(opts || {})) }; } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  });
  ipcMain.handle('recap:testKey', (_e, key) => gemini.testKey(String(key || '').trim()));

  ipcMain.handle('sys:hostname', () => { try { return require('os').hostname(); } catch (e) { return ''; } });
  // Memory in use, by part (MB). The deck's own process includes the on-device voice models.
  ipcMain.handle('sys:memory', () => {
    const out = { total: 0, deck: 0, graphics: 0, core: 0, other: 0 };
    for (const m of app.getAppMetrics()) {
      const mb = ((m.memory && (m.memory.privateBytes || m.memory.workingSetSize)) || 0) / 1024;
      const key = m.type === 'Tab' ? 'deck' : m.type === 'GPU' ? 'graphics' : m.type === 'Browser' ? 'core' : 'other';
      out[key] += mb;
      out.total += mb;
    }
    for (const k of Object.keys(out)) out[k] = Math.round(out[k]);
    return out;
  });
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

// ---------------------------------------------------------------- Comm Tower 1
// The dial (v1.31): a small always-on-top core that opens into a fan of keys (record,
// terminal, browser, note, files, your own shortcuts). One frameless, see-through window,
// only ever as big as what shows: the core (closed), the fan (open), or the core plus the
// pop-up terminal. The hub keeps its place on screen while the window changes around it.
// Geometry lives in src/tower-util.js. The deck window still does the work.
const TU = require('./src/tower-util');
let towerLay = { state: 'closed', popH: 400 };
let towerTheme = null; // the deck theme's colors, for the "Match theme" skin
let towerRec = null; // the last recording state, so a rebuilt dial still shows a recording in progress
// Rebuild the dial's window from scratch. Coming back from sleep (or after the graphics
// driver resets), Windows can leave a see-through always-on-top window frozen: drawn, but
// deaf to clicks. A fresh window fixes that. Debounced, so a burst of wake-up events
// (resume, unlock, displays returning) rebuilds it once, after the displays settle.
let towerRebuildT = null;
function rebuildTower(why, ms = 2500) {
  clearTimeout(towerRebuildT);
  towerRebuildT = setTimeout(() => {
    if (!towerSettings().on) return;
    if (tower && !tower.isDestroyed()) tower.destroy();
    tower = null;
    createTower();
  }, ms);
}
function towerSettings() {
  const t = settings().tower || {};
  return {
    on: t.on !== false,
    name: String(t.name || 'COMM TOWER 1').trim().toUpperCase() || 'COMM TOWER 1',
    operator: settings().operatorName || '',
    skin: TU.SKINS.includes(t.skin) ? t.skin : 'eclipse',
    style: TU.STYLES.includes(t.style) ? t.style : 'sentinel',
    layer: t.layer === 'desktop' ? 'desktop' : 'top',
    shortcuts: TU.cleanShortcuts(t.shortcuts).map(({ id, name, kind }) => ({ id, name, kind })),
    max: TU.MAX_SHORTCUTS
  };
}
function towerDisplays() {
  return { list: screen.getAllDisplays(), main: screen.getPrimaryDisplay().id };
}
// The hub's centre on screen (locked to a corner, or wherever it was left).
function towerAnchor() {
  const { list, main } = towerDisplays();
  return TU.anchor(store.get().towerPos, list, main);
}
function towerPlace(center = towerAnchor()) {
  const d = center.display || screen.getDisplayNearestPoint({ x: Math.round(center.x), y: Math.round(center.y) });
  return { ...TU.place(center, towerLay.state, towerLay.popH, d.workArea), pin: center.pin || null };
}
// Size and place the window for the state it's in, and tell the page where its hub is.
function towerApply() {
  if (!tower || tower.isDestroyed()) return;
  const p = towerPlace();
  const cur = tower.getBounds();
  const b = p.bounds;
  if (cur.x !== b.x || cur.y !== b.y || cur.width !== b.width || cur.height !== b.height) tower.setBounds(b);
  sendTower('tower:layout', { state: p.state, hx: p.hx, hy: p.hy, h: p.h, v: p.v, pin: p.pin });
}
function createTower() {
  if (tower && !tower.isDestroyed()) return;
  towerLay = { state: 'closed', popH: 400 };
  const p = towerPlace();
  tower = new BrowserWindow({
    ...p.bounds,
    frame: false, transparent: true, resizable: false, movable: true, hasShadow: false,
    skipTaskbar: true, show: false, focusable: false, alwaysOnTop: towerSettings().layer === 'top', minimizable: false, maximizable: false,
    backgroundColor: '#00000000', title: 'Comm Tower 1',
    webPreferences: { preload: path.join(__dirname, 'tower-preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  });
  towerLayer();
  tower.loadURL('deck://app/renderer/tower.html');
  tower.once('ready-to-show', () => { if (tower && !tower.isDestroyed()) tower.showInactive(); });
  tower.webContents.on('did-finish-load', () => {
    sendTower('tower:config', towerSettings());
    if (towerTheme) sendTower('tower:state', { theme: towerTheme });
    if (towerRec) sendTower('tower:state', { rec: towerRec });
    towerApply();
  });
  // If the dial's page crashes or hangs, start it over.
  tower.webContents.on('render-process-gone', () => rebuildTower('crash', 500));
  tower.on('unresponsive', () => rebuildTower('hang', 500));
  tower.webContents.on('will-navigate', (e) => e.preventDefault());
  tower.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  tower.on('closed', () => { if (tower && tower.isDestroyed()) tower = null; });
}
function sendTower(ch, data) {
  if (tower && !tower.isDestroyed()) tower.webContents.send(ch, data);
}
// ON TOP: above every window. DESKTOP: an ordinary window that others cover; opening it
// (a click on what shows, or Ctrl + Alt + T) brings it to the front until you use another window.
function towerLayer() {
  if (!tower || tower.isDestroyed()) return;
  const top = towerSettings().layer === 'top';
  tower.setAlwaysOnTop(top, top ? 'floating' : 'normal');
}
function towerFront() {
  if (!tower || tower.isDestroyed()) return;
  if (!tower.isVisible()) tower.showInactive();
  tower.moveTop();
}
function applyTower() {
  const t = towerSettings();
  if (t.on) { createTower(); towerLayer(); sendTower('tower:config', t); }
  else if (tower && !tower.isDestroyed()) tower.destroy();
}
function saveTowerSettings(patch) {
  const s = settings();
  s.tower = { ...(s.tower || {}), ...patch };
  store.set('settings', s);
  if (win && !win.isDestroyed()) win.webContents.send('deck:settings-changed', s);
  sendTower('tower:config', towerSettings());
}
// The keys that open something on the computer.
function towerLaunch(a) {
  const t = settings().tower || {};
  const fail = (what) => sendTower('tower:state', { line: { k: 'err', t: `Couldn't open ${what}.` } });
  if (a.kind === 'browser') {
    shell.openExternal(TU.cleanUrl(t.browserUrl) || 'https://www.google.com').catch(() => fail('the browser'));
  } else if (a.kind === 'files') {
    if (process.platform === 'win32') {
      try { require('child_process').spawn('explorer.exe', [], { detached: true, stdio: 'ignore' }).unref(); } catch { fail('File Explorer'); }
    } else shell.openPath(app.getPath('home'));
  } else if (a.kind === 'shortcut') {
    const sc = TU.cleanShortcuts(t.shortcuts).find((x) => x.id === a.id);
    if (!sc) return;
    if (sc.kind === 'web') shell.openExternal(sc.target).catch(() => fail(sc.name));
    else shell.openPath(sc.target).then((err) => { if (err) fail(sc.name); });
  }
}
function registerTowerIpc() {
  // The page says which state it's in (closed / open / term); the window follows.
  ipcMain.on('tower:layout', (_e, state, popH) => {
    towerLay = { state: ['open', 'term'].includes(state) ? state : 'closed', popH: Math.max(200, Math.min(520, Number(popH) || 400)) };
    towerApply();
    if (towerLay.state !== 'closed') towerFront();
  });
  // Press and drag the closed core to move it. Let go near a screen corner and it locks there.
  let dragFrom = null;
  ipcMain.on('tower:drag', (_e, phase, sx, sy) => {
    if (!tower || tower.isDestroyed()) return;
    if (phase === 'start') { const bb = tower.getBounds(); dragFrom = { ...bb, sx, sy }; return; }
    if (!dragFrom) return;
    tower.setBounds({ x: Math.round(dragFrom.x + sx - dragFrom.sx), y: Math.round(dragFrom.y + sy - dragFrom.sy), width: dragFrom.width, height: dragFrom.height });
    if (phase === 'end') {
      dragFrom = null;
      const bb = tower.getBounds();
      const c = { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 };
      const d = screen.getDisplayNearestPoint({ x: Math.round(c.x), y: Math.round(c.y) });
      store.set('towerPos', TU.dropped(c, d, screen.getPrimaryDisplay().id));
      towerApply();
    }
  });
  ipcMain.on('tower:home', () => { store.set('towerPos', null); towerApply(); });
  // The pop-up terminal: what you type goes to the deck, which does the work.
  ipcMain.on('tower:send', (_e, text) => {
    if (win && !win.isDestroyed() && text) win.webContents.send('tower:text', String(text).slice(0, 500));
  });
  // REC controls in the pop-up (start / stop / pause / resume / discard a meeting recording).
  ipcMain.on('tower:rec', (_e, a) => {
    if (win && !win.isDestroyed() && a && a.action) win.webContents.send('tower:rec', { action: String(a.action), title: String(a.title || '').slice(0, 80), sys: a.sys !== false, mic: a.mic !== false });
  });
  // The window only takes keyboard focus while the fan or the terminal is open.
  ipcMain.on('tower:focus', (_e, on) => {
    if (!tower || tower.isDestroyed()) return;
    tower.setFocusable(!!on);
    if (on) { tower.focus(); tower.webContents.focus(); }
  });
  ipcMain.on('tower:launch', (_e, a) => { if (a && a.kind) towerLaunch({ kind: String(a.kind), id: String(a.id || '') }); });
  // Your own shortcuts (the + key): add, remove, or pick a program / folder with the system dialog.
  ipcMain.handle('tower:shortcut', async (_e, a) => {
    const t = settings().tower || {};
    const list = TU.cleanShortcuts(t.shortcuts);
    if (!a || !a.action) return { ok: false };
    if (a.action === 'pick') {
      const folder = a.what === 'folder';
      const res = await dialog.showOpenDialog(tower && !tower.isDestroyed() ? tower : win, {
        title: folder ? 'Pick a folder' : 'Pick a program or file',
        properties: [folder ? 'openDirectory' : 'openFile'],
        ...(folder ? {} : { filters: [{ name: 'Programs and shortcuts', extensions: ['exe', 'lnk', 'bat', 'cmd', 'url'] }, { name: 'Any file', extensions: ['*'] }] })
      });
      return res.canceled || !res.filePaths[0] ? { ok: false } : { ok: true, path: res.filePaths[0] };
    }
    if (a.action === 'add') {
      if (list.length >= TU.MAX_SHORTCUTS) return { ok: false, error: `The dial holds ${TU.MAX_SHORTCUTS} shortcuts. Remove one first.` };
      const n = TU.normalizeShortcut({ name: a.name, target: a.target });
      if (!n.ok) return n;
      saveTowerSettings({ shortcuts: [...list, { id: `sc_${Date.now().toString(36)}`, name: n.name, kind: n.kind, target: n.target }] });
      return { ok: true, name: n.name };
    }
    if (a.action === 'remove') {
      saveTowerSettings({ shortcuts: list.filter((x) => x.id !== String(a.id)) });
      return { ok: true };
    }
    return { ok: false };
  });
  // Deck → dial: reply lines, busy, recording state, and the deck theme's colors.
  ipcMain.on('tower:state', (_e, st) => {
    if (st && st.theme) towerTheme = st.theme;
    if (st && st.rec && st.rec.state) { const { levels, ...r } = st.rec; towerRec = r; }
    sendTower('tower:state', st);
  });
  // Displays come and go (and Windows renumbers them): put the dial back where it belongs.
  for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(ev, () => towerApply());
  // Health check: once a minute, ask the dial's page to answer. No answer within 5 s means it's
  // frozen: rebuild it.
  setInterval(() => {
    if (!tower || tower.isDestroyed() || !towerSettings().on) return;
    let answered = false;
    tower.webContents.executeJavaScript('1').then(() => { answered = true; }).catch(() => {});
    setTimeout(() => { if (!answered && tower && !tower.isDestroyed()) rebuildTower('frozen', 0); }, 5000);
  }, 60 * 1000);
  // Waking up: rebuild the dial once things settle (see rebuildTower()).
  powerMonitor.on('resume', () => rebuildTower('resume'));
  powerMonitor.on('unlock-screen', () => rebuildTower('unlock'));
  app.on('child-process-gone', (_e, d) => { if (d && d.type === 'GPU') rebuildTower('gpu', 1500); });
}

// ---------------------------------------------------------------- Discord voice
// The mute / deafen icons beside Hail. Runs here (the pipe to Discord is a local socket);
// the deck window gets each change as 'discord:state'.
function startDiscord() {
  const { DiscordVoice } = require('./src/discord');
  discord = new DiscordVoice({
    load: () => store.get().discord || {},
    save: (patch) => store.set('discord', { ...(store.get().discord || {}), ...patch }),
    fetch: (u, o) => net.fetch(u, o)
  });
  discord.on('state', (st) => { if (win && !win.isDestroyed()) win.webContents.send('discord:state', st); });
  discord.start();
}
function registerDiscordIpc() {
  ipcMain.handle('discord:get', () => {
    const d = store.get().discord || {};
    return { ...(discord ? discord.state : { status: 'off', mute: false, deaf: false }), clientId: d.clientId || '', hasSecret: !!d.clientSecret };
  });
  ipcMain.handle('discord:config', (_e, cfg) => {
    const d = store.get().discord || {};
    const clientId = String((cfg && cfg.clientId) || '').trim();
    const secretIn = String((cfg && cfg.clientSecret) || '').trim();
    const clientSecret = secretIn || (clientId === d.clientId ? d.clientSecret : '');
    const changed = clientId !== d.clientId || clientSecret !== d.clientSecret;
    store.set('discord', changed ? { clientId, clientSecret, accessToken: '', refreshToken: '', expiresAt: 0 } : d);
    if (discord) { if (changed) discord.restart(); else discord.start(); }
    return { ok: true };
  });
  ipcMain.handle('discord:forget', () => {
    store.set('discord', { clientId: '', clientSecret: '', accessToken: '', refreshToken: '', expiresAt: 0 });
    if (discord) discord.stop();
    return { ok: true };
  });
  ipcMain.handle('discord:set', async (_e, patch) => {
    try { return { ok: true, ...(await discord.set(patch || {})) }; } catch (e) { return { ok: false, ...(discord ? discord.state : {}), error: e.message }; }
  });
}

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

// ---- Rig lighting (iCUE): see src/lighting.js ------------------------------------------------
let lights = null;
function setupLighting() {
  const fake = process.env.DECK_FAKE_ICUE; // development: a stand-in SDK library (test/fixtures/fake-icue.c)
  lights = new Lighting({
    dir: path.join(app.getPath('userData'), 'icue'),
    platform: fake ? 'win32' : process.platform,
    loadSdk: (dll) => require('./src/icue').loadIcue(dll),
    fetchSdk: fake ? async () => fake : (dir) => fetchSdkWindows(dir, { fetch: (u) => net.fetch(u), execFile: require('child_process').execFile }),
    onState: (s) => { if (win && !win.isDestroyed()) win.webContents.send('lights:state', s); }
  });
  const cfg = (store.get().settings || {}).lighting;
  if (cfg && cfg.enabled) lights.configure(cfg).catch(() => {});
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
  // Record a meeting (v1.28): the deck asks for the screen only to get what the computer
  // plays ("loopback" audio); the picture is dropped right away and never saved.
  session.defaultSession.setDisplayMediaRequestHandler((_req, callback) => {
    desktopCapturer.getSources({ types: ['screen'] })
      .then((sources) => callback(sources[0] ? { video: sources[0], audio: 'loopback' } : {}))
      .catch(() => callback({}));
  });

  serveFiles();
  registerIpc();
  registerTowerIpc();
  registerDiscordIpc();
  allowFirebaseFromApp();
  createWindow();
  applyTower();
  startDiscord();
  watchAway();
  createTray();
  applyAutoStart();
  setupUpdates();
  setupLighting();

  globalShortcut.register('Control+Alt+Space', toggleWindow);
  // Ctrl + Alt + T: opens Comm Tower 1's dial from any app (or the deck's terminal, if the dial is hidden).
  globalShortcut.register('Control+Alt+T', () => {
    if (tower && !tower.isDestroyed()) {
      towerFront();
      sendTower('tower:open');
    } else if (win && !win.isDestroyed()) {
      if (!win.isVisible()) win.show();
      win.focus();
      win.webContents.send('term:open');
    }
  });
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (lights) lights.shutdown(); // hand the lights back to iCUE
  if (discord) discord.stop();
  store.flush();
});

app.on('will-quit', () => globalShortcut.unregisterAll());

app.on('window-all-closed', (e) => e.preventDefault());
