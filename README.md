# SnipClip

A local desktop clipboard vault and screenshot snipper — copy history, annotate captures, stay in the tray.

<p align="center">
  <img src="app-icon.png" alt="SnipClip app icon" width="128" />
</p>

<p align="center">
  <img src="docs/vault.png" alt="SnipClip clipboard vault — Images filter" width="720" />
</p>

<p align="center">
  <img src="docs/snip.png" alt="Region snip selection overlay" width="480" />
  &nbsp;
  <img src="docs/settings.png" alt="SnipClip settings — startup and hotkeys" width="480" />
</p>

> **Try it:** [Download the latest release](https://github.com/Ander507/SnipClip/releases/latest), or use an install one-liner below.

## Install

### Windows (PowerShell)

**Installer (NSIS):**

```powershell
$r = irm https://api.github.com/repos/Ander507/SnipClip/releases/latest
$a = $r.assets | ? name -like '*x64-setup.exe' | select -First 1
iwr $a.browser_download_url -OutFile $a.name
Start-Process ".\$($a.name)"
```

**Portable (no install):**

```powershell
$r = irm https://api.github.com/repos/Ander507/SnipClip/releases/latest
$a = $r.assets | ? name -like '*x64_portable.zip' | select -First 1
iwr $a.browser_download_url -OutFile $a.name
Expand-Archive $a.name -DestinationPath .\SnipClip -Force
Start-Process .\SnipClip\SnipClip.exe
```

Or grab the `.msi` / `.exe` / portable `.zip` from [Releases](https://github.com/Ander507/SnipClip/releases/latest).

### Linux

**AppImage (most distros):**

```bash
curl -sL https://api.github.com/repos/Ander507/SnipClip/releases/latest \
  | grep -oE 'https://[^"]+_amd64\.AppImage' | head -1 \
  | xargs -I{} curl -L {} -o SnipClip.AppImage
chmod +x SnipClip.AppImage
./SnipClip.AppImage
```

**Debian / Ubuntu (`.deb`):**

```bash
curl -sL https://api.github.com/repos/Ander507/SnipClip/releases/latest \
  | grep -oE 'https://[^"]+_amd64\.deb' | head -1 \
  | xargs -I{} curl -L {} -o snipclip.deb
sudo apt install ./snipclip.deb
```

With [GitHub CLI](https://cli.github.com/):

```bash
gh release download -R Ander507/SnipClip -p '*amd64.AppImage' --clobber
chmod +x SnipClip_*_amd64.AppImage && ./SnipClip_*_amd64.AppImage
```

### macOS

Prebuilt macOS packages aren’t published yet — build from source:

```bash
# Needs Node 20+, Rust (rustup), and Xcode CLT
git clone https://github.com/Ander507/SnipClip.git
cd SnipClip
npm install
npm run tauri build
# App: src-tauri/target/release/bundle/macos/SnipClip.app
open src-tauri/target/release/bundle/macos/SnipClip.app
```

For day-to-day hacking: `npm run tauri dev`.

### After install

SnipClip sits in the tray. Defaults:

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+V` | Toggle clipboard vault |
| `Ctrl+Shift+S` | Start region snip |

Both are editable in Settings.

## Quick start (from source)

```bash
npm install
npm run tauri dev
```

That’s it for day-to-day use. First launch may compile the Rust side — give it a minute.

## Features

- **Clipboard vault** — watches the system clipboard for text, links, and images; stores history in SQLite (pinned items stay safe)
- **Search & filters** — All / Text / Images / Links / Pinned, instant search, ↑↓ / `j` `k` keyboard nav
- **Region snip** — translucent overlay → crop → annotate (pen, arrow, rect, highlight, blur, callouts, color picker)
- **Pause & ignore list** — stop capture temporarily, or skip noisy apps (e.g. dictation)
- **Themes** — dark/light, accent presets, full custom color editor
- **OCR** — copy text from a snip (Windows)
- **Auto-updater** — check for signed updates from Settings (packaged installs)
- **Re-edit from vault** — open a past screenshot and annotate again
- **Zoom & pan** — wheel zoom centered on cursor; middle-click or Shift-drag to pan
- **Auto-clear** — optional wipe of unpinned history on reboot / daily / weekly
- **Tray app** — close hides to tray; global hotkeys work while you’re in other apps
- **Launch at startup** — optional login autostart; boots minimized to tray until you hit a hotkey

## Run locally

**Needs**

- [Node.js](https://nodejs.org/) 20+ (npm)
- [Rust](https://rustup.rs/) (stable) + [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS
- **Windows** is the primary target (OCR + richest clipboard owner detection). Linux and macOS builds work for the core vault/snip flow.

```bash
# Install deps
npm install

# Dev (Vite + Tauri)
npm run tauri dev

# Production packages
npm run tauri build
```

No `.env` required for the default local vault. Data lives under the app data directory (`snipclip.db`).

### Vault keyboard shortcuts

| Key | Action |
|-----|--------|
| `↑` / `↓` or `j` / `k` | Navigate |
| `Enter` | Copy selected |
| `p` | Toggle pin |
| `Delete` / `Backspace` | Remove item |
| `/` | Focus search |
| `Esc` | Clear search / leave snip |

## How it works

SnipClip is a **Tauri 2** shell: React + Tailwind UI, Rust for clipboard monitoring (`arboard`), screen capture (`xcap`), SQLite (`rusqlite`), and global hotkeys.

The snipper is a **second, preloaded transparent window** kept warm at startup. On hotkey it shows instantly over the desktop; after you drag a region it hides, captures that rect, then hands the crop to the annotation editor in the main window. That avoids baking the overlay UI into the screenshot.

Annotations (including blur) run on an **HTML canvas in image-pixel space**, so zoom/pan don’t weaken redaction. The vault list is virtualized so long histories stay light — image rows keep thumbnails; full blobs load only for preview / re-edit.

## Credits

Built with [Tauri](https://tauri.app/), [React](https://react.dev/), [Tailwind CSS](https://tailwindcss.com/), [rusqlite](https://github.com/rusqlite/rusqlite), [arboard](https://github.com/1Password/arboard), [xcap](https://github.com/nashaofu/xcap), and [Lucide](https://lucide.dev/).
