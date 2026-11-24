# SnipClip progress

The work has five phases:

1. Audit and fix performance problems and bugs. **Done.**
2. Add Medal-style instant replay clipping. **Done; checked in the app.**
3. Run a second bug audit over everything, including the new clipping code. **Done (see below).**
4. UI/UX redesign with an in-app media viewer. **Done (see below).**
5. Polish pass from the ChatGPT review of the Figma file. It has three sub-phases. **5.1 is done; 5.2 is next.**

Nothing is committed since `e932ce1`.

## Phase 5: UX and visual polish (from the Figma review, 2026-11-24)

- Figma file: https://www.figma.com/design/zBC2IZ8WZ9etWB6LY0LMQ3. Page 0 is the review brief; pages 1–6 hold the 50 real-app captures.
- Capture harness: `node figma-harness/capture.mjs --png` rerenders all 50 screens into `figma-harness/out/`.
- Before/after baseline: `figma-harness/before/` holds the pre-polish PNGs (`*.static.png` and `*.live.png`). Compare new captures against these.
- Re-import to Figma: page merge script `scratchpad/merge_pages.py`. It is not in the repo; recreate it from these steps if needed.
  1. Group the out files per area.
  2. Strip the `data-fx-*` attributes from `<html>`.
  3. Wrap each screen in `.sc-wrap`, with `transform: translateZ(0)` on `.board`.
  4. Upload with html_to_figma, cssSelector `.sc-wrap`.

### 5.1 Correctness: done and checked in the running app
- **Sidebar counts:**
  - `db.rs category_counts` now keys counts by sidebar category id ("images", "videos", …) through the new `category_of_content_type`. It used raw content types, so Images, Screenshots, Clips and Links never showed a count.
  - New regression test `category_counts_match_list`: every tab's badge equals what that tab lists.
  - The harness mock was updated to match.
  - Checked in the app: Images 4, Clips 1, Links 4.
- **Duplicate React keys:** `lib/picker/symbols.ts` now de-duplicates each group. Punctuation listed ‚ „ ‹ › twice.
- **Remove vs delete file:**
  - Del or the trash button means "Remove from library". The file is kept, and the toast says so.
  - Shift+Del or the new "Delete file" button (FileX icon in the viewer) means "Delete file". It confirms first, then moves the mp4 or GIF to the Recycle Bin (`delete_item_file` command, `SHFileOperationW` with `FOF_ALLOWUNDO`) and drops the entry.
  - The viewer releases the `<video>` before the delete runs.
  - Ignored test `recycle_bin_move_removes_the_file` passed once on this PC.
- **Global hotkeys (`hotkeys.rs`):**
  - One validator (`validate_hotkey`) covers all keys. A key needs Ctrl, Alt or Win; Shift alone is allowed only with F1–F24.
  - A denylist blocks Ctrl+C/V/X/Z/Y/A/S, Alt+F4, Alt+Tab and Alt+Space.
  - All 6 actions are checked for uniqueness before registering, and errors name both conflicting actions.
  - Applying is transactional: if a registration fails, the previous keys are restored. Before, one failure unregistered every hotkey.
  - At startup, it registers what it can and reports the rest.
  - 12 new tests.
  - Checked in the app: Alt+Z saved a clip after the rebuild.
- **In-app keys:**
  - Enter, Space, Del and P are ignored when a button, select or link has focus, in both the main window and the viewer. The viewer used to copy when you pressed Enter on a toolbar button.
  - P, Space, Del and digits require no modifier, so Ctrl+P no longer pins.
  - Focus is restored when the viewer closes.
  - Grid ↑/↓ no longer swallows keys in selects and inputs.
  - Settings hotkey capture checks for conflicts inline and requires a modifier. Tab, Esc and blur cancel it. An NVIDIA hint sits under the replay hotkey.
  - The palette has Ctrl+P to pin from the search box.
- **Not changed (open decision):** Enter copies in the main window but pastes in the popup.
- **Tests:** `cargo test --lib` passes 25 tests, plus 1 ignored. `tsc` and `npm run build` pass.

### 5.2 UX (next)
- Responsive media grids that fill the window.
- Clipboard card hierarchy and density.
- A Settings sidebar with categories.
- Command palette keyboard navigation.
- Clear recording, replay and clipboard-capture status.
- Missing-file recovery and empty states.
- Also fix the content detection seen in the app: a Markdown checklist is labelled "SQL", and a long text containing a URL becomes a "link" with a text icon.

### 5.3 Visual polish (after 5.2)
- Theme-specific semantic tokens.
- Contrast, hit areas and focus rings.
- Spacing, type and borders across all windows.
- Trim timeline with thumbnails.
- Overlays readable on both light and dark desktops.
- Then regenerate all 50 captures, compare them with `figma-harness/before/`, and check several window sizes, display scaling, and light and dark themes.

## Phase 4: UI/UX redesign, 2026-11-24 (implemented, not committed)

The spec is `docs/UI_REDESIGN.md`. All three slices are built with the spec's defaults for §8. `tsc`, `npm run build` and `cargo test --lib` (12 tests) pass.

- **Checked in the running app (window capture):** the new shell, the Record and "Clip last 60s" buttons, and the hint chips. A replay saved with Alt+Z appears as "Replay · 0:34" with a poster frame and Edit/Folder buttons.
- **Not checked by hand yet:**
  - the Media Viewer itself (play, scrub, arrow keys, F fullscreen, image zoom)
  - the Clips grid tab and hover preview
  - the toast's content: a content-protected window captures black, so only its size and visibility were confirmed
- **Fixes from the independent review:**
  - A second replay press during a save is a quiet no-op (`replay::is_saving`).
  - F then Esc can no longer leave the window stuck fullscreen.
  - The hover preview works under StrictMode.
  - The poster queue runs newest-first.
- **Open (low):** in `replay_toast.rs`, a toast shown in the moment between the generation check and `hide()` can be hidden at once.
- **Line endings:** Slice B wrote CRLF; it was normalized back to LF.

Original slice plan:

- Slice A: Media Viewer (`src/components/media/*`), `EmptyState.tsx`, `App.tsx` wiring, `uiPrefs.ts` default; deletes `ImageViewerModal.tsx`.
- Slice B: gallery tiles, video posters, rows (`ClipboardGrid`, `ClipboardItemRow`, `ClipboardList`, `itemParts`, `lib/thumbnails.ts`).
- Slice C: shell (`TitleBar`, `Sidebar`, `SearchBar`, `index.css`).
- The slices own disjoint files and need no Rust or config changes.
- Four decisions wait for the user (spec §8): always-dark viewer, whether Delete also removes the mp4, Enter copy vs paste in the main window, renaming Videos to Clips with grid as default.

## Phase 1: audit fixes (done, not yet committed)

Verified by `tsc`, `npm run build` and `cargo build`. None of this has been tested in the running app yet.

### Backend (Rust)
- `db.rs` `insert_with_meta`: the duplicate check now runs inside SQLite (`EXISTS` with a length pre-check). It used to load the last 8 rows, often multi-MB base64 images, into Rust on every copy.
- `db.rs`: the FTS orphan cleanup (a full scan) now runs only when the history trim actually deleted rows. Before, it ran on every insert.
- `db.rs`: added an `idx_items_pinned_created` index for the list ordering. `ensure_fts_populated` now runs in a single transaction.
- `clipboard.rs`: if the clipboard is locked when read, the sequence number is un-acknowledged with `clipboard_seq::forget()`. Before, that copy was silently lost.
- `recording.rs`: ffmpeg stderr is drained continuously by `spawn_stderr_drain()`, which keeps an 8 KB tail. Before, the pipe could fill and stall long recordings.
- `commands.rs`: `start_region_recording` and `capture_screen_region` are now async with `spawn_blocking`. The 150 ms sleep and the ffmpeg spawn used to block the main/UI thread.
- `ocr.rs`: the model download now has connect/read timeouts and writes to `.part` before renaming. A truncated model used to be treated as valid forever.
- `vault.rs`: `.enc` and the decrypted DB are written atomically (tmp file, then rename).

### Frontend
- `App.tsx` and the `RecorderBar`, `VideoEditor`, `Snip` and `ScreenshotPopup` pages: `listen()` cleanup now handles unmount happening before the promise resolves. Under StrictMode, handlers used to leak and fire twice.
- `App.tsx` `refresh()`: a sequence guard stops a slow older `listItems` from overwriting newer results. The main listener effect no longer re-subscribes on every category or search change; it uses `refreshRef`.

### Known issues, still open
- `vault.rs`: the whole DB is read into memory to encrypt it.
- `replay.rs`: MPEG-TS timestamps wrap after about 26.5 hours of one uninterrupted ffmpeg run. A clip saved across the wrap is untested.
- `replay.rs`: the GDI fallback always captures the whole desktop and ignores the display setting.
- `db.rs` `list`: text items are returned with their full content, which can be large.

## Phase 2 and 3 work, 2026-11-14 (not committed)

Verified by `cargo build`, `cargo test --lib` (11 pass), `tsc` and `npm run build`. **Not yet tried in the running app.** The first launch of this build rebuilds the vault table once (about 1.4 s on a 280 MB vault).

### Instant replay
- Compiles now: `play_feedback` calls `MessageBeep` through a raw user32 import.
- Sound lagged the picture by the capture start-up delay, because ffmpeg shifts each input to start at 0. Fixed with `-copyts` (checked with a synthetic source).
- The GDI fallback put `-vf` before the audio input, so ffmpeg refused to start whenever audio was on. The filter is now an output option.
- GOP is one segment long and NVENC uses `-forced-idr 1`, so every 1 s segment starts on a real keyframe.
- The supervisor probes lazily and again after two quick crashes. A failed probe retries with backoff; before, it ended replay until restart.
- The exact capture command was run for 6 s on this PC: 1 s segments, each starting on a keyframe, and the concat gives 3.00 s video / 2.99 s audio.
- Frontend: `replay*` settings in `lib/types.ts`, `lib/settings.ts` and `isDirty`; an "Instant replay" section in SettingsView with a live status line; `replayStatus` / `saveReplayClip` in `api.ts`; `replay-saved` and `replay-error` toasts in `App.tsx`.
- **Checked in the app on 2026-11-24:** clips save. The user's hotkey is Alt+Z. 30 s clips at 2560×1440 have audio matching (30.0 / 29.99 s).
- **Save feedback (added 2026-11-24):** the user reported no indication on save, because `MessageBeep` was silent.
  - New `replay_toast.rs`: a `replay_toast` window (`?view=replay-toast`, `ReplayToastPage.tsx`) in the top-right of the primary monitor. It shows "Saving clip…", then "Clip saved · <file>" or the error, and hides after 2.6 s.
  - The window is shown with raw Win32 (`WS_EX_NOACTIVATE`, `SW_SHOWNOACTIVATE`, `HWND_TOPMOST`), so it never takes focus. It is click-through and content-protected, so it stays out of clips.
  - A two-note chime is generated in code and played through `PlaySoundW(SND_MEMORY)`. It plays even with system sounds muted.
  - New settings `replay_notify_popup` and `replay_notify_sound` (both default on) have toggles in Settings.
  - `cargo test --lib` passes (12 tests) and `tsc` passes. **The toast has not been seen in the app yet.** A toast over an exclusive-fullscreen game may not show; borderless will.

### Videos folder
- Recordings, edited clips and replays now go to `Videos\SnipClip`. They used to go to `Pictures\SnipClip
ecordings` because `recordings_dir()` was derived from the screenshots folder.
- Old files are not moved. They keep working: items store absolute paths and the asset scope covers both folders (`tauri.conf.json`).

### Vault speed
- `content` is now the last column of `items` (`db.rs` `move_content_last`, a one-time rebuild plus `VACUUM`). SQLite had to walk every image's overflow pages to reach the columns behind it. Measured on a copy of the real vault (500 items, 180 images): list query 60 ms to 2.5 ms, file 278 MB to 127 MB.
- `idx_items_pinned` is dropped; the composite index serves the list order without a sort.
- `PRAGMA synchronous = NORMAL`.
- The duplicate check compares `octet_length`, which does not read the value.
- `item_thumbnail` no longer loads the full image on a cache hit (`db.content_info`).

### Search (was broken since FTS5 was added)
- `search_clipboard` used `WHERE f MATCH`, an alias, which is an SQL error. Every normal query in the popup returned an error and showed no results. It is now `items_fts MATCH`.
- Terms are quoted, so `example.com` and `foo-bar` are no longer FTS5 syntax errors.
- An FTS failure falls back to the LIKE search.

### Recorder and editor
- `system_audio.rs`: silence is zero-filled by wall clock (un-paused time), so sound after a quiet stretch no longer runs ahead of the video.
- `recording.rs`: GIF frames are encoded as they are captured on a `gif-encode` thread. They used to be held as raw RGBA (up to about 1.6 GB).
- `video_edit.rs`: output names no longer collide, a failed export deletes its partial file, ffmpeg runs with `-nostdin`.

### Recorder bar (reported: pause and other buttons don't always work)
- The timer kept counting while paused, so Pause looked dead. It now freezes (checked in a browser harness: 00:02 stays 00:02 while paused, then continues).
- The bar was placed at "region bottom + 10 px" with no clamping. A region touching the bottom or right screen edge put the buttons partly or fully off screen. `recorder_bar.rs` `place_bar` now keeps it on the region's monitor: below, else above, else along the bottom edge (4 unit tests).
- The bar is excluded from screen capture (`set_content_protected`), so it can overlap the recorded region. **Not yet confirmed in a real recording.**
- The bar window is sized by the monitor's scale factor (was a fixed 360 physical px, too narrow at 125%+), and is 380 wide.
- New Close button before recording starts, and on the error box. An error used to leave the bar stuck on screen.
- A failed `finalizeRecording` was never shown; the bar now reappears with the message.
- A second Pause click before the first one answers is ignored.

### Not audited yet
`paste.rs`, `scratch.rs`, `transform.rs`, `klipy.rs`, `themes.rs`, `snip.rs`, `SnipOverlay.tsx`, `CommandPalettePage.tsx` rendering, `SettingsView.tsx` (2,400 lines, one component).

## Phase 2: original notes (history)

### Current state
- `src-tauri/src/replay.rs` is written but **not wired in yet**. It is not in `lib.rs`'s `mod` list, so the app still builds. It has not been compiled yet.
- The module covers the supervisor thread, encoder and source probing, ffmpeg segmenting, a WASAPI audio pump with silence fill, the janitor, `save_clip()`, `status()`, `apply_settings()` and `play_feedback()` (a beep).

### Pipeline verified by hand on this PC (RTX 4080, ffmpeg 9 full)
```
ffmpeg -f lavfi -i "ddagrab=output_idx=0:framerate=60,settb=1/1000000,setpts=RTCTIME-<T0us>"
       -f f32le -ar 48000 -ac 2 -i pipe:0 -map 0:v -map 1:a
       -c:v h264_nvenc -preset p4 -rc vbr -b:v 16M ... -force_key_frames "expr:gte(t,n_forced*1)"
       -c:a aac -f segment -segment_time 1 s_%08d.ts
ffmpeg -i "concat:a.ts|b.ts|c.ts" -map 0 -c copy -movflags +faststart clip.mp4   # A/V durations match
```
- `scale_d3d11` and `scale_cuda` fail here. Downscaling therefore goes through the CPU: `hwdownload,format=bgra,scale,format=nv12`.
- AMF and QSV fail on this PC; the probe falls through to the next candidate.

### Update (second pause): steps 1–6 below are DONE in code, but NOT yet compiled
- The audio clock is now `SystemTime`.
- `replay_*` settings are in `db.rs`.
- `mod replay` is in `lib.rs`. It starts at boot when enabled, and `replay::stop()` runs on Exit.
- `update_settings` calls `replay::apply_settings`. A change to the replay toggle or hotkey re-registers hotkeys.
- `hotkeys.rs` has `try_register_replay`, and the hotkey handler calls `commands::save_replay_in_background`.
- The `replay_status` and `save_replay_clip` commands are added. Saving emits `replay-saving`, `replay-saved`, `replay-error` and `clipboard-item`, and plays a beep.
- **Next:** the last `cargo build` had exactly 1 error. `replay.rs` `play_feedback` cannot import `MessageBeep` from `Win32::UI::WindowsAndMessaging` in windows 0.62. Check the compiler's suggested name: it is likely in another module or needs a Cargo feature. Simplest fix: call `MessageBeep` through a raw `extern "system"` user32 import, the same way `clipboard.rs` imports `GetClipboardSequenceNumber`.
- Then do the TS settings (`lib/types.ts`, `lib/settings.ts`, `isDirty`), the SettingsView section, an `api.ts` wrapper, and step 8 (the real test).

### Remaining steps (original list)
1. **Fix first:** `audio_pump` computes `expected` from `Instant`. Switch it to `SystemTime` relative to `t0_wall`, the same clock as ffmpeg's `RTCTIME`. Otherwise audio drifts over long sessions.
2. Add to `AppSettings` in `db.rs` (struct, defaults, get_settings, save_settings) and in TS (`lib/types.ts`, `lib/settings.ts`, `isDirty` in SettingsView):
   - `replay_enabled`: false
   - `replay_seconds`: 30 (5–600)
   - `replay_hotkey`: "Alt+F10"
   - `replay_fps`: 60
   - `replay_quality`: low/medium/high (8/16/30 Mbps)
   - `replay_resolution`: native/1080p/720p
   - `replay_audio`: true
   - `replay_monitor`: 0
3. Add `mod replay;` to `lib.rs`. In setup, call `replay::apply_settings` on a background thread. Call `replay::stop()` on Exit.
4. Make `update_settings` call `replay::apply_settings` whenever any `replay_*` field changes.
5. Hotkey: optional registration, like `try_register_dock`, only when enabled. The handler spawns a thread that runs `save_clip()`, then `db.insert("video", path, …)`, emits `clipboard-item`, emits a `replay-saved` event and calls `play_feedback`. Do **not** use `show_screenshot_popup`, because it calls `set_focus` and would alt-tab out of games.
6. Add Tauri commands `replay_status` and `save_replay_clip`, then register them in `lib.rs`.
7. Add an "Instant replay" section to SettingsView: a toggle, length, hotkey, fps, quality, resolution, audio, monitor, and a status line (encoder / running / error).
8. Run `cargo test replay`, build, run the app, save a clip, then check its A/V sync and length.

### Original design notes

Goal: record the full screen (or the game) continuously in the background. A hotkey saves the last N seconds or minutes, with N set by the user.

How recording works today:
- `screen_capture::RegionCapturer` is a GDI capture thread that fills a double-buffered BGRA slot.
- A pacing loop pipes raw frames into ffmpeg: `-f rawvideo -pixel_format bgra -i - -c:v libx264 -preset ultrafast`.
- WASAPI loopback audio is written to a `.f32` file, then muxed in with `-c:v copy -c:a aac`.
- ffmpeg comes from `ffmpeg-sidecar` (`recording::ffmpeg_binary()`).

Design to start from:
- Reuse the capturer and ffmpeg pipe, but write a **segment muxer**: `-f segment -segment_time 2 -reset_timestamps 1`, into `%TEMP%/snipclip-replay/seg_%05d.ts`. Use h264 with a GOP of about 2 s. Use `h264_nvenc`, `h264_qsv` or `h264_amf` when available, else x264 ultrafast.
- Keep a ring of segments covering N seconds plus one, deleting old ones.
- On the hotkey, concat the last ceil(N/2)+1 segments with `-f concat -c copy`, trim to N with `-sseof`, and save to the vault.
- Settings: an enable toggle, buffer length, a hotkey, an fps/quality cap, and a monitor choice.
- Pause the buffer while a normal recording is running, or share the capturer.
- Audio needs the silence-gap fix noted above.
- GDI capture costs a lot of CPU at 60 fps full screen. Consider DXGI Desktop Duplication, or ffmpeg `ddagrab` on Windows, for the buffer.
