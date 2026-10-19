'use strict';
/*
 * Panda Tray — a Windows tray companion for Panda Dashboard.
 *
 *  - Left-click the tray icon: quick panel (rate now, battery, solar, house, heat pump,
 *    room lights and the dashboard's Shortcuts). It hides when you click away.
 *  - "Open dashboard": Panda Dashboard itself, in its own window.
 *  - Right-click: menu (dashboard, settings, start with Windows, quit).
 *
 * It signs in to Home Assistant with a long-lived access token (stored encrypted with
 * Windows DPAPI via safeStorage) and reads Panda Dashboard's own config.js from the
 * add-on, so entities, shortcuts and tariffs are never set up twice.
 */
const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, safeStorage, screen, shell, Notification } = require('electron');
const { HAClient } = require('./ha');
const panda = require('./panda-config');

// One copy only: a second launch just shows the panel
if (!app.requestSingleInstanceLock()) app.exit(0);

const ASSETS = path.join(__dirname, '..', 'assets');
const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');

let tray = null; let panelWin = null; let dashWin = null; let settingsWin = null;
const ha = new HAClient();
let pandaInfo = null;          // { config, slug, panelUrl, personal, tariffSource }
let pandaError = null;
let activeUrl = null;          // whichever address answered (home or away)
let rateTimer = null;
let retryTimer = null;

// ── Settings (token encrypted at rest) ──
function readSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8'));
    let token = '';
    if (raw.tokenEnc && safeStorage.isEncryptionAvailable()) token = safeStorage.decryptString(Buffer.from(raw.tokenEnc, 'base64'));
    return { url: raw.url || '', awayUrl: raw.awayUrl || '', token, hideDashOnBlur: raw.hideDashOnBlur !== false, dashSize: raw.dashSize || 'wide' };
  } catch (e) { return { url: 'http://homeassistant.local:8123', awayUrl: '', token: '', hideDashOnBlur: true, dashSize: 'wide' }; }
}
function writeSettings(s) {
  const out = { url: s.url, awayUrl: s.awayUrl, hideDashOnBlur: s.hideDashOnBlur, dashSize: s.dashSize };
  if (s.token) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows could not encrypt the token');
    out.tokenEnc = safeStorage.encryptString(s.token).toString('base64');
  }
  fs.mkdirSync(path.dirname(SETTINGS_FILE()), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(out, null, 2));
}
let settings = null;

// Only accept plain http on the local network; anything else must be https
function addressOk(u) {
  try {
    const x = new URL(u);
    if (x.protocol === 'https:') return true;
    if (x.protocol !== 'http:') return false;
    return /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(x.hostname) || /\.local$|\.lan$|\.home$|^[a-z0-9-]+$/i.test(x.hostname);
  } catch (e) { return false; }
}

// Which address answers: home first, then away. Checked without the token.
async function pickAddress() {
  for (const u of [settings.url, settings.awayUrl].filter(Boolean)) {
    if (!addressOk(u)) continue;
    try {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 4000);
      const r = await fetch(`${u.replace(/\/+$/, '')}/manifest.json`, { signal: ctrl.signal });
      clearTimeout(t);
      if (r.ok) return u.replace(/\/+$/, '');
    } catch (e) { /* try the next one */ }
  }
  return null;
}

async function connect() {
  clearTimeout(retryTimer);
  ha.stop(); pandaInfo = null; pandaError = null;
  if (!settings.url || !settings.token) { pandaError = 'Open Settings to connect to Home Assistant.'; pushState(); return; }
  activeUrl = await pickAddress();
  if (!activeUrl) { pandaError = "Can't reach Home Assistant at the home or away address."; pushState(); retryTimer = setTimeout(connect, 30000); return; }
  ha.start(activeUrl, settings.token);
}

ha.on('status', async (s, detail) => {
  if (s === 'connected' && !pandaInfo) {
    try { pandaInfo = await panda.load(ha, activeUrl); pandaError = null; } catch (e) { pandaError = e.message; }
  }
  if (s === 'auth-failed') pandaError = 'Home Assistant rejected the token. Make a new long-lived token and paste it in Settings.';
  if (s === 'offline' && detail) pandaError = `Reconnecting… (${detail})`;
  if (s === 'connected' && pandaInfo) pandaError = null;
  updateTray(); pushState();
});

let pushPending = false;
ha.on('states', () => {
  if (pushPending) return;
  pushPending = true;
  setTimeout(() => { pushPending = false; updateTray(); pushState(); }, 250);
});

// ── What the panel needs: plain values only ──
const num = (id) => { const s = id && ha.states[id]; const v = s ? parseFloat(s.state) : NaN; return Number.isFinite(v) ? v : null; };
const st = (id) => (id && ha.states[id] ? ha.states[id].state : null);

function snapshot() {
  const c = pandaInfo && pandaInfo.config;
  const base = { status: ha.status, error: pandaError, ready: !!c, personal: pandaInfo ? pandaInfo.personal : null };
  if (!c) return base;
  const e = c.energy || {}; const hp = c.heatPump || {};
  const rate = panda.rateNow(c.tariffs);
  const lights = [];
  (c.floors || []).forEach((f) => (f.rooms || []).forEach((r) => {
    if (r.light) lights.push({ id: r.light, name: r.name === r.lightName || !r.lightName ? r.name : `${r.name} · ${r.lightName}` });
    (r.extraLights || []).forEach((l) => lights.push({ id: l.id, name: `${r.name} · ${l.name}` }));
  }));
  const seen = new Set();
  const lightList = lights.filter((l) => !seen.has(l.id) && seen.add(l.id) && ha.states[l.id])
    .map((l) => ({ ...l, on: st(l.id) === 'on', available: !['unavailable', 'unknown'].includes(st(l.id)) }));
  const allLights = [...new Set([
    ...lights.map((l) => l.id),
    ...((c.floorplan && c.floorplan.floors) || []).flatMap((f) => f.rooms.flatMap((r) => r.lights || [])),
  ])];
  const shortcuts = (c.shortcuts || []).map((sc, i) => {
    let sub = ''; let on = false; let ok = true;
    if (sc.toggle) { on = st(sc.toggle) === 'on'; ok = !!ha.states[sc.toggle] && st(sc.toggle) !== 'unavailable'; sub = ok ? (on ? 'On' : 'Off') : 'Unavailable'; }
    else if (sc.press) { ok = !!ha.states[sc.press] && st(sc.press) !== 'unavailable'; sub = ok ? '' : 'Unavailable'; }
    else if (sc.service && sc.entities === 'lights') { const n = allLights.filter((id) => st(id) === 'on').length; sub = n ? `${n} on now` : 'All off'; }
    return { i, name: sc.name, icon: sc.icon || 'power', sub, on, ok, confirm: sc.confirm || null, danger: !!sc.danger };
  });
  const hpPower = num(hp.power);
  return {
    ...base,
    title: c.title || 'Panda Dashboard',
    rate: rate && { offPeak: rate.offPeak, pence: rate.rate * 100, exportPence: rate.export * 100, until: rate.until },
    soc: num(e.soc), battery: num(e.batteryPower), pv: num(e.pvPower), load: num(e.loadPower), grid: num(e.gridPower),
    heatPump: hp.power ? { kw: hpPower, running: hpPower != null && hpPower > (hp.runningAbove ?? 0.1), tank: num(hp.tankTemp) } : null,
    lights: lightList,
    shortcuts,
  };
}

function pushState() { if (panelWin && !panelWin.isDestroyed()) panelWin.webContents.send('state', snapshot()); }

// ── Tray ──
function trayIcon(dim) { return nativeImage.createFromPath(path.join(ASSETS, dim ? 'tray-dim.png' : 'tray.png')); }
function updateTray() {
  if (!tray) return;
  const s = snapshot();
  tray.setImage(trayIcon(s.status !== 'connected'));
  if (!s.ready) { tray.setToolTip(`Panda Tray — ${s.error || 'connecting…'}`); return; }
  const bits = [];
  if (s.soc != null) bits.push(`Battery ${Math.round(s.soc)}%`);
  if (s.rate) bits.push(`${s.rate.pence.toFixed(1)}p ${s.rate.offPeak ? 'cheap' : 'peak'}`);
  if (s.pv != null && s.pv > 0.05) bits.push(`Solar ${s.pv.toFixed(1)} kW`);
  tray.setToolTip(`Panda — ${bits.join(' · ')}`.slice(0, 127));
}

function trayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Quick panel', click: () => showPanel() },
    { label: 'Open dashboard', click: () => openDashboard() },
    { type: 'separator' },
    { label: 'Settings…', click: () => openSettings() },
    { label: 'Start with Windows', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }) },
    { label: 'Reconnect', click: () => connect() },
    { type: 'separator' },
    { label: 'Quit Panda Tray', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
}

// ── Quick panel: a small frameless window above the tray ──
function placeNearTray(win) {
  const b = tray.getBounds(); const [w, h] = win.getSize();
  const d = screen.getDisplayNearestPoint({ x: b.x, y: b.y }).workArea;
  let x = Math.round(b.x + b.width / 2 - w / 2); let y = Math.round(b.y - h - 8);
  if (y < d.y) y = b.y + b.height + 8;                       // taskbar at the top
  x = Math.min(Math.max(x, d.x + 8), d.x + d.width - w - 8);
  y = Math.min(Math.max(y, d.y + 8), d.y + d.height - h - 8);
  win.setPosition(x, y, false);
}

function createPanel() {
  panelWin = new BrowserWindow({
    width: 380, height: 600, show: false, frame: false, resizable: false, skipTaskbar: true,
    alwaysOnTop: true, fullscreenable: false, backgroundColor: '#17212c', roundedCorners: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  panelWin.loadFile(path.join(__dirname, 'panel.html'));
  panelWin.on('blur', () => { if (!panelWin.webContents.isDevToolsOpened()) { panelWin.hide(); panelHiddenAt = Date.now(); } });
  panelWin.webContents.on('did-finish-load', pushState);
  panelWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}
let panelHiddenAt = 0;
function showPanel() {
  if (!panelWin || panelWin.isDestroyed()) createPanel();
  if (panelWin.isVisible()) { panelWin.hide(); return; }
  // Clicking the tray icon while the panel is open blurs it first; don't reopen straight away
  if (Date.now() - panelHiddenAt < 300) return;
  placeNearTray(panelWin); panelWin.show(); panelWin.focus(); pushState();
}

// ── Dashboard window ──
// The dashboard is Home Assistant's own page for the add-on. To avoid a second sign-in,
// the long-lived token is handed to Home Assistant's front end the way it stores its own
// login, and the sidebar is tucked away so the dashboard gets the whole window.
async function openDashboard() {
  if (panelWin && panelWin.isVisible()) panelWin.hide();
  if (!pandaInfo) { openSettings(); return; }
  if (dashWin && !dashWin.isDestroyed()) { dashWin.show(); dashWin.focus(); return; }
  const wa = screen.getPrimaryDisplay().workArea;
  const size = settings.dashSize === 'compact' ? { width: 480, height: 860 } : { width: Math.min(1440, wa.width - 80), height: Math.min(940, wa.height - 60) };
  dashWin = new BrowserWindow({
    ...size, show: false, title: pandaInfo.config.title || 'Panda Dashboard', backgroundColor: '#17212c', autoHideMenuBar: true,
    icon: path.join(ASSETS, 'icon.png'),
    webPreferences: { partition: 'persist:panda', contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  dashWin.setMenuBarVisibility(false);
  // Links out of Home Assistant open in the normal browser
  dashWin.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  dashWin.webContents.on('will-navigate', (ev, url) => { if (!url.startsWith(activeUrl)) { ev.preventDefault(); shell.openExternal(url); } });
  dashWin.on('close', (ev) => { if (!app.isQuitting) { ev.preventDefault(); dashWin.hide(); } });
  dashWin.on('blur', () => { if (settings.hideDashOnBlur && dashWin && !dashWin.isDestroyed() && !dashWin.webContents.isDevToolsOpened()) dashWin.hide(); });

  const tokens = {
    hassUrl: activeUrl, clientId: `${activeUrl}/`, access_token: settings.token, token_type: 'Bearer',
    refresh_token: '', expires_in: 315360000, expires: Date.now() + 315360000 * 1000,
  };
  try {
    await dashWin.loadURL(`${activeUrl}/manifest.json`);   // any page on the HA origin, to reach its storage
    await dashWin.webContents.executeJavaScript(`
      localStorage.setItem('hassTokens', ${JSON.stringify(JSON.stringify(tokens))});
      localStorage.setItem('dockedSidebar', '"always_hidden"');
      true;`);
    await dashWin.loadURL(pandaInfo.panelUrl);
  } catch (e) { /* the page shows Home Assistant's own error */ }
  dashWin.show();
}

// ── Settings window ──
function openSettings() {
  if (panelWin && panelWin.isVisible()) panelWin.hide();
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 520, height: 740, resizable: false, minimizable: false, maximizable: false, title: 'Panda Tray settings',
    backgroundColor: '#17212c', autoHideMenuBar: true, icon: path.join(ASSETS, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  settingsWin.setMenuBarVisibility(false);
  settingsWin.loadFile(path.join(__dirname, 'settings.html'));
  settingsWin.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
}

// ── IPC from the panel and settings ──
// Shortcuts that need confirming are confirmed in the panel itself (tap twice)
ipcMain.handle('panel:shortcut', async (_e, i) => {
  const sc = pandaInfo && (pandaInfo.config.shortcuts || [])[i];
  if (!sc) throw new Error('unknown shortcut');
  if (sc.toggle) {
    const [domain] = sc.toggle.split('.');
    const svc = st(sc.toggle) === 'on' ? 'turn_off' : 'turn_on';
    return ha.callService(['switch', 'light', 'input_boolean', 'fan'].includes(domain) ? domain : 'homeassistant', svc, { entity_id: sc.toggle });
  }
  if (sc.press) return ha.callService('button', 'press', { entity_id: sc.press });
  if (sc.service) {
    const [d, s] = sc.service.split('.');
    let ids = [].concat(sc.entities || []);
    if (sc.entities === 'lights') {
      const c = pandaInfo.config;
      ids = [...new Set([
        ...(c.floors || []).flatMap((f) => (f.rooms || []).flatMap((r) => [r.light, ...(r.extraLights || []).map((l) => l.id)])),
        ...((c.floorplan && c.floorplan.floors) || []).flatMap((f) => f.rooms.flatMap((r) => r.lights || [])),
      ].filter(Boolean))];
    }
    return ha.callService(d, s, { entity_id: ids });
  }
  return null;
});
ipcMain.handle('panel:toggleLight', async (_e, id) => {
  const known = snapshot().lights || [];
  if (!known.some((l) => l.id === id)) throw new Error('not one of the dashboard\'s lights');
  const [domain] = id.split('.');
  return ha.callService(domain === 'light' ? 'light' : 'switch', st(id) === 'on' ? 'turn_off' : 'turn_on', { entity_id: id });
});
ipcMain.handle('panel:openDashboard', () => openDashboard());
ipcMain.handle('panel:openSettings', () => openSettings());
ipcMain.handle('panel:hide', () => { if (panelWin) panelWin.hide(); });
ipcMain.handle('panel:resize', (_e, h) => {
  if (!panelWin) return;
  const height = Math.max(240, Math.min(760, Math.round(h)));
  if (panelWin.getSize()[1] !== height) { panelWin.setSize(380, height); if (panelWin.isVisible()) placeNearTray(panelWin); }
});

ipcMain.handle('settings:get', () => ({ url: settings.url, awayUrl: settings.awayUrl, hasToken: !!settings.token, hideDashOnBlur: settings.hideDashOnBlur, dashSize: settings.dashSize, startWithWindows: app.getLoginItemSettings().openAtLogin, version: app.getVersion() }));
ipcMain.handle('settings:save', async (_e, s) => {
  for (const u of [s.url, s.awayUrl].filter(Boolean)) if (!addressOk(u)) throw new Error(`${u}: use https:// for anything outside your home network`);
  settings = { ...settings, url: s.url.trim(), awayUrl: (s.awayUrl || '').trim(), hideDashOnBlur: !!s.hideDashOnBlur, dashSize: s.dashSize === 'compact' ? 'compact' : 'wide', token: s.token ? s.token.trim() : settings.token };
  writeSettings(settings);
  app.setLoginItemSettings({ openAtLogin: !!s.startWithWindows });
  if (dashWin && !dashWin.isDestroyed()) { app.isQuitting = true; dashWin.destroy(); app.isQuitting = false; dashWin = null; }
  await connect();
  return true;
});
ipcMain.handle('settings:status', () => ({ status: ha.status, error: pandaError, ready: !!pandaInfo, personal: pandaInfo ? pandaInfo.personal : null, tariffs: pandaInfo ? pandaInfo.tariffSource : null, url: activeUrl }));
ipcMain.handle('settings:openTokenPage', () => { if (settings.url && addressOk(settings.url)) shell.openExternal(`${settings.url.replace(/\/+$/, '')}/profile/security`); });

// ── Updates (from this repo's GitHub releases) ──
function checkForUpdates() {
  if (!app.isPackaged) return;
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('update-downloaded', (info) => {
      if (Notification.isSupported()) new Notification({ title: 'Panda Tray update ready', body: `Version ${info.version} installs when you quit or restart the PC.` }).show();
    });
    autoUpdater.checkForUpdates().catch(() => { /* offline or no release yet */ });
  } catch (e) { /* updater not available */ }
}

// ── Start ──
app.on('second-instance', () => showPanel());
app.on('window-all-closed', (e) => e.preventDefault());   // keep running in the tray
app.whenReady().then(() => {
  app.setAppUserModelId('io.github.suchabadpanda.pandatray');
  settings = readSettings();
  tray = new Tray(trayIcon(true));
  tray.setToolTip('Panda Tray');
  tray.on('click', () => showPanel());
  tray.on('right-click', () => tray.popUpContextMenu(trayMenu()));
  createPanel();
  connect();
  if (!settings.token) openSettings();
  clearInterval(rateTimer); rateTimer = setInterval(() => { updateTray(); pushState(); }, 60000);   // rate windows change on the hour
  checkForUpdates();
  setInterval(checkForUpdates, 6 * 3600 * 1000);
});
