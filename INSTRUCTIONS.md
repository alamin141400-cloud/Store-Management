# Arman Store WMS — Windows Desktop App  v2.0
### Emaar Al Bader Warehouse Management System

---

## QUICK START  (run in development)

```
cd windows
npm install        ← downloads Electron (~110 MB, one-time)
npm start          ← launches the app immediately
```

---

## BUILD  →  Windows Installer (.exe)

```
npm run build:win
```

Output: `windows/dist/Arman Store WMS Setup 2.0.0.exe`

The installer:
- Lets user choose install folder
- Creates desktop + Start Menu shortcut
- Includes full uninstaller

---

## FEATURES IN THIS BUILD

### CDN / Programming Language Support
Every request from the website is filtered through a whitelist.
Your app domain is always allowed. Additionally ALL of these pass through:

| Category             | What's covered                                           |
|----------------------|----------------------------------------------------------|
| CSS Frameworks       | Bootstrap 3/4/5, Tailwind, Bulma, Foundation, Materialize|
| JS Libraries         | jQuery, React, Vue, Angular, Alpine.js, Svelte, HTMX    |
| Data / Charts        | Chart.js, D3, Plotly, Three.js, Leaflet                 |
| Fonts & Icons        | Google Fonts, Font Awesome (free+pro), Material Icons   |
| Editors              | Quill, CKEditor, TinyMCE, Monaco Editor, Ace            |
| Data tables          | DataTables, AG Grid, Tabulator                          |
| Language runtimes    | Python (Pyodide), PHP (php-wasm), Ruby (Opal),          |
|                      | SQL (sql.js), Lua (fengari) — all via cdn.jsdelivr.net  |
| CDN hosts            | cdnjs.cloudflare.com, unpkg.com, cdn.jsdelivr.net,      |
|                      | stackpath.bootstrapcdn.com, code.jquery.com, unpkg.com  |
| Analytics / Payment  | Google Analytics, Tag Manager, Stripe, Sentry           |

To add more hosts: open `src/main.js` → `CDN_WHITELIST` array.

---

### Download Manager
- All file downloads intercepted automatically
- Progress bar card slides up from bottom-right
- File-type icon auto-detected (PDF=📄 Excel=📊 Image=🖼 etc.)
- "Open Folder" button after completion
- System notification (Windows toast) on complete

### Print Options
| Action              | How to trigger                              |
|---------------------|---------------------------------------------|
| Print page          | Click 🖨 Print button · or · Ctrl+P        |
| Save as PDF         | Click 📄 Save PDF button · or · File menu  |
| Right-click → Print | Right-click anywhere on the page           |

### Find in Page
- Click 🔍 or press Ctrl+F
- Previous / Next buttons
- Esc or × to close

### Zoom
| Action        | Shortcut     |
|---------------|--------------|
| Zoom In       | Ctrl++       |
| Zoom Out      | Ctrl+-       |
| Reset to 100% | Ctrl+0       |
| Preset %      | Right-click → Zoom menu |

### Right-Click Context Menu
Back · Forward · Reload · Copy · Save Image · Download Link ·
Open Link in New Tab · 🖨 Print · 📄 Save as PDF · 📂 Downloads ·
🔍 Zoom submenu · 🔧 Inspect Element · 🖥 Toggle DevTools

### Keyboard Shortcuts
| Shortcut    | Action           |
|-------------|------------------|
| Ctrl+T      | New tab          |
| Ctrl+W      | Close active tab |
| Ctrl+R      | Reload           |
| Ctrl+P      | Print            |
| Ctrl+F      | Find in page     |
| Ctrl++/-/0  | Zoom in/out/reset|
| F11         | Full screen      |
| F12         | Developer Tools  |
| Alt+←/→     | Back / Forward   |

---

## FILE STRUCTURE

```
windows/
├── src/
│   ├── main.js        ← Electron main process (tab mgr, CDN filter,
│   │                     download mgr, print/PDF, context menu, IPC)
│   ├── preload.js     ← Secure IPC bridge (contextBridge)
│   └── index.html     ← Shell UI (tab bar, download tray, find bar,
│                          zoom control, action buttons)
├── assets/
│   └── icon.ico       ← App icon (replace with your own 256×256 .ico)
├── package.json       ← Dependencies + electron-builder config
└── INSTRUCTIONS.md    ← This file
```

---

## CHANGING THE ALLOWED DOMAIN

Open `src/main.js` → top of file:
```js
const APP_DOMAIN = 'arman.ahrtechdiv.com';   // ← change this
const HOME_URL   = 'https://arman.ahrtechdiv.com';  // ← and this
```

---

## ADDING YOUR APP ICON

1. Create a 256×256 `.ico` file
2. Place it at `windows/assets/icon.ico`
3. Run `npm run build:win`

Free converter: https://cloudconvert.com/png-to-ico

---

## TROUBLESHOOTING

| Problem | Fix |
|---|---|
| `npm install` fails | Use Node 18 LTS: https://nodejs.org |
| Blank white window | Check `src/main.js` `HOME_URL` is reachable |
| CDN assets not loading | Add the CDN hostname to `CDN_WHITELIST` in `main.js` |
| Build fails | Run as Administrator; check antivirus isn't blocking |
| Icon not showing | Ensure `assets/icon.ico` exists; must be `.ico` format |
| Print opens blank | The page must finish loading before printing |

