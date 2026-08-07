# SnipClip

Lightning-fast local clipboard manager + screenshot snipping tool. Built with Tauri 2, React, and Tailwind CSS.

## Features

- **Clipboard Vault** — background monitoring for text, links, and images with SQLite history
- **Search & filter** — All / Text / Images / Links / Pinned, instant search, keyboard navigation
- **Snip** — region capture with annotation tools (pen, arrow, rect, highlight, blur, numbered callouts)
- **Settings** — customize global hotkeys (stored locally, re-registered live)
- **System tray** — runs in background; close hides to tray
- **Global shortcuts** (defaults, editable in Settings)
  - `Ctrl+Shift+V` — toggle clipboard vault
  - `Ctrl+Shift+S` — start snip capture

## Develop

```bash
npm install
npm run tauri dev
```

## Build

```bash
npm run tauri build
```

## Keyboard (in vault)

| Key | Action |
|-----|--------|
| `↑` / `↓` or `j` / `k` | Navigate |
| `Enter` | Copy selected |
| `p` | Toggle pin |
| `Delete` | Remove item |
| `/` | Focus search |
| `Esc` | Clear search / cancel snip |
