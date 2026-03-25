/**
 * preload.js — Arman Store WMS  (v2.0)
 * Runs in renderer context with access to ipcRenderer.
 * Exposes a clean, typed API via contextBridge — no Node leaks.
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/** Helper: register a one-way listener and return an unsubscribe fn. */
const on = (ch, cb) => {
  const handler = (_, data) => cb(data);
  ipcRenderer.on(ch, handler);
  return () => ipcRenderer.removeListener(ch, handler);
};

contextBridge.exposeInMainWorld('WMS', {

  // ── Tab ───────────────────────────────────────────────────
  openTab:   (url)  => ipcRenderer.send('tab:open',   url),
  switchTab: (id)   => ipcRenderer.send('tab:switch', id),
  closeTab:  (id)   => ipcRenderer.send('tab:close',  id),

  // ── Navigation ───────────────────────────────────────────
  back:    () => ipcRenderer.send('nav:back'),
  forward: () => ipcRenderer.send('nav:forward'),
  reload:  () => ipcRenderer.send('nav:reload'),
  home:    () => ipcRenderer.send('nav:home'),

  // ── Print / PDF ───────────────────────────────────────────
  print:     () => ipcRenderer.send('print'),
  savePDF:   () => ipcRenderer.send('pdf'),

  // ── Downloads ─────────────────────────────────────────────
  openDownloads: ()    => ipcRenderer.send('downloads'),
  downloadURL:   (url) => ipcRenderer.send('dl:url', url),

  // ── Zoom ─────────────────────────────────────────────────
  zoomIn:    ()    => ipcRenderer.send('zoom:in'),
  zoomOut:   ()    => ipcRenderer.send('zoom:out'),
  zoomReset: ()    => ipcRenderer.send('zoom:reset'),
  zoomSet:   (pct) => ipcRenderer.send('zoom:set', pct),

  // ── Find in page ─────────────────────────────────────────
  findStart: (q) => ipcRenderer.send('find:start', q),
  findNext:  (q) => ipcRenderer.send('find:next',  q),
  findPrev:  (q) => ipcRenderer.send('find:prev',  q),
  findStop:  ()  => ipcRenderer.send('find:stop'),

  // ── Inbound events (main → renderer) ─────────────────────
  on: {
    tabOpened:    cb => on('tab:opened',  cb),
    tabClosed:    cb => on('tab:closed',  cb),
    tabActive:    cb => on('tab:active',  cb),
    tabUpdate:    cb => on('tab:update',  cb),
    tabLoading:   cb => on('tab:loading', cb),
    tabFavicon:   cb => on('tab:favicon', cb),
    navState:     cb => on('nav:state',   cb),
    navBlocked:   cb => on('nav-blocked', cb),
    zoomChanged:  cb => on('zoom:changed',cb),
    toast:        cb => on('toast',       cb),
    findOpen:     cb => on('find:open',   cb),
    dlStart:      cb => on('dl:start',    cb),
    dlProgress:   cb => on('dl:progress', cb),
    dlComplete:   cb => on('dl:complete', cb),
    dlError:      cb => on('dl:error',    cb),
  },
});
