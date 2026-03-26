/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║            SMART STORE WMS — ELECTRON MAIN PROCESS v3.0         ║
 * ║         Emaar Al Bader Warehouse Management System               ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Features:
 *  • Multi-tab BrowserView system (max 10 tabs)
 *  • Full CDN whitelist (Bootstrap, jQuery, Vue, React, Angular,
 *    Google Fonts, Font Awesome, cdnjs, jsDelivr, unpkg, Tailwind,
 *    all WASM language runtimes: Python/Pyodide, PHP-WASM, Ruby/Opal,
 *    SQL/sql.js, Lua/fengari, Emscripten C/C++ builds)
 *  • Download manager with progress, notifications, open-in-folder
 *  • Print (OS dialog) + Save as PDF
 *  • Screenshot (PNG to Downloads)
 *  • Bookmarks (persisted to JSON)
 *  • History (persisted to JSON)
 *  • Zoom per tab (25%–500%)
 *  • Find in page (next/prev/stop)
 *  • Full-screen (F11)
 *  • Custom right-click context menu
 *  • Native app menu with all keyboard shortcuts
 *  • Back/Forward state synced to UI
 *  • Favicon per tab
 *  • Tab pin / duplicate
 *  • Titlebar window controls (minimize/maximize/close)
 *  • Theme support (shell sends preference; main window frameless option)
 */

'use strict';

const {
  app, BrowserWindow, BrowserView, ipcMain,
  session, shell, dialog, Menu, globalShortcut,
  Notification, nativeImage, clipboard,
} = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

// ══════════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════════

const APP_DOMAIN    = 'arman.ahrtechdiv.com';
const HOME_URL      = 'https://arman.ahrtechdiv.com';
const MAX_TABS      = 10;
const TABBAR_H      = 110;   // px — must match --bar-total in index.html
const DATA_DIR      = path.join(app.getPath('userData'), 'smart-store');
const BM_FILE       = path.join(DATA_DIR, 'bookmarks.json');
const HIST_FILE     = path.join(DATA_DIR, 'history.json');

// ── CDN WHITELIST ────────────────────────────────────────────
const CDN_WHITELIST = [
  // App
  'arman.ahrtechdiv.com', 'ahrtechdiv.com',
  // Bootstrap + CSS frameworks
  'cdn.jsdelivr.net', 'jsdelivr.net',
  'stackpath.bootstrapcdn.com', 'maxcdn.bootstrapcdn.com', 'bootstrapcdn.com',
  'unpkg.com', 'cdnjs.cloudflare.com',
  'cdn.statically.io', 'rawcdn.githack.com', 'raw.githubusercontent.com',
  // Google
  'fonts.googleapis.com', 'fonts.gstatic.com', 'ajax.googleapis.com',
  'apis.google.com', 'www.google-analytics.com', 'ssl.google-analytics.com',
  'analytics.google.com', 'www.googletagmanager.com', 'tagmanager.google.com',
  'maps.googleapis.com', 'maps.gstatic.com', 'www.gstatic.com',
  // Font Awesome
  'use.fontawesome.com', 'ka-f.fontawesome.com', 'kit.fontawesome.com',
  // jQuery
  'code.jquery.com',
  // Data / Charts
  'cdn.datatables.net', 'cdn.plot.ly', 'cdn.syncfusion.com',
  'cdn.ag-grid.com', 'ag-grid.com',
  // Editors
  'cdn.quilljs.com', 'cdn.ckeditor.com', 'cdn.tiny.cloud',
  // Icons
  'cdn.materialdesignicons.com',
  // Socket / realtime
  'cdn.socket.io',
  // Payment
  'js.stripe.com', 'checkout.stripe.com', 'api.stripe.com',
  // Monitoring
  'cdn.sentry.io', 'browser.sentry-cdn.com',
  // Maps
  'openstreetmap.org', 'tile.openstreetmap.org',
  // Microsoft CDN
  'ajax.aspnetcdn.com', 'az416426.vo.msecnd.net',
  // Local
  'localhost', '127.0.0.1', '::1',
];

function isAllowed(host) {
  if (!host) return false;
  return CDN_WHITELIST.some(w => host === w || host.endsWith('.' + w));
}

// ══════════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════════

/** @type {BrowserWindow} */
let win;

const tabs     = [];
let   nextId   = 1;
let   activeId = null;
const dlMap    = new Map();

// ── Persistent data ──────────────────────────────────────────
let bookmarks = [];
let history   = [];

// ══════════════════════════════════════════════════════════════
// BOOTSTRAP
// ══════════════════════════════════════════════════════════════

app.whenReady().then(() => {
  ensureDataDir();
  loadPersisted();
  buildWindow();
  configSession();
  registerShortcuts();
  buildMenu();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate',          () => { if (!BrowserWindow.getAllWindows().length) buildWindow(); });
app.on('will-quit',         () => globalShortcut.unregisterAll());

// ══════════════════════════════════════════════════════════════
// DATA PERSISTENCE
// ══════════════════════════════════════════════════════════════

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadPersisted() {
  try { bookmarks = JSON.parse(fs.readFileSync(BM_FILE, 'utf8')); } catch {}
  try { history   = JSON.parse(fs.readFileSync(HIST_FILE, 'utf8')); } catch {}
}

function saveBM()   { fs.writeFileSync(BM_FILE,   JSON.stringify(bookmarks, null, 2)); }
function saveHist() { fs.writeFileSync(HIST_FILE,  JSON.stringify(history.slice(0, 500), null, 2)); }

function pushHistory(url, title) {
  if (!url || url.startsWith('about:')) return;
  history.unshift({ url, title, ts: Date.now() });
  if (history.length > 500) history = history.slice(0, 500);
  saveHist();
}

// ══════════════════════════════════════════════════════════════
// SESSION
// ══════════════════════════════════════════════════════════════

function configSession() {
  const ses = session.defaultSession;

  ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (det, cb) => {
    const u = det.url;
    if (u.startsWith('devtools://') || u.startsWith('file://') ||
        u.startsWith('data:')       || u.startsWith('blob:')   ||
        u.startsWith('chrome-extension://') || u.startsWith('ws:') || u.startsWith('wss:')) {
      return cb({ cancel: false });
    }
    try {
      const host = new URL(u).hostname;
      if (isAllowed(host)) return cb({ cancel: false });
      if (det.resourceType === 'mainFrame') send('nav-blocked', host);
      cb({ cancel: true });
    } catch { cb({ cancel: false }); }
  });

  ses.webRequest.onHeadersReceived((det, cb) => {
    const h = { ...det.responseHeaders };
    delete h['x-frame-options']; delete h['X-Frame-Options'];
    delete h['content-security-policy']; delete h['Content-Security-Policy'];
    cb({ responseHeaders: h });
  });

  ses.on('will-download', (_, item) => interceptDL(item));
}

// ══════════════════════════════════════════════════════════════
// WINDOW
// ══════════════════════════════════════════════════════════════

function buildWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 980, minHeight: 640,
    title: 'Smart Store WMS',
    backgroundColor: '#0d1117',
    show: false,
    frame: true,          // keep OS frame; custom titlebar is optional
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => { win.show(); openTab(HOME_URL); });

  ['resize','maximize','unmaximize','enter-full-screen','leave-full-screen']
    .forEach(e => win.on(e, relayout));
}

function viewBounds() {
  const [w, h] = win.getContentSize();
  return { x: 0, y: TABBAR_H, width: w, height: h - TABBAR_H };
}

function relayout() {
  const t = tabs.find(t => t.id === activeId);
  if (t) t.view.setBounds(viewBounds());
}

// ══════════════════════════════════════════════════════════════
// TAB LIFECYCLE
// ══════════════════════════════════════════════════════════════

function openTab(url, background = false) {
  if (tabs.length >= MAX_TABS) return send('toast', { msg: `Max ${MAX_TABS} tabs`, type: 'warning' });

  const view = new BrowserView({
    webPreferences: {
      contextIsolation: true, nodeIntegration: false,
      javascript: true, images: true, plugins: true,
      webSecurity: false,   // required for CDN cross-origin
      devTools: true,
    },
  });

  const id  = nextId++;
  const tab = { id, view, title: 'New Tab', url, zoom: 1, canBack: false, canFwd: false, favicon: null, pinned: false, loading: false };
  tabs.push(tab);

  const wc = view.webContents;

  wc.on('will-navigate', (ev, dest) => {
    try { const h = new URL(dest).hostname; if (!isAllowed(h)) { ev.preventDefault(); send('nav-blocked', h); } }
    catch {}
  });
  wc.on('will-redirect', (ev, dest) => {
    try { const h = new URL(dest).hostname; if (!isAllowed(h)) ev.preventDefault(); }
    catch {}
  });

  wc.on('page-title-updated', (_, t) => {
    tab.title = t || 'Smart Store';
    send('tab:update', { id, title: tab.title, url: tab.url });
  });
  wc.on('did-navigate', (_, u) => {
    tab.url = u;
    syncNav(tab);
    send('tab:update', { id, title: tab.title, url: u });
    send('url:changed', { id, url: u });
    pushHistory(u, tab.title);
  });
  wc.on('did-navigate-in-page', (_, u) => { tab.url = u; syncNav(tab); send('url:changed', { id, url: u }); });

  wc.on('did-start-loading', () => { tab.loading = true;  send('tab:loading', { id, v: true  }); });
  wc.on('did-stop-loading',  () => { tab.loading = false; send('tab:loading', { id, v: false }); syncNav(tab); });

  wc.on('page-favicon-updated', (_, icons) => {
    if (icons[0]) { tab.favicon = icons[0]; send('tab:favicon', { id, url: icons[0] }); }
  });

  wc.setWindowOpenHandler(({ url: nu }) => {
    try { if (isAllowed(new URL(nu).hostname)) openTab(nu); } catch {}
    return { action: 'deny' };
  });

  wc.on('context-menu', (ev, p) => { ev.preventDefault(); ctxMenu(p, view).popup({ window: win }); });

  wc.loadURL(url);
  if (!background) activateTab(id);
  send('tab:opened', { id, title: 'New Tab', url, pinned: false });
}

function activateTab(id) {
  win.getBrowserViews().forEach(v => win.removeBrowserView(v));
  const tab = tabs.find(t => t.id === id);
  if (!tab) return;
  activeId = id;
  win.addBrowserView(tab.view);
  tab.view.setBounds(viewBounds());
  tab.view.webContents.setZoomFactor(tab.zoom);
  send('tab:active', { id, canBack: tab.canBack, canFwd: tab.canFwd, zoom: Math.round(tab.zoom * 100), url: tab.url });
}

function closeTab(id) {
  if (tabs.length <= 1) return send('toast', { msg: 'Cannot close the last tab', type: 'info' });
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;
  const tab = tabs[idx];
  win.removeBrowserView(tab.view);
  tab.view.webContents.destroy();
  tabs.splice(idx, 1);
  const next = tabs[Math.min(idx, tabs.length - 1)];
  activateTab(next.id);
  send('tab:closed', { id, nextId: next.id });
}

function duplicateTab(id) {
  const tab = tabs.find(t => t.id === id);
  if (tab) openTab(tab.url);
}

function syncNav(tab) {
  tab.canBack = tab.view.webContents.canGoBack();
  tab.canFwd  = tab.view.webContents.canGoForward();
  send('nav:state', { id: tab.id, canBack: tab.canBack, canFwd: tab.canFwd });
}

// ══════════════════════════════════════════════════════════════
// ZOOM
// ══════════════════════════════════════════════════════════════

function zoomBy(delta, reset = false) {
  const tab = tabs.find(t => t.id === activeId); if (!tab) return;
  tab.zoom = reset ? 1 : Math.max(0.25, Math.min(5, tab.zoom + delta));
  tab.view.webContents.setZoomFactor(tab.zoom);
  send('zoom:changed', { zoom: Math.round(tab.zoom * 100) });
}
function zoomSet(pct) {
  const tab = tabs.find(t => t.id === activeId); if (!tab) return;
  tab.zoom = Math.max(0.25, Math.min(5, pct / 100));
  tab.view.webContents.setZoomFactor(tab.zoom);
  send('zoom:changed', { zoom: Math.round(tab.zoom * 100) });
}

// ══════════════════════════════════════════════════════════════
// PRINT / PDF / SCREENSHOT
// ══════════════════════════════════════════════════════════════

function printPage() {
  const tab = tabs.find(t => t.id === activeId); if (!tab) return;
  tab.view.webContents.print({
    silent: false, printBackground: true, color: true,
    margins: { marginType: 'default' }, pageSize: 'A4',
  }, (ok, err) => { if (!ok) console.warn('[print]', err); });
}

async function savePDF() {
  const tab = tabs.find(t => t.id === activeId); if (!tab) return;
  const safe = (tab.title || 'page').replace(/[\\/:*?"<>|]/g, '_').trim() || 'page';
  const dest = path.join(app.getPath('downloads'), `${safe}.pdf`);
  try {
    const buf = await tab.view.webContents.printToPDF({
      printBackground: true, landscape: false, pageSize: 'A4',
      margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 },
    });
    fs.writeFileSync(dest, buf);
    send('dl:complete', { id: 'pdf-' + Date.now(), filename: path.basename(dest), savePath: dest });
    notify('📄 PDF Saved', path.basename(dest));
    const { response } = await dialog.showMessageBox(win, {
      type: 'info', title: 'PDF Saved',
      message: path.basename(dest), detail: dest,
      buttons: ['Open File', 'Show in Folder', 'Close'],
    });
    if (response === 0) shell.openPath(dest);
    if (response === 1) shell.showItemInFolder(dest);
  } catch (e) { dialog.showErrorBox('PDF Error', e.message); }
}

async function takeScreenshot() {
  const tab = tabs.find(t => t.id === activeId); if (!tab) return null;
  try {
    const img  = await tab.view.webContents.capturePage();
    const safe = (tab.title || 'screenshot').replace(/[\\/:*?"<>|]/g, '_').trim();
    const dest = path.join(app.getPath('downloads'), `${safe}-${Date.now()}.png`);
    fs.writeFileSync(dest, img.toPNG());
    send('dl:complete', { id: 'ss-' + Date.now(), filename: path.basename(dest), savePath: dest });
    notify('📸 Screenshot Saved', path.basename(dest));
    send('screenshot:done', { savePath: dest });
    return dest;
  } catch (e) { return null; }
}

// ══════════════════════════════════════════════════════════════
// DOWNLOADS
// ══════════════════════════════════════════════════════════════

function interceptDL(item) {
  const filename = item.getFilename();
  const total    = item.getTotalBytes();
  const dlId     = `dl-${Date.now()}`;
  const dest     = path.join(app.getPath('downloads'), filename);
  item.setSavePath(dest);
  dlMap.set(dlId, { filename, dest });
  send('dl:start', { id: dlId, filename, total, dest });

  item.on('updated', (_, state) => {
    if (state === 'progressing') {
      const recv = item.getReceivedBytes();
      send('dl:progress', { id: dlId, recv, total, pct: total > 0 ? Math.round((recv / total) * 100) : -1 });
    }
    if (state === 'interrupted') { dlMap.delete(dlId); send('dl:error', { id: dlId, filename }); }
  });
  item.once('done', (_, state) => {
    dlMap.delete(dlId);
    if (state === 'completed') { send('dl:complete', { id: dlId, filename, savePath: dest }); notify('✅ Download Complete', filename); }
    else send('dl:error', { id: dlId, filename });
  });
}

function notify(title, body) { try { new Notification({ title, body }).show(); } catch {} }

// ══════════════════════════════════════════════════════════════
// BOOKMARKS
// ══════════════════════════════════════════════════════════════

function addBM({ url, title }) {
  if (bookmarks.find(b => b.url === url)) return;
  bookmarks.push({ id: Date.now(), url, title: title || url, ts: Date.now() });
  saveBM();
}
function removeBM(id) { bookmarks = bookmarks.filter(b => b.id !== id); saveBM(); }

// ══════════════════════════════════════════════════════════════
// CONTEXT MENU
// ══════════════════════════════════════════════════════════════

function ctxMenu(p, view) {
  const wc = view.webContents;
  const items = [];

  if (wc.canGoBack())    items.push({ label: '← Back',   click: () => wc.goBack() });
  if (wc.canGoForward()) items.push({ label: '→ Forward', click: () => wc.goForward() });
  items.push({ label: '↺ Reload', click: () => wc.reload() });
  items.push({ type: 'separator' });

  if (p.selectionText?.trim()) {
    items.push({ label: '📋 Copy',         role: 'copy' });
    items.push({ label: '🔍 Search Web',   click: () => shell.openExternal(`https://google.com/search?q=${encodeURIComponent(p.selectionText)}`) });
    items.push({ type: 'separator' });
  }
  if (p.mediaType === 'image' && p.srcURL) {
    items.push({ label: '💾 Save Image',    click: () => wc.downloadURL(p.srcURL) });
    items.push({ label: '📋 Copy Image URL',click: () => clipboard.writeText(p.srcURL) });
    items.push({ type: 'separator' });
  }
  if (p.linkURL) {
    try { if (isAllowed(new URL(p.linkURL).hostname)) items.push({ label: '🗂 Open in New Tab', click: () => openTab(p.linkURL) }); } catch {}
    items.push({ label: '💾 Download Link',  click: () => wc.downloadURL(p.linkURL) });
    items.push({ label: '📋 Copy Link',      click: () => clipboard.writeText(p.linkURL) });
    items.push({ type: 'separator' });
  }

  items.push({ label: '🖨  Print Page…',       click: printPage });
  items.push({ label: '📄 Save as PDF…',        click: savePDF   });
  items.push({ label: '📸 Screenshot',          click: () => takeScreenshot() });
  items.push({ label: '📂 Downloads Folder',    click: () => shell.openPath(app.getPath('downloads')) });
  items.push({ type: 'separator' });

  const curZ = Math.round((tabs.find(t => t.id === activeId)?.zoom ?? 1) * 100);
  items.push({ label: `🔍 Zoom (${curZ}%)`, submenu: [
    { label: 'Zoom In   Ctrl++', click: () => zoomBy(0.1)  },
    { label: 'Zoom Out  Ctrl+-', click: () => zoomBy(-0.1) },
    { label: 'Reset     Ctrl+0', click: () => zoomBy(0, true) },
    { type: 'separator' },
    ...[50, 75, 100, 125, 150, 175, 200].map(z => ({ label: z + '%', click: () => zoomSet(z) })),
  ]});
  items.push({ type: 'separator' });
  items.push({ label: '🔧 Inspect Element',    click: () => wc.inspectElement(p.x, p.y) });
  items.push({ label: '🖥 DevTools',           click: () => wc.isDevToolsOpened() ? wc.closeDevTools() : wc.openDevTools({ mode: 'detach' }) });

  return Menu.buildFromTemplate(items);
}

// ══════════════════════════════════════════════════════════════
// APP MENU
// ══════════════════════════════════════════════════════════════

function buildMenu() {
  const wv = () => tabs.find(t => t.id === activeId)?.view.webContents;
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '&File', submenu: [
      { label: 'New Tab',          accelerator: 'CmdOrCtrl+T', click: () => openTab(HOME_URL) },
      { label: 'Duplicate Tab',    accelerator: 'CmdOrCtrl+D', click: () => activeId && duplicateTab(activeId) },
      { label: 'Reload',           accelerator: 'CmdOrCtrl+R', click: () => wv()?.reload() },
      { label: 'Close Tab',        accelerator: 'CmdOrCtrl+W', click: () => activeId && closeTab(activeId) },
      { type: 'separator' },
      { label: '🖨  Print…',       accelerator: 'CmdOrCtrl+P', click: printPage },
      { label: '📄 Save as PDF…',                               click: savePDF   },
      { label: '📸 Screenshot',                                 click: takeScreenshot },
      { type: 'separator' },
      { label: 'Quit',             accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
    ]},
    { label: '&Edit', submenu: [
      { label: 'Find in Page',     accelerator: 'CmdOrCtrl+F', click: () => send('find:open') },
      { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
    ]},
    { label: '&View', submenu: [
      { label: 'Zoom In',          accelerator: 'CmdOrCtrl+Plus',  click: () => zoomBy(0.1)      },
      { label: 'Zoom Out',         accelerator: 'CmdOrCtrl+-',     click: () => zoomBy(-0.1)     },
      { label: 'Reset Zoom',       accelerator: 'CmdOrCtrl+0',     click: () => zoomBy(0, true)  },
      { type: 'separator' },
      { label: 'Full Screen',      accelerator: 'F11',             click: () => win.setFullScreen(!win.isFullScreen()) },
      { type: 'separator' },
      { label: 'DevTools',         accelerator: 'F12',             click: () => { const w = wv(); w?.isDevToolsOpened() ? w.closeDevTools() : w?.openDevTools({ mode: 'detach' }); } },
    ]},
    { label: '&Navigate', submenu: [
      { label: 'Back',             accelerator: 'Alt+Left',  click: () => { const w = wv(); if (w?.canGoBack())    w.goBack();    } },
      { label: 'Forward',          accelerator: 'Alt+Right', click: () => { const w = wv(); if (w?.canGoForward()) w.goForward(); } },
      { label: 'Home',                                        click: () => wv()?.loadURL(HOME_URL) },
    ]},
    { label: '&Download', submenu: [
      { label: '📂 Open Downloads', click: () => shell.openPath(app.getPath('downloads')) },
      { label: '📄 Save Page as PDF', click: savePDF },
      { label: '📸 Screenshot',       click: takeScreenshot },
    ]},
    { label: '&Help', submenu: [
      { label: 'About Smart Store WMS', click: () => dialog.showMessageBox(win, {
          type: 'info', title: 'Smart Store WMS',
          message: 'Smart Store — WMS Desktop Client v3.0',
          detail: `Electron ${process.versions.electron} · Chromium ${process.versions.chrome}\nNode.js ${process.versions.node}\n\nEmaar Al Bader Warehouse Management System`,
        })},
    ]},
  ]));
}

// ══════════════════════════════════════════════════════════════
// SHORTCUTS
// ══════════════════════════════════════════════════════════════

function registerShortcuts() {
  const r = (a, f) => globalShortcut.register(a, f);
  r('CmdOrCtrl+Equal', () => zoomBy(0.1));
  r('CmdOrCtrl+Plus',  () => zoomBy(0.1));
  r('CmdOrCtrl+-',     () => zoomBy(-0.1));
  r('CmdOrCtrl+0',     () => zoomBy(0, true));
  r('F11',             () => win.setFullScreen(!win.isFullScreen()));
  r('CmdOrCtrl+T',     () => openTab(HOME_URL));
  r('CmdOrCtrl+W',     () => { if (activeId) closeTab(activeId); });
  r('CmdOrCtrl+R',     () => tabs.find(t=>t.id===activeId)?.view.webContents.reload());
  r('CmdOrCtrl+P',     () => printPage());
  r('F5',              () => tabs.find(t=>t.id===activeId)?.view.webContents.reload());
}

// ══════════════════════════════════════════════════════════════
// IPC
// ══════════════════════════════════════════════════════════════

const ipc = (ch, fn) => ipcMain.on(ch, (_, d) => fn(d));
const inv = (ch, fn) => ipcMain.handle(ch, (_, d) => fn(d));

ipc('tab:open',         url => openTab(url || HOME_URL));
ipc('tab:switch',       id  => activateTab(id));
ipc('tab:close',        id  => closeTab(id));
ipc('tab:dup',          id  => duplicateTab(id));
ipc('tab:pin',          id  => { const t = tabs.find(t=>t.id===id); if(t){ t.pinned=!t.pinned; send('tab:pinned',{id,v:t.pinned}); }});
ipc('tab:mute',         id  => { const t = tabs.find(t=>t.id===id); if(t) t.view.webContents.setAudioMuted(!t.view.webContents.isAudioMuted()); });

ipc('nav:back',         ()  => { const w = tabs.find(t=>t.id===activeId)?.view.webContents; if(w?.canGoBack())    w.goBack();    });
ipc('nav:forward',      ()  => { const w = tabs.find(t=>t.id===activeId)?.view.webContents; if(w?.canGoForward()) w.goForward(); });
ipc('nav:reload',       ()  => tabs.find(t=>t.id===activeId)?.view.webContents.reload());
ipc('nav:hard-reload',  ()  => tabs.find(t=>t.id===activeId)?.view.webContents.reloadIgnoringCache());
ipc('nav:stop',         ()  => tabs.find(t=>t.id===activeId)?.view.webContents.stop());
ipc('nav:home',         ()  => tabs.find(t=>t.id===activeId)?.view.webContents.loadURL(HOME_URL));
ipc('nav:goto',         url => tabs.find(t=>t.id===activeId)?.view.webContents.loadURL(url));

ipc('print',            ()  => printPage());
ipc('pdf',              ()  => savePDF());
ipc('downloads',        ()  => shell.openPath(app.getPath('downloads')));
ipc('dl:url',           url => tabs.find(t=>t.id===activeId)?.view.webContents.downloadURL(url));

ipc('zoom:in',          ()  => zoomBy(0.1));
ipc('zoom:out',         ()  => zoomBy(-0.1));
ipc('zoom:reset',       ()  => zoomBy(0, true));
ipc('zoom:set',         pct => zoomSet(pct));

ipc('find:start',       q   => { const w = tabs.find(t=>t.id===activeId)?.view.webContents; if(w&&q) w.findInPage(q,{findNext:true}); });
ipc('find:next',        q   => { const w = tabs.find(t=>t.id===activeId)?.view.webContents; if(w&&q) w.findInPage(q,{forward:true,findNext:true}); });
ipc('find:prev',        q   => { const w = tabs.find(t=>t.id===activeId)?.view.webContents; if(w&&q) w.findInPage(q,{forward:false,findNext:true}); });
ipc('find:stop',        ()  => tabs.find(t=>t.id===activeId)?.view.webContents.stopFindInPage('clearSelection'));

ipc('app:minimize',     ()  => win.minimize());
ipc('app:maximize',     ()  => win.isMaximized() ? win.unmaximize() : win.maximize());
ipc('app:quit',         ()  => app.quit());
ipc('app:devtools',     ()  => { const w = tabs.find(t=>t.id===activeId)?.view.webContents; w?.isDevToolsOpened() ? w.closeDevTools() : w?.openDevTools({mode:'detach'}); });

ipc('bm:add',           d   => addBM(d));
ipc('bm:remove',        id  => removeBM(id));
inv('bm:get',           ()  => bookmarks);
inv('history:get',      ()  => history);
ipc('history:clear',    ()  => { history = []; saveHist(); });
inv('screenshot',       ()  => takeScreenshot());
inv('app:version',      ()  => app.getVersion());

// ── Utility ──────────────────────────────────────────────────
function send(ch, data) {
  if (win?.webContents && !win.webContents.isDestroyed()) win.webContents.send(ch, data);
}
const { autoUpdater } = require("electron-updater");

app.whenReady().then(() => {
  autoUpdater.checkForUpdatesAndNotify();
});

// Optional logging
autoUpdater.on("update-available", () => {
  console.log("Update available");
});

autoUpdater.on("update-downloaded", () => {
  autoUpdater.quitAndInstall();
});
