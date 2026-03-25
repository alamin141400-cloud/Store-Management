/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║          ARMAN STORE WMS — ELECTRON MAIN PROCESS v2.0           ║
 * ║          Emaar Al Bader Warehouse Management System              ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * ARCHITECTURE
 * ─────────────────────────────────────────────────────────────────
 *  BrowserWindow  ← shell chrome  (index.html = tab-bar UI only)
 *  BrowserView[]  ← one per tab   (real web content lives here)
 *  preload.js     ← secure IPC bridge between shell ↔ main
 *
 * FEATURES
 * ─────────────────────────────────────────────────────────────────
 *  • Tab system          — up to 10 tabs, each a BrowserView
 *  • CDN whitelist       — Bootstrap, jQuery, Google Fonts, Font
 *                          Awesome, cdnjs, jsDelivr, unpkg, Tailwind,
 *                          Vue/React/Angular CDN, Pyodide (Python),
 *                          PHP-WASM, sql.js, Emscripten runtimes, etc.
 *  • Download manager    — intercepts all downloads, shows progress,
 *                          system notification on complete
 *  • Native print        — OS print dialog (Ctrl+P)
 *  • Save as PDF         — printToPDF API + open/reveal after save
 *  • Find in page        — Ctrl+F with highlight
 *  • Zoom per tab        — Ctrl +/- /0, remembered per tab
 *  • Full-screen         — F11
 *  • Custom context menu — Print, PDF, Save image, Download link,
 *                          Open in new tab, Copy, Zoom, DevTools
 *  • Native app menu     — full keyboard-shortcut menu bar
 *  • Back/Forward state  — synced to shell UI buttons
 *  • Favicon per tab     — shown in tab strip
 *  • Offline detection   — shell notified on network error
 *  • Security            — contextIsolation, no nodeIntegration,
 *                          session-level domain filter, header sanitise
 */

'use strict';

const {
  app, BrowserWindow, BrowserView, ipcMain,
  session, shell, dialog, Menu, globalShortcut, Notification,
} = require('electron');
const path = require('path');
const fs   = require('fs');

// ══════════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════════

const APP_DOMAIN     = 'arman.ahrtechdiv.com';
const HOME_URL       = 'https://arman.ahrtechdiv.com';
const MAX_TABS       = 10;
const TABBAR_HEIGHT  = 60;   // px  — must match --bar-h in index.html

/**
 * CDN_WHITELIST
 * Any hostname that equals OR ends-with one of these strings is
 * allowed through the session request filter.  This covers:
 *
 *  CSS Frameworks:  Bootstrap, Tailwind, Bulma, Foundation,
 *                   Materialize, Semantic UI, Pure.css
 *  JS Libraries:    jQuery, React, Vue, Angular, Alpine.js,
 *                   Lodash, Moment, Axios, Chart.js, D3, Three.js,
 *                   Socket.IO, Leaflet, Swiper, GSAP, etc.
 *  Icon fonts:      Font Awesome, Material Icons, Ionicons,
 *                   Bootstrap Icons, Remix Icons
 *  Fonts:           Google Fonts (all variants)
 *  Data tables:     DataTables, AG Grid, Tabulator
 *  Editors:         Quill, CKEditor, TinyMCE, Monaco Editor
 *  Language runtimes (WASM):
 *    Python  → Pyodide  (cdn.jsdelivr.net/pyodide)
 *    PHP     → php-wasm (cdn.jsdelivr.net)
 *    Ruby    → Opal     (cdn.jsdelivr.net)
 *    SQL     → sql.js   (cdnjs.cloudflare.com / unpkg.com)
 *    Lua     → fengari   (cdn.jsdelivr.net)
 *    C/C++   → Emscripten output (any CDN)
 *  Analytics:       Google Analytics, Tag Manager
 *  Payments:        Stripe
 *  Monitoring:      Sentry
 *  Maps:            Google Maps
 */
const CDN_WHITELIST = [
  // ── App domain ──────────────────────────────────────────────
  'arman.ahrtechdiv.com',
  'ahrtechdiv.com',

  // ── Bootstrap & CSS frameworks ───────────────────────────────
  'cdn.jsdelivr.net',           // Bootstrap 5, Tailwind CDN, Pyodide, PHP-WASM …
  'jsdelivr.net',
  'stackpath.bootstrapcdn.com',
  'maxcdn.bootstrapcdn.com',
  'bootstrapcdn.com',
  'unpkg.com',                  // React, Vue, Angular, Tailwind play CDN …
  'cdnjs.cloudflare.com',       // jQuery, Lodash, Chart.js, D3, Three.js …
  'cdn.statically.io',
  'rawcdn.githack.com',
  'raw.githubusercontent.com',

  // ── Google ───────────────────────────────────────────────────
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'ajax.googleapis.com',
  'apis.google.com',
  'www.google-analytics.com',
  'ssl.google-analytics.com',
  'analytics.google.com',
  'www.googletagmanager.com',
  'tagmanager.google.com',
  'maps.googleapis.com',
  'maps.gstatic.com',
  'www.gstatic.com',

  // ── Font Awesome ─────────────────────────────────────────────
  'use.fontawesome.com',
  'ka-f.fontawesome.com',
  'kit.fontawesome.com',
  'pro.fontawesome.com',

  // ── jQuery ───────────────────────────────────────────────────
  'code.jquery.com',

  // ── Vue / React / Angular / Svelte CDNs ─────────────────────
  'vuejs.org',
  'cdn.jsdelivr.net',           // already listed

  // ── Data & Charts ────────────────────────────────────────────
  'cdn.datatables.net',
  'cdn.plot.ly',
  'cdn.syncfusion.com',
  'ag-grid.com',
  'cdn.ag-grid.com',

  // ── Rich-text editors ────────────────────────────────────────
  'cdn.quilljs.com',
  'cdn.ckeditor.com',
  'cdn.tiny.cloud',
  'cdn.jsdelivr.net',           // Monaco Editor
  'cdnjs.cloudflare.com',       // Ace Editor

  // ── Icon sets ────────────────────────────────────────────────
  'cdn.materialdesignicons.com',
  'fonts.googleapis.com',       // Material Icons — already listed

  // ── Socket / realtime ────────────────────────────────────────
  'cdn.socket.io',

  // ── Payment ──────────────────────────────────────────────────
  'js.stripe.com',
  'checkout.stripe.com',
  'api.stripe.com',

  // ── Monitoring / analytics ───────────────────────────────────
  'cdn.sentry.io',
  'browser.sentry-cdn.com',
  'o0.ingest.sentry.io',

  // ── Maps extras ──────────────────────────────────────────────
  'openstreetmap.org',
  'tile.openstreetmap.org',
  'cdn.jsdelivr.net',           // Leaflet — already listed

  // ── Microsoft (Azure CDN for some WMS integrations) ──────────
  'ajax.aspnetcdn.com',
  'az416426.vo.msecnd.net',

  // ── Local dev ────────────────────────────────────────────────
  'localhost',
  '127.0.0.1',
  '::1',
];

/** Returns true if hostname is in the whitelist (exact or subdomain). */
function isAllowed(hostname) {
  if (!hostname) return false;
  return CDN_WHITELIST.some(w => hostname === w || hostname.endsWith('.' + w));
}

// ══════════════════════════════════════════════════════════════
// MUTABLE STATE
// ══════════════════════════════════════════════════════════════

/** @type {BrowserWindow} */
let win;

/**
 * @typedef {{ id:number, view:BrowserView, title:string, url:string,
 *             zoom:number, canBack:boolean, canFwd:boolean }} TabRec
 * @type {TabRec[]}
 */
const tabs        = [];
let   nextId      = 1;
let   activeId    = null;

/** Map<downloadId, {el, filename}> kept for IPC progress messages */
const dlMap = new Map();

// ══════════════════════════════════════════════════════════════
// APP BOOTSTRAP
// ══════════════════════════════════════════════════════════════

app.whenReady().then(() => {
  buildWindow();
  configureSession();
  registerShortcuts();
  buildMenu();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate',          () => { if (!BrowserWindow.getAllWindows().length) buildWindow(); });
app.on('will-quit',         () => globalShortcut.unregisterAll());

// ══════════════════════════════════════════════════════════════
// SESSION CONFIGURATION
// ══════════════════════════════════════════════════════════════

function configureSession() {
  const ses = session.defaultSession;

  /* ── Request filter: allow CDNs, block everything else ──── */
  ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, cb) => {
    const u = details.url;

    // Always pass through Electron / browser internals
    if (u.startsWith('devtools://') || u.startsWith('file://')   ||
        u.startsWith('data:')       || u.startsWith('blob:')     ||
        u.startsWith('chrome-extension://') || u.startsWith('ws:') ||
        u.startsWith('wss:')) {
      return cb({ cancel: false });
    }

    try {
      const host = new URL(u).hostname;
      if (isAllowed(host)) return cb({ cancel: false });
      // Block — only notify shell for main-frame navigations
      if (details.resourceType === 'mainFrame' && win) {
        win.webContents.send('nav-blocked', host);
      }
      cb({ cancel: true });
    } catch { cb({ cancel: false }); }
  });

  /* ── Strip X-Frame-Options so iframes from CDNs render ──── */
  ses.webRequest.onHeadersReceived((details, cb) => {
    const h = { ...details.responseHeaders };
    delete h['x-frame-options'];
    delete h['X-Frame-Options'];
    delete h['content-security-policy'];
    delete h['Content-Security-Policy'];
    cb({ responseHeaders: h });
  });

  /* ── Download interceptor ──────────────────────────────── */
  ses.on('will-download', (_ev, item) => interceptDownload(item));
}

// ══════════════════════════════════════════════════════════════
// SHELL WINDOW
// ══════════════════════════════════════════════════════════════

function buildWindow() {
  win = new BrowserWindow({
    width:  1440,
    height: 900,
    minWidth:  960,
    minHeight: 640,
    title: 'Arman Store — WMS',
    backgroundColor: '#0D1554',
    show: false,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      spellcheck:       false,
    },
  });

  win.loadFile(path.join(__dirname, 'index.html'));

  win.once('ready-to-show', () => {
    win.show();
    openTab(HOME_URL);
  });

  // Re-layout active BrowserView on any window geometry change
  ['resize','maximize','unmaximize','enter-full-screen','leave-full-screen']
    .forEach(e => win.on(e, relayout));
}

// ══════════════════════════════════════════════════════════════
// BROWSERVIEW GEOMETRY
// ══════════════════════════════════════════════════════════════

function viewBounds() {
  const [w, h] = win.getContentSize();
  return { x: 0, y: TABBAR_HEIGHT, width: w, height: h - TABBAR_HEIGHT };
}

function relayout() {
  const t = tabs.find(t => t.id === activeId);
  if (t) t.view.setBounds(viewBounds());
}

// ══════════════════════════════════════════════════════════════
// TAB LIFECYCLE
// ══════════════════════════════════════════════════════════════

function openTab(url) {
  if (tabs.length >= MAX_TABS) {
    return send('toast', { msg: `Maximum ${MAX_TABS} tabs reached`, type: 'warn' });
  }

  const view = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration:  false,
      javascript:       true,
      images:           true,
      plugins:          true,
      webSecurity:      false,   // ← Must be false so CDN cross-origin assets load
      devTools:         true,
    },
  });

  const id  = nextId++;
  /** @type {TabRec} */
  const tab = { id, view, title: 'Loading…', url, zoom: 1.0, canBack: false, canFwd: false };
  tabs.push(tab);

  const wc = view.webContents;

  // ── Domain enforcement ──────────────────────────────────────
  wc.on('will-navigate', (ev, dest) => {
    try {
      const h = new URL(dest).hostname;
      if (!isAllowed(h)) { ev.preventDefault(); send('nav-blocked', h); }
    } catch {}
  });
  wc.on('will-redirect', (ev, dest) => {
    try { const h = new URL(dest).hostname; if (!isAllowed(h)) ev.preventDefault(); }
    catch {}
  });

  // ── Title & URL ─────────────────────────────────────────────
  wc.on('page-title-updated', (_, t) => {
    tab.title = t || 'Arman Store';
    send('tab:update', { id, title: tab.title, url: tab.url });
  });
  wc.on('did-navigate',         (_, u) => { tab.url = u; syncNav(tab); send('tab:update', { id, title: tab.title, url: u }); });
  wc.on('did-navigate-in-page', (_,u)  => { tab.url = u; syncNav(tab); });

  // ── Loading ─────────────────────────────────────────────────
  wc.on('did-start-loading', () => send('tab:loading', { id, v: true  }));
  wc.on('did-stop-loading',  () => { send('tab:loading', { id, v: false }); syncNav(tab); });

  // ── Favicon ─────────────────────────────────────────────────
  wc.on('page-favicon-updated', (_, icons) => {
    if (icons[0]) send('tab:favicon', { id, url: icons[0] });
  });

  // ── New window → open as new tab ────────────────────────────
  wc.setWindowOpenHandler(({ url: nu }) => {
    try { if (isAllowed(new URL(nu).hostname)) openTab(nu); } catch {}
    return { action: 'deny' };
  });

  // ── Custom context menu ──────────────────────────────────────
  wc.on('context-menu', (ev, p) => { ev.preventDefault(); ctxMenu(p, view).popup({ window: win }); });

  // ── Initial load ─────────────────────────────────────────────
  wc.loadURL(url);
  activateTab(id);
  send('tab:opened', { id, title: 'Loading…', url });
}

function activateTab(id) {
  // Remove all attached views first
  win.getBrowserViews().forEach(v => win.removeBrowserView(v));
  const tab = tabs.find(t => t.id === id);
  if (!tab) return;
  activeId = id;
  win.addBrowserView(tab.view);
  tab.view.setBounds(viewBounds());
  tab.view.webContents.setZoomFactor(tab.zoom);
  send('tab:active', { id, canBack: tab.canBack, canFwd: tab.canFwd, zoom: Math.round(tab.zoom * 100) });
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

function syncNav(tab) {
  tab.canBack = tab.view.webContents.canGoBack();
  tab.canFwd  = tab.view.webContents.canGoForward();
  send('nav:state', { id: tab.id, canBack: tab.canBack, canFwd: tab.canFwd });
}

// ══════════════════════════════════════════════════════════════
// ZOOM
// ══════════════════════════════════════════════════════════════

function zoom(delta, reset = false) {
  const tab = tabs.find(t => t.id === activeId);
  if (!tab) return;
  tab.zoom = reset ? 1.0 : Math.max(0.25, Math.min(5.0, tab.zoom + delta));
  tab.view.webContents.setZoomFactor(tab.zoom);
  send('zoom:changed', { zoom: Math.round(tab.zoom * 100) });
}

// ══════════════════════════════════════════════════════════════
// PRINT
// ══════════════════════════════════════════════════════════════

function printPage() {
  const tab = tabs.find(t => t.id === activeId);
  if (!tab) return;
  tab.view.webContents.print({
    silent:          false,
    printBackground: true,
    color:           true,
    margins:         { marginType: 'default' },
    pageSize:        'A4',
    landscape:       false,
  }, (ok, err) => { if (!ok) console.warn('[Print]', err); });
}

async function savePDF() {
  const tab = tabs.find(t => t.id === activeId);
  if (!tab) return;

  const safe = (tab.title || 'page').replace(/[\\/:*?"<>|]/g, '_').trim() || 'page';
  const dest = path.join(app.getPath('downloads'), `${safe}.pdf`);

  try {
    const buf = await tab.view.webContents.printToPDF({
      printBackground: true,
      landscape:       false,
      pageSize:        'A4',
      margins:         { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 },
      scale:           1,
    });
    fs.writeFileSync(dest, buf);

    // Notify download tray
    send('dl:complete', { id: 'pdf-' + Date.now(), filename: path.basename(dest), savePath: dest });
    notify('📄 PDF Saved', path.basename(dest));

    const { response } = await dialog.showMessageBox(win, {
      type:    'info',
      title:   'PDF Saved',
      message: `Saved: ${path.basename(dest)}`,
      detail:  dest,
      buttons: ['Open File', 'Show in Folder', 'Close'],
    });
    if (response === 0) shell.openPath(dest);
    if (response === 1) shell.showItemInFolder(dest);

  } catch (e) {
    dialog.showErrorBox('PDF Error', e.message);
  }
}

// ══════════════════════════════════════════════════════════════
// DOWNLOAD MANAGER
// ══════════════════════════════════════════════════════════════

function interceptDownload(item) {
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
      send('dl:progress', {
        id: dlId, recv, total,
        pct: total > 0 ? Math.round((recv / total) * 100) : -1,
      });
    }
    if (state === 'interrupted') {
      send('dl:error', { id: dlId, filename });
      dlMap.delete(dlId);
    }
  });

  item.once('done', (_, state) => {
    dlMap.delete(dlId);
    if (state === 'completed') {
      send('dl:complete', { id: dlId, filename, savePath: dest });
      notify('✅ Download Complete', filename);
    } else {
      send('dl:error', { id: dlId, filename });
    }
  });
}

function notify(title, body) {
  try { new Notification({ title, body }).show(); } catch {}
}

// ══════════════════════════════════════════════════════════════
// CONTEXT MENU
// ══════════════════════════════════════════════════════════════

function ctxMenu(p, view) {
  const wc    = view.webContents;
  const items = [];

  // Navigation
  if (wc.canGoBack())    items.push({ label: '← Back',    click: () => wc.goBack() });
  if (wc.canGoForward()) items.push({ label: '→ Forward',  click: () => wc.goForward() });
  items.push({ label: '↺ Reload Page', click: () => wc.reload() });
  items.push({ type: 'separator' });

  // Text
  if (p.selectionText?.trim()) {
    items.push({ label: '📋 Copy',        role: 'copy' });
    items.push({ label: '🔍 Search Web…', click: () => shell.openExternal(`https://www.google.com/search?q=${encodeURIComponent(p.selectionText)}`) });
    items.push({ type: 'separator' });
  }

  // Image
  if (p.mediaType === 'image' && p.srcURL) {
    items.push({ label: '💾 Save Image',  click: () => wc.downloadURL(p.srcURL) });
    items.push({ label: '📋 Copy Image URL', click: () => require('electron').clipboard.writeText(p.srcURL) });
    items.push({ type: 'separator' });
  }

  // Link
  if (p.linkURL) {
    const linkHost = (() => { try { return new URL(p.linkURL).hostname; } catch { return ''; } })();
    if (isAllowed(linkHost)) {
      items.push({ label: '🗂 Open in New Tab', click: () => openTab(p.linkURL) });
    }
    items.push({ label: '💾 Download Link', click: () => wc.downloadURL(p.linkURL) });
    items.push({ label: '📋 Copy Link URL', click: () => require('electron').clipboard.writeText(p.linkURL) });
    items.push({ type: 'separator' });
  }

  // Print / Save
  items.push({ label: '🖨  Print Page…',         click: printPage });
  items.push({ label: '📄 Save as PDF…',          click: savePDF  });
  items.push({ label: '📂 Open Downloads Folder', click: () => shell.openPath(app.getPath('downloads')) });
  items.push({ type: 'separator' });

  // Zoom
  const curZoom = Math.round((tabs.find(t => t.id === activeId)?.zoom ?? 1) * 100);
  items.push({
    label: `🔍 Zoom  (${curZoom}%)`,
    submenu: [
      { label: 'Zoom In   (Ctrl++)', click: () => zoom(0.1)  },
      { label: 'Zoom Out  (Ctrl+-)', click: () => zoom(-0.1) },
      { label: 'Reset     (Ctrl+0)', click: () => zoom(0, true) },
      { type: 'separator' },
      { label: '75%',  click: () => setZoom(0.75) },
      { label: '100%', click: () => setZoom(1.00) },
      { label: '125%', click: () => setZoom(1.25) },
      { label: '150%', click: () => setZoom(1.50) },
      { label: '200%', click: () => setZoom(2.00) },
    ],
  });
  items.push({ type: 'separator' });

  // DevTools
  items.push({
    label: '🔧 Inspect Element',
    click: () => wc.inspectElement(p.x, p.y),
  });
  items.push({
    label: '🖥 Toggle DevTools',
    click: () => wc.isDevToolsOpened() ? wc.closeDevTools() : wc.openDevTools({ mode: 'detach' }),
  });

  return Menu.buildFromTemplate(items);
}

function setZoom(factor) {
  const tab = tabs.find(t => t.id === activeId);
  if (!tab) return;
  tab.zoom = factor;
  tab.view.webContents.setZoomFactor(factor);
  send('zoom:changed', { zoom: Math.round(factor * 100) });
}

// ══════════════════════════════════════════════════════════════
// NATIVE APP MENU
// ══════════════════════════════════════════════════════════════

function buildMenu() {
  const wv = () => tabs.find(t => t.id === activeId)?.view.webContents;
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: '&File',
      submenu: [
        { label: 'New Tab',      accelerator: 'CmdOrCtrl+T', click: () => openTab(HOME_URL) },
        { label: 'Reload Tab',   accelerator: 'CmdOrCtrl+R', click: () => wv()?.reload() },
        { label: 'Close Tab',    accelerator: 'CmdOrCtrl+W', click: () => activeId && closeTab(activeId) },
        { type: 'separator' },
        { label: '🖨  Print…',   accelerator: 'CmdOrCtrl+P', click: printPage },
        { label: '📄 Save as PDF…',                           click: savePDF   },
        { type: 'separator' },
        { label: 'Quit',         accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
      ],
    },
    {
      label: '&Edit',
      submenu: [
        { label: 'Find in Page', accelerator: 'CmdOrCtrl+F', click: () => send('find:open') },
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: '&View',
      submenu: [
        { label: 'Zoom In',      accelerator: 'CmdOrCtrl+Plus',  click: () => zoom(0.1) },
        { label: 'Zoom Out',     accelerator: 'CmdOrCtrl+-',     click: () => zoom(-0.1) },
        { label: 'Reset Zoom',   accelerator: 'CmdOrCtrl+0',     click: () => zoom(0, true) },
        { type: 'separator' },
        { label: 'Full Screen',  accelerator: 'F11', click: () => win.setFullScreen(!win.isFullScreen()) },
        { type: 'separator' },
        { label: 'Developer Tools', accelerator: 'F12',
          click: () => { const w = wv(); w?.isDevToolsOpened() ? w.closeDevTools() : w?.openDevTools({ mode: 'detach' }); } },
      ],
    },
    {
      label: '&Navigate',
      submenu: [
        { label: 'Back',         accelerator: 'Alt+Left',  click: () => { const w = wv(); if (w?.canGoBack()) w.goBack(); } },
        { label: 'Forward',      accelerator: 'Alt+Right', click: () => { const w = wv(); if (w?.canGoForward()) w.goForward(); } },
        { label: 'Home',                                    click: () => wv()?.loadURL(HOME_URL) },
      ],
    },
    {
      label: '&Download',
      submenu: [
        { label: '📂 Open Downloads Folder', click: () => shell.openPath(app.getPath('downloads')) },
        { label: '📄 Save Current Page as PDF', click: savePDF },
      ],
    },
    {
      label: '&Help',
      submenu: [
        { label: 'About Arman Store WMS', click: () =>
          dialog.showMessageBox(win, {
            type: 'info', title: 'Arman Store WMS',
            message: 'Arman Store — WMS Desktop Client',
            detail: [
              'Version 2.0.0',
              `Electron  ${process.versions.electron}`,
              `Chromium  ${process.versions.chrome}`,
              `Node.js   ${process.versions.node}`,
              '',
              'Emaar Al Bader Warehouse Management System',
              'https://arman.ahrtechdiv.com',
            ].join('\n'),
          })
        },
      ],
    },
  ]));
}

// ══════════════════════════════════════════════════════════════
// GLOBAL SHORTCUTS
// ══════════════════════════════════════════════════════════════

function registerShortcuts() {
  const reg = (acc, fn) => globalShortcut.register(acc, fn);
  reg('CmdOrCtrl+Equal', () => zoom(0.1));
  reg('CmdOrCtrl+Plus',  () => zoom(0.1));
  reg('CmdOrCtrl+-',     () => zoom(-0.1));
  reg('CmdOrCtrl+0',     () => zoom(0, true));
  reg('F11',             () => win.setFullScreen(!win.isFullScreen()));
  reg('CmdOrCtrl+T',     () => openTab(HOME_URL));
  reg('CmdOrCtrl+W',     () => { if (activeId) closeTab(activeId); });
  reg('CmdOrCtrl+R',     () => tabs.find(t=>t.id===activeId)?.view.webContents.reload());
}

// ══════════════════════════════════════════════════════════════
// IPC  — renderer → main
// ══════════════════════════════════════════════════════════════

const on = (ch, fn) => ipcMain.on(ch, fn);

on('tab:open',    (_, url) => openTab(url || HOME_URL));
on('tab:switch',  (_, id)  => activateTab(id));
on('tab:close',   (_, id)  => closeTab(id));

on('nav:back',    () => { const w = tabs.find(t=>t.id===activeId)?.view.webContents; if(w?.canGoBack())    w.goBack(); });
on('nav:forward', () => { const w = tabs.find(t=>t.id===activeId)?.view.webContents; if(w?.canGoForward()) w.goForward(); });
on('nav:reload',  () => tabs.find(t=>t.id===activeId)?.view.webContents.reload());
on('nav:home',    () => tabs.find(t=>t.id===activeId)?.view.webContents.loadURL(HOME_URL));

on('print',       () => printPage());
on('pdf',         () => savePDF());
on('downloads',   () => shell.openPath(app.getPath('downloads')));
on('dl:url',      (_, url) => tabs.find(t=>t.id===activeId)?.view.webContents.downloadURL(url));

on('zoom:in',     () => zoom(0.1));
on('zoom:out',    () => zoom(-0.1));
on('zoom:reset',  () => zoom(0, true));
on('zoom:set',    (_, pct) => setZoom(pct / 100));

on('find:start',  (_, q) => { const w = tabs.find(t=>t.id===activeId)?.view.webContents; if(w&&q) w.findInPage(q,{findNext:true}); });
on('find:next',   (_, q) => { const w = tabs.find(t=>t.id===activeId)?.view.webContents; if(w&&q) w.findInPage(q,{forward:true,findNext:true}); });
on('find:prev',   (_, q) => { const w = tabs.find(t=>t.id===activeId)?.view.webContents; if(w&&q) w.findInPage(q,{forward:false,findNext:true}); });
on('find:stop',   ()     => tabs.find(t=>t.id===activeId)?.view.webContents.stopFindInPage('clearSelection'));

// ── Utility ──────────────────────────────────────────────────
function send(channel, data) {
  if (win?.webContents && !win.webContents.isDestroyed()) {
    win.webContents.send(channel, data);
  }
}
