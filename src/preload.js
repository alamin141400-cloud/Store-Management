/**
 * preload.js — Arman Store WMS v3.0
 * Secure IPC bridge via contextBridge.
 * Exposes window.WMS — no Node.js leaks into renderer.
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const on  = (ch, cb) => { const h = (_, d) => cb(d); ipcRenderer.on(ch, h); return () => ipcRenderer.removeListener(ch, h); };
const inv = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
const snd = (ch, d)    => ipcRenderer.send(ch, d);

contextBridge.exposeInMainWorld('WMS', {

  // ── Tabs ──────────────────────────────────────────────────
  openTab:      url  => snd('tab:open',    url),
  switchTab:    id   => snd('tab:switch',  id),
  closeTab:     id   => snd('tab:close',   id),
  duplicateTab: id   => snd('tab:dup',     id),
  pinTab:       id   => snd('tab:pin',     id),
  muteTab:      id   => snd('tab:mute',    id),

  // ── Navigation ────────────────────────────────────────────
  back:         ()   => snd('nav:back'),
  forward:      ()   => snd('nav:forward'),
  reload:       ()   => snd('nav:reload'),
  hardReload:   ()   => snd('nav:hard-reload'),
  stop:         ()   => snd('nav:stop'),
  home:         ()   => snd('nav:home'),
  goToURL:      url  => snd('nav:goto',    url),

  // ── Print / PDF / Screenshot ──────────────────────────────
  print:        ()   => snd('print'),
  savePDF:      ()   => snd('pdf'),
  screenshot:   ()   => inv('screenshot'),

  // ── Downloads ─────────────────────────────────────────────
  openDownloads: ()  => snd('downloads'),
  downloadURL:  url  => snd('dl:url',      url),
  clearDownloads: () => snd('dl:clear'),

  // ── Bookmarks ─────────────────────────────────────────────
  addBookmark:    d  => snd('bm:add',      d),
  removeBookmark: id => snd('bm:remove',   id),
  getBookmarks:   () => inv('bm:get'),

  // ── History ───────────────────────────────────────────────
  getHistory:     () => inv('history:get'),
  clearHistory:   () => snd('history:clear'),

  // ── Zoom ──────────────────────────────────────────────────
  zoomIn:         ()  => snd('zoom:in'),
  zoomOut:        ()  => snd('zoom:out'),
  zoomReset:      ()  => snd('zoom:reset'),
  zoomSet:        pct => snd('zoom:set',   pct),

  // ── Find ──────────────────────────────────────────────────
  findStart:      q  => snd('find:start',  q),
  findNext:       q  => snd('find:next',   q),
  findPrev:       q  => snd('find:prev',   q),
  findStop:       ()  => snd('find:stop'),

  // ── App ───────────────────────────────────────────────────
  minimize:       ()  => snd('app:minimize'),
  maximize:       ()  => snd('app:maximize'),
  quit:           ()  => snd('app:quit'),
  getVersion:     ()  => inv('app:version'),
  openDevTools:   ()  => snd('app:devtools'),

  // ── Inbound (main → renderer) ─────────────────────────────
  on: {
    tabOpened:      cb => on('tab:opened',   cb),
    tabClosed:      cb => on('tab:closed',   cb),
    tabActive:      cb => on('tab:active',   cb),
    tabUpdate:      cb => on('tab:update',   cb),
    tabLoading:     cb => on('tab:loading',  cb),
    tabFavicon:     cb => on('tab:favicon',  cb),
    tabPinned:      cb => on('tab:pinned',   cb),
    navState:       cb => on('nav:state',    cb),
    navBlocked:     cb => on('nav-blocked',  cb),
    urlChanged:     cb => on('url:changed',  cb),
    zoomChanged:    cb => on('zoom:changed', cb),
    toast:          cb => on('toast',        cb),
    findOpen:       cb => on('find:open',    cb),
    dlStart:        cb => on('dl:start',     cb),
    dlProgress:     cb => on('dl:progress',  cb),
    dlComplete:     cb => on('dl:complete',  cb),
    dlError:        cb => on('dl:error',     cb),
    screenshotDone: cb => on('screenshot:done', cb),
  },
});
