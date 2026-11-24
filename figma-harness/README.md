# Figma capture harness

Renders the **real** SnipClip React UI (unchanged `src/`) in Chromium with a fake Tauri backend,
and writes every screen as one self-contained HTML file for Figma's `html_to_figma`
(inline `<style>`, `data:` URI images, no scripts, no external URLs).

```sh
node figma-harness/capture.mjs            # all screens -> figma-harness/out/NN-name.html
node figma-harness/capture.mjs viewer     # only files whose name contains "viewer"
node figma-harness/capture.mjs --png      # also save NN-name.live.png (live render)
node figma-harness/verify.mjs             # open each HTML offline, save NN-name.static.png,
                                          # diff against the live PNG
```

`FX_LOCALE=nb-NO node figma-harness/capture.mjs` renders day names / times in another locale
(default `en-US`; the real app follows the Windows locale).

Playwright is taken from the project, a global install, or the `npx playwright` cache.
Nothing outside `figma-harness/` is written, and no user data is read.

## Files

| File | What it does |
| --- | --- |
| `vite.config.ts` | Own Vite server (port 1430+). Root stays at the project so Tailwind scans `src/` exactly like the app build; `public/` serves the fake media at `/media/…`. |
| `index.html` | Harness page, same `<html>` attributes as the app's `index.html`; loads `entry.ts`. |
| `entry.ts` | Imports `mock.ts`, then the real `src/main.tsx`. Window is picked by the same URL params (`?view=palette`, `?mode=snip`, …). |
| `mock.ts` | `mockIPC` + `mockWindows` + `convertFileSrc`. Answers every command the pages call with invented data (30 items over 5 days: text, code, JSON, hex, timestamp, translated, links, math, generated PNGs, screenshots, mp4/gif clips, one clip whose file is missing; pinned items; instant replay on, Alt+Z, 60 s). Scenarios come from `window.__SCENARIO__` (`empty`, `noVideos`, `paused`, `settings`, `uiPrefs`). `window.__fx.emit()` fires Tauri events. |
| `serialize.js` | In-page serializer: video/canvas -> `<img>` of the current frame, all images -> data URIs, all CSS -> one `<style>`, live `:hover`/`:focus` states -> classes, scroll positions frozen with transforms, form values -> attributes, scripts removed, screen wrapped in `<div class="board" data-name="…">` at the window size. |
| `capture.mjs` | Drives each window through its states and writes `out/`. |
| `verify.mjs` | Offline check (all network blocked) + pixel diff vs. the live render. |
| `public/media/` | Frames (`f*.jpg`, `big.jpg`), a 6 s 720p `clip.mp4` cut from a local replay, two shorter clips, `loop.gif`, GIF-picker previews. |

## Window sizes

main 976×669 · palette 600×400 · screenshot popup 220×140 · recorder bar 380×52 ·
replay toast 300×64 · video editor 980×720 · snip overlay 1280×720.

Transparent windows (palette, popup, recorder, toast) keep a transparent background; the snip
overlay is shown over a desktop frame (`big.jpg`), which is what sits behind it in reality.

## Known gaps

- Static output: no hover/animation; spinners are frozen; the playing video is one frame.
- Headless Chromium left the autoplayed clip paused, so the harness calls `play()` itself.
- Emoji render with the Windows emoji font in the browser; Figma may substitute glyphs.
- Fonts are system fonts (Segoe UI / Cascadia etc.), not embedded.
- Native window chrome (Mica/acrylic, shadows, rounded corners from Windows) is not part of the
  web content and isn't captured.

## Extra checks (added in Phase 5.2A)

| Command | What it does |
| --- | --- |
| `node figma-harness/widths.mjs [--collapsed]` | Renders Clips, Screenshots and Images at 720/960/1200/1440/1920 px and prints columns and tile widths. PNGs go to `out/widths/`. |
| `node figma-harness/keys.mjs` | Keyboard smoke test on the main window (Ctrl+F, search editing, Enter fallback, Ctrl+P, → in grid, Space/Esc viewer, Enter on a focused button). Exits 1 on failure. |

`public/media/` is git-ignored because its clips come from a local replay. Recreate it with frames and a short mp4 of your own before capturing on a fresh clone.
