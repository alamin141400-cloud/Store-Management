# Smart Store – Pro Kiosk Browser for Windows
### Version 2.0 | Electron.js | Built for arman.ahrtechdiv.com

---

## QUICK START

```bash
# 1. Install dependencies (one time only)
npm install

# 2. Run the app
npm start

# 3. Build Windows installer
npm run build:win
# → Output: dist/Smart Store Setup 2.0.0.exe
```

**Requirements:** Node.js 18+ (https://nodejs.org)

---

## FEATURES

### 🗂️ Tab System
| Feature | Details |
|---|---|
| Max tabs | 10 (adjustable in main.js: `MAX_TABS`) |
| Open new tab | Click **+** button or **Ctrl+T** |
| Close tab | Click **×** on tab or **Ctrl+W** |
| Switch tabs | Click tab, **Ctrl+Tab**, **Ctrl+1–9** |
| Pin tab | Right-click tab → Pin Tab (collapses to icon) |
| Restore session | Last open tabs reloaded on next launch |
| Tab context menu | Right-click any tab for pin/reload/close |

### 🔑 Password Manager
| Feature | Details |
|---|---|
| Save passwords | Open 🔑 panel → fill form → Save |
| Auto-fill | Press 🔑 Auto-fill button or right-click → Auto-fill |
| Login detection | App auto-prompts to save on login pages |
| Reveal password | Click 👁 eye icon in password list |
| Delete credential | Click 🗑 trash icon |
| Storage | Saved locally in `%APPDATA%/smart-store/smartstore-data.json` |

### ⭐ Bookmarks
- **Ctrl+D** — Toggle bookmark for current page
- Open ⭐ panel to view/open/delete bookmarks
- Up to 200 bookmarks stored

### 🕐 History
- Automatically tracks all visited pages
- View grouped by date in 🕐 panel
- **Clear All** button in panel footer
- Up to 500 entries stored

### ⬇️ Downloads
- Files automatically save to your Downloads folder
- Progress bar shown per file in ⬇️ panel
- Click ↗ to open completed file
- Desktop notification on completion

### 🔍 Find in Page
- **Ctrl+F** — Open find bar
- Type to search, **Enter** / ↑↓ to navigate matches
- Shows match count (e.g. "3 / 12")
- **Escape** to close

### 🌙 Dark Mode
- Click 🌙 to toggle — CSS filter inversion applied to all tabs
- Setting persists between sessions

### 🔎 Zoom
- **Ctrl++** / **Ctrl+–** / **Ctrl+0** — In/Out/Reset
- Mouse scroll + Ctrl on URL bar to zoom
- Zoom badge shows current level, click to reset

### 📷 Screenshot
- **Ctrl+Shift+S** — Capture full page screenshot
- Saves PNG to Downloads folder
- Desktop notification confirms save location

### 🖨️ Print
- **Ctrl+P** — Print current tab (system print dialog)

### ⛶ Fullscreen
- **F11** — Toggle fullscreen
- Button in nav bar highlights when active

### 🔒 Security
- All navigation outside `arman.ahrtechdiv.com` is blocked
- Blocked at two levels: `will-navigate` event + session-level request filter
- Right-click context menu is a custom internal menu (no browser default)
- No Node.js access in renderer (contextIsolation: true)
- External links open as new internal tabs (if on allowed domain), denied otherwise

---

## KEYBOARD SHORTCUTS

| Shortcut | Action |
|---|---|
| Ctrl+T | New tab |
| Ctrl+W | Close current tab |
| Ctrl+R / F5 | Reload |
| Ctrl+F | Find in page |
| Ctrl+D | Bookmark toggle |
| Ctrl+L | Focus URL bar |
| Ctrl+P | Print |
| Ctrl+Shift+S | Screenshot |
| Ctrl++ / Ctrl+– / Ctrl+0 | Zoom in / out / reset |
| Ctrl+Tab | Next tab |
| Ctrl+Shift+Tab | Previous tab |
| Ctrl+1 to Ctrl+9 | Jump to tab N |
| F11 | Toggle fullscreen |
| Escape | Close panels / find bar |

---

## PROJECT STRUCTURE

```
smart-store/
├── package.json          ← Dependencies + build config
├── src/
│   ├── main.js           ← Main process (all feature logic)
│   ├── preload.js        ← Secure IPC bridge (contextBridge)
│   └── index.html        ← Shell UI (tab bar + all panels)
└── assets/
    ├── icon.ico          ← Windows icon (add your own)
    └── icon.svg          ← SVG source
```

---

## BUILD WINDOWS INSTALLER

```bash
# Prerequisites: Windows 10/11, Node.js 18+, ~500MB free
npm install
npm run build:win

# Output:
#   dist/Smart Store Setup 2.0.0.exe   ← NSIS installer
#   dist/win-unpacked/                  ← Portable folder
```

The installer:
- Installs to `Program Files\Smart Store`
- Adds desktop shortcut
- Adds Start Menu entry
- Adds uninstaller

---

## DATA STORAGE

All data is stored locally on the machine:

| Data | Location |
|---|---|
| Passwords, bookmarks, history | `%APPDATA%\smart-store\smartstore-data.json` |
| Downloads | `%USERPROFILE%\Downloads\` |
| Screenshots | `%USERPROFILE%\Downloads\screenshot-*.png` |

To reset all data: delete `smartstore-data.json` in AppData.

---

## CONFIGURATION

**Change allowed domain** — `src/main.js` line ~20:
```js
const ALLOWED_DOMAIN = 'arman.ahrtechdiv.com';
const HOME_URL       = 'https://arman.ahrtechdiv.com';
```

**Change max tabs** — `src/main.js` line ~22:
```js
const MAX_TABS = 10;
```

**Change tab bar height** — must match in BOTH files:
- `src/main.js`: `const TAB_BAR_HEIGHT = 88;`
- `src/index.html`: `--tab-bar-h: 88px;` in `:root { }`

---

*Smart Store v2.0 — Built for Emaar Al Bader Warehouse Management System*
