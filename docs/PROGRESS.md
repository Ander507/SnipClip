# SnipClip progress

The work has three phases:

1. Audit and fix performance problems and bugs. **Done.**
2. Add Medal-style instant replay clipping. **Next.**
3. Run a second bug audit over everything, including the new clipping code.

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

### Known issues, deferred
- `system_audio.rs`: WASAPI loopback delivers no packets during silence, so audio drifts ahead of the video. Fix this in phase 2 by inserting zero samples by wall-clock, because the replay buffer needs it too.
- `recording.rs`: GIF mode buffers every frame in RAM (up to about 1.6 GB). It needs a byte cap or streaming.
- `video_edit.rs`: a failed run can leave a partial output file, and output names at one-second resolution can collide.
- `vault.rs`: the whole DB is read into memory to encrypt it.

## Phase 2: instant replay clipping (next)

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
