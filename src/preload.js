'use strict';

/**
 * Smart Store WMS — Preload / Context Bridge
 * Exposes window.WMS to renderer. NO Node.js access leaks.
 */

const { contextBridge, ipcRenderer } = require('electron');

const inv = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
const on  = (ch, cb)   => ipcRenderer.on(ch, (_, ...a) => cb(...a));

contextBridge.exposeInMainWorld('WMS', {

  tab: {
    open:      (url)  => inv('tab:open', url),
    close:     (id)   => inv('tab:close', id),
    switch:    (id)   => inv('tab:switch', id),
    duplicate: (id)   => inv('tab:duplicate', id),
    list:      ()     => inv('tab:list'),
  },

  nav: {
    back:       ()    => inv('nav:back'),
    forward:    ()    => inv('nav:forward'),
    reload:     ()    => inv('nav:reload'),
    hardReload: ()    => inv('nav:hard-reload'),
    stop:       ()    => inv('nav:stop'),
    home:       ()    => inv('nav:home'),
    goto:       (url) => inv('nav:goto', url),
  },

  zoom: {
    set:   (tabId, factor) => inv('zoom:set', { tabId, factor }),
    in:    ()              => inv('zoom:in'),
    out:   ()              => inv('zoom:out'),
    reset: ()              => inv('zoom:reset'),
  },

  find: {
    start: (text, options) => inv('find:start', { text, options }),
    stop:  ()              => inv('find:stop'),
  },

  page: {
    print:      () => inv('page:print'),
    savePDF:    () => inv('page:save-pdf'),
    screenshot: () => inv('page:screenshot'),
  },

  downloads: {
    getAll:     ()  => inv('downloads:get-all'),
    openFolder: ()  => inv('downloads:open-folder'),
    openFile:   (p) => inv('downloads:open-file', p),
  },

  bookmarks: {
    get:    ()             => inv('bookmarks:get'),
    add:    (url, title)   => inv('bookmarks:add', { url, title }),
    remove: (url)          => inv('bookmarks:remove', url),
  },

  history: {
    get:   () => inv('history:get'),
    clear: () => inv('history:clear'),
  },

  settings: {
    get:  ()  => inv('settings:get'),
    save: (s) => inv('settings:save', s),
  },

  /**
   * Password Manager API
   * All sensitive operations (decrypt, encrypt) happen in main process only.
   */
  pm: {
    /** Save or update a credential */
    save: (domain, username, password, label) =>
      inv('pm:save', { domain, username, password, label }),

    /** List all sites + accounts (NO passwords) */
    list: () => inv('pm:list'),

    /** Delete one account by id */
    deleteAccount: (domain, accountId) =>
      inv('pm:delete-account', { domain, accountId }),

    /** Delete all accounts for a domain */
    deleteDomain: (domain) => inv('pm:delete-domain', domain),

    /** Toggle never-save */
    setNeverSave: (domain, flag) =>
      inv('pm:set-never-save', { domain, flag }),

    /** Toggle autofill disabled for a domain */
    setAutoFillDisabled: (domain, flag) =>
      inv('pm:set-autofill-disabled', { domain, flag }),

    /** Manually trigger autofill on the active tab */
    autofillNow: () => inv('pm:autofill-now'),

    /** Get a decrypted password (master-password gated in UI) */
    getPassword: (domain, accountId) =>
      inv('pm:get-password', { domain, accountId }),

    /** Update account label */
    updateLabel: (domain, accountId, label) =>
      inv('pm:update-label', { domain, accountId, label }),

    /** Master password status { set, hint } */
    masterStatus: () => inv('pm:master-status'),

    /** Set master password */
    setMaster: (password, hint) =>
      inv('pm:set-master', { password, hint }),

    /** Verify master password → { ok } */
    verifyMaster: (password) => inv('pm:verify-master', { password }),

    /** Clear master password */
    clearMaster: () => inv('pm:clear-master'),

    /** Export encrypted backup (opens save dialog) */
    export: (password) => inv('pm:export', { password }),

    /** Import encrypted backup (opens open dialog) */
    import: (password) => inv('pm:import', { password }),
  },

  window: {
    minimize:   () => inv('window:minimize'),
    maximize:   () => inv('window:maximize'),
    close:      () => inv('window:close'),
    fullscreen: () => inv('window:fullscreen'),
    devtools:   () => inv('window:devtools'),
  },

  app: {
    version: () => inv('app:version'),
  },

  /** IPC event subscriptions */
  on: {
    tabCreated:    (cb) => on('wms:tab-created', cb),
    tabClosed:     (cb) => on('wms:tab-closed', cb),
    tabUpdated:    (cb) => on('wms:tab-updated', cb),
    tabSwitched:   (cb) => on('wms:tab-switched', cb),
    tabLoading:    (cb) => on('wms:tab-loading', cb),
    navState:      (cb) => on('wms:nav-state', cb),
    findResult:    (cb) => on('wms:find-result', cb),
    downloadStart: (cb) => on('wms:download-start', cb),
    downloadProgress: (cb) => on('wms:download-progress', cb),
    downloadDone:  (cb) => on('wms:download-done', cb),
    notification:  (cb) => on('wms:notification', cb),
    blocked:       (cb) => on('wms:blocked', cb),
    error:         (cb) => on('wms:error', cb),
    fullscreen:    (cb) => on('wms:fullscreen', cb),
    /** Fired when the page submits a login form — prompt user to save */
    credentialsPrompt: (cb) => on('wms:credentials-prompt', cb),
  },
});
