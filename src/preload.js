/**
 * Smart Store WMS Desktop App v3.0
 * Preload Script — Secure Bridge Between Main & Renderer
 *
 * Rules:
 *  - contextIsolation: true  → this script runs in isolated world
 *  - nodeIntegration: false  → renderer has NO Node access
 *  - Only explicitly exposed APIs are available to renderer via window.WMS
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// ─────────────────────────────────────────────────────────────────────────────
// HELPER — safe invoke wrapper
// ─────────────────────────────────────────────────────────────────────────────

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const send   = (channel, ...args) => ipcRenderer.send(channel, ...args);
const on     = (channel, cb)      => {
  const handler = (_, ...args) => cb(...args);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

// ─────────────────────────────────────────────────────────────────────────────
// EXPOSED API — window.WMS
// ─────────────────────────────────────────────────────────────────────────────

contextBridge.exposeInMainWorld('WMS', {

  // ── Tab API ──────────────────────────────────────────────────────────────
  tab: {
    open:      (url)  => invoke('tab:open', url),
    close:     (id)   => invoke('tab:close', id),
    switch:    (id)   => invoke('tab:switch', id),
    duplicate: (id)   => invoke('tab:duplicate', id),
    list:      ()     => invoke('tab:list'),
  },

  // ── Navigation API ───────────────────────────────────────────────────────
  nav: {
    back:       ()    => invoke('nav:back'),
    forward:    ()    => invoke('nav:forward'),
    reload:     ()    => invoke('nav:reload'),
    hardReload: ()    => invoke('nav:hard-reload'),
    stop:       ()    => invoke('nav:stop'),
    home:       ()    => invoke('nav:home'),
    goto:       (url) => invoke('nav:goto', url),
  },

  // ── Zoom API ─────────────────────────────────────────────────────────────
  zoom: {
    set:   (tabId, factor) => invoke('zoom:set',   { tabId, factor }),
    in:    ()              => invoke('zoom:in'),
    out:   ()              => invoke('zoom:out'),
    reset: ()              => invoke('zoom:reset'),
  },

  // ── Find in Page ─────────────────────────────────────────────────────────
  find: {
    start: (text, options) => invoke('find:start', { text, options }),
    stop:  ()              => invoke('find:stop'),
  },

  // ── Page Actions ─────────────────────────────────────────────────────────
  page: {
    print:      () => invoke('page:print'),
    savePDF:    () => invoke('page:save-pdf'),
    screenshot: () => invoke('page:screenshot'),
  },

  // ── Downloads ─────────────────────────────────────────────────────────────
  downloads: {
    getAll:     () => invoke('downloads:get-all'),
    openFolder: () => invoke('downloads:open-folder'),
  },

  // ── Bookmarks ─────────────────────────────────────────────────────────────
  bookmarks: {
    get:    ()               => invoke('bookmarks:get'),
    add:    (url, title)     => invoke('bookmarks:add', { url, title }),
    remove: (url)            => invoke('bookmarks:remove', url),
  },

  // ── History ───────────────────────────────────────────────────────────────
  history: {
    get:   ()  => invoke('history:get'),
    clear: ()  => invoke('history:clear'),
  },

  // ── Settings ──────────────────────────────────────────────────────────────
  settings: {
    get:  ()  => invoke('settings:get'),
    save: (s) => invoke('settings:save', s),
  },

  // ── Credentials ───────────────────────────────────────────────────────────
  credentials: {
    save:     (domain, username, password) => invoke('credentials:save', { domain, username, password }),
    get:      (domain)                     => invoke('credentials:get', domain),
    delete:   (domain)                     => invoke('credentials:delete', domain),
    autofill: ()                           => invoke('credentials:autofill'),
    list:     ()                           => invoke('credentials:list'),
    /** Called from injected script in BrowserView */
    promptSave: (username, password)       => send('credentials:prompt-save', { username, password }),
  },

  // ── Window Controls ───────────────────────────────────────────────────────
  window: {
    minimize:   () => invoke('window:minimize'),
    maximize:   () => invoke('window:maximize'),
    close:      () => invoke('window:close'),
    fullscreen: () => invoke('window:fullscreen'),
    devtools:   () => invoke('window:devtools'),
  },

  // ── App Info ──────────────────────────────────────────────────────────────
  app: {
    version: () => invoke('app:version'),
  },

  // ── Event Listeners (renderer ← main) ────────────────────────────────────
  on: {
    tabCreated:          (cb) => on('wms:tab-created',          cb),
    tabClosed:           (cb) => on('wms:tab-closed',           cb),
    tabUpdated:          (cb) => on('wms:tab-updated',          cb),
    tabSwitched:         (cb) => on('wms:tab-switched',         cb),
    tabLoading:          (cb) => on('wms:tab-loading',          cb),
    navState:            (cb) => on('wms:nav-state',            cb),
    downloadStart:       (cb) => on('wms:download-start',       cb),
    downloadProgress:    (cb) => on('wms:download-progress',    cb),
    downloadDone:        (cb) => on('wms:download-done',        cb),
    notification:        (cb) => on('wms:notification',         cb),
    blocked:             (cb) => on('wms:blocked',              cb),
    error:               (cb) => on('wms:error',                cb),
    fullscreen:          (cb) => on('wms:fullscreen',           cb),
    credentialsPrompt:   (cb) => on('wms:credentials-prompt',   cb),
  },
});
