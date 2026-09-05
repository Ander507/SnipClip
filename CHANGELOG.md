# Changelog

All notable changes to SnipClip are documented here.

## [Unreleased]

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
