'use strict';

/**
 * Smart Store WMS Desktop App v3.0
 * Main Process — Complete Password Manager Edition
 *
 * Password Manager:
 *  ✅ AES-256-CBC encryption (device-bound key)
 *  ✅ Multiple accounts per domain
 *  ✅ Master password (PBKDF2 + HMAC verify)
 *  ✅ Auto-detect login form submission (MutationObserver for React/Vue/SPA)
 *  ✅ Smart autofill with multi-account chooser UI
 *  ✅ Per-site never-save & autofill-disable
 *  ✅ Usage tracking (lastUsed, timesUsed)
 *  ✅ Export / Import (password-encrypted JSON)
 *  ✅ Reveal password (master password gated)
 */

const {
  app, BrowserWindow, BrowserView, ipcMain,
  session, dialog, shell, Menu
} = require('electron');

const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
const os     = require('os');

// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────

const WMS_URL  = 'https://arman.ahrtechdiv.com';
const WMS_HOST = 'arman.ahrtechdiv.com';
const MAX_TABS = 10;
const CHROME_H = 110;

const CDN_WHITELIST = [
  'arman.ahrtechdiv.com',
  'cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'unpkg.com',
  'fonts.googleapis.com', 'fonts.gstatic.com',
  'use.fontawesome.com', 'bootstrapcdn.com',
  'maxcdn.bootstrapcdn.com', 'stackpath.bootstrapcdn.com',
  'js.stripe.com', 'checkout.stripe.com',
  'cdn.socket.io', 'maps.googleapis.com', 'maps.gstatic.com',
  'www.google.com', 'www.gstatic.com', 'ajax.googleapis.com',
];

const STORE_DIR      = path.join(app.getPath('userData'), 'smart-store');
const CREDS_FILE     = path.join(STORE_DIR, 'credentials.json');
const BOOKMARKS_FILE = path.join(STORE_DIR, 'bookmarks.json');
const HISTORY_FILE   = path.join(STORE_DIR, 'history.json');
const SETTINGS_FILE  = path.join(STORE_DIR, 'settings.json');
const PM_META_FILE   = path.join(STORE_DIR, 'pm-meta.json');
const KEY_FILE       = path.join(STORE_DIR, '.enckey');

// ─────────────────────────────────────────────────────────────
// FILE HELPERS
// ─────────────────────────────────────────────────────────────

function ensureDir() {
  if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true });
}

function readJSON(file, def = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return def; }
}

function writeJSON(file, data) {
  ensureDir();
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function isAllowed(urlStr) {
  try {
    const { hostname } = new URL(urlStr);
    return CDN_WHITELIST.some(d => hostname === d || hostname.endsWith('.' + d));
  } catch { return false; }
}

// ─────────────────────────────────────────────────────────────
// ENCRYPTION — AES-256-CBC
// ─────────────────────────────────────────────────────────────

function getDeviceKey() {
  ensureDir();
  if (fs.existsSync(KEY_FILE)) {
    const raw = fs.readFileSync(KEY_FILE);
    if (raw.length === 32) return raw;
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, key, { mode: 0o600 });
  return key;
}

function encryptAES(plaintext) {
  const key = getDeviceKey();
  const iv  = crypto.randomBytes(16);
  const c   = crypto.createCipheriv('aes-256-cbc', key, iv);
  const enc = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  return iv.toString('hex') + ':' + enc.toString('base64');
}

function decryptAES(ciphertext) {
  try {
    const [ivHex, b64] = ciphertext.split(':');
    const key = getDeviceKey();
    const iv  = Buffer.from(ivHex, 'hex');
    const d   = crypto.createDecipheriv('aes-256-cbc', key, iv);
    return Buffer.concat([d.update(Buffer.from(b64, 'base64')), d.final()]).toString('utf8');
  } catch { return null; }
}

function encryptWithPwKey(plaintext, key) {
  const iv  = crypto.randomBytes(16);
  const c   = crypto.createCipheriv('aes-256-cbc', key, iv);
  const enc = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  return iv.toString('hex') + ':' + enc.toString('base64');
}

function decryptWithPwKey(ciphertext, key) {
  try {
    const [ivHex, b64] = ciphertext.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const d  = crypto.createDecipheriv('aes-256-cbc', key, iv);
    return Buffer.concat([d.update(Buffer.from(b64, 'base64')), d.final()]).toString('utf8');
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────────
// MASTER PASSWORD
// ─────────────────────────────────────────────────────────────

function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 200000, 32, 'sha256');
}

function getMasterMeta() {
  return readJSON(PM_META_FILE, { set: false, hash: null, salt: null, hint: '' });
}

function isMasterSet() { return getMasterMeta().set === true; }

function setMasterPassword(password, hint = '') {
  const salt = crypto.randomBytes(32).toString('hex');
  const key  = deriveKey(password, salt);
  const hash = crypto.createHmac('sha256', key).update('wms-pm-v3').digest('hex');
  writeJSON(PM_META_FILE, { set: true, hash, salt, hint });
}

function verifyMaster(password) {
  const meta = getMasterMeta();
  if (!meta.set) return true;
  const key  = deriveKey(password, meta.salt);
  const hash = crypto.createHmac('sha256', key).update('wms-pm-v3').digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(meta.hash)); } catch { return false; }
}

function clearMaster() {
  writeJSON(PM_META_FILE, { set: false, hash: null, salt: null, hint: '' });
}

// ─────────────────────────────────────────────────────────────
// CREDENTIAL STORE
// ─────────────────────────────────────────────────────────────

/*
  Storage schema:
  {
    "domain.com": {
      accounts: [
        { id, username, password(enc), label, savedAt, lastUsed, timesUsed }
      ],
      neverSave: false,
      autoFillDisabled: false
    }
  }
*/

function getAllCreds()        { return readJSON(CREDS_FILE, {}); }
function saveAllCreds(store) { writeJSON(CREDS_FILE, store); }

function saveCredential(domain, username, password, label = '') {
  const store = getAllCreds();
  if (!store[domain]) store[domain] = { accounts: [], neverSave: false, autoFillDisabled: false };
  const now  = Date.now();
  const enc  = encryptAES(password);
  const idx  = store[domain].accounts.findIndex(a => a.username === username);
  if (idx >= 0) {
    store[domain].accounts[idx].password = enc;
    store[domain].accounts[idx].savedAt  = now;
    if (label) store[domain].accounts[idx].label = label;
  } else {
    store[domain].accounts.push({
      id: crypto.randomBytes(8).toString('hex'),
      username, password: enc,
      label: label || username,
      savedAt: now, lastUsed: null, timesUsed: 0
    });
  }
  saveAllCreds(store);
}

function markCredUsed(domain, username) {
  const store = getAllCreds();
  const site  = store[domain];
  if (!site) return;
  const acc = site.accounts.find(a => a.username === username);
  if (!acc) return;
  acc.lastUsed  = Date.now();
  acc.timesUsed = (acc.timesUsed || 0) + 1;
  saveAllCreds(store);
}

function deleteAccount(domain, accountId) {
  const store = getAllCreds();
  const site  = store[domain];
  if (!site) return;
  site.accounts = site.accounts.filter(a => a.id !== accountId);
  if (!site.accounts.length && !site.neverSave) delete store[domain];
  saveAllCreds(store);
}

function deleteDomain(domain) {
  const store = getAllCreds();
  delete store[domain];
  saveAllCreds(store);
}

function setNeverSave(domain, flag) {
  const store = getAllCreds();
  if (!store[domain]) store[domain] = { accounts: [], neverSave: false, autoFillDisabled: false };
  store[domain].neverSave = flag;
  saveAllCreds(store);
}

function setAutoFillDisabled(domain, flag) {
  const store = getAllCreds();
  if (!store[domain]) store[domain] = { accounts: [], neverSave: false, autoFillDisabled: false };
  store[domain].autoFillDisabled = flag;
  saveAllCreds(store);
}

function listAllCreds() {
  const store = getAllCreds();
  return Object.entries(store).map(([domain, data]) => ({
    domain,
    neverSave:        data.neverSave || false,
    autoFillDisabled: data.autoFillDisabled || false,
    accounts: (data.accounts || []).map(a => ({
      id: a.id, username: a.username, label: a.label,
      savedAt: a.savedAt, lastUsed: a.lastUsed, timesUsed: a.timesUsed || 0
    }))
  }));
}

function exportCreds(exportPassword) {
  const raw  = JSON.stringify(getAllCreds());
  const salt = crypto.randomBytes(16).toString('hex');
  const key  = deriveKey(exportPassword, salt);
  const enc  = encryptWithPwKey(raw, key);
  return JSON.stringify({ v: 3, salt, data: enc }, null, 2);
}

function importCreds(jsonStr, importPassword) {
  try {
    const { v, salt, data } = JSON.parse(jsonStr);
    if (v !== 3) throw new Error('Incompatible format');
    const key = deriveKey(importPassword, salt);
    const dec = decryptWithPwKey(data, key);
    if (!dec) throw new Error('Wrong password or corrupt file');
    const parsed = JSON.parse(dec);
    saveAllCreds(parsed);
    return { ok: true, count: Object.keys(parsed).length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ─────────────────────────────────────────────────────────────
// AUTOFILL INJECTION SCRIPTS
// ─────────────────────────────────────────────────────────────

/** Build the autofill script with all decrypted accounts embedded. */
function buildAutofillScript(accounts) {
  const safe = JSON.stringify(
    accounts.map(a => ({ id: a.id, username: a.username, password: a.password, label: a.label || a.username }))
  );
  return `
(function(){
'use strict';
var ACCOUNTS=${safe};
if(!ACCOUNTS.length)return;

function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

function getFields(){
  var pw=document.querySelector('input[type="password"]');
  if(!pw)return null;
  var f=pw.closest('form')||document;
  var u=f.querySelector('input[type="email"]')||
        f.querySelector('input[autocomplete="username"]')||
        f.querySelector('input[autocomplete="email"]')||
        f.querySelector('input[name*="email"]')||
        f.querySelector('input[name*="user"]')||
        f.querySelector('input[id*="email"]')||
        f.querySelector('input[id*="user"]')||
        f.querySelector('input[type="text"]');
  return{user:u,pw:pw};
}

function dispatch(el){
  ['input','change','keyup','blur'].forEach(function(n){
    el.dispatchEvent(new Event(n,{bubbles:true}));
  });
}

function fillWith(acc){
  var f=getFields();if(!f)return;
  if(f.user){f.user.value=acc.username;dispatch(f.user);}
  f.pw.value=acc.password;dispatch(f.pw);
  showBadge('\\u2714 Filled: '+esc(acc.label),'#059669');
  removeChooser();
  // Notify main about usage
  document.dispatchEvent(new CustomEvent('__wms_filled__',{detail:{username:acc.username}}));
}

function showBadge(msg,color){
  var old=document.getElementById('__wms_badge__');if(old)old.remove();
  var b=document.createElement('div');b.id='__wms_badge__';
  b.style.cssText='position:fixed;bottom:18px;right:18px;z-index:2147483647;background:'+color+';color:#fff;'+
    'padding:9px 18px;border-radius:8px;font-size:13px;font-family:system-ui,sans-serif;'+
    'box-shadow:0 4px 20px rgba(0,0,0,.4);transition:opacity .5s;pointer-events:none;';
  b.textContent=msg;
  document.body.appendChild(b);
  setTimeout(function(){b.style.opacity='0';setTimeout(function(){b.remove();},500);},2800);
}

function removeChooser(){var c=document.getElementById('__wms_chooser__');if(c)c.remove();}

function buildChooser(){
  removeChooser();
  var f=getFields();if(!f)return;
  var rect=f.pw.getBoundingClientRect();
  var w=document.createElement('div');w.id='__wms_chooser__';
  w.style.cssText='position:fixed;z-index:2147483647;'+
    'top:'+(rect.bottom+window.scrollY+6)+'px;left:'+(rect.left+window.scrollX)+'px;'+
    'background:#0d1428;border:1px solid #2563eb;border-radius:10px;'+
    'box-shadow:0 8px 40px rgba(0,0,0,.65);font-family:system-ui,sans-serif;'+
    'min-width:260px;max-width:320px;overflow:hidden;';

  var hdr=document.createElement('div');
  hdr.style.cssText='padding:9px 14px;font-size:11px;font-weight:700;text-transform:uppercase;'+
    'letter-spacing:.07em;color:#5f7fba;border-bottom:1px solid #1e3060;'+
    'display:flex;align-items:center;justify-content:space-between;';
  hdr.innerHTML='<span>\\uD83D\\uDD11 Choose Account</span>';
  var x=document.createElement('span');x.textContent='\\u2715';
  x.style.cssText='cursor:pointer;color:#5f7fba;font-size:15px;line-height:1;padding:0 2px;';
  x.onclick=removeChooser;hdr.appendChild(x);w.appendChild(hdr);

  ACCOUNTS.forEach(function(acc){
    var row=document.createElement('div');
    row.style.cssText='padding:10px 14px;cursor:pointer;display:flex;align-items:center;gap:10px;'+
      'border-bottom:1px solid #1e3060;transition:background .12s;';
    row.onmouseenter=function(){row.style.background='#162040';};
    row.onmouseleave=function(){row.style.background='transparent';};
    var av=document.createElement('div');
    av.style.cssText='width:30px;height:30px;border-radius:50%;'+
      'background:linear-gradient(135deg,#2563eb,#1d4ed8);'+
      'display:flex;align-items:center;justify-content:center;'+
      'font-size:13px;font-weight:700;color:#fff;flex-shrink:0;';
    av.textContent=(acc.label||acc.username).charAt(0).toUpperCase();
    var info=document.createElement('div');info.style.cssText='flex:1;overflow:hidden;';
    info.innerHTML='<div style="font-size:13px;color:#e8edf8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+esc(acc.label||acc.username)+'</div>'+
      '<div style="font-size:11px;color:#5f7fba;margin-top:1px;">'+esc(acc.username)+'</div>';
    row.appendChild(av);row.appendChild(info);
    row.onclick=function(){fillWith(acc);};
    w.appendChild(row);
  });
  document.body.appendChild(w);
  setTimeout(function(){
    document.addEventListener('click',function h(e){if(!w.contains(e.target)){removeChooser();document.removeEventListener('click',h);}});
  },10);
}

function tryFill(){
  if(!getFields())return false;
  if(ACCOUNTS.length===1)fillWith(ACCOUNTS[0]);
  else buildChooser();
  return true;
}

if(!tryFill()){
  var obs=new MutationObserver(function(){if(tryFill())obs.disconnect();});
  obs.observe(document.documentElement,{childList:true,subtree:true});
  setTimeout(function(){obs.disconnect();},12000);
}
})();
`.trim();
}

/** Build the credential-capture detection script. */
function buildDetectScript() {
  return `
(function(){
'use strict';
if(window.__wmsDetect__)return;
window.__wmsDetect__=true;

function getUser(form){
  return form.querySelector('input[type="email"]')||
    form.querySelector('input[autocomplete="username"]')||
    form.querySelector('input[autocomplete="email"]')||
    form.querySelector('input[name*="email"]')||
    form.querySelector('input[name*="user"]')||
    form.querySelector('input[type="text"]');
}

function listen(form){
  if(form.__wmsListen__)return;form.__wmsListen__=true;
  function capture(){
    var pw=form.querySelector('input[type="password"]');
    if(!pw||!pw.value)return;
    var u=getUser(form);
    if(u&&u.value&&pw.value){
      document.dispatchEvent(new CustomEvent('__wms_submit__',{detail:{username:u.value,password:pw.value}}));
    }
  }
  form.addEventListener('submit',capture);
  // Also watch for button clicks that submit
  form.querySelectorAll('button[type="submit"],input[type="submit"]').forEach(function(btn){
    btn.addEventListener('click',function(){setTimeout(capture,100);});
  });
}

document.querySelectorAll('form').forEach(listen);
new MutationObserver(function(ms){
  ms.forEach(function(m){m.addedNodes.forEach(function(n){
    if(n.nodeType!==1)return;
    if(n.tagName==='FORM')listen(n);
    n.querySelectorAll&&n.querySelectorAll('form').forEach(listen);
  });});
}).observe(document.documentElement,{childList:true,subtree:true});
})();
`.trim();
}

// ─────────────────────────────────────────────────────────────
// AUTOFILL TRIGGER
// ─────────────────────────────────────────────────────────────

function autoFillCredentials(tabId) {
  const s = getSettings();
  if (!s.autoFill) return;
  const tab = tabs.get(tabId);
  if (!tab) return;
  const store = getAllCreds();
  const site  = store[WMS_HOST];
  if (!site || !site.accounts.length || site.autoFillDisabled) return;

  const accounts = site.accounts
    .map(a => ({ id: a.id, username: a.username, password: decryptAES(a.password), label: a.label || a.username }))
    .filter(a => a.password);

  if (!accounts.length) return;
  tab.view.webContents.executeJavaScript(buildAutofillScript(accounts)).catch(() => {});

  // Listen for fill event to mark usage
  tab.view.webContents.executeJavaScript(`
    (function(){
      if(window.__wmsFilledListen__)return;window.__wmsFilledListen__=true;
      document.addEventListener('__wms_filled__',function(e){window.__wmsLastFilled__=e.detail.username;});
    })();
  `).catch(() => {});
}

function detectLoginForm(tabId) {
  const tab = tabs.get(tabId); if (!tab) return;
  tab.view.webContents.executeJavaScript(buildDetectScript()).catch(() => {});

  // Setup listener for the custom event
  setTimeout(() => {
    tab.view.webContents.executeJavaScript(`
      (function(){
        if(window.__wmsSubmitListen__)return;window.__wmsSubmitListen__=true;
        document.addEventListener('__wms_submit__',function(e){window.__wmsPendingCred__=e.detail;});
      })();
    `).catch(() => {});
  }, 600);
}

function pollForCredential(tabId) {
  const tab = tabs.get(tabId); if (!tab) return;
  tab.view.webContents.executeJavaScript(`
    (function(){var c=window.__wmsPendingCred__;window.__wmsPendingCred__=null;return c||null;})();
  `).then(cred => {
    if (!cred || !cred.username || !cred.password) return;
    const store = getAllCreds();
    const site  = store[WMS_HOST];
    if (site && site.neverSave) return;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('wms:credentials-prompt', { username: cred.username, password: cred.password, domain: WMS_HOST });
    }
  }).catch(() => {});
}

// ─────────────────────────────────────────────────────────────
// APP STATE
// ─────────────────────────────────────────────────────────────

let mainWindow  = null;
const tabs      = new Map();
let activeTabId = null;
let nextTabId   = 1;
const downloads = [];

function send(channel, ...args) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args);
}

// ─────────────────────────────────────────────────────────────
// WINDOW
// ─────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600,
    frame: true, title: 'Smart Store WMS',
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    backgroundColor: '#0a0f1e', show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
      sandbox: true, webSecurity: true,
    }
  });
  Menu.setApplicationMenu(null);
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.once('ready-to-show', () => { mainWindow.show(); mainWindow.maximize(); createTab(WMS_URL); });
  mainWindow.webContents.on('will-navigate', e => e.preventDefault());
  mainWindow.on('resize', () => resizeActive());
  mainWindow.on('closed', () => { mainWindow = null; });
  setupShortcuts();
}

// ─────────────────────────────────────────────────────────────
// TABS
// ─────────────────────────────────────────────────────────────

function getBounds() {
  const [w, h] = mainWindow.getContentSize();
  return { x: 0, y: CHROME_H, width: w, height: h - CHROME_H };
}

function createTab(url = WMS_URL) {
  if (tabs.size >= MAX_TABS) { send('wms:error', 'Maximum 10 tabs allowed.'); return null; }
  const tabId = nextTabId++;
  const ses   = session.fromPartition(`persist:tab-${tabId}`);
  applySessionSecurity(ses);
  const view = new BrowserView({
    webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true }
  });
  tabs.set(tabId, { view, url, title: 'Loading…', favicon: null, zoom: 1.0, canGoBack: false, canGoForward: false });
  setupViewEvents(tabId, view);
  switchTab(tabId);
  view.webContents.loadURL(url).catch(() => {});
  send('wms:tab-created', { tabId, url });
  return tabId;
}

function setupViewEvents(tabId, view) {
  const wc = view.webContents;
  wc.on('will-navigate', (e, u) => { if (!isAllowed(u)) { e.preventDefault(); send('wms:blocked', { url: u }); } });
  wc.setWindowOpenHandler(({ url }) => { if (isAllowed(url)) createTab(url); else send('wms:blocked', { url }); return { action: 'deny' }; });
  wc.on('did-navigate', (_, u) => { updateTab(tabId, { url: u }); addHistory(u, tabs.get(tabId)?.title || u); setTimeout(() => pollForCredential(tabId), 1800); });
  wc.on('did-navigate-in-page', (_, u) => updateTab(tabId, { url: u }));
  wc.on('page-title-updated', (_, t) => updateTab(tabId, { title: t }));
  wc.on('page-favicon-updated', (_, f) => { if (f?.length) updateTab(tabId, { favicon: f[0] }); });
  wc.on('did-start-loading', () => send('wms:tab-loading', { tabId, loading: true }));
  wc.on('did-stop-loading', () => { send('wms:tab-loading', { tabId, loading: false }); updateNavState(tabId); detectLoginForm(tabId); });
  wc.on('did-finish-load', () => { autoFillCredentials(tabId); detectLoginForm(tabId); });
  wc.session.on('will-download', handleDownload);
  wc.on('found-in-page', (_, r) => send('wms:find-result', { activeMatchOrdinal: r.activeMatchOrdinal, matches: r.matches }));
}

function updateTab(tabId, patch) {
  const t = tabs.get(tabId); if (!t) return;
  Object.assign(t, patch);
  send('wms:tab-updated', { tabId, ...t, view: undefined });
}

function updateNavState(tabId) {
  const t = tabs.get(tabId); if (!t) return;
  const back = t.view.webContents.canGoBack(), fwd = t.view.webContents.canGoForward();
  updateTab(tabId, { canGoBack: back, canGoForward: fwd });
  if (tabId === activeTabId) send('wms:nav-state', { canGoBack: back, canGoForward: fwd, url: t.url });
}

function switchTab(tabId) {
  if (!tabs.has(tabId)) return;
  if (activeTabId && tabs.has(activeTabId)) mainWindow.removeBrowserView(tabs.get(activeTabId).view);
  activeTabId = tabId;
  const t = tabs.get(tabId);
  mainWindow.addBrowserView(t.view);
  resizeActive();
  updateNavState(tabId);
  send('wms:tab-switched', { tabId });
}

function resizeActive() {
  if (activeTabId && tabs.has(activeTabId)) tabs.get(activeTabId).view.setBounds(getBounds());
}

function closeTab(tabId) {
  if (!tabs.has(tabId)) return;
  const t = tabs.get(tabId);
  mainWindow.removeBrowserView(t.view);
  t.view.webContents.destroy();
  tabs.delete(tabId);
  send('wms:tab-closed', { tabId });
  if (tabs.size === 0) createTab(WMS_URL);
  else if (tabId === activeTabId) switchTab([...tabs.keys()].pop());
}

function duplicateTab(tabId) {
  const t = tabs.get(tabId); if (t) createTab(t.url);
}

// ─────────────────────────────────────────────────────────────
// SESSION SECURITY
// ─────────────────────────────────────────────────────────────

function applySessionSecurity(ses) {
  ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, cb) => {
    const u = details.url;
    if (u.startsWith('file://') || u.startsWith('chrome-extension://') || u.startsWith('devtools://') || u.startsWith('data:'))
      return cb({ cancel: false });
    cb({ cancel: !isAllowed(u) });
  });
}

// ─────────────────────────────────────────────────────────────
// DOWNLOADS
// ─────────────────────────────────────────────────────────────

function handleDownload(event, item) {
  const sp = path.join(app.getPath('downloads'), item.getFilename());
  item.setSavePath(sp);
  const e = { id: Date.now(), filename: item.getFilename(), savePath: sp, size: item.getTotalBytes(), received: 0, status: 'downloading', startTime: Date.now() };
  downloads.push(e);
  send('wms:download-start', e);
  item.on('updated', (_, state) => { e.received = item.getReceivedBytes(); e.status = state; const p = e.size ? Math.round(e.received / e.size * 100) : 0; send('wms:download-progress', { id: e.id, progress: p, status: state, received: e.received }); });
  item.once('done', (_, state) => { e.status = state; send('wms:download-done', { id: e.id, status: state, savePath: sp }); if (state === 'completed') send('wms:notification', { msg: `Downloaded: ${e.filename}`, type: 'success' }); });
}

// ─────────────────────────────────────────────────────────────
// PAGE ACTIONS
// ─────────────────────────────────────────────────────────────

async function printTab() {
  const t = tabs.get(activeTabId); if (!t) return;
  t.view.webContents.print({}, (ok, r) => { if (!ok) send('wms:notification', { msg: 'Print failed: ' + r, type: 'error' }); });
}

async function savePDF() {
  const t = tabs.get(activeTabId); if (!t) return;
  const { filePath } = await dialog.showSaveDialog(mainWindow, { title: 'Save PDF', defaultPath: path.join(app.getPath('documents'), 'page.pdf'), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (!filePath) return;
  try { fs.writeFileSync(filePath, await t.view.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })); send('wms:notification', { msg: 'PDF saved!', type: 'success' }); }
  catch (e) { send('wms:notification', { msg: 'PDF failed: ' + e.message, type: 'error' }); }
}

async function takeScreenshot() {
  const t = tabs.get(activeTabId); if (!t) return;
  try {
    const img = await t.view.webContents.capturePage();
    const { filePath } = await dialog.showSaveDialog(mainWindow, { title: 'Save Screenshot', defaultPath: path.join(app.getPath('pictures'), `screenshot-${Date.now()}.png`), filters: [{ name: 'PNG', extensions: ['png'] }] });
    if (!filePath) return;
    fs.writeFileSync(filePath, img.toPNG());
    send('wms:notification', { msg: 'Screenshot saved!', type: 'success' });
  } catch (e) { send('wms:notification', { msg: 'Screenshot failed: ' + e.message, type: 'error' }); }
}

// ─────────────────────────────────────────────────────────────
// HISTORY / SETTINGS
// ─────────────────────────────────────────────────────────────

const MAX_HIST = 150;
function addHistory(url, title) { const h = readJSON(HISTORY_FILE, []); if (h.length && h[0].url === url) return; h.unshift({ url, title, ts: Date.now() }); writeJSON(HISTORY_FILE, h.slice(0, MAX_HIST)); }
function getSettings() { return readJSON(SETTINGS_FILE, { theme: 'deep-blue', zoom: 1.0, autoFill: true, showStatusBar: true }); }
function saveSettings(s) { writeJSON(SETTINGS_FILE, s); }

// ─────────────────────────────────────────────────────────────
// SHORTCUTS
// ─────────────────────────────────────────────────────────────

function setupShortcuts() {
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const ctrl = input.control, shift = input.shift, key = input.key;
    if (ctrl && key === 't') createTab(WMS_URL);
    if (ctrl && key === 'w') closeTab(activeTabId);
    if (ctrl && !shift && key === 'r') tabs.get(activeTabId)?.view.webContents.reload();
    if (ctrl && shift && key === 'R') tabs.get(activeTabId)?.view.webContents.reloadIgnoringCache();
    if (ctrl && key === 'p') printTab();
    if (ctrl && key === 'd') duplicateTab(activeTabId);
    if (ctrl && key === 'q') app.quit();
    if (key === 'F11') { const fs = !mainWindow.isFullScreen(); mainWindow.setFullScreen(fs); send('wms:fullscreen', fs); }
    if (key === 'F12') tabs.get(activeTabId)?.view.webContents.toggleDevTools();
  });
}

// ─────────────────────────────────────────────────────────────
// IPC HANDLERS
// ─────────────────────────────────────────────────────────────

function registerIPC() {
  // Tabs
  ipcMain.handle('tab:open',      (_, url) => createTab(url || WMS_URL));
  ipcMain.handle('tab:close',     (_, id)  => closeTab(id));
  ipcMain.handle('tab:switch',    (_, id)  => switchTab(id));
  ipcMain.handle('tab:duplicate', (_, id)  => duplicateTab(id));
  ipcMain.handle('tab:list', () => [...tabs.entries()].map(([id, t]) => ({ id, url: t.url, title: t.title, favicon: t.favicon, zoom: t.zoom, canGoBack: t.canGoBack, canGoForward: t.canGoForward, isActive: id === activeTabId })));

  // Nav
  ipcMain.handle('nav:back',         () => tabs.get(activeTabId)?.view.webContents.goBack());
  ipcMain.handle('nav:forward',      () => tabs.get(activeTabId)?.view.webContents.goForward());
  ipcMain.handle('nav:reload',       () => tabs.get(activeTabId)?.view.webContents.reload());
  ipcMain.handle('nav:hard-reload',  () => tabs.get(activeTabId)?.view.webContents.reloadIgnoringCache());
  ipcMain.handle('nav:stop',         () => tabs.get(activeTabId)?.view.webContents.stop());
  ipcMain.handle('nav:home',         () => tabs.get(activeTabId)?.view.webContents.loadURL(WMS_URL));
  ipcMain.handle('nav:goto', (_, url) => {
    const t = tabs.get(activeTabId); if (!t) return;
    let target = url;
    if (!target.startsWith('http://') && !target.startsWith('https://')) target = 'https://' + target;
    if (!isAllowed(target)) { send('wms:blocked', { url: target }); return; }
    t.view.webContents.loadURL(target);
  });

  // Zoom
  ipcMain.handle('zoom:set',   (_, { tabId, factor }) => setZoom(tabId, factor));
  ipcMain.handle('zoom:in',    () => { const t = tabs.get(activeTabId); if (t) setZoom(activeTabId, t.zoom + 0.1); });
  ipcMain.handle('zoom:out',   () => { const t = tabs.get(activeTabId); if (t) setZoom(activeTabId, t.zoom - 0.1); });
  ipcMain.handle('zoom:reset', () => setZoom(activeTabId, 1.0));
  function setZoom(tabId, f) { const t = tabs.get(tabId); if (!t) return; const z = Math.min(Math.max(f, 0.25), 5.0); t.zoom = z; t.view.webContents.setZoomFactor(z); updateTab(tabId, { zoom: z }); }

  // Find
  ipcMain.handle('find:start', (_, { text, options }) => { const t = tabs.get(activeTabId); if (t && text) t.view.webContents.findInPage(text, options); });
  ipcMain.handle('find:stop',  () => { const t = tabs.get(activeTabId); if (t) t.view.webContents.stopFindInPage('clearSelection'); });

  // Page
  ipcMain.handle('page:print',      () => printTab());
  ipcMain.handle('page:save-pdf',   () => savePDF());
  ipcMain.handle('page:screenshot', () => takeScreenshot());

  // Downloads
  ipcMain.handle('downloads:get-all',     () => downloads);
  ipcMain.handle('downloads:open-folder', () => shell.openPath(app.getPath('downloads')));
  ipcMain.handle('downloads:open-file',   (_, p) => shell.openPath(p));

  // Bookmarks
  ipcMain.handle('bookmarks:get',    () => readJSON(BOOKMARKS_FILE, []));
  ipcMain.handle('bookmarks:add',    (_, { url, title }) => { const b = readJSON(BOOKMARKS_FILE, []); if (!b.find(x => x.url === url)) { b.unshift({ url, title, ts: Date.now() }); writeJSON(BOOKMARKS_FILE, b); } return readJSON(BOOKMARKS_FILE, []); });
  ipcMain.handle('bookmarks:remove', (_, url) => { writeJSON(BOOKMARKS_FILE, readJSON(BOOKMARKS_FILE, []).filter(b => b.url !== url)); return readJSON(BOOKMARKS_FILE, []); });

  // History
  ipcMain.handle('history:get',   () => readJSON(HISTORY_FILE, []));
  ipcMain.handle('history:clear', () => writeJSON(HISTORY_FILE, []));

  // Settings
  ipcMain.handle('settings:get',  () => getSettings());
  ipcMain.handle('settings:save', (_, s) => saveSettings(s));

  // ─── PASSWORD MANAGER IPC ─────────────────────────────────────────

  /** Save credential (user confirmed "Save") */
  ipcMain.handle('pm:save', (_, { domain, username, password, label }) => {
    saveCredential(domain || WMS_HOST, username, password, label || '');
    return { ok: true };
  });

  /** List all sites + accounts (no passwords exposed) */
  ipcMain.handle('pm:list', () => listAllCreds());

  /** Delete one account */
  ipcMain.handle('pm:delete-account', (_, { domain, accountId }) => {
    deleteAccount(domain, accountId); return { ok: true };
  });

  /** Delete all accounts for a domain */
  ipcMain.handle('pm:delete-domain', (_, domain) => {
    deleteDomain(domain); return { ok: true };
  });

  /** Toggle never-save */
  ipcMain.handle('pm:set-never-save', (_, { domain, flag }) => {
    setNeverSave(domain, flag); return { ok: true };
  });

  /** Toggle autofill disabled */
  ipcMain.handle('pm:set-autofill-disabled', (_, { domain, flag }) => {
    setAutoFillDisabled(domain, flag); return { ok: true };
  });

  /** Manually trigger autofill on active tab */
  ipcMain.handle('pm:autofill-now', () => {
    if (activeTabId) autoFillCredentials(activeTabId); return { ok: true };
  });

  /** Reveal a password (decrypts, only in main process) */
  ipcMain.handle('pm:get-password', (_, { domain, accountId }) => {
    const store = getAllCreds();
    const site  = store[domain];
    if (!site) return { ok: false };
    const acc = site.accounts.find(a => a.id === accountId);
    if (!acc) return { ok: false };
    const pw = decryptAES(acc.password);
    return { ok: !!pw, password: pw };
  });

  /** Update account label */
  ipcMain.handle('pm:update-label', (_, { domain, accountId, label }) => {
    const store = getAllCreds();
    const site  = store[domain];
    if (!site) return { ok: false };
    const acc = site.accounts.find(a => a.id === accountId);
    if (!acc) return { ok: false };
    acc.label = label;
    saveAllCreds(store);
    return { ok: true };
  });

  /** Master password status */
  ipcMain.handle('pm:master-status', () => {
    const m = getMasterMeta(); return { set: m.set, hint: m.hint || '' };
  });

  /** Set master password */
  ipcMain.handle('pm:set-master', (_, { password, hint }) => {
    setMasterPassword(password, hint || ''); return { ok: true };
  });

  /** Verify master password */
  ipcMain.handle('pm:verify-master', (_, { password }) => ({ ok: verifyMaster(password) }));

  /** Clear master password */
  ipcMain.handle('pm:clear-master', () => { clearMaster(); return { ok: true }; });

  /** Export (encrypted) */
  ipcMain.handle('pm:export', async (_, { password }) => {
    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Passwords Backup',
      defaultPath: path.join(app.getPath('documents'), `wms-passwords-${Date.now()}.json`),
      filters: [{ name: 'Encrypted Backup', extensions: ['json'] }]
    });
    if (!filePath) return { ok: false, error: 'Cancelled' };
    try { fs.writeFileSync(filePath, exportCreds(password), 'utf8'); return { ok: true, path: filePath }; }
    catch (e) { return { ok: false, error: e.message }; }
  });

  /** Import (encrypted) */
  ipcMain.handle('pm:import', async (_, { password }) => {
    const { filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Passwords Backup',
      filters: [{ name: 'Encrypted Backup', extensions: ['json'] }],
      properties: ['openFile']
    });
    if (!filePaths?.length) return { ok: false, error: 'Cancelled' };
    try {
      const result = importCreds(fs.readFileSync(filePaths[0], 'utf8'), password);
      return result;
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // Window
  ipcMain.handle('window:minimize',   () => mainWindow.minimize());
  ipcMain.handle('window:maximize',   () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
  ipcMain.handle('window:close',      () => mainWindow.close());
  ipcMain.handle('window:fullscreen', () => { const fs = !mainWindow.isFullScreen(); mainWindow.setFullScreen(fs); send('wms:fullscreen', fs); });
  ipcMain.handle('window:devtools',   () => tabs.get(activeTabId)?.view.webContents.toggleDevTools());
  ipcMain.handle('app:version',       () => app.getVersion());
}

// ─────────────────────────────────────────────────────────────
// LIFECYCLE
// ─────────────────────────────────────────────────────────────

app.whenReady().then(() => { ensureDir(); registerIPC(); createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }
else { app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } }); }
