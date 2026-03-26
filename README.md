# Smart Store WMS Desktop App v3.0

A production-grade, secure kiosk-style Windows desktop application for the Smart Store Warehouse Management System.

---

## Quick Start

```bash
# Install dependencies
npm install

# Run in development
npm start

# Build Windows installer
npm run build
```

The built installer will appear at: `dist/Smart Store WMS Setup.exe`

---

## Project Structure

```
smart-store-wms/
├── src/
│   ├── main.js       — Electron main process (security, tabs, IPC, downloads, passwords)
│   ├── preload.js    — Secure contextBridge API exposed as window.WMS
│   ├── index.html    — Full Chrome UI (tabs, nav, panels, settings)
│   └── assets/
│       └── icon.ico  — Application icon
├── package.json      — Dependencies + electron-builder config
└── README.md
```

---

## Features

### Security
- **Whitelist-only navigation** — Only `arman.ahrtechdiv.com` + approved CDNs
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- All external navigation silently blocked with visual indicator
- Popup/new window attempts redirected to tabs

### Tabs
- Up to 10 tabs with independent sessions (BrowserView per tab)
- Ctrl+T new tab, Ctrl+W close, Ctrl+1-9 switch, Ctrl+D duplicate
- Per-tab favicon, title, loading indicator, zoom level

### Password Manager
- AES-256-CBC encrypted credential storage
- Auto-detect login forms on page load
- MutationObserver for React/Vue dynamic login pages
- "Save password?" prompt on form submit
- Credentials stored in `userData/smart-store/credentials.json`
- Passwords never exposed to renderer as plaintext

### Downloads
- Floating progress card during active downloads
- Downloads panel shows full history
- Saves to system Downloads folder

### Panels
- **Downloads** — history + open folder
- **Bookmarks** — add/remove, click to navigate, persisted to JSON
- **History** — last 150 pages with timestamps, click to revisit
- **Settings** — 8 themes, zoom presets, toggles, credential manager

### Themes
Deep Blue · Midnight · Emerald · Purple · Crimson · Ocean · Light · Amber

### Keyboard Shortcuts
| Key | Action |
|-----|--------|
| Ctrl+T | New tab |
| Ctrl+W | Close tab |
| Ctrl+R | Reload |
| Ctrl+Shift+R | Hard reload |
| Ctrl+P | Print |
| Ctrl+F | Find in page |
| Ctrl+D | Duplicate tab |
| Ctrl+Q | Quit |
| Ctrl+= / Ctrl+- | Zoom in/out |
| Ctrl+0 | Reset zoom |
| F11 | Fullscreen |
| F12 | DevTools |

---

## CDN Whitelist
Edit `CDN_WHITELIST` array in `src/main.js` to add/remove allowed domains.

---

## Data Storage
All data stored in OS user data directory:
- **Credentials:** `%APPDATA%/smart-store-wms/smart-store/credentials.json` (AES-256 encrypted)
- **Bookmarks:** `…/smart-store/bookmarks.json`
- **History:** `…/smart-store/history.json`
- **Settings:** `…/smart-store/settings.json`
