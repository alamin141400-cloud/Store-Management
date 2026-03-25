'use strict';
/**
 * preload.js — Secure IPC bridge.
 * Exposes electronAPI to the renderer (index.html) via contextBridge.
 * Node.js / Electron internals are NEVER exposed directly.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // ── Tab management ──────────────────────────────────────────
  openTab:         url  => ipcRenderer.send('open-tab', url),
  switchTab:       id   => ipcRenderer.send('switch-tab', id),
  closeTab:        id   => ipcRenderer.send('close-tab', id),
  pinTab:          id   => ipcRenderer.send('pin-tab', id),

  // ── Navigation ──────────────────────────────────────────────
  navigateTo:      url  => ipcRenderer.send('navigate-to', url),
  goBack:          ()   => ipcRenderer.send('go-back'),
  goForward:       ()   => ipcRenderer.send('go-forward'),
  reload:          ()   => ipcRenderer.send('reload'),

  // ── Zoom ────────────────────────────────────────────────────
  zoomIn:          ()   => ipcRenderer.send('zoom-in'),
  zoomOut:         ()   => ipcRenderer.send('zoom-out'),
  zoomReset:       ()   => ipcRenderer.send('zoom-reset'),

  // ── Features ────────────────────────────────────────────────
  toggleDarkMode:  ()   => ipcRenderer.send('toggle-dark-mode'),
  toggleFullscreen:()   => ipcRenderer.send('toggle-fullscreen'),
  findInPage:      (t,f)=> ipcRenderer.send('find-in-page', { text: t, fwd: f }),
  stopFind:        ()   => ipcRenderer.send('stop-find'),
  printPage:       ()   => ipcRenderer.send('print-page'),
  screenshot:      ()   => ipcRenderer.send('screenshot'),
  bookmarkToggle:  ()   => ipcRenderer.send('bookmark-toggle'),
  deleteBookmark:  url  => ipcRenderer.send('delete-bookmark', url),
  clearHistory:    ()   => ipcRenderer.send('clear-history'),

  // ── Password manager ────────────────────────────────────────
  savePassword:    d    => ipcRenderer.send('save-password', d),
  deletePassword:  idx  => ipcRenderer.send('delete-password', idx),
  revealPassword:  idx  => ipcRenderer.send('reveal-password', idx),
  autofillPassword:()   => ipcRenderer.send('autofill-password'),

  // ── Downloads ───────────────────────────────────────────────
  openDownloads:   ()   => ipcRenderer.send('open-downloads'),
  openFile:        p    => ipcRenderer.send('open-file', p),

  // ── Async getters ───────────────────────────────────────────
  getPasswords:    ()   => ipcRenderer.invoke('get-passwords'),
  getHistory:      ()   => ipcRenderer.invoke('get-history'),
  getBookmarks:    ()   => ipcRenderer.invoke('get-bookmarks'),
  getDownloads:    ()   => ipcRenderer.invoke('get-downloads'),

  // ── Event listeners (main → renderer) ───────────────────────
  on: (channel, cb) => {
    const allowed = [
      'init-state','tab-opened','tab-closed','tab-switched','tab-updated',
      'tab-loading','tab-favicon','show-toast','dark-mode-changed',
      'fullscreen-change','zoom-changed','find-toggle','find-result',
      'bookmarks-updated','history-updated','passwords-updated',
      'password-revealed','login-form-detected','focus-urlbar',
      'download-started','download-progress','download-done',
    ];
    if (allowed.includes(channel)) {
      ipcRenderer.on(channel, (_, data) => cb(data));
    }
  },
  off: (channel, cb) => ipcRenderer.removeListener(channel, cb),
});
