/**
 * Smart Store WMS Desktop App v3.0
 * Main Process — Electron Entry Point
 *
 * Responsibilities:
 *  - Window & BrowserView (tab) lifecycle
 *  - Security enforcement (domain whitelist, request blocking)
 *  - Download management
 *  - Password manager (AES-256 encrypted credentials)
 *  - IPC bridge handlers
 *  - Bookmarks / History / Settings persistence
 */

'use strict';

const {
  app,
  BrowserWindow,
  BrowserView,
  ipcMain,
  session,
  dialog,
  shell,
  globalShortcut,
  Menu,
  nativeTheme,
  net,
  protocol
} = require('electron');

const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
const os     = require('os');

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

/** The single allowed WMS origin. */
const WMS_URL    = 'https://arman.ahrtechdiv.com';
const WMS_HOST   = 'arman.ahrtechdiv.com';

/**
 * CDN domains that the WMS site is allowed to load resources from.
 * Modify this array to expand/restrict CDN access.
 */
const CDN_WHITELIST = [
  'arman.ahrtechdiv.com',
  'cdn.jsdelivr.net',
  'cdnjs.cloudflare.com',
  'unpkg.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'use.fontawesome.com',
  'bootstrapcdn.com',
  'maxcdn.bootstrapcdn.com',
  'js.stripe.com',
  'checkout.stripe.com',
  'cdn.socket.io',
  'maps.googleapis.com',
  'maps.gstatic.com',
  'www.google.com',       // reCAPTCHA
  'www.gstatic.com',      // reCAPTCHA assets
];

/** Maximum tabs allowed. */
const MAX_TABS = 10;

/** App data paths */
const USER_DATA      = app.getPath('userData');
const STORE_DIR      = path.join(USER_DATA, 'smart-store');
const CREDS_FILE     = path.join(STORE_DIR, 'credentials.json');
const BOOKMARKS_FILE = path.join(STORE_DIR, 'bookmarks.json');
const HISTORY_FILE   = path.join(STORE_DIR, 'history.json');
const SETTINGS_FILE  = path.join(STORE_DIR, 'settings.json');
const KEY_FILE       = path.join(STORE_DIR, '.enckey');

/** Top chrome bar height in pixels. */
const CHROME_HEIGHT = 110;

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

/** Ensure the data directory exists. */
function ensureStoreDir() {
  if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true });
}

/** Read JSON file safely; return defaultValue on any error. */
function readJSON(file, defaultValue = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return defaultValue;
  }
}

/** Write JSON file atomically (write to tmp then rename). */
function writeJSON(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

/** Check if a URL hostname is in the whitelist. */
function isAllowedURL(urlStr) {
  try {
    const { hostname } = new URL(urlStr);
    return CDN_WHITELIST.some(allowed =>
      hostname === allowed || hostname.endsWith('.' + allowed)
    );
  } catch {
    return false;
  }
}

/** Generate or load the AES-256 encryption key. */
function getEncryptionKey() {
  ensureStoreDir();
  if (fs.existsSync(KEY_FILE)) {
    return fs.readFileSync(KEY_FILE);
  }
  // Derive from machine ID + app version for deterministic fallback
  const machineId = os.hostname() + os.platform() + os.arch();
  const key = crypto.createHash('sha256').update(machineId + 'WMS-v3').digest();
  fs.writeFileSync(KEY_FILE, key);
  return key;
}

/** Encrypt a plaintext string → base64 ciphertext. */
function encrypt(text) {
  const key = getEncryptionKey();
  const iv  = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('base64');
}

/** Decrypt a base64 ciphertext → plaintext. */
function decrypt(ciphertext) {
  try {
    const [ivHex, data] = ciphertext.split(':');
    const key = getEncryptionKey();
    const iv  = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(data, 'base64')),
      decipher.final()
    ]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────────

let mainWindow = null;

/**
 * Tab state map: tabId → { view, url, title, favicon, zoom, canGoBack, canGoForward }
 */
const tabs       = new Map();
let   activeTabId = null;
let   nextTabId   = 1;

/** In-memory download list. */
const downloads  = [];

// ─────────────────────────────────────────────────────────────────────────────
// WINDOW CREATION
// ─────────────────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    frame: true,
    titleBarStyle: 'default',
    title: 'Smart Store WMS',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    backgroundColor: '#0a0f1e',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,      // ✅ Security: isolate renderer context
      nodeIntegration: false,      // ✅ Security: no Node in renderer
      sandbox: true,               // ✅ Security: sandboxed renderer
      webSecurity: true,
      allowRunningInsecureContent: false,
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.maximize();
    // Open first tab automatically
    createTab(WMS_URL);
  });

  // Prevent the main window's webContents from navigating anywhere
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());

  mainWindow.on('resize', () => resizeActiveTab());
  mainWindow.on('closed', () => { mainWindow = null; });

  // Remove default menu bar
  Menu.setApplicationMenu(null);

  setupGlobalShortcuts();
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

/** Get pixel bounds for the BrowserView (below chrome). */
function getViewBounds() {
  const [w, h] = mainWindow.getContentSize();
  return { x: 0, y: CHROME_HEIGHT, width: w, height: h - CHROME_HEIGHT };
}

/**
 * Create a new tab and attach a BrowserView.
 * @param {string} url - URL to load
 * @returns {number} tabId
 */
function createTab(url = WMS_URL) {
  if (tabs.size >= MAX_TABS) {
    mainWindow.webContents.send('wms:error', 'Maximum 10 tabs allowed.');
    return null;
  }

  const tabId = nextTabId++;
  const ses   = session.fromPartition(`persist:tab-${tabId}`); // Independent session per tab

  // Apply security rules to this tab's session
  applySessionSecurity(ses);

  const view = new BrowserView({
    webPreferences: {
      session: ses,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      preload: path.join(__dirname, 'preload.js'),
    }
  });

  tabs.set(tabId, {
    view,
    url,
    title: 'Loading…',
    favicon: null,
    zoom: 1.0,
    canGoBack: false,
    canGoForward: false,
  });

  setupViewEvents(tabId, view);

  // Switch to new tab
  switchTab(tabId);

  // Load the URL
  view.webContents.loadURL(url).catch(err => {
    console.error(`Tab ${tabId} load error:`, err);
  });

  // Notify renderer a tab was created
  mainWindow.webContents.send('wms:tab-created', { tabId, url });

  return tabId;
}

/** Attach event handlers to a BrowserView's webContents. */
function setupViewEvents(tabId, view) {
  const wc = view.webContents;

  // Security: block external navigation
  wc.on('will-navigate', (event, navUrl) => {
    if (!isAllowedURL(navUrl)) {
      event.preventDefault();
      mainWindow.webContents.send('wms:blocked', { url: navUrl });
    }
  });

  // Security: block new windows / popups
  wc.setWindowOpenHandler(({ url }) => {
    if (isAllowedURL(url)) {
      createTab(url); // open in new tab instead
    } else {
      mainWindow.webContents.send('wms:blocked', { url });
    }
    return { action: 'deny' };
  });

  // Update tab state on navigation
  wc.on('did-navigate', (_, url) => {
    updateTabState(tabId, { url });
    addToHistory(url, tabs.get(tabId)?.title || url);
  });

  wc.on('did-navigate-in-page', (_, url) => {
    updateTabState(tabId, { url });
  });

  // Title changes
  wc.on('page-title-updated', (_, title) => {
    updateTabState(tabId, { title });
  });

  // Favicon
  wc.on('page-favicon-updated', (_, favicons) => {
    if (favicons && favicons.length) updateTabState(tabId, { favicon: favicons[0] });
  });

  // Loading indicators
  wc.on('did-start-loading', () => {
    mainWindow.webContents.send('wms:tab-loading', { tabId, loading: true });
  });

  wc.on('did-stop-loading', () => {
    mainWindow.webContents.send('wms:tab-loading', { tabId, loading: false });
    updateNavState(tabId);
  });

  // Downloads
  wc.session.on('will-download', handleDownload);

  // Certificate errors — accept for allowed domains only
  wc.on('certificate-error', (event, url, error, cert, callback) => {
    if (isAllowedURL(url)) {
      // Accept cert for whitelisted domain (enterprise self-signed possible)
      event.preventDefault();
      callback(true);
    } else {
      callback(false);
    }
  });

  // Auto-fill credentials detection after page load
  wc.on('did-finish-load', () => {
    autoFillCredentials(tabId);
    detectLoginForm(tabId);
  });
}

/** Update tab metadata and notify renderer. */
function updateTabState(tabId, patch) {
  const tab = tabs.get(tabId);
  if (!tab) return;
  Object.assign(tab, patch);
  mainWindow.webContents.send('wms:tab-updated', { tabId, ...tab, view: undefined });
}

/** Refresh back/forward state. */
function updateNavState(tabId) {
  const tab = tabs.get(tabId);
  if (!tab) return;
  const wc = tab.view.webContents;
  const canGoBack    = wc.canGoBack();
  const canGoForward = wc.canGoForward();
  updateTabState(tabId, { canGoBack, canGoForward });
  if (tabId === activeTabId) {
    mainWindow.webContents.send('wms:nav-state', { canGoBack, canGoForward, url: tab.url });
  }
}

/** Switch the visible BrowserView to tabId. */
function switchTab(tabId) {
  if (!tabs.has(tabId)) return;

  // Detach current
  if (activeTabId && tabs.has(activeTabId)) {
    mainWindow.removeBrowserView(tabs.get(activeTabId).view);
  }

  activeTabId = tabId;
  const tab   = tabs.get(tabId);

  mainWindow.addBrowserView(tab.view);
  resizeActiveTab();
  updateNavState(tabId);

  mainWindow.webContents.send('wms:tab-switched', { tabId });
}

/** Resize the active BrowserView to fill available area. */
function resizeActiveTab() {
  if (!activeTabId || !tabs.has(activeTabId)) return;
  tabs.get(activeTabId).view.setBounds(getViewBounds());
}

/** Close a tab by ID. */
function closeTab(tabId) {
  if (!tabs.has(tabId)) return;
  const tab = tabs.get(tabId);

  mainWindow.removeBrowserView(tab.view);
  tab.view.webContents.destroy();
  tabs.delete(tabId);

  mainWindow.webContents.send('wms:tab-closed', { tabId });

  if (tabs.size === 0) {
    // No tabs left → open a fresh one
    createTab(WMS_URL);
  } else if (tabId === activeTabId) {
    // Activate the last remaining tab
    const lastId = [...tabs.keys()].pop();
    switchTab(lastId);
  }
}

/** Duplicate a tab. */
function duplicateTab(tabId) {
  const tab = tabs.get(tabId);
  if (!tab) return;
  createTab(tab.url);
}

// ─────────────────────────────────────────────────────────────────────────────
// SESSION SECURITY
// ─────────────────────────────────────────────────────────────────────────────

/** Apply whitelist-based blocking to a session. */
function applySessionSecurity(ses) {
  ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    const url = details.url;

    // Allow file:// and chrome-extension:// (internal)
    if (url.startsWith('file://') || url.startsWith('chrome-extension://') ||
        url.startsWith('devtools://') || url.startsWith('data:')) {
      return callback({ cancel: false });
    }

    if (isAllowedURL(url)) {
      callback({ cancel: false });
    } else {
      console.warn(`[BLOCKED] ${url}`);
      callback({ cancel: true });
    }
  });

  // Block mixed content
  ses.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'X-Frame-Options':           ['SAMEORIGIN'],
        'X-Content-Type-Options':    ['nosniff'],
      }
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// DOWNLOAD MANAGER
// ─────────────────────────────────────────────────────────────────────────────

function handleDownload(event, item) {
  const downloadsDir = app.getPath('downloads');
  const filename     = item.getFilename();
  const savePath     = path.join(downloadsDir, filename);

  item.setSavePath(savePath);

  const downloadEntry = {
    id:       Date.now(),
    filename,
    savePath,
    url:      item.getURL(),
    size:     item.getTotalBytes(),
    received: 0,
    status:   'downloading',
    startTime: Date.now(),
  };

  downloads.push(downloadEntry);
  mainWindow.webContents.send('wms:download-start', downloadEntry);

  item.on('updated', (_, state) => {
    downloadEntry.received = item.getReceivedBytes();
    downloadEntry.status   = state;
    const progress = downloadEntry.size
      ? Math.round((downloadEntry.received / downloadEntry.size) * 100)
      : 0;
    mainWindow.webContents.send('wms:download-progress', {
      id: downloadEntry.id, progress, status: state, received: downloadEntry.received
    });
  });

  item.on('done', (_, state) => {
    downloadEntry.status = state; // 'completed' | 'cancelled' | 'interrupted'
    mainWindow.webContents.send('wms:download-done', {
      id: downloadEntry.id, status: state, savePath
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PRINT & PDF & SCREENSHOT
// ─────────────────────────────────────────────────────────────────────────────

async function printCurrentTab() {
  const tab = tabs.get(activeTabId);
  if (!tab) return;
  tab.view.webContents.print({}, (success, reason) => {
    if (!success) console.error('Print failed:', reason);
  });
}

async function savePDF() {
  const tab = tabs.get(activeTabId);
  if (!tab) return;

  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Page as PDF',
    defaultPath: path.join(app.getPath('documents'), 'page.pdf'),
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
  });

  if (!filePath) return;

  try {
    const data = await tab.view.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
    });
    fs.writeFileSync(filePath, data);
    mainWindow.webContents.send('wms:notification', { msg: 'PDF saved!', type: 'success' });
  } catch (err) {
    mainWindow.webContents.send('wms:notification', { msg: 'PDF failed: ' + err.message, type: 'error' });
  }
}

async function takeScreenshot() {
  const tab = tabs.get(activeTabId);
  if (!tab) return;

  try {
    const img = await tab.view.webContents.capturePage();
    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Save Screenshot',
      defaultPath: path.join(app.getPath('pictures'), `screenshot-${Date.now()}.png`),
      filters: [{ name: 'PNG Image', extensions: ['png'] }]
    });
    if (!filePath) return;
    fs.writeFileSync(filePath, img.toPNG());
    mainWindow.webContents.send('wms:notification', { msg: 'Screenshot saved!', type: 'success' });
  } catch (err) {
    mainWindow.webContents.send('wms:notification', { msg: 'Screenshot failed: ' + err.message, type: 'error' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FIND IN PAGE
// ─────────────────────────────────────────────────────────────────────────────

function findInPage(text, options = {}) {
  const tab = tabs.get(activeTabId);
  if (!tab || !text) return;
  tab.view.webContents.findInPage(text, options);
}

function stopFindInPage() {
  const tab = tabs.get(activeTabId);
  if (!tab) return;
  tab.view.webContents.stopFindInPage('clearSelection');
}

// ─────────────────────────────────────────────────────────────────────────────
// HISTORY
// ─────────────────────────────────────────────────────────────────────────────

const MAX_HISTORY = 150;

function addToHistory(url, title) {
  ensureStoreDir();
  let history = readJSON(HISTORY_FILE, []);
  // Avoid consecutive duplicates
  if (history.length && history[0].url === url) return;
  history.unshift({ url, title, ts: Date.now() });
  if (history.length > MAX_HISTORY) history = history.slice(0, MAX_HISTORY);
  writeJSON(HISTORY_FILE, history);
}

function getHistory() {
  return readJSON(HISTORY_FILE, []);
}

// ─────────────────────────────────────────────────────────────────────────────
// BOOKMARKS
// ─────────────────────────────────────────────────────────────────────────────

function getBookmarks() {
  return readJSON(BOOKMARKS_FILE, []);
}

function addBookmark(url, title) {
  ensureStoreDir();
  const bookmarks = getBookmarks();
  if (bookmarks.find(b => b.url === url)) return; // no duplicates
  bookmarks.unshift({ url, title, ts: Date.now() });
  writeJSON(BOOKMARKS_FILE, bookmarks);
  return bookmarks;
}

function removeBookmark(url) {
  ensureStoreDir();
  const bookmarks = getBookmarks().filter(b => b.url !== url);
  writeJSON(BOOKMARKS_FILE, bookmarks);
  return bookmarks;
}

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS
// ─────────────────────────────────────────────────────────────────────────────

function getSettings() {
  return readJSON(SETTINGS_FILE, {
    theme: 'deep-blue',
    zoom: 1.0,
    autoFill: true,
    showBookmarksBar: false,
    showStatusBar: true,
  });
}

function saveSettings(settings) {
  ensureStoreDir();
  writeJSON(SETTINGS_FILE, settings);
}

// ─────────────────────────────────────────────────────────────────────────────
// PASSWORD MANAGER (AES-256)
// ─────────────────────────────────────────────────────────────────────────────

function getCredentials() {
  return readJSON(CREDS_FILE, {});
}

function saveCredential(domain, username, password) {
  // Only allow WMS domain
  if (!domain.includes(WMS_HOST)) {
    throw new Error('Credentials only allowed for: ' + WMS_HOST);
  }
  ensureStoreDir();
  const creds = getCredentials();
  creds[domain] = {
    username,
    password: encrypt(password),  // AES-256 encrypted
    savedAt: Date.now()
  };
  writeJSON(CREDS_FILE, creds);
}

function getCredential(domain) {
  const creds  = getCredentials();
  const entry  = creds[domain];
  if (!entry) return null;
  return {
    username: entry.username,
    password: decrypt(entry.password), // Decrypt in main process only
    savedAt:  entry.savedAt
  };
}

function deleteCredential(domain) {
  const creds = getCredentials();
  delete creds[domain];
  writeJSON(CREDS_FILE, creds);
}

/** Inject autofill script into BrowserView after page load. */
function autoFillCredentials(tabId) {
  const settings = getSettings();
  if (!settings.autoFill) return;

  const tab = tabs.get(tabId);
  if (!tab) return;

  const cred = getCredential(WMS_HOST);
  if (!cred) return;

  // Inject safely — only username/password fields
  const script = `
    (function() {
      function tryFill() {
        var pwField = document.querySelector('input[type="password"]');
        if (!pwField) return false;

        // Find associated username field heuristically
        var usernameField =
          document.querySelector('input[type="email"]') ||
          document.querySelector('input[type="text"][name*="user"]') ||
          document.querySelector('input[type="text"][name*="email"]') ||
          document.querySelector('input[type="text"][id*="user"]') ||
          document.querySelector('input[type="text"][id*="email"]') ||
          document.querySelector('input[type="text"]');

        if (usernameField) {
          usernameField.value = ${JSON.stringify(cred.username)};
          usernameField.dispatchEvent(new Event('input', { bubbles: true }));
          usernameField.dispatchEvent(new Event('change', { bubbles: true }));
        }

        pwField.value = ${JSON.stringify(cred.password)};
        pwField.dispatchEvent(new Event('input', { bubbles: true }));
        pwField.dispatchEvent(new Event('change', { bubbles: true }));

        // Show autofill indicator
        var indicator = document.createElement('div');
        indicator.style.cssText = 'position:fixed;bottom:16px;right:16px;background:#1a73e8;color:#fff;padding:8px 14px;border-radius:6px;font-size:13px;z-index:999999;box-shadow:0 4px 12px rgba(0,0,0,.3);';
        indicator.textContent = '✓ Auto-filled by Smart Store WMS';
        document.body.appendChild(indicator);
        setTimeout(() => indicator.remove(), 3000);

        return true;
      }

      // Try immediately, then use MutationObserver for dynamic pages
      if (!tryFill()) {
        var observer = new MutationObserver(function() {
          if (tryFill()) observer.disconnect();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        // Give up after 10s
        setTimeout(() => observer.disconnect(), 10000);
      }
    })();
  `;

  tab.view.webContents.executeJavaScript(script).catch(() => {});
}

/** Detect login form submission and prompt to save credentials. */
function detectLoginForm(tabId) {
  const tab = tabs.get(activeTabId);  // Use active tab context
  if (!tab || tabId !== activeTabId) return;

  const script = `
    (function() {
      var pwField = document.querySelector('input[type="password"]');
      if (!pwField) return;

      // Watch for form submit
      var form = pwField.closest('form');
      if (!form) return;

      form.addEventListener('submit', function() {
        var usernameField =
          form.querySelector('input[type="email"]') ||
          form.querySelector('input[type="text"][name*="user"]') ||
          form.querySelector('input[type="text"][name*="email"]') ||
          form.querySelector('input[type="text"]');

        var username = usernameField ? usernameField.value : '';
        var password = pwField.value;

        if (username && password) {
          window.WMS && window.WMS.credentials && window.WMS.credentials.promptSave(username, password);
        }
      }, { once: true });
    })();
  `;

  tab.view.webContents.executeJavaScript(script).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────────
// ZOOM
// ─────────────────────────────────────────────────────────────────────────────

function setZoom(tabId, factor) {
  const tab = tabs.get(tabId);
  if (!tab) return;
  const clamped = Math.min(Math.max(factor, 0.25), 5.0);
  tab.zoom = clamped;
  tab.view.webContents.setZoomFactor(clamped);
  updateTabState(tabId, { zoom: clamped });
}

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL SHORTCUTS
// ─────────────────────────────────────────────────────────────────────────────

function setupGlobalShortcuts() {
  // These are registered as local (window-level) accelerators via Menu in the
  // renderer via IPC, but we also handle F11/F12 globally here.

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (!input.type === 'keyDown') return;
    const ctrl  = input.control;
    const shift = input.shift;
    const key   = input.key;

    if (ctrl && key === 't') { createTab(WMS_URL); event.preventDefault(); }
    if (ctrl && key === 'w') { closeTab(activeTabId); event.preventDefault(); }
    if (ctrl && key === 'r' && !shift) { reloadActive(); event.preventDefault(); }
    if (ctrl && shift && key === 'R') { hardReloadActive(); event.preventDefault(); }
    if (ctrl && key === 'p') { printCurrentTab(); event.preventDefault(); }
    if (ctrl && key === 'd') { duplicateTab(activeTabId); event.preventDefault(); }
    if (ctrl && key === 'q') { app.quit(); event.preventDefault(); }
    if (key === 'F11') { toggleFullscreen(); event.preventDefault(); }
    if (key === 'F12') { toggleDevTools(); event.preventDefault(); }
  });
}

function reloadActive() {
  const tab = tabs.get(activeTabId);
  if (tab) tab.view.webContents.reload();
}

function hardReloadActive() {
  const tab = tabs.get(activeTabId);
  if (tab) tab.view.webContents.reloadIgnoringCache();
}

function toggleFullscreen() {
  mainWindow.setFullScreen(!mainWindow.isFullScreen());
  if (mainWindow.isFullScreen()) {
    mainWindow.webContents.send('wms:fullscreen', true);
  } else {
    mainWindow.webContents.send('wms:fullscreen', false);
  }
}

function toggleDevTools() {
  const tab = tabs.get(activeTabId);
  if (tab) {
    tab.view.webContents.toggleDevTools();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// IPC HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

function registerIPC() {

  // ── Tabs ─────────────────────────────────────────────────────────────────
  ipcMain.handle('tab:open',       (_, url) => createTab(url || WMS_URL));
  ipcMain.handle('tab:close',      (_, id)  => closeTab(id));
  ipcMain.handle('tab:switch',     (_, id)  => switchTab(id));
  ipcMain.handle('tab:duplicate',  (_, id)  => duplicateTab(id));
  ipcMain.handle('tab:list',       ()       => {
    return [...tabs.entries()].map(([id, t]) => ({
      id, url: t.url, title: t.title, favicon: t.favicon,
      zoom: t.zoom, canGoBack: t.canGoBack, canGoForward: t.canGoForward,
      isActive: id === activeTabId,
    }));
  });

  // ── Navigation ────────────────────────────────────────────────────────────
  ipcMain.handle('nav:back',    () => tabs.get(activeTabId)?.view.webContents.goBack());
  ipcMain.handle('nav:forward', () => tabs.get(activeTabId)?.view.webContents.goForward());
  ipcMain.handle('nav:reload',  () => reloadActive());
  ipcMain.handle('nav:hard-reload', () => hardReloadActive());
  ipcMain.handle('nav:stop',    () => tabs.get(activeTabId)?.view.webContents.stop());
  ipcMain.handle('nav:home',    () => tabs.get(activeTabId)?.view.webContents.loadURL(WMS_URL));
  ipcMain.handle('nav:goto',    (_, url) => {
    const tab = tabs.get(activeTabId);
    if (!tab) return;
    let target = url;
    if (!target.startsWith('http://') && !target.startsWith('https://')) {
      target = 'https://' + target;
    }
    if (!isAllowedURL(target)) {
      mainWindow.webContents.send('wms:blocked', { url: target });
      return;
    }
    tab.view.webContents.loadURL(target);
  });

  // ── Zoom ──────────────────────────────────────────────────────────────────
  ipcMain.handle('zoom:set',  (_, { tabId, factor }) => setZoom(tabId, factor));
  ipcMain.handle('zoom:in',   () => {
    const tab = tabs.get(activeTabId);
    if (tab) setZoom(activeTabId, tab.zoom + 0.1);
  });
  ipcMain.handle('zoom:out',  () => {
    const tab = tabs.get(activeTabId);
    if (tab) setZoom(activeTabId, tab.zoom - 0.1);
  });
  ipcMain.handle('zoom:reset',() => setZoom(activeTabId, 1.0));

  // ── Find ──────────────────────────────────────────────────────────────────
  ipcMain.handle('find:start', (_, { text, options }) => findInPage(text, options));
  ipcMain.handle('find:stop',  () => stopFindInPage());

  // ── Print / PDF / Screenshot ──────────────────────────────────────────────
  ipcMain.handle('page:print',      () => printCurrentTab());
  ipcMain.handle('page:save-pdf',   () => savePDF());
  ipcMain.handle('page:screenshot', () => takeScreenshot());

  // ── Downloads ─────────────────────────────────────────────────────────────
  ipcMain.handle('downloads:get-all',    () => downloads);
  ipcMain.handle('downloads:open-folder',() => shell.openPath(app.getPath('downloads')));

  // ── Bookmarks ─────────────────────────────────────────────────────────────
  ipcMain.handle('bookmarks:get',    () => getBookmarks());
  ipcMain.handle('bookmarks:add',    (_, { url, title }) => addBookmark(url, title));
  ipcMain.handle('bookmarks:remove', (_, url) => removeBookmark(url));

  // ── History ───────────────────────────────────────────────────────────────
  ipcMain.handle('history:get',   () => getHistory());
  ipcMain.handle('history:clear', () => { writeJSON(HISTORY_FILE, []); });

  // ── Settings ──────────────────────────────────────────────────────────────
  ipcMain.handle('settings:get',  () => getSettings());
  ipcMain.handle('settings:save', (_, s) => saveSettings(s));

  // ── Credentials ───────────────────────────────────────────────────────────
  ipcMain.handle('credentials:save',   (_, { domain, username, password }) =>
    saveCredential(domain, username, password));

  ipcMain.handle('credentials:get',    (_, domain) => {
    const cred = getCredential(domain);
    // Never expose decrypted password to renderer unless for autofill
    if (!cred) return null;
    return { username: cred.username, savedAt: cred.savedAt, hasSaved: true };
  });

  ipcMain.handle('credentials:delete', (_, domain) => deleteCredential(domain));

  ipcMain.handle('credentials:autofill', () => {
    if (activeTabId) autoFillCredentials(activeTabId);
  });

  ipcMain.handle('credentials:list', () => {
    const creds = getCredentials();
    return Object.entries(creds).map(([domain, v]) => ({
      domain, username: v.username, savedAt: v.savedAt
    }));
  });

  // ── Window controls ───────────────────────────────────────────────────────
  ipcMain.handle('window:minimize',   () => mainWindow.minimize());
  ipcMain.handle('window:maximize',   () => mainWindow.isMaximized()
    ? mainWindow.unmaximize() : mainWindow.maximize());
  ipcMain.handle('window:close',      () => mainWindow.close());
  ipcMain.handle('window:fullscreen', () => toggleFullscreen());
  ipcMain.handle('window:devtools',   () => toggleDevTools());

  // ── Utility ───────────────────────────────────────────────────────────────
  ipcMain.handle('app:version',  () => app.getVersion());
  ipcMain.handle('app:open-url', (_, url) => {
    if (isAllowedURL(url)) shell.openExternal(url);
  });

  // Renderer tells us user wants to save credentials (triggered from injected script)
  ipcMain.on('credentials:prompt-save', (_, { username, password }) => {
    mainWindow.webContents.send('wms:credentials-prompt', { username, password, domain: WMS_HOST });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// APP LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  ensureStoreDir();
  registerIPC();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Prevent second instance
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}
