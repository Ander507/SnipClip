# SnipClip UI/UX redesign: implementation spec

User goal: "much prettier", "watch clips inside like Medal", "fullscreen the images", "a real application for clipping and snipping", "just a much better UX". Where looks and UX compete, UX wins: fewer clicks for find → copy, watch a clip, share a clip.

Three slices with disjoint files (§7). No new dependencies. No Rust, `tauri.conf.json` or capability changes are needed.

## 0. Verified facts the design relies on

- Video/gif items: `content` = absolute file path (present in list payloads; only image blobs are stripped, `db.rs:1359`), `preview` = `"video: <file>.mp4"`. Replays are named `SnipClip Replay <stamp>.mp4` (`replay.rs:827`). No duration or size is stored.
- `item_thumbnail` returns null for anything but image/screenshot (`commands.rs:73`). There is no poster source today.
- `convertFileSrc(path)` plays clips (already used by `VideoEditorModal.tsx:76`). The asset protocol answers with `Access-Control-Allow-Origin: <window origin>` (tauri 2.11.5 `protocol/asset.rs`), so a `crossOrigin="anonymous"` video can be drawn to a canvas and exported.
- `opener:default` includes `allow-reveal-item-in-dir`; `@tauri-apps/plugin-opener` is installed → `revealItemInDir(path)` works with no backend command.
- `core:window:allow-set-fullscreen` is granted; `is-visible` / `is-minimized` come with `core:default`.
- Tokens are `@theme inline` (`index.css:9`), so utilities compile to `var(--sc-*)` and can be re-scoped on any subtree. With glass/translucency/mica on, surface tokens become 28–78 % opaque (`theme.ts:531-537`).
- Corner radius is a user pref that rescales `--radius-xs…2xl` (`uiPrefs.ts:151`). UI scale is `zoom` on `#root` (`theme.ts:587`).
- Deleting an item removes the DB row only; the mp4 stays on disk (`db.rs:1569`). Delete already has a 5 s Undo toast (`App.tsx:586`).

## 1. Direction

**UX rules**
1. One click or one key to the main verb: play glyph / thumbnail click opens the viewer, Space toggles it, Enter copies, hover actions are real buttons (≥ 28 px).
2. Never a dead end: every empty state and toast offers the next action (Record, Snip, Clear search, Watch, Undo).
3. Feedback stays visible: toasts render above the viewer; copy never closes what you are looking at.
4. Same language as the popup: `rounded-xl` cards, `Enter`/`P`/`Del` hints written the same way, clips show a frame everywhere.

**Visual system**
- Media is the interface: large posters, quiet chrome, borders instead of resting shadows. Accent is reserved for selection, the primary capture button and progress.
- Colors: tokens only (`bg-app|raised|muted|inset|hover`, `border-line|line-strong`, `text-fg|fg-secondary|fg-muted|fg-faint`, `accent`, `accent-soft`, `accent-fg`, `danger`). Two exceptions: overlays that sit on media pixels (badges, play glyph, gradients) use `bg-black/55–75` + `text-white`, because media is not a themed surface and translucent themes make token surfaces see-through; and the existing Windows close-button red.
- Radii via Tailwind tokens only, never `rounded-[Npx]`: `rounded-md` controls, `rounded-lg` inputs, `rounded-xl` rows/tiles/panels, `rounded-full` pills and round buttons.
- Spacing on a 4 px grid: gutter `px-4`, grid gap 12, icon buttons `h-7 w-7`, inputs and primary buttons `h-9`.
- Type: 13 px body, 12 secondary, 11 meta, 10 uppercase section labels (`font-semibold tracking-wider`); `tabular-nums` for counts; `font-mono` for times, durations, dimensions.
- States: hover `bg-hover` / `border-line-strong`; selected tile `border-accent ring-2 ring-accent/50`; selected row keeps the 3 px accent rail; active nav `bg-accent-soft`; disabled `opacity-40`.
- Motion: opacity/transform/color only. 150 ms ease-out hovers, 180 ms overlays (`sc-fade-in`, `sc-pop-in`), 300 ms thumbnail zoom `scale-[1.03]`. No animated heights inside virtualized lists. Respect `prefers-reduced-motion`.

## 2. Cross-slice contracts

1. `TitleBar` stays `h-10`; the viewer sits at `top-10` when windowed.
2. `ClipboardList` / `ClipboardGrid` / `ClipboardItemRow` prop names and types do not change. `onPreviewImage(id)` now means "open the Media Viewer" for images **and** videos; `onEditVideo(id)` means "open the trim editor".
3. Slice B only adds exports to `thumbnails.ts` and `itemParts.tsx`; existing signatures stay. Slice A imports nothing that B or C create, so every slice type-checks alone.
4. The viewer root carries `data-media-viewer`. Any global key handler outside the viewer must return early while `document.querySelector("[data-media-viewer],[data-snip-editor]")` matches.
5. Class names `sc-fade-in` / `sc-pop-in` are defined by C in `index.css`; A and B may use them (harmless until C lands).
6. Every `<video>` created by A or B must release its file on unmount: `v.pause(); v.removeAttribute("src"); v.load();`. Otherwise WebView2 keeps the mp4 locked and the editor or Explorer cannot replace or delete it.
7. Nobody edits `SettingsView.tsx`, `main.tsx`, `CommandPalettePage.tsx`, `src-tauri/**`, or other windows' pages (one exception: the optional `PaletteItem.tsx` change in §5.3). The tree has uncommitted replay work: no `git stash/checkout/reset`.

## 3. UX fixes (current pain points)

| # | Pain point (file:line) | Fix | Slice |
|---|---|---|---|
| U1 | Enter does nothing while the search field is focused: `App.tsx:744-746` returns for every key but Esc/↑/↓, so "type → Enter" never copies | Let Enter (plain, Ctrl, Shift) through when `e.target === searchRef.current` | A |
| U2 | Space / double-click on a clip opens the trim editor in another window instead of playing: `App.tsx:807-809`, `ClipboardGrid.tsx:285-289`, `ClipboardItemRow.tsx:162-166` | Both open the viewer; Edit lives in the viewer and the hover pencil | A + B |
| U3 | Clips have no picture or length; rows and tiles print `video: SnipClip_….mp4`: `ClipboardItemRow.tsx:215-218`, `ClipboardGrid.tsx:204-207`, popup `palette/PaletteItem.tsx:28` | Poster frame, duration badge, "Replay · 0:30" label | B |
| U4 | The viewer hides feedback and its own OCR button: modal `z-[999]` (`ImageViewerModal.tsx:37`) covers the toast `z-[200]` (`App.tsx:997`); `ocrAvailable` is never passed (`App.tsx:1022-1033`) so "Copy Text (OCR)" never renders; Copy closes the viewer (`ImageViewerModal.tsx:105`); no zoom, no next/prev | New viewer at `z-[150]`, stays open on copy, gets `ocrAvailable` | A |
| U5 | Media tabs default to 64 px list rows and Clips can never be a grid: `uiPrefs.ts:45`, `App.tsx:545-548` | Grid by default, Clips included, toggle in the header | A |
| U6 | In the grid ↑/↓ move one item sideways, not one row: `App.tsx:755-775` has no column count | 2-D arrow navigation inside `ClipboardGrid` | B |
| U7 | One empty state for everything; a search with no matches or an empty Clips tab says "Your library is empty": `ClipboardList.tsx:70-86` | Per-context `EmptyState` with an action | A |
| U8 | Recording and replay saving are hotkey-only: `Sidebar.tsx:186-224` offers only Snip; `beginRecord` / `saveReplayClip` (`api.ts:274`, `:569`) are unused in `App.tsx` | Record and "Clip last N s" buttons in the header and the Clips empty state | A |
| U9 | "Replay saved" toast is a dead end: `App.tsx:293-296` | Toast action "Watch" | A |
| U10 | Shortcuts are one faint 11 px sentence that omits `/`, `P`, `Del`: `App.tsx:923-935`; the search field does not show `/`: `SearchBar.tsx:22` | Kbd hint chips; `/` chip in the field | A + C |
| U11 | Hover actions are 20–25 px targets: `ClipboardGrid.tsx:325-349`, `itemParts.tsx:200-201`; open/play is only a tooltip: `ClipboardItemRow.tsx:180,202` | 28 px buttons, visible play/expand affordances, "Show in folder" | B |
| U12 | Title-bar "Pause" reads as a media control but pauses clipboard capture: `TitleBar.tsx:58-74` | Icon button with tooltip; explicit "Clipboard paused" pill when paused | C |
| U13 | Enter copies in the main window but pastes in the popup, Ctrl+Enter the reverse: `App.tsx:777-799` vs `CommandPalettePage.tsx:448-458` | Open decision (§8). Default: keep, state it in the hint chips | — |

## 4. Slice A: Media Viewer and app flows

### 4.1 Component contract

Files: `src/components/media/MediaViewer.tsx` (shell, keys, fullscreen, actions), `VideoStage.tsx`, `ImageStage.tsx` (same folder).

```ts
export interface MediaViewerProps {
  items: ClipboardItem[];            // media only (image|screenshot|video|gif), on-screen order
  activeId: number;                  // component is mounted only while the viewer is open
  ocrAvailable: boolean;
  onNavigate(id: number): void;
  onClose(): void;
  onCopy(id: number): void | Promise<void>;
  onPin(id: number): void;
  onDelete(id: number): void;
  onExtractText(id: number): void | Promise<void>;
  onEditImage(id: number, dataUrl: string): void;   // annotation editor
  onEditVideo(id: number): void;                    // trim editor window
  onError(message: string): void;
}
```

Stages expose imperative handles (`forwardRef` + `useImperativeHandle`) so the shell owns every key: `VideoStage` → `{ togglePlay, seekBy(sec), stepFrame(dir), toggleMute, nudgeVolume(d), nudgeRate(dir), toggleLoop }`; `ImageStage` → `{ zoomBy(factor), fit(), actual() }`.

### 4.2 Shell

- Root: `<div data-media-viewer tabIndex={-1} style={cinemaVars}>`, classes `fixed inset-x-0 bottom-0 z-[150] overflow-hidden text-fg outline-none select-none sc-fade-in`, plus `top-10 bg-black/95` windowed or `top-0 bg-black` fullscreen. Focus the root on mount. Every button gets `onMouseDown={(e) => e.preventDefault()}` so clicks never move focus and Space always reaches the key handler.
- **Cinema scope** (always dark, always opaque, still token-driven): `cinemaVars` is a module constant built from `getPresetThemeColors("dark", "cyan")` mapped through `THEME_CSS_VARS` for every key except `accent` / `accentFg` (those inherit the user's accent). Inside the viewer use normal token classes. Reason: in a light or translucent theme, token text over a black stage is unreadable.
- If `activeId` is not in `items`, call `onClose()` (effect). Item = `items[index]`; no wrap-around.
- Top bar (`absolute inset-x-0 top-0 h-12 px-3 flex items-center gap-1 bg-gradient-to-b from-black/70 to-transparent`): left = kind label (`Replay` / `Recording` / `GIF` / `Screenshot` / `Image`) + `shortWhen(createdAt)` + dimensions in `font-mono text-fg-muted`; middle = `index+1 / items.length`; right = `h-8 w-8 rounded-md` icon buttons with shortcut tooltips: Copy, Edit (`Pencil` image, `Scissors` video), `ScanText` (image and `ocrAvailable`), `FolderOpen` (video/gif → `revealItemInDir(item.content)`, errors to `onError`), Pin (filled when pinned), `Trash2` (`hover:text-danger`), divider, `Maximize`/`Minimize`, `X`.
- Prev/next: `absolute top-1/2 -translate-y-1/2 left-3|right-3 h-10 w-10 rounded-full border border-line bg-raised/80 hover:bg-hover`; not rendered at the ends.
- Chrome (top bar, arrows, bottom controls) fades out (`opacity-0 pointer-events-none`, 200 ms) after 2.5 s without pointer movement while a video is playing or an image is shown and the pointer is not over chrome; the stage gets `cursor-none`. Any pointer move, key press or pause shows it.
- Fullscreen: `getCurrentWindow().setFullscreen(next)`, tracked in state. On close or unmount, if fullscreen, call `setFullscreen(false)`.
- Pause playback when the window is hidden or minimized: `getCurrentWindow().onFocusChanged` → on blur, if `!(await isVisible()) || (await isMinimized())`, pause.
- Actions: Copy keeps the viewer open (App shows the toast). Edit calls `onEditImage(id, fullDataUrl)` / `onEditVideo(id)` (pause first) and then `onClose()`. Delete calls `onDelete(id)`; App picks the neighbor.

### 4.3 VideoStage

- `<video key={item.id} src={convertFileSrc(item.content)} autoPlay playsInline preload="auto">` filling the stage with `object-contain`; no native controls. `play()` rejection → stay paused and show a centered 64 px play button. `onError` or empty path → panel "This clip's file is missing or can't be played", path in mono, button "Remove from library" (`onDelete`).
- Click = play/pause; double-click = fullscreen.
- Bottom overlay (`absolute inset-x-0 bottom-0 px-4 pb-3 pt-10 bg-gradient-to-t from-black/75 to-transparent`):
  - Scrub bar: full-width 16 px hit area, track `h-1` (`h-1.5` on hover) `bg-white/25`, buffered `bg-white/35`, played `bg-accent`, 12 px accent thumb on hover/drag, hover time bubble. Pointer capture; ratio = `(clientX - rect.left) / rect.width`; seek live, throttled with rAF. Progress updates from an rAF loop while playing (`timeupdate` is too coarse).
  - Row: Play/Pause · time `0:07 / 0:30` (`font-mono tabular-nums`, hundredths while paused) · spacer · `StepBack` / `StepForward` · `Repeat` (accent when on) · speed button showing `1×` (click cycles 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2) · mute button + 72 px volume slider · fullscreen.
- Frame step: pause, then `currentTime ± frameDur`. `frameDur` = smallest positive `mediaTime` delta seen through `requestVideoFrameCallback` (ignore < 1/240), default 1/30.
- Persist `{ volume, muted, rate, loop }` in `localStorage["snipclip.viewer.v1"]`; defaults `1, false, 1, true`. Apply on `loadedmetadata`.

### 4.4 ImageStage (images, screenshots, GIFs)

- Source: GIF → `convertFileSrc(item.content)`. Image/screenshot → show `useItemThumbnail(id, 720, item.preview)` at once, then swap to `getItem(id).content` (guard against stale responses); report the full data URL up so Edit can use it (Edit disabled until then).
- Size the image box from `item.width × item.height` (fallback `naturalWidth/Height`) so the thumb → full swap does not jump. Stage padding 48 top / 56 bottom / 56 sides.
- `fit = min(stageW / w, stageH / h, 1)`; scale range `[fit, 8]`. Wheel zooms ×1.15 per notch around the cursor; drag pans when zoomed (clamp so the image cannot leave the stage); double-click toggles fit ↔ 100 % (↔ 200 % if fit is already 100 %) around the click point. Render with `transform: translate3d() scale()`, origin `0 0`; `image-rendering: pixelated` at scale ≥ 3. Reset on item change.
- UI zoom: convert pointer deltas to local px by dividing by `rect.width / el.offsetWidth`.
- Bottom pill (`rounded-full border border-line bg-raised/90 h-9 px-1 shadow-lg`): `ZoomOut` · `NN%` (click = 100 %) · `ZoomIn` · divider · `Fit`.

### 4.5 Keys

One `window` keydown listener in the capture phase; handled keys call `preventDefault()` + `stopPropagation()`.

| Key | Action |
|---|---|
| Esc | close (leaves fullscreen) |
| ← / → , Home / End | previous / next, first / last item |
| F | toggle window fullscreen |
| Enter, C, Ctrl+C | copy · E edit · P pin · Delete delete |
| Space | video: play/pause (also K) · image: close (Quick Look toggle) |
| J / L | seek −5 s / +5 s |
| , / . | previous / next frame (pauses) |
| M, ↑ / ↓ | mute, volume ±10 % |
| < / > , R | speed down / up, loop |
| + / − / 0 / 1 | image zoom in / out / fit / 100 % |

### 4.6 `App.tsx` wiring (only Slice A edits this file)

1. Replace `previewId` / `previewSrc` / `previewLoading`, `openImagePreview`, `closeImagePreview` and the `ImageViewerModal` import/JSX with `const [viewerId, setViewerId] = useState<number | null>(null)`. Delete `ImageViewerModal.tsx`.
2. `mediaItems` = `dockItems.filter((i) => isImageItem(i) || isVideoItem(i))`, memoized on `items` and `settings.compactDock`. `openViewer(id)` sets `selectedId` and `viewerId`.
3. Render `{viewerId != null && <MediaViewer items={mediaItems} activeId={viewerId} ocrAvailable={ocrAvailable} onNavigate={(id) => { setViewerId(id); setSelectedId(id); }} onClose={() => setViewerId(null)} onCopy={handleCopy} onPin={…} onDelete={handleDelete} onExtractText={handleExtractText} onEditImage={(id, src) => void handleEditImage(id, src)} onEditVideo={(id) => void handleEditVideo(id)} onError={(m) => setStatus(m, 2400, { tone: "error" })} />}`.
4. `ClipboardList`: `onPreviewImage={openViewer}`; `onEditVideo` unchanged.
5. Key handler (`App.tsx:733`): first guard becomes `if (capture || view === "settings" || viewerId != null) return;` (add `viewerId` to deps). Space branch: any image or video → `openViewer(item.id)`. U1: allow Enter through when `e.target === searchRef.current`.
6. `handleDelete`: replace the `previewId` line with: if `viewerId === id`, set `viewerId` to the next media item, else the previous, else `null`. `handleClear`: `setViewerId(null)`.
7. `handleEditImage(id, imageSrc)`: use `id` for `vaultId`; close the viewer.
8. `gridView` also true for `category === "videos"`. In `uiPrefs.ts` change only `DEFAULT_UI_PREFS.imageView` to `"grid"`.
9. Toast: `viewerId != null ? "bottom-24" : "bottom-4"` so it clears the controls.
10. U9: `replay-saved` toast gets `action: { label: "Watch" }` → `setView("vault")`, `setCategory("videos")`, store `payload.vaultId` in a ref; an effect on `items` opens the viewer once that id is present.

### 4.7 Content header and empty states (in `App.tsx`)

Replace the block at `App.tsx:921-961` (keep the compact-dock buttons and their logic):
- Row 1 (`flex items-center gap-2`): `<SearchBar>` in a `min-w-0 flex-1` wrapper; on media tabs a two-button view toggle (group `rounded-lg border border-line bg-inset p-0.5`, buttons `h-8 w-8 rounded-md`, active `bg-raised text-fg shadow-sm`, `aria-pressed`, icons `LayoutGrid` / `Rows3`) that calls `persistWindowPrefs({ uiPrefs: { ...settings.uiPrefs, imageView } })`; then U8 capture buttons (not in compact dock), `h-9 rounded-lg border border-line px-2.5 text-[12px] text-fg-secondary hover:bg-hover`, label `hidden min-[900px]:inline`: **Record** (`beginRecord()`, tooltip with `hotkeyRecord`) and, when `settings.replayEnabled`, **Clip last {replaySeconds}s** (`saveReplayClip()`, tooltip with `replayHotkey`, errors to the toast).
- Row 2 (`mt-2 flex h-5 items-center justify-between`): left = tab label (from `LIBRARY_TABS`) + count, `text-[12px] font-medium text-fg-secondary`, count `text-fg-faint tabular-nums`; right = hint chips (`hidden min-[820px]:flex gap-3 text-[11px] text-fg-faint`, each `<kbd class="rounded border border-line bg-muted px-1 font-mono text-[10px] text-fg-muted">`). Media tabs: `Space` view · `Enter` copy · `Del` delete. Other tabs: `Enter` copy · `Ctrl+Enter` paste (only with direct paste) · `P` pin · `Del` delete. Compact dock keeps its current sentence. Append "listening paused" when paused.
- New `src/components/EmptyState.tsx`: `{ icon: ReactNode; title: string; body?: string; action?: { label: string; onClick(): void }; secondary?: { label: string; onClick(): void } }`; centered, icon in `h-12 w-12 rounded-xl bg-muted text-accent`, title 14 px semibold, body 12 px `text-fg-muted max-w-[320px]`, action = accent `h-9` button, secondary = ghost. Render it instead of `<ClipboardList>` when `dockItems.length === 0`:
  - query set → "No matches for “{query}”", action **Clear search**, secondary **Search all tabs** when `category !== "all"`.
  - videos → "No clips yet", body names `hotkeyRecord` and (if enabled) `replayHotkey`, action **Record**, secondary **Open settings** when replay is off.
  - screenshots → "No screenshots yet", action **Snip** (`startSnip`). images → "Copied images land here". pinned → "Nothing pinned", body "Press P on any item to keep it on top."
  - otherwise the current "Your library is empty" copy with hotkeys.

## 5. Slice B: gallery, posters, item affordances

### 5.1 Poster frames (decision: frontend canvas capture, no backend)

Add to `src/lib/thumbnails.ts`:

```ts
export interface VideoPoster { src: string | null; durationSec: number | null; failed: boolean }
export function useVideoPoster(path: string, enabled?: boolean): VideoPoster;
```

- Capture: detached `<video>` with `crossOrigin = "anonymous"`, `muted`, `preload = "auto"`, `src = convertFileSrc(path)`. Await `loadedmetadata` → `durationSec` (null if not finite) → `currentTime = Math.min(0.5, duration / 2)` → await `seeked` (and `readyState >= 2`) → draw to a canvas with long edge ≤ 640 → `toDataURL("image/jpeg", 0.8)` → release per contract 6. GIF: `Image` with `crossOrigin`, `decode()`, draw the first frame, duration null. 10 s timeout or any error → `failed`.
- Cache by `path` (an edited clip gets a new path) in an LRU of 300 like the existing one; dedupe in-flight requests; at most 2 captures at once.
- If `toDataURL` throws a SecurityError in testing, stop and report; the fallback is an ffmpeg poster command, which is out of scope here.

Add to `itemParts.tsx`: `formatDuration(sec)` → `0:07` / `1:02:03`; `videoKindLabel(item)` → `GIF`, `Replay` (file name starts with `SnipClip Replay`), else `Recording`.

### 5.2 Grid tiles (`ClipboardGrid.tsx`)

- `wide = items.every(isVideoItem)` (memo). Frame is `aspect-video` when wide, else `aspect-[4/3]`; `tileRowH` must use the same ratio (9/16 or 3/4) or the virtualizer drifts. Wide tiles use min width `Math.round(THUMB_PX[thumbSize] * 1.4)`.
- Tile: `rounded-xl`, selected `border-accent ring-2 ring-accent/50`, image `transition-transform duration-300 group-hover:scale-[1.03]`. Keep the caption strip and `TILE_CHROME_PX`.
- Video extras: poster from `useVideoPoster(item.content)`; duration badge bottom-right (`rounded-md bg-black/65 px-1.5 py-0.5 font-mono text-[10px] font-medium tabular-nums text-white`); `GIF` badge bottom-left; centered play button (`h-10 w-10 rounded-full bg-black/55 text-white`, shown on hover and when selected). **Single click on the play button opens the viewer** (`onPreviewImage`, stop propagation). Poster failed → `Film` icon + "No preview". Caption: time left, `videoKindLabel` right.
- Hover preview: after 250 ms of hover mount a muted, looping, `playsInline` `<video>` over the poster (fade in on `playing`), with a 2 px accent progress line at the bottom; unmount on leave (contract 6). GIF: swap in the animated file. One preview at a time.
- Double-click: image or video → `onPreviewImage()`; other → `onCopy()`. Pencil still calls `onEditVideo`.
- U11 actions: buttons `h-7 w-7` with 14 px icons (`ActionButton` gets flex centering; row buttons too). Add `Maximize2` "Open" for images and `FolderOpen` "Show in folder" for video/gif (`revealItemInDir(item.content)` from `@tauri-apps/plugin-opener`, errors to `console.error`).
- U6: capture-phase `window` keydown for ArrowUp/ArrowDown (no modifiers, target not a TEXTAREA, contract 4 guard): move to the same column in the previous/next tiles row (clamped to that row's length, crossing day headers), call `onSelect`, then `preventDefault()` + `stopPropagation()`. ←/→ and j/k stay with App.

### 5.3 Rows (`ClipboardItemRow.tsx`, `ClipboardList.tsx`, optional `palette/PaletteItem.tsx`)

- Video rows use the image thumb box (`m.thumbW × m.thumbH`) with the poster and a small centered play glyph (`bg-black/55 text-white rounded-full`). Title: `{videoKindLabel} · {formatDuration}`; file name moves to the meta line (`font-mono truncate`). In `ClipboardList.estimateItemHeight` videos take `lead = m.thumbH` like images.
- Clicking the thumbnail of an image or video row opens the viewer with one click (stop propagation); tooltips become "Open" / "Play". Double-click on the row: image or video → `onPreviewImage()`.
- Row card becomes `rounded-xl` to match the popup cards. Do not change `ROW_METRICS` paddings or heights; the virtualizer estimates depend on them.
- Optional, last, only if everything else is done: in `PaletteItem.tsx` give video items the poster card (`asCard`) with a duration chip. Touch nothing else in the popup.

## 6. Slice C: shell

- **`TitleBar.tsx`**: stays `h-10`; `bg-raised border-b border-line`, `pl-3 pr-0`. Tools are `h-7 w-7 rounded-md` icon buttons (`gap-0.5`, vertically centered): idle `text-fg-muted hover:bg-hover hover:text-fg`, active `bg-accent-soft text-accent`. U12: the pause control is icon-only with the existing tooltip; when paused it becomes a pill `h-7 px-2 rounded-md bg-accent-soft text-accent text-[11px] font-medium` reading "Clipboard paused" ("Paused" in compact dock). A `h-4 w-px bg-line mx-1.5` divider, then window controls `w-11 h-full` flush right (close keeps its red hover). Keep every handler, `aria-*`, `data-tauri-drag-region`, `no-drag` and `onMouseDown` stop.
- **`Sidebar.tsx`**: same widths, props and order logic (digits 1–9 follow visual order, so no regrouping). `p-2`. Label for `videos` becomes **Clips**. Nav item: `relative flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors`; idle `text-fg-muted hover:bg-hover hover:text-fg`; active `bg-accent-soft text-fg font-medium`, icon `text-accent` (a user `tabColors` value still wins), plus a rail `absolute inset-y-1.5 w-[3px] rounded-full bg-accent` on the outer edge (`left-0`, or `right-0` when the sidebar is on the right). Count: plain `ml-auto text-[11px] tabular-nums`, `text-fg-faint` idle, `text-accent` active; no pill. Collapsed behavior unchanged. Bottom block: **Snip** is the one primary button (`h-9 w-full rounded-lg bg-accent text-accent-fg text-[13px] font-semibold hover:brightness-110`, `Camera` icon, kbd chip `ml-auto rounded bg-accent-fg/15 px-1.5 text-[10px]`; collapsed = `h-9 w-9` icon). "Snip in 3s" and "Settings" stay ghost rows in the nav-item style.
- **`SearchBar.tsx`**: same props and `forwardRef`. Input `h-9 w-full rounded-lg border border-line bg-inset pl-9 pr-14 text-[13px]`, focus `border-accent ring-2 ring-accent/25`, placeholder "Search clips, text, links…". Right side: clear button when there is a value, else a `/` kbd chip (hidden while focused).
- **`index.css`** (append; do not change token blocks or the other windows' mode rules):
  - `[data-media-viewer]` and its `.bg-raised/.bg-app/.bg-muted/.bg-inset/.bg-hover` descendants: `backdrop-filter: none !important` (same shape as the `[data-snip-editor]` rule).
  - `@keyframes sc-fade-in { from { opacity: 0 } }`, `@keyframes sc-pop-in { from { opacity: 0; transform: translateY(4px) scale(.985) } }`; `.sc-fade-in { animation: sc-fade-in 150ms ease-out both }`, `.sc-pop-in { animation: sc-pop-in 180ms cubic-bezier(.2,.8,.2,1) both }`; both `animation: none` under `prefers-reduced-motion: reduce`.
  - Keyboard focus ring for the main window only, in `@layer base` so `outline-none` utilities still win: `html:not(.popup-mode):not(.snip-mode):not(.video-editor-mode) :focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 1px; }`.
  - Scrollbar thumb: `background-color` + `background-clip: padding-box` + `border: 2px solid transparent` (the current `--sc-app` border shows on `bg-raised` panels); width 8 px.

## 7. Work split and acceptance

| Slice | Owns (nobody else edits these) |
|---|---|
| **A** Viewer + flows | new `src/components/media/MediaViewer.tsx`, `VideoStage.tsx`, `ImageStage.tsx`, `src/components/EmptyState.tsx`; edit `src/App.tsx`, `src/lib/uiPrefs.ts`; delete `src/components/ImageViewerModal.tsx` |
| **B** Gallery + items | `src/components/ClipboardGrid.tsx`, `ClipboardItemRow.tsx`, `ClipboardList.tsx`, `itemParts.tsx`, `src/lib/thumbnails.ts`, optional `src/components/palette/PaletteItem.tsx` |
| **C** Shell | `src/components/TitleBar.tsx`, `Sidebar.tsx`, `SearchBar.tsx`, `src/index.css` |

Slice A is the largest; build the three viewer files first, then the App wiring, then §4.7.

All slices: `npx tsc --noEmit` and `npm run build` pass (errors inside another slice's in-progress files are not yours; re-run at the end). No hex/rgb literals outside the two exceptions in §1. Manual checks need `npm run tauri dev`.

**A**
1. Space or double-click on an image opens the viewer; wheel zooms at the cursor, drag pans, double-click and `0` / `1` work; Space closes.
2. Space on a clip plays it with sound; Space, scrub drag, `,` / `.`, `J` / `L`, `M`, ↑/↓, `<` / `>`, `R` work; volume, speed and loop survive reopening.
3. ←/→ step through media only, in list order, no wrap; the list selection follows and stays on the last viewed item after Esc.
4. `F` and the button enter real fullscreen; Esc closes and restores the window size.
5. Copy shows "Copied" above the controls and keeps the viewer open; Delete moves to the neighbor and Undo restores; Edit opens the right editor; "Show in folder" selects the file in Explorer; the OCR button appears when OCR is available.
6. While the viewer is open, digits, `j` / `k`, `/` and list Delete do nothing in the app behind it.
7. Light theme with translucency 100 %: all viewer chrome is legible.
8. Hiding the window with the toggle hotkey pauses playback. A missing file shows the error panel.
9. Typing a query and pressing Enter copies the top hit. A query with no matches shows "No matches" with a working Clear search. The Clips tab shows Record (and Clip last N s when replay is on); both work. "Replay saved" → Watch opens that clip.

**B**
1. Clips tab in grid view: 16:9 posters with duration badges; scrolling does not jump or overlap rows.
2. Hovering a clip for 250 ms plays a muted preview; after leaving, the mp4 can be renamed in Explorer at once (no lock).
3. One click on the play button and double-click on the tile both call `onPreviewImage`; the pencil still opens the editor.
4. ↑/↓ move by one row in the grid, also across day headers; they do nothing while the viewer or the snip editor is open.
5. "All" list: clip rows show a poster and `Replay · 0:30`; row heights are stable while scrolling.
6. Images / Screenshots grids keep copy, OCR, pin, delete; every hover button is 28 px.
7. A clip whose file is gone shows the placeholder and no error loop.

**C**
1. Check dark, light, one custom accent, glass on, sidebar right, sidebar collapsed, compact dock.
2. Tabs, counts, collapse, Snip, Snip in 3s, Settings, digits 1–9, `/`, clear button, window drag and all title-bar buttons behave as before; title bar is still 40 px.
3. Popup, palette, snip overlay, recorder bar, video editor and replay toast look the same apart from the scrollbar thumb.

## 8. Risks and open decisions

Risks
- Fullscreen on a frameless, transparent (mica) window: verify that enter/exit restores size and position.
- File locks from `<video>` (contract 6); autoplay with sound may be refused (fallback in §4.3).
- Posters are regenerated each session (about 0.1–0.2 s per clip, two at a time). If that feels slow, add an ffmpeg command with a disk cache later.
- The viewer steps through the loaded list only (`listItems` limit 200).
- Installs that already saved UI prefs keep `imageView: "list"`; the header toggle is the way to switch.
- Pointer math under UI zoom (§4.4); capture-phase key handlers must honor contract 4.

Open decisions (defaults are what this spec builds)
1. The viewer is always dark, also in light themes. Default: yes.
2. Delete in the viewer removes the library entry only; the mp4 stays in `Videos\SnipClip`. Default: unchanged. Alternative: also delete the file when the Undo window ends.
3. Enter in the main window copies while the popup pastes (U13). Default: unchanged. Alternative: make the main window paste too.
4. "Videos" is renamed "Clips" and media tabs default to grid. Default: yes.
