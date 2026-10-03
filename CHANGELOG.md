# Changelog

All notable changes to SnipClip are documented here.

## [1.7.0] — 2026-10-03

### Paste engine

- **Direct auto-paste:** **Off by default** (Settings → Clipboard extras). When enabled, Enter in the floating clipboard popup (or compact dock) hides SnipClip, restores the previous app, and synthesizes Ctrl+V. **Shift+Enter** types Unicode keystrokes for fields that block paste. **Ctrl+Enter** copies without pasting.
- Tracks the last non-SnipClip foreground window so paste works from the vault too.
- **Transform on paste:** 21 transforms (format/minify JSON, base64, URL encode/decode, case conversions, slug, dedupe/sort lines, strip HTML, unindent) applied on the way out. `Tab` cycles, the bar leads with content-aware hits, and the result previews before you commit.
- **Multi-clip paste:** `Ctrl+Space` picks several clips. Enter merges them into one paste; **Shift+Enter** walks form fields, tapping `Tab` between each.
- **Alt+1…9** fires the Nth clip straight into the app you came from.
- **Frecency ranking:** clips you actually paste climb search results (`use_count` + `last_used_at`, bounded so one clip can't pin itself to the top forever).

### Clipboard popup (Alt+C) — emoji, GIFs, kaomoji, symbols

- **Win+V-style tabs:** Clipboard, Emoji, GIFs, Kaomoji and Symbols, each with search, category shortcuts and a "Recently used" row. `Ctrl+Tab` switches tabs; arrow keys move through the grids.
- **Emoji:** full catalogue (emojibase, up to Emoji 15 so nothing renders as a box on Windows) with keyword search ("lol" finds 😂) and a remembered skin tone.
- **GIFs via KLIPY:** trending, search, quick-search chips and infinite scroll. Enter pastes the GIF as a real `.gif` file (Discord, Slack and Teams upload it), Shift+Enter copies the link, Ctrl+Enter copies only. Needs a free KLIPY key in Settings → Clipboard popup, or one baked in at build time via the `KLIPY_API_KEY` environment variable. "Powered by KLIPY" is shown in the tab.
- **Inserting:** with Direct paste on, Enter pastes emoji / kaomoji / symbols into the previous app and leaves them on your clipboard; Shift+Enter types them out without touching the clipboard; Ctrl+Enter only copies.
- **Draggable:** drag the popup by its header; the spot is remembered per position setting. Double-click the header to snap back.
- **No more duplicate rows** when pasting or copying an older clip — SnipClip ignores its own clipboard writes.
- Category rows scroll sideways with the mouse wheel and no longer show a thick scrollbar.

### Platforms

- **Linux builds paused:** releases are Windows-only for now. The release workflow no longer builds AppImage / `.deb`, and the README says so. Cross-platform code paths stay in the source for later.

### Cleanup

- Removed four unused Rust functions (old hotkey bootstrap, `is_recording`, a region-capture wrapper, an unused password check); the Wayland-only PNG helper is now only compiled where it's used. `cargo build` is warning-free for SnipClip's own code.

### Theme

- **Saved theme loads at launch:** the vault no longer sits on default dark/cyan until Settings is opened. The last theme paints instantly from a local cache, startup settings reads retry until the backend is ready, and the window background matches the theme (no grey flash).
- **Every window follows the theme:** the clipboard popup, snipper, recorder bar, screenshot popup and video editor update live on save (`settings-changed`), and the popup, recorder bar and screenshot popup drop their hard-coded dark colors.
- **Vault unlock** reloads the real theme instead of keeping the locked placeholder's defaults.
- **Accent and Dark/Light work with Custom theme on:** accent swatches update the custom accent; switching mode rebases custom surfaces onto the new mode and keeps the accent.
- **Unsaved previews don't stick:** leaving Settings without saving restores the saved theme, Back asks before discarding changes, and toggling a library tab saves only the tab change.

### Customization

- **Theme gallery:** SnipClip Dark/Light, OLED Black, Nord, Dracula, Catppuccin Mocha, Rosé Pine, Windows Light and Solarized Light, with live mini previews.
- **Any accent color:** nine presets plus a custom color picker; text on the accent picks black or white automatically for contrast.
- **System theme:** follows Windows light/dark live, including the window background.
- **Mica / Acrylic window material** (Windows 11; Acrylic on Windows 10 1809+) behind translucent panels. Falls back to solid on older builds.
- **Layout & text:** UI and code fonts (presets or any installed font), density (compact / comfortable / spacious), corner roundness, border strength, sidebar left/right, icon-only sidebar, and a thumbnail grid for the Images / Screenshots tabs.
- **Clipboard popup options:** open bottom-right, bottom-center, centered or next to the mouse (on the monitor under the cursor), plus width, number of clips and image previews on/off.
- **Per-tab icons and colors** for the library sidebar.

### Vault UI

- **Day groups and relative times:** Pinned / Today / Yesterday / weekday headers, and "5m ago"-style timestamps.
- **Richer rows:** multi-line text previews, the app a clip came from, character counts, image dimensions and sharp thumbnails (new `item_thumbnail` backend command; the stored 64 px preview was being stretched).
- **Flatter cards:** accent bar for the selected row instead of a full fill, and code blocks without the nested header box.
- **Keyboard-friendly:** row actions stay visible on the selected row; single click selects, double-click or **Space** previews images and opens recordings.
- **Settings:** section rail with live highlighting, toggle switches, an "Unsaved changes" indicator, **Ctrl+S** to save, and confirmations for Defaults (vault password is kept).
- **Toasts:** success / error icons, and **Undo** after deleting a clip (the delete waits 5 seconds).
- **Clear history** moved from the sidebar to Settings → Storage with a click-again confirmation; the popup's "Clear all" also asks twice.

### Fixes

- OCR "Copy text" button never appeared on image rows.
- Uneven gaps between vault rows (double-counted spacing and a measurement reset on every refresh).
- Popup image cards were blurry.
- Hotkeys showed Mac symbols (⌃⇧V) on Windows — now `Ctrl+Shift+V`.
- "Reset colors to preset" no longer wipes glass, translucency and the wallpaper.
- Edited screenshots keep their stored size up to date.

## [1.6.1] — 2026-09-14

### Cleanup

- Tidied hotkey registration (optional clipboard-popup binding, clearer conflict toasts) and a small hotkey label helper.

## [1.6.0] — 2026-09-14

### Clipboard popup

- **Win+V-style floating history:** `Ctrl+Shift+D` and `Alt+C` open a bottom-right panel over any app — search, pin, clear all, click to paste.
- Title-bar compact dock stays a slim vault layout; the hotkey now opens the floating popup instead.

### Fixes

- **Snip after record:** a late `closeSnipper` no longer parks a brand-new snip overlay.
- **Hotkeys:** a bad/taken dock shortcut no longer wipes snip and clipboard bindings.

## [1.5.5] — 2026-09-13

### Vault

- **Compact dock:** slim Win+V-style vault from the title bar or **`Ctrl+Shift+D`** — pins first, last ten clips, always-on-top.
- **Opt-in math:** off by default; raw equation stays on the clipboard, vault shows a copyable `= result` badge.
- **Max history:** 50–1000 in Settings; shrinking the cap prunes unpinned items right away (pins stay).
- **UI scale:** 90–125% for denser or roomier chrome.
- **Search:** pinned clips float to the top of FTS / palette results.

### Capture

- **Blackout redact** on snips (`R`) beside blur (`B`) — solid cover for secrets before you share.
- **Second recording no longer opens mid-session:** recorder bar remounts clean after Stop so you get Start / `00:00` again.

### Docs / trust

- README points reviewers at `/releases/latest`, MSI/portable first when SmartScreen nags, and an honest AI tooling note.

## [1.5.4] — 2026-09-06

### Capture

- **Snip during/after record no longer sticks on REC:** clear frozen overlay state after handing off to the recorder bar, remount on each snip-ready, and allow Esc while the REC preview is up.

## [1.5.3] — 2026-09-06

### Vault + library

- **Vault password crash fix:** correct AES-GCM nonce size, safer encrypt path, and salt in the `.enc` header so lock/unlock no longer panics.
- **Sidebar tabs apply correctly:** Settings order drives the library; hotkeys no longer re-register on every tab save.
- **Clear history:** refreshes category counts and shows a floating toast (including when pinned items are kept).

### Auto-translate

- **Opt-in MyMemory translate** (off by default) with target language in Settings.
- **Translated items** show the translation plus a way to copy original or translation.
- **Themed dropdowns** via portal so Settings menus are not clipped by scroll containers.

## [1.5.2] — 2026-09-05

### Installer

- **NSIS preinstall/uninstall:** force-close running `snipclip.exe` before overwrite so tray-locked updates no longer fail with “Error opening file for writing”.

## [1.5.1] — 2026-09-05

### Recording

- **Hide ffmpeg console** on Windows during record/edit so the encoder window no longer flashes and can't be closed by accident.
- **Clearer encoder errors:** broken-pipe / os error 109 maps to a short “use Stop in SnipClip” message instead of the raw OS string.

## [1.5.0] — 2026-09-05

### Vault + library polish

- **Native Windows OCR:** `extract_text_from_image` command runs Windows Media OCR on any image path via `BitmapDecoder` + `OcrEngine` (no `win_ocr` crate, no bundled models).
- **Math auto-solve:** Copy arithmetic and `meval` evaluates it, inserts a `math` item, and swaps the clipboard to the answer.
- **Videos tab:** New library tab for `video`/`gif` items; backend `sidebar_tabs` setting + `normalize_sidebar_tabs` for order/visibility.
- **Customizable sidebar:** Reorder or hide library tabs in Settings → Appearance.
- **Per-category counts:** `category_counts` command powers count badges next to each sidebar tab.
- **Keyboard shortcuts:** `1`-`7` switch library tabs inside the vault.
- **Password-protected vault:** AES-256-GCM file-level encryption with Argon2id key derivation; lock/unlock commands; password prompt on launch when `snipclip.db.enc` exists.
- **Vault backup:** `export_vault` / `import_vault` commands; restore applies on next launch.
- **Hotkey conflict toast:** `hotkey-conflict` event surfaces a toast when a shortcut is taken by another app.
- **Code detection:** `detectLanguage` no longer mis-labels compiler output as SQL.

## [1.4.0] — 2026-09-04

### Capture studio

- **CF_HDROP clipboard:** Save & Copy / vault copy of recordings puts a real Windows file-list on the clipboard so Discord, Slack, and Explorer paste the `.mp4`/`.gif`, not a path string.
- **In-app video editor:** Trim, crop, mute, MP4↔GIF after recording (`process_video_clip`); stream-copy for simple cuts.
- **Multi-monitor overlays:** One snip/record overlay per display via `available_monitors()` + virtual-desktop origin normalization.
- **Shift+snip OCR:** Hold Shift while releasing a snip to run Windows Media OCR and copy text (toast with line count).
- **FTS5 search:** `items_fts` powers `Alt+C` palette queries.
- **README:** Technical architecture + Mermaid diagram for reviewers.

## [1.3.0] — 2026-09-02

### Speed

- **Clipboard:** Windows sequence-number polling — skip clipboard reads when nothing changed; single open for text + image instead of two separate reads.
- **Snips:** GDI region capture on Windows (same fast path as recording) with xcap fallback for edge cases.
- **OCR:** Prewarm models at startup; run recognition on a background thread so the UI stays responsive.

### Polish

- README overhaul: try-it guide, shortcut table, and technical deep-dive for reviewers.
- Friendlier empty vault state with shortcut hints.

## [1.2.1] — 2026-08-31

- Fix transparent logo and app icon borders (no square frame in title bar or Explorer).

## [1.2.0] — 2026-08-31

- Region screen recording (MP4/GIF) with optional Windows desktop audio.
- Command palette (`Alt+C`) for fast clipboard search.
- GDI capture for recording; FFmpeg prewarm; recording performance fixes.
- New logo and branding assets.

## [1.1.3] — 2026-08-29

- Open links from vault; inline snippet edits; database and README polish.

## [1.1.2] — 2026-08-22

- Theme packs; multi-monitor snips; capture and editor fixes.

## [1.1.0] — 2026-08-22

- Pause monitoring, app ignore list, auto-updater, OCR, custom themes.

## [1.0.0] — 2026-08-22

- First public release: clipboard vault, snips, annotations, autostart, signed updates.

[1.4.0]: https://github.com/Ander507/SnipClip/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/Ander507/SnipClip/compare/v1.2.1...v1.3.0
[1.2.1]: https://github.com/Ander507/SnipClip/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/Ander507/SnipClip/compare/v1.1.3...v1.2.0
[1.1.3]: https://github.com/Ander507/SnipClip/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/Ander507/SnipClip/compare/v1.1.1...v1.1.2
[1.1.0]: https://github.com/Ander507/SnipClip/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Ander507/SnipClip/releases/tag/v1.0.0
