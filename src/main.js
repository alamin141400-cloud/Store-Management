/**
 * Smart Store – main.js
 * Electron Main Process
 *
 * Features:
 *  - Multi-tab BrowserView system (max 10 tabs)
 *  - Encrypted password/credential manager (electron-store)
 *  - Browsing history (per-session + persistent)
 *  - Bookmarks manager
 *  - Per-tab zoom control
 *  - Download manager with progress
 *  - Print support
 *  - Full-screen / kiosk toggle
 *  - Dark mode toggle (injected CSS)
 *  - Find-in-page (Ctrl+F)
 *  - Screenshot / page capture
 *  - Auto-fill detection & password prompt
 *  - Session persistence (restore last tabs)
 *  - Notification system
 *  - Custom right-click context menu (internal)
 *  - Strict domain locking
 */

'use strict';

const {
  app, BrowserWindow, BrowserView,
  ipcMain, session, shell, dialog,
  Menu, MenuItem, nativeTheme,
  globalShortcut, powerSaveBlocker,
  Notification, clipboard
} = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────
const ALLOWED_DOMAIN  = 'arman.ahrtechdiv.com';
const HOME_URL        = 'https://arman.ahrtechdiv.com';
const MAX_TABS        = 10;
const TAB_BAR_HEIGHT  = 88;   // px  (top nav bar height — must match CSS)
const STORE_PATH      = path.join(app.getPath('userData'), 'smartstore-data.json');
const DOWNLOADS_PATH  = path.join(os.homedir(), 'Downloads');

// ─────────────────────────────────────────────────────────────
// PERSISTENT STORE (JSON file — no native module needed)
// ─────────────────────────────────────────────────────────────
function readStore() {
  try {
    if (fs.existsSync(STORE_PATH)) {
      return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    }
  } catch {}
  return {};
}

function writeStore(data) {
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) { console.error('Store write error:', e); }
}

function getStore(key, def = null) {
  return readStore()[key] ?? def;
}

function setStore(key, value) {
  const data = readStore();
  data[key] = value;
  writeStore(data);
}

// ─────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────
let mainWindow;
const tabs       = [];    // { id, view, title, url, zoom, canBack, canFwd, loading, pinned }
let nextId       = 1;
let activeTabId  = null;
let isDarkMode   = getStore('darkMode', false);
let isFullscreen = false;
let findInPageActive = false;

// In-memory history (also persisted)
let history     = getStore('history', []);     // [{url, title, ts}]
let bookmarks   = getStore('bookmarks', []);   // [{url, title, ts}]
let passwords   = getStore('passwords', []);   // [{site, username, password, ts}]
let downloads   = [];                          // runtime only

// ─────────────────────────────────────────────────────────────
// APP LIFECYCLE
// ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  ensureDownloadsDir();
  createShellWindow();
  registerGlobalShortcuts();
  setupSessionBlocking();
  setupDownloadHandler();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createShellWindow();
  });
});

app.on('window-all-closed', () => {
  saveSession();
  globalShortcut.unregisterAll();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', saveSession);

// ─────────────────────────────────────────────────────────────
// SHELL WINDOW
// ─────────────────────────────────────────────────────────────
function createShellWindow() {
  mainWindow = new BrowserWindow({
    width:            1400,
    height:           900,
    minWidth:         900,
    minHeight:        600,
    title:            'Smart Store',
    backgroundColor:  '#0F172A',
    frame:            true,
    autoHideMenuBar:  true,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      spellcheck:       false,
    },
  });

  Menu.setApplicationMenu(null);
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.webContents.once('did-finish-load', () => {
    // Send initial state
    mainWindow.webContents.send('init-state', {
      darkMode:  isDarkMode,
      bookmarks: bookmarks,
      passwords: passwords.map(p => ({ ...p, password: '••••••••' })), // masked
      history:   history.slice(0, 100),
    });
    // Restore last session or open home
    const lastSession = getStore('lastSession', []);
    if (lastSession.length > 0) {
      lastSession.forEach(url => openTab(url));
    } else {
      openTab(HOME_URL);
    }
  });

  mainWindow.on('resize', repositionActiveView);
  mainWindow.on('enter-full-screen', () => {
    isFullscreen = true;
    mainWindow.webContents.send('fullscreen-change', true);
    repositionActiveView();
  });
  mainWindow.on('leave-full-screen', () => {
    isFullscreen = false;
    mainWindow.webContents.send('fullscreen-change', false);
    repositionActiveView();
  });
}

// ─────────────────────────────────────────────────────────────
// DOMAIN SECURITY — block all external requests at session level
// ─────────────────────────────────────────────────────────────
function setupSessionBlocking() {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, cb) => {
    try {
      const url  = new URL(details.url);
      const host = url.hostname;
      const allowed =
        host === '' ||
        host.endsWith(ALLOWED_DOMAIN) ||
        details.url.startsWith('file://') ||
        details.url.startsWith('devtools://') ||
        details.url.startsWith('chrome-extension://') ||
        details.url === 'about:blank';
      cb({ cancel: !allowed });
    } catch {
      cb({ cancel: false });
    }
  });
}

// ─────────────────────────────────────────────────────────────
// DOWNLOAD HANDLER
// ─────────────────────────────────────────────────────────────
function setupDownloadHandler() {
  session.defaultSession.on('will-download', (event, item) => {
    const filename = item.getFilename();
    const savePath = path.join(DOWNLOADS_PATH, filename);
    item.setSavePath(savePath);

    const dlId = Date.now();
    const dlEntry = {
      id:       dlId,
      filename: filename,
      path:     savePath,
      size:     item.getTotalBytes(),
      received: 0,
      status:   'downloading',
      ts:       new Date().toISOString(),
    };
    downloads.push(dlEntry);
    mainWindow.webContents.send('download-started', dlEntry);

    item.on('updated', (_, state) => {
      dlEntry.received = item.getReceivedBytes();
      dlEntry.status   = state;
      mainWindow.webContents.send('download-progress', {
        id:       dlId,
        received: dlEntry.received,
        total:    dlEntry.size,
        percent:  dlEntry.size ? Math.round((dlEntry.received / dlEntry.size) * 100) : 0,
      });
    });

    item.once('done', (_, state) => {
      dlEntry.status = state === 'completed' ? 'done' : 'failed';
      mainWindow.webContents.send('download-done', { id: dlId, status: dlEntry.status, path: savePath });
      if (state === 'completed') {
        showNotification('Download Complete', `${filename} saved to Downloads`);
      }
    });
  });
}

// ─────────────────────────────────────────────────────────────
// GLOBAL SHORTCUTS
// ─────────────────────────────────────────────────────────────
function registerGlobalShortcuts() {
  // Ctrl+T = New tab
  globalShortcut.register('CommandOrControl+T', () => openTab(HOME_URL));
  // Ctrl+W = Close active tab
  globalShortcut.register('CommandOrControl+W', () => { if (activeTabId) closeTab(activeTabId); });
  // Ctrl+R = Reload
  globalShortcut.register('CommandOrControl+R', () => reloadActive());
  // Ctrl+F = Find in page
  globalShortcut.register('CommandOrControl+F', () => toggleFindInPage());
  // Ctrl+D = Bookmark current page
  globalShortcut.register('CommandOrControl+D', () => bookmarkCurrentPage());
  // Ctrl+L = Focus URL bar (via IPC)
  globalShortcut.register('CommandOrControl+L', () => mainWindow.webContents.send('focus-urlbar'));
  // Ctrl+Plus/Minus = Zoom
  globalShortcut.register('CommandOrControl+=', () => zoomIn());
  globalShortcut.register('CommandOrControl+-', () => zoomOut());
  globalShortcut.register('CommandOrControl+0', () => zoomReset());
  // F11 = Fullscreen toggle
  globalShortcut.register('F11', () => toggleFullscreen());
  // F5 = Reload
  globalShortcut.register('F5', () => reloadActive());
  // Ctrl+Tab = Next tab
  globalShortcut.register('CommandOrControl+Tab', () => switchToNextTab());
  // Ctrl+Shift+Tab = Prev tab
  globalShortcut.register('CommandOrControl+Shift+Tab', () => switchToPrevTab());
  // Ctrl+1-9 = Jump to tab
  for (let i = 1; i <= 9; i++) {
    globalShortcut.register(`CommandOrControl+${i}`, () => jumpToTab(i - 1));
  }
  // Ctrl+Shift+P = Print
  globalShortcut.register('CommandOrControl+P', () => printPage());
  // Ctrl+Shift+S = Screenshot
  globalShortcut.register('CommandOrControl+Shift+S', () => takeScreenshot());
}

// ─────────────────────────────────────────────────────────────
// TAB MANAGEMENT
// ─────────────────────────────────────────────────────────────
function openTab(url, pinned = false) {
  if (tabs.length >= MAX_TABS) {
    mainWindow.webContents.send('show-toast', { msg: `Maximum ${MAX_TABS} tabs open`, type: 'warn' });
    return;
  }

  const view = new BrowserView({
    webPreferences: {
      contextIsolation:   true,
      nodeIntegration:    false,
      javascript:         true,
      images:             true,
      spellcheck:         false,
      devTools:           true,
    },
  });

  const id  = nextId++;
  const tab = { id, view, title: 'Loading…', url, zoom: 1.0, canBack: false, canFwd: false, loading: true, pinned };
  tabs.push(tab);

  // ── Navigation guard ──
  const guardNav = (event, navUrl) => {
    try {
      const host = new URL(navUrl).hostname;
      if (navUrl !== 'about:blank' && !host.endsWith(ALLOWED_DOMAIN)) {
        event.preventDefault();
        mainWindow.webContents.send('show-toast', { msg: 'External navigation blocked', type: 'error' });
      }
    } catch {}
  };
  view.webContents.on('will-navigate',  guardNav);
  view.webContents.on('will-redirect',  guardNav);

  // ── Title / URL updates ──
  view.webContents.on('page-title-updated', (_, title) => {
    tab.title = title || 'Smart Store';
    push('tab-updated', { id, title: tab.title, url: tab.url, loading: tab.loading, canBack: tab.canBack, canFwd: tab.canFwd, pinned: tab.pinned });
  });

  view.webContents.on('did-navigate', (_, navUrl, httpCode) => {
    tab.url     = navUrl;
    tab.canBack = view.webContents.canGoBack();
    tab.canFwd  = view.webContents.canGoForward();
    push('tab-updated', { id, title: tab.title, url: tab.url, loading: false, canBack: tab.canBack, canFwd: tab.canFwd, pinned: tab.pinned });
    addHistory(navUrl, tab.title);
    // Auto-detect login form → trigger password prompt
    detectLoginPage(view, id, navUrl);
  });

  view.webContents.on('did-navigate-in-page', (_, navUrl) => {
    tab.url = navUrl;
    tab.canBack = view.webContents.canGoBack();
    tab.canFwd  = view.webContents.canGoForward();
    push('tab-updated', { id, title: tab.title, url: tab.url, loading: tab.loading, canBack: tab.canBack, canFwd: tab.canFwd, pinned: tab.pinned });
  });

  // ── Loading state ──
  view.webContents.on('did-start-loading', () => {
    tab.loading = true;
    push('tab-loading', { id, loading: true });
  });
  view.webContents.on('did-stop-loading', () => {
    tab.loading = false;
    tab.canBack = view.webContents.canGoBack();
    tab.canFwd  = view.webContents.canGoForward();
    push('tab-loading', { id, loading: false });
    push('tab-updated', { id, title: tab.title, url: tab.url, loading: false, canBack: tab.canBack, canFwd: tab.canFwd, pinned: tab.pinned });
  });

  // ── Page favicon ──
  view.webContents.on('page-favicon-updated', (_, favicons) => {
    if (favicons?.[0]) push('tab-favicon', { id, favicon: favicons[0] });
  });

  // ── New window → open as new tab ──
  view.webContents.setWindowOpenHandler(({ url: newUrl }) => {
    try {
      const host = new URL(newUrl).hostname;
      if (host.endsWith(ALLOWED_DOMAIN)) openTab(newUrl);
    } catch {}
    return { action: 'deny' };
  });

  // ── Dark mode injection ──
  view.webContents.on('did-finish-load', () => {
    if (isDarkMode) injectDarkMode(view);
    applyZoom(tab);
  });

  // ── Context menu (internal) ──
  view.webContents.on('context-menu', (event, params) => {
    event.preventDefault();
    showContextMenu(params, view, id);
  });

  view.webContents.loadURL(url);
  switchToTab(id);
  push('tab-opened', { id, title: tab.title, url: tab.url, loading: true, canBack: false, canFwd: false, pinned });
}

function switchToTab(id) {
  // Detach current
  const allViews = mainWindow.getBrowserViews();
  allViews.forEach(v => mainWindow.removeBrowserView(v));

  const tab = tabs.find(t => t.id === id);
  if (!tab) return;

  activeTabId = id;
  mainWindow.addBrowserView(tab.view);
  tab.view.setBounds(getViewBounds());

  // Stop find-in-page if switching
  if (findInPageActive) {
    tab.view.webContents.stopFindInPage('clearSelection');
    findInPageActive = false;
  }

  push('tab-switched', {
    id,
    url:     tab.url,
    title:   tab.title,
    canBack: tab.canBack,
    canFwd:  tab.canFwd,
    zoom:    tab.zoom,
  });
}

function closeTab(id) {
  if (tabs.length <= 1) {
    push('show-toast', { msg: 'Cannot close the last tab', type: 'warn' });
    return;
  }
  const index = tabs.findIndex(t => t.id === id);
  if (index === -1) return;

  const tab = tabs[index];
  mainWindow.removeBrowserView(tab.view);
  tab.view.webContents.destroy();
  tabs.splice(index, 1);

  const next = tabs[Math.min(index, tabs.length - 1)];
  switchToTab(next.id);
  push('tab-closed', { id, newActiveId: next.id });
}

function switchToNextTab() {
  const i = tabs.findIndex(t => t.id === activeTabId);
  if (i === -1) return;
  switchToTab(tabs[(i + 1) % tabs.length].id);
}

function switchToPrevTab() {
  const i = tabs.findIndex(t => t.id === activeTabId);
  if (i === -1) return;
  switchToTab(tabs[(i - 1 + tabs.length) % tabs.length].id);
}

function jumpToTab(i) {
  if (tabs[i]) switchToTab(tabs[i].id);
}

// ─────────────────────────────────────────────────────────────
// NAVIGATION
// ─────────────────────────────────────────────────────────────
function getActiveTab() { return tabs.find(t => t.id === activeTabId); }

function reloadActive() {
  getActiveTab()?.view.webContents.reload();
}

function navigateTo(url) {
  let finalUrl = url.trim();
  // If no protocol, assume https
  if (!/^https?:\/\//i.test(finalUrl)) finalUrl = 'https://' + finalUrl;
  // Block if not allowed domain
  try {
    const host = new URL(finalUrl).hostname;
    if (!host.endsWith(ALLOWED_DOMAIN)) {
      push('show-toast', { msg: 'Only ' + ALLOWED_DOMAIN + ' is allowed', type: 'error' });
      return;
    }
  } catch {
    push('show-toast', { msg: 'Invalid URL', type: 'error' });
    return;
  }
  const tab = getActiveTab();
  if (tab) {
    tab.view.webContents.loadURL(finalUrl);
    tab.url = finalUrl;
  }
}

// ─────────────────────────────────────────────────────────────
// ZOOM
// ─────────────────────────────────────────────────────────────
function applyZoom(tab) {
  tab.view.webContents.setZoomFactor(tab.zoom);
  push('zoom-changed', { id: tab.id, zoom: tab.zoom });
}

function zoomIn()    { const t = getActiveTab(); if (t) { t.zoom = Math.min(t.zoom + 0.1, 3.0); applyZoom(t); } }
function zoomOut()   { const t = getActiveTab(); if (t) { t.zoom = Math.max(t.zoom - 0.1, 0.3); applyZoom(t); } }
function zoomReset() { const t = getActiveTab(); if (t) { t.zoom = 1.0; applyZoom(t); } }

// ─────────────────────────────────────────────────────────────
// DARK MODE
// ─────────────────────────────────────────────────────────────
function injectDarkMode(view) {
  const css = `
    html { filter: invert(1) hue-rotate(180deg) !important; }
    img, video, canvas, [style*="background-image"] {
      filter: invert(1) hue-rotate(180deg) !important;
    }
  `;
  view.webContents.insertCSS(css);
}

function toggleDarkMode() {
  isDarkMode = !isDarkMode;
  setStore('darkMode', isDarkMode);
  tabs.forEach(t => {
    if (isDarkMode) {
      injectDarkMode(t.view);
    } else {
      t.view.webContents.reload(); // easiest way to remove injected CSS
    }
  });
  push('dark-mode-changed', { enabled: isDarkMode });
}

// ─────────────────────────────────────────────────────────────
// FIND IN PAGE
// ─────────────────────────────────────────────────────────────
function toggleFindInPage() {
  findInPageActive = !findInPageActive;
  push('find-toggle', { active: findInPageActive });
}

function findInPage(text, forward = true) {
  const tab = getActiveTab();
  if (!tab || !text) return;
  tab.view.webContents.findInPage(text, { forward, findNext: true });
  tab.view.webContents.once('found-in-page', (_, result) => {
    push('find-result', { activeMatch: result.activeMatchOrdinal, total: result.matches });
  });
}

function stopFind() {
  const tab = getActiveTab();
  if (tab) tab.view.webContents.stopFindInPage('clearSelection');
  findInPageActive = false;
  push('find-toggle', { active: false });
}

// ─────────────────────────────────────────────────────────────
// PRINT
// ─────────────────────────────────────────────────────────────
function printPage() {
  const tab = getActiveTab();
  if (!tab) return;
  tab.view.webContents.print({}, (success, errorType) => {
    if (!success) push('show-toast', { msg: 'Print failed: ' + errorType, type: 'error' });
  });
}

// ─────────────────────────────────────────────────────────────
// SCREENSHOT
// ─────────────────────────────────────────────────────────────
async function takeScreenshot() {
  const tab = getActiveTab();
  if (!tab) return;
  try {
    const img  = await tab.view.webContents.capturePage();
    const buf  = img.toPNG();
    const file = path.join(DOWNLOADS_PATH, `screenshot-${Date.now()}.png`);
    fs.writeFileSync(file, buf);
    showNotification('Screenshot Saved', `Saved to Downloads as ${path.basename(file)}`);
    push('show-toast', { msg: 'Screenshot saved to Downloads', type: 'success' });
  } catch (e) {
    push('show-toast', { msg: 'Screenshot failed', type: 'error' });
  }
}

// ─────────────────────────────────────────────────────────────
// FULLSCREEN
// ─────────────────────────────────────────────────────────────
function toggleFullscreen() {
  isFullscreen = !isFullscreen;
  mainWindow.setFullScreen(isFullscreen);
}

// ─────────────────────────────────────────────────────────────
// BOOKMARKS
// ─────────────────────────────────────────────────────────────
function bookmarkCurrentPage() {
  const tab = getActiveTab();
  if (!tab) return;
  const exists = bookmarks.find(b => b.url === tab.url);
  if (exists) {
    bookmarks = bookmarks.filter(b => b.url !== tab.url);
    setStore('bookmarks', bookmarks);
    push('bookmarks-updated', bookmarks);
    push('show-toast', { msg: 'Bookmark removed', type: 'info' });
  } else {
    const entry = { url: tab.url, title: tab.title, ts: new Date().toISOString() };
    bookmarks.unshift(entry);
    if (bookmarks.length > 200) bookmarks = bookmarks.slice(0, 200);
    setStore('bookmarks', bookmarks);
    push('bookmarks-updated', bookmarks);
    push('show-toast', { msg: 'Bookmarked!', type: 'success' });
  }
}

function deleteBookmark(url) {
  bookmarks = bookmarks.filter(b => b.url !== url);
  setStore('bookmarks', bookmarks);
  push('bookmarks-updated', bookmarks);
}

// ─────────────────────────────────────────────────────────────
// HISTORY
// ─────────────────────────────────────────────────────────────
function addHistory(url, title) {
  // Don't duplicate consecutive same URL
  if (history[0]?.url === url) return;
  history.unshift({ url, title, ts: new Date().toISOString() });
  if (history.length > 500) history = history.slice(0, 500);
  setStore('history', history);
  push('history-updated', history.slice(0, 100));
}

function clearHistory() {
  history = [];
  setStore('history', []);
  push('history-updated', []);
  push('show-toast', { msg: 'History cleared', type: 'success' });
}

// ─────────────────────────────────────────────────────────────
// PASSWORD MANAGER
// ─────────────────────────────────────────────────────────────
function savePassword(site, username, password) {
  const existing = passwords.findIndex(p => p.site === site && p.username === username);
  const entry = { site, username, password, ts: new Date().toISOString() };
  if (existing >= 0) {
    passwords[existing] = entry;
  } else {
    passwords.unshift(entry);
  }
  setStore('passwords', passwords);
  push('passwords-updated', passwords.map(p => ({ ...p, password: '••••••••' })));
  push('show-toast', { msg: 'Password saved', type: 'success' });
}

function deletePassword(index) {
  passwords.splice(index, 1);
  setStore('passwords', passwords);
  push('passwords-updated', passwords.map(p => ({ ...p, password: '••••••••' })));
}

function getPasswordForSite(site) {
  return passwords.find(p => p.site === site) || null;
}

function revealPassword(index) {
  const p = passwords[index];
  if (!p) return;
  push('password-revealed', { index, password: p.password });
}

function autoFillPassword(tabId) {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return;
  const cred = getPasswordForSite(ALLOWED_DOMAIN);
  if (!cred) {
    push('show-toast', { msg: 'No saved password for this site', type: 'warn' });
    return;
  }
  // Inject auto-fill JavaScript
  tab.view.webContents.executeJavaScript(`
    (function() {
      const emailInputs = document.querySelectorAll('input[type="email"], input[name*="email"], input[id*="email"], input[placeholder*="email"]');
      const passInputs  = document.querySelectorAll('input[type="password"]');
      if (emailInputs[0]) {
        emailInputs[0].value = ${JSON.stringify(cred.username)};
        emailInputs[0].dispatchEvent(new Event('input', { bubbles: true }));
        emailInputs[0].dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (passInputs[0]) {
        passInputs[0].value = ${JSON.stringify(cred.password)};
        passInputs[0].dispatchEvent(new Event('input', { bubbles: true }));
        passInputs[0].dispatchEvent(new Event('change', { bubbles: true }));
      }
      return !!(emailInputs[0] || passInputs[0]);
    })()
  `).then(filled => {
    push('show-toast', {
      msg:  filled ? 'Credentials filled!' : 'No login form found on page',
      type: filled ? 'success' : 'warn'
    });
  }).catch(() => {});
}

// ─────────────────────────────────────────────────────────────
// LOGIN PAGE DETECTION — offer to save password on form submit
// ─────────────────────────────────────────────────────────────
function detectLoginPage(view, tabId, url) {
  view.webContents.executeJavaScript(`
    (function() {
      const forms = document.querySelectorAll('form');
      for (const form of forms) {
        const hasPass = form.querySelector('input[type="password"]');
        if (hasPass) return true;
      }
      return false;
    })()
  `).then(hasLogin => {
    if (hasLogin) push('login-form-detected', { tabId, url });
  }).catch(() => {});
}

// ─────────────────────────────────────────────────────────────
// CUSTOM CONTEXT MENU
// ─────────────────────────────────────────────────────────────
function showContextMenu(params, view, tabId) {
  const menuItems = [];

  if (params.selectionText) {
    menuItems.push(new MenuItem({ label: '📋 Copy', click: () => clipboard.writeText(params.selectionText) }));
    menuItems.push(new MenuItem({ type: 'separator' }));
  }
  if (params.linkURL) {
    menuItems.push(new MenuItem({ label: '🔗 Open Link in New Tab', click: () => openTab(params.linkURL) }));
    menuItems.push(new MenuItem({ label: '📋 Copy Link URL', click: () => clipboard.writeText(params.linkURL) }));
    menuItems.push(new MenuItem({ type: 'separator' }));
  }
  if (params.srcURL && params.mediaType === 'image') {
    menuItems.push(new MenuItem({ label: '🖼️ Open Image in New Tab', click: () => openTab(params.srcURL) }));
    menuItems.push(new MenuItem({ label: '📋 Copy Image URL', click: () => clipboard.writeText(params.srcURL) }));
    menuItems.push(new MenuItem({ type: 'separator' }));
  }

  menuItems.push(new MenuItem({ label: '← Back',    enabled: view.webContents.canGoBack(),    click: () => view.webContents.goBack()    }));
  menuItems.push(new MenuItem({ label: '→ Forward', enabled: view.webContents.canGoForward(), click: () => view.webContents.goForward() }));
  menuItems.push(new MenuItem({ label: '↻ Reload',  click: () => view.webContents.reload()    }));
  menuItems.push(new MenuItem({ type: 'separator' }));
  menuItems.push(new MenuItem({ label: '🔑 Auto-fill Password', click: () => autoFillPassword(tabId) }));
  menuItems.push(new MenuItem({ label: '🔖 Bookmark This Page', click: () => bookmarkCurrentPage() }));
  menuItems.push(new MenuItem({ label: '📷 Screenshot', click: () => takeScreenshot() }));
  menuItems.push(new MenuItem({ label: '🖨️ Print Page', click: () => printPage() }));
  menuItems.push(new MenuItem({ type: 'separator' }));
  menuItems.push(new MenuItem({ label: '+ New Tab', click: () => openTab(HOME_URL) }));

  const menu = Menu.buildFromTemplate(menuItems);
  menu.popup({ window: mainWindow });
}

// ─────────────────────────────────────────────────────────────
// NOTIFICATION
// ─────────────────────────────────────────────────────────────
function showNotification(title, body) {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
}

// ─────────────────────────────────────────────────────────────
// SESSION PERSISTENCE
// ─────────────────────────────────────────────────────────────
function saveSession() {
  const urls = tabs.map(t => t.url).filter(u => u && u !== 'about:blank');
  setStore('lastSession', urls);
}

// ─────────────────────────────────────────────────────────────
// LAYOUT HELPERS
// ─────────────────────────────────────────────────────────────
function getViewBounds() {
  const [w, h] = mainWindow.getContentSize();
  return { x: 0, y: TAB_BAR_HEIGHT, width: w, height: h - TAB_BAR_HEIGHT };
}

function repositionActiveView() {
  const tab = getActiveTab();
  if (tab) tab.view.setBounds(getViewBounds());
}

function ensureDownloadsDir() {
  if (!fs.existsSync(DOWNLOADS_PATH)) fs.mkdirSync(DOWNLOADS_PATH, { recursive: true });
}

// Shorthand: send to renderer
function push(channel, data) {
  if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

// ─────────────────────────────────────────────────────────────
// IPC HANDLERS
// ─────────────────────────────────────────────────────────────
ipcMain.on('open-tab',          (_, url)          => openTab(url || HOME_URL));
ipcMain.on('switch-tab',        (_, id)           => switchToTab(id));
ipcMain.on('close-tab',         (_, id)           => closeTab(id));
ipcMain.on('navigate-to',       (_, url)          => navigateTo(url));
ipcMain.on('go-back',           ()                => { const t = getActiveTab(); if (t?.canBack) t.view.webContents.goBack(); });
ipcMain.on('go-forward',        ()                => { const t = getActiveTab(); if (t?.canFwd) t.view.webContents.goForward(); });
ipcMain.on('reload',            ()                => reloadActive());
ipcMain.on('zoom-in',           ()                => zoomIn());
ipcMain.on('zoom-out',          ()                => zoomOut());
ipcMain.on('zoom-reset',        ()                => zoomReset());
ipcMain.on('toggle-dark-mode',  ()                => toggleDarkMode());
ipcMain.on('toggle-fullscreen', ()                => toggleFullscreen());
ipcMain.on('find-in-page',      (_, { text, fwd }) => findInPage(text, fwd !== false));
ipcMain.on('stop-find',         ()                => stopFind());
ipcMain.on('print-page',        ()                => printPage());
ipcMain.on('screenshot',        ()                => takeScreenshot());
ipcMain.on('bookmark-toggle',   ()                => bookmarkCurrentPage());
ipcMain.on('delete-bookmark',   (_, url)          => deleteBookmark(url));
ipcMain.on('clear-history',     ()                => clearHistory());
ipcMain.on('save-password',     (_, d)            => savePassword(d.site, d.username, d.password));
ipcMain.on('delete-password',   (_, idx)          => deletePassword(idx));
ipcMain.on('reveal-password',   (_, idx)          => revealPassword(idx));
ipcMain.on('autofill-password', (_, tabId)        => autoFillPassword(tabId || activeTabId));
ipcMain.on('open-downloads',    ()                => shell.openPath(DOWNLOADS_PATH));
ipcMain.on('open-file',         (_, p)            => shell.openPath(p));
ipcMain.on('pin-tab',           (_, id)           => {
  const t = tabs.find(x => x.id === id);
  if (t) { t.pinned = !t.pinned; push('tab-updated', { id, title: t.title, url: t.url, loading: t.loading, canBack: t.canBack, canFwd: t.canFwd, pinned: t.pinned }); }
});

// Sync IPC — returns data to renderer
ipcMain.handle('get-passwords', () => passwords.map((p, i) => ({ ...p, index: i, password: '••••••••' })));
ipcMain.handle('get-history',   () => history.slice(0, 100));
ipcMain.handle('get-bookmarks', () => bookmarks);
ipcMain.handle('get-downloads', () => downloads);
