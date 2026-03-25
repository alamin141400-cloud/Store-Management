/**
 * main.js — Electron Main Process
 *
 * Architecture:
 *   - One BrowserWindow (the chrome/shell)
 *   - One BrowserView per tab (renders the actual website)
 *   - The shell (index.html) renders the tab bar UI
 *   - IPC bridges shell ↔ main process for tab operations
 *
 * Tab lifecycle:
 *   open-tab   → create BrowserView, load URL, attach to window
 *   switch-tab → detach current BrowserView, attach selected one
 *   close-tab  → destroy BrowserView, switch to adjacent tab
 */

const {
  app,
  BrowserWindow,
  BrowserView,
  ipcMain,
  session,
  shell,
} = require('electron');
const path = require('path');

// ── Constants ─────────────────────────────────────────────────
const ALLOWED_DOMAIN = 'arman.ahrtechdiv.com';
const HOME_URL       = 'https://arman.ahrtechdiv.com';
const MAX_TABS       = 5;
const TAB_BAR_HEIGHT = 52; // px — must match CSS in index.html

// ── State ─────────────────────────────────────────────────────
/** @type {BrowserWindow} */
let mainWindow;

/**
 * Tab record:
 *   id      — unique incremental ID
 *   view    — BrowserView instance
 *   title   — page title (sent back to shell)
 *   url     — current URL
 */
const tabs    = [];
let   nextId  = 1;
let   activeTabId = null;

// ── App ready ─────────────────────────────────────────────────
app.whenReady().then(() => {
  createShellWindow();

  // Block navigation to external domains at session level (belt + suspenders)
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    try {
      const url  = new URL(details.url);
      const host = url.hostname;
      // Allow: allowed domain, local resources (devtools, file://)
      if (host.endsWith(ALLOWED_DOMAIN) || details.url.startsWith('devtools://')) {
        callback({ cancel: false });
      } else {
        callback({ cancel: true });
      }
    } catch {
      callback({ cancel: false }); // allow non-parseable (e.g., about:blank)
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createShellWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── Create shell window ───────────────────────────────────────
function createShellWindow() {
  mainWindow = new BrowserWindow({
    width:           1280,
    height:          800,
    minWidth:        800,
    minHeight:       600,
    title:           'Arman Store',
    backgroundColor: '#1A237E',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
    // Remove default menu bar
    autoHideMenuBar: true,
  });

  // Load the shell HTML (tab bar UI)
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Open first tab once the shell is ready
  mainWindow.webContents.once('did-finish-load', () => {
    openTab(HOME_URL);
  });

  // Resize event: re-layout the active BrowserView
  mainWindow.on('resize', repositionActiveView);
}

// ── BrowserView helpers ───────────────────────────────────────

/** Calculate the bounds for BrowserViews (below the tab bar). */
function getViewBounds() {
  const [w, h]      = mainWindow.getContentSize();
  const statusBarH  = process.platform === 'darwin' ? 0 : 0; // handled by electron
  return {
    x:      0,
    y:      TAB_BAR_HEIGHT + statusBarH,
    width:  w,
    height: h - TAB_BAR_HEIGHT - statusBarH,
  };
}

function repositionActiveView() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab) tab.view.setBounds(getViewBounds());
}

// ── Tab operations (called from IPC) ─────────────────────────

function openTab(url) {
  if (tabs.length >= MAX_TABS) {
    mainWindow.webContents.send('tab-limit-reached', MAX_TABS);
    return;
  }

  const view = new BrowserView({
    webPreferences: {
      contextIsolation:   true,
      nodeIntegration:    false,
      javascript:         true,
      images:             true,
      spellcheck:         false,
      // Disable context menu on long-press (right click)
      devTools:           false,
    },
  });

  const id  = nextId++;
  const tab = { id, view, title: 'New Tab', url };
  tabs.push(tab);

  // Block external navigation inside the BrowserView
  view.webContents.on('will-navigate', (event, navUrl) => {
    try {
      const host = new URL(navUrl).hostname;
      if (!host.endsWith(ALLOWED_DOMAIN)) {
        event.preventDefault();
      }
    } catch { /* allow */ }
  });

  view.webContents.on('will-redirect', (event, navUrl) => {
    try {
      const host = new URL(navUrl).hostname;
      if (!host.endsWith(ALLOWED_DOMAIN)) {
        event.preventDefault();
      }
    } catch { /* allow */ }
  });

  // Capture page title changes
  view.webContents.on('page-title-updated', (_, title) => {
    tab.title = title || 'Arman Store';
    mainWindow.webContents.send('tab-updated', { id, title: tab.title, url: tab.url });
  });

  // Capture URL changes (for tab URL tracking)
  view.webContents.on('did-navigate', (_, navUrl) => {
    tab.url = navUrl;
    mainWindow.webContents.send('tab-updated', { id, title: tab.title, url: navUrl });
  });

  // Loading state → progress indicator
  view.webContents.on('did-start-loading', () => {
    mainWindow.webContents.send('tab-loading', { id, loading: true });
  });
  view.webContents.on('did-stop-loading', () => {
    mainWindow.webContents.send('tab-loading', { id, loading: false });
  });

  // Prevent opening new windows (open in new tab instead)
  view.webContents.setWindowOpenHandler(({ url: newUrl }) => {
    try {
      const host = new URL(newUrl).hostname;
      if (host.endsWith(ALLOWED_DOMAIN)) {
        openTab(newUrl);
      }
    } catch { /* ignore */ }
    return { action: 'deny' };
  });

  // Prevent right-click context menu
  view.webContents.on('context-menu', (event) => {
    event.preventDefault();
  });

  // Load the URL
  view.webContents.loadURL(url);

  // Switch to this new tab
  switchToTab(id);

  // Notify renderer of new tab
  mainWindow.webContents.send('tab-opened', { id, title: 'New Tab', url });
}

function switchToTab(id) {
  // Remove currently attached BrowserView
  const current = mainWindow.getBrowserView();
  if (current) mainWindow.removeBrowserView(current);

  const tab = tabs.find(t => t.id === id);
  if (!tab) return;

  activeTabId = id;
  mainWindow.addBrowserView(tab.view);
  tab.view.setBounds(getViewBounds());

  mainWindow.webContents.send('tab-switched', { id });
}

function closeTab(id) {
  if (tabs.length <= 1) {
    mainWindow.webContents.send('tab-close-blocked');
    return;
  }

  const index = tabs.findIndex(t => t.id === id);
  if (index === -1) return;

  const tab = tabs[index];

  // Remove view from window
  mainWindow.removeBrowserView(tab.view);
  tab.view.webContents.destroy();
  tabs.splice(index, 1);

  // Switch to adjacent tab
  const newTab = tabs[Math.min(index, tabs.length - 1)];
  switchToTab(newTab.id);

  mainWindow.webContents.send('tab-closed', { id, newActiveId: newTab.id });
}

// ── IPC handlers (renderer → main) ───────────────────────────

ipcMain.on('open-tab',   (_, url)  => openTab(url || HOME_URL));
ipcMain.on('switch-tab', (_, id)   => switchToTab(id));
ipcMain.on('close-tab',  (_, id)   => closeTab(id));

ipcMain.on('go-back', () => {
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab?.view.webContents.canGoBack()) tab.view.webContents.goBack();
});

ipcMain.on('go-forward', () => {
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab?.view.webContents.canGoForward()) tab.view.webContents.goForward();
});

ipcMain.on('reload', () => {
  const tab = tabs.find(t => t.id === activeTabId);
  tab?.view.webContents.reload();
});
