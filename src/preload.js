/**
 * preload.js — runs in the renderer (shell) with access to Node IPC.
 * Exposes a safe "electronAPI" object to index.html via contextBridge.
 * This is the ONLY way the renderer communicates with main.js.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ── Outgoing (renderer → main) ──────────────────────────────
  openTab:   (url)  => ipcRenderer.send('open-tab', url),
  switchTab: (id)   => ipcRenderer.send('switch-tab', id),
  closeTab:  (id)   => ipcRenderer.send('close-tab', id),
  goBack:    ()     => ipcRenderer.send('go-back'),
  goForward: ()     => ipcRenderer.send('go-forward'),
  reload:    ()     => ipcRenderer.send('reload'),

  // ── Incoming (main → renderer) ──────────────────────────────
  onTabOpened:      (cb) => ipcRenderer.on('tab-opened',       (_, data) => cb(data)),
  onTabClosed:      (cb) => ipcRenderer.on('tab-closed',       (_, data) => cb(data)),
  onTabSwitched:    (cb) => ipcRenderer.on('tab-switched',     (_, data) => cb(data)),
  onTabUpdated:     (cb) => ipcRenderer.on('tab-updated',      (_, data) => cb(data)),
  onTabLoading:     (cb) => ipcRenderer.on('tab-loading',      (_, data) => cb(data)),
  onLimitReached:   (cb) => ipcRenderer.on('tab-limit-reached',(_, max)  => cb(max)),
  onCloseBlocked:   (cb) => ipcRenderer.on('tab-close-blocked',()        => cb()),
});
