import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import clsx from "clsx";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  FolderOpen,
  Maximize,
  Minimize,
  Pencil,
  Pin,
  ScanText,
  Scissors,
  Trash2,
  FileX,
  X,
} from "lucide-react";
import type { ClipboardItem } from "../../lib/types";
import { THEME_CSS_VARS, getPresetThemeColors } from "../../lib/theme";
import type { ThemeTokenKey } from "../../lib/theme";
import { dimensionsLabel, shortWhen } from "../../lib/itemMeta";
import { ImageStage } from "./ImageStage";
import type { ImageStageHandle } from "./ImageStage";
import { VideoStage } from "./VideoStage";
import type { VideoStageHandle } from "./VideoStage";

export interface MediaViewerProps {
  /** Media only (image | screenshot | video | gif), in on-screen order. */
  items: ClipboardItem[];
  /** The viewer is mounted only while it is open. */
  activeId: number;
  ocrAvailable: boolean;
  onNavigate(id: number): void;
  onClose(): void;
  onCopy(id: number): void | Promise<void>;
  onPin(id: number): void;
  /** Remove the library entry only (the file stays on disk). */
  onDelete(id: number): void;
  /** Clips/GIFs: move the file to the Recycle Bin (App confirms first). */
  onDeleteFile(id: number): void;
  onExtractText(id: number): void | Promise<void>;
  /** Annotation editor. */
  onEditImage(id: number, dataUrl: string): void;
  /** Trim editor window. */
  onEditVideo(id: number): void;
  onError(message: string): void;
}

/**
 * The viewer is always dark and opaque, whatever the app theme: re-scope every surface and
 * text token to the dark preset (the accent stays the user's own) so token classes stay legible.
 */
const CINEMA_VARS = (() => {
  const dark = getPresetThemeColors("dark", "cyan");
  const vars: Record<string, string> = {};
  for (const key of Object.keys(THEME_CSS_VARS) as ThemeTokenKey[]) {
    if (key === "accent" || key === "accentFg") continue;
    vars[THEME_CSS_VARS[key]] = dark[key];
  }
  return vars as CSSProperties;
})();

const HIDE_AFTER_MS = 2500;
const REPEATABLE = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "j", "l", ",", ".", "+", "=", "-"]);

function isVideoKind(item: ClipboardItem): boolean {
  return item.contentType === "video";
}

function isImageKind(item: ClipboardItem): boolean {
  return item.contentType === "image" || item.contentType === "screenshot";
}

function kindLabel(item: ClipboardItem): string {
  switch (item.contentType) {
    case "screenshot":
      return "Screenshot";
    case "gif":
      return "GIF";
    case "video":
      return /replay/i.test(item.content || item.preview || "") ? "Replay" : "Recording";
    default:
      return "Image";
  }
}

function IconBtn({
  title,
  onClick,
  disabled,
  danger,
  active,
  children,
}: {
  title: string;
  onClick(): void;
  disabled?: boolean;
  danger?: boolean;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      // Never take focus: Space and the other keys must keep reaching the viewer.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={clsx(
        "flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-hover disabled:pointer-events-none disabled:opacity-40",
        danger ? "text-fg-secondary hover:text-danger" : "text-fg-secondary hover:text-fg",
        active && "text-accent hover:text-accent"
      )}
    >
      {children}
    </button>
  );
}

export function MediaViewer(props: MediaViewerProps) {
  const { items, activeId, ocrAvailable } = props;
  const index = items.findIndex((i) => i.id === activeId);
  const item: ClipboardItem | undefined = items[index];

  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<VideoStageHandle>(null);
  const imageRef = useRef<ImageStageHandle>(null);

  const [fs, setFs] = useState(false);
  const fsRef = useRef(false);
  const mountedRef = useRef(true);
  const fsBusy = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [full, setFull] = useState<{ id: number; src: string } | null>(null);

  // Latest props/state for the one long-lived key listener.
  const latest = useRef({ props, item, index, full });
  latest.current = { props, item, index, full };

  // Not in the list any more (e.g. deleted elsewhere): nothing to show.
  useEffect(() => {
    if (index < 0) props.onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // Take focus on open, and hand it back to whatever had it (e.g. the grid card) on close.
  useEffect(() => {
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    rootRef.current?.focus();
    return () => {
      if (prev && prev !== document.body && prev.isConnected) {
        try {
          prev.focus({ preventScroll: true });
        } catch {
          /* element no longer focusable */
        }
      }
    };
  }, []);

  // ---- fullscreen -------------------------------------------------------------------
  const toggleFullscreen = useCallback(async () => {
    if (fsBusy.current) return;
    fsBusy.current = true;
    const next = !fsRef.current;
    try {
      await getCurrentWindow().setFullscreen(next);
      if (!mountedRef.current) {
        // Closed (Esc / E) while the call was in flight: the unmount cleanup already ran
        // with the old value, so undo here or the window stays fullscreen with no viewer.
        if (next) void getCurrentWindow().setFullscreen(false).catch(() => undefined);
        return;
      }
      fsRef.current = next;
      setFs(next);
    } catch (err) {
      latest.current.props.onError(String(err));
    } finally {
      fsBusy.current = false;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (fsRef.current) {
        fsRef.current = false;
        void getCurrentWindow().setFullscreen(false).catch(() => undefined);
      }
    };
  }, []);

  // ---- pause when the window is hidden or minimized ------------------------------------
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const win = getCurrentWindow();
    void win
      .onFocusChanged(async ({ payload: focused }) => {
        if (focused) return;
        try {
          if (!(await win.isVisible()) || (await win.isMinimized())) {
            videoRef.current?.pause();
          }
        } catch {
          /* window state unavailable */
        }
      })
      .then((u) => {
        if (disposed) u();
        else unlisten = u;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // ---- auto-hiding chrome -----------------------------------------------------------------
  const hideTimer = useRef<number | null>(null);
  const overChrome = useRef(false);
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  const eligibleRef = useRef(true);
  eligibleRef.current = item ? (isVideoKind(item) ? playing : true) : false;

  const poke = useCallback(() => {
    setChromeVisible(true);
    if (hideTimer.current != null) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      hideTimer.current = null;
      if (eligibleRef.current && !overChrome.current) setChromeVisible(false);
    }, HIDE_AFTER_MS);
  }, []);

  useEffect(() => {
    poke();
  }, [item?.id, playing, poke]);

  useEffect(() => {
    return () => {
      if (hideTimer.current != null) window.clearTimeout(hideTimer.current);
    };
  }, []);

  // ---- keys -------------------------------------------------------------------------------
  const go = useCallback((target: "prev" | "next" | "first" | "last") => {
    const { props: p, index: i } = latest.current;
    const list = p.items;
    const next =
      target === "prev" ? list[i - 1] : target === "next" ? list[i + 1] : target === "first" ? list[0] : list[list.length - 1];
    if (next && next.id !== list[i]?.id) p.onNavigate(next.id);
  }, []);

  const doEdit = useCallback(() => {
    const { props: p, item: it, full: f } = latest.current;
    if (!it) return;
    if (isImageKind(it)) {
      if (!f || f.id !== it.id) return;
      p.onEditImage(it.id, f.src);
      p.onClose();
    } else {
      videoRef.current?.pause();
      p.onEditVideo(it.id);
      p.onClose();
    }
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const { props: p, item: it } = latest.current;
      if (!it || e.isComposing || e.altKey) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const video = isVideoKind(it);
      const image = !video;

      // A focused control owns its own keys: Tab + Enter/Space must press the button, and
      // typing/sliding in a field must not fire single-key shortcuts. Escape still closes.
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (t && key !== "Escape") {
        const tag = t.tagName;
        const editable = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
        const pressable = tag === "BUTTON" || tag === "A" || t.getAttribute("role") === "button";
        if (editable) return;
        if (!mod && pressable && (key === "Enter" || key === " ")) return;
      }

      let handled = true;
      if (mod) {
        if (key === "c" && !e.shiftKey) {
          if (!e.repeat) void p.onCopy(it.id);
        } else {
          return; // leave other shortcuts (reload, devtools…) alone
        }
      } else if (e.repeat && !REPEATABLE.has(key)) {
        // Swallow auto-repeat of one-shot keys so Space or Enter cannot machine-gun.
      } else {
        switch (key) {
          case "Escape":
            p.onClose();
            break;
          case "ArrowLeft":
            go("prev");
            break;
          case "ArrowRight":
            go("next");
            break;
          case "Home":
            go("first");
            break;
          case "End":
            go("last");
            break;
          case "f":
            void toggleFullscreen();
            break;
          case "Enter":
          case "c":
            void p.onCopy(it.id);
            break;
          case "e":
            doEdit();
            break;
          case "p":
            p.onPin(it.id);
            break;
          case "Delete":
            if (e.shiftKey && (video || it.contentType === "gif")) p.onDeleteFile(it.id);
            else p.onDelete(it.id);
            break;
          case " ":
            if (video) videoRef.current?.togglePlay();
            else p.onClose();
            break;
          case "k":
            if (video) videoRef.current?.togglePlay();
            else handled = false;
            break;
          case "j":
            if (video) videoRef.current?.seekBy(-5);
            else handled = false;
            break;
          case "l":
            if (video) videoRef.current?.seekBy(5);
            else handled = false;
            break;
          case ",":
            if (video) videoRef.current?.stepFrame(-1);
            else handled = false;
            break;
          case ".":
            if (video) videoRef.current?.stepFrame(1);
            else handled = false;
            break;
          case "m":
            if (video) videoRef.current?.toggleMute();
            else handled = false;
            break;
          case "ArrowUp":
            if (video) videoRef.current?.nudgeVolume(0.1);
            break;
          case "ArrowDown":
            if (video) videoRef.current?.nudgeVolume(-0.1);
            break;
          case "<":
            if (video) videoRef.current?.nudgeRate(-1);
            else handled = false;
            break;
          case ">":
            if (video) videoRef.current?.nudgeRate(1);
            else handled = false;
            break;
          case "r":
            if (video) videoRef.current?.toggleLoop();
            else handled = false;
            break;
          case "+":
          case "=":
            if (image) imageRef.current?.zoomBy(1.25);
            else handled = false;
            break;
          case "-":
            if (image) imageRef.current?.zoomBy(1 / 1.25);
            else handled = false;
            break;
          case "0":
            if (image) imageRef.current?.fit();
            else handled = false;
            break;
          case "1":
            if (image) imageRef.current?.actual();
            else handled = false;
            break;
          default:
            handled = false;
        }
      }

      poke();
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [go, doEdit, toggleFullscreen, poke]);

  if (!item) return null;

  const video = isVideoKind(item);
  // Clips and GIFs live as files on disk, so "remove" and "delete file" differ for them.
  const isClipFile = item.contentType === "video" || item.contentType === "gif";
  const isFileKind = video || item.contentType === "gif";
  const dims = dimensionsLabel(item);
  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;
  const canEditImage = isImageKind(item) ? full?.id === item.id : true;

  const chromeCls = clsx(
    "transition-opacity duration-200",
    !chromeVisible && "pointer-events-none opacity-0"
  );

  return (
    <div
      ref={rootRef}
      data-media-viewer
      role="dialog"
      aria-modal="true"
      aria-label="Media viewer"
      tabIndex={-1}
      style={CINEMA_VARS}
      className={clsx(
        "sc-fade-in fixed inset-x-0 bottom-0 z-[150] select-none overflow-hidden text-fg outline-none",
        fs ? "top-0 bg-black" : "top-10 bg-black/95",
        !chromeVisible && "[&_*]:cursor-none"
      )}
      onPointerMove={(e) => {
        const last = lastPointer.current;
        // Layout changes fire synthetic moves under a still pointer: ignore those.
        if (last && last.x === e.clientX && last.y === e.clientY) return;
        lastPointer.current = { x: e.clientX, y: e.clientY };
        overChrome.current = !!(e.target as Element).closest("[data-chrome]");
        poke();
      }}
      onPointerDown={() => poke()}
    >
      <div className="absolute inset-0">
        {video ? (
          <VideoStage
            key={item.id}
            ref={videoRef}
            item={item}
            chromeVisible={chromeVisible}
            fullscreen={fs}
            onToggleFullscreen={() => void toggleFullscreen()}
            onPlayingChange={setPlaying}
            onDelete={props.onDelete}
          />
        ) : (
          <ImageStage
            key={item.id}
            ref={imageRef}
            item={item}
            isFile={isFileKind}
            chromeVisible={chromeVisible}
            onFullSrc={(src) => setFull(src ? { id: item.id, src } : null)}
            onDelete={props.onDelete}
          />
        )}
      </div>

      {/* Top bar */}
      <div
        data-chrome
        className={clsx(
          "absolute inset-x-0 top-0 z-10 flex h-12 items-center gap-1 bg-gradient-to-b from-black/70 to-transparent px-3",
          chromeCls
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 text-[12px]">
          <span className="font-semibold text-fg">{kindLabel(item)}</span>
          <span className="truncate text-fg-muted">{shortWhen(item.createdAt)}</span>
          {dims && <span className="font-mono text-fg-muted">{dims}</span>}
        </div>
        <span className="shrink-0 font-mono text-[12px] tabular-nums text-fg-muted">
          {index + 1} / {items.length}
        </span>
        <div className="flex flex-1 items-center justify-end gap-1">
          <IconBtn title="Copy (Enter)" onClick={() => void props.onCopy(item.id)}>
            <Copy size={16} />
          </IconBtn>
          <IconBtn
            title={isImageKind(item) ? "Annotate (E)" : "Trim (E)"}
            onClick={doEdit}
            disabled={!canEditImage}
          >
            {isImageKind(item) ? <Pencil size={16} /> : <Scissors size={16} />}
          </IconBtn>
          {isImageKind(item) && ocrAvailable && (
            <IconBtn title="Copy text (OCR)" onClick={() => void props.onExtractText(item.id)}>
              <ScanText size={16} />
            </IconBtn>
          )}
          {isFileKind && (
            <IconBtn
              title="Show in folder"
              onClick={() => {
                void revealItemInDir(item.content).catch((err) => props.onError(String(err)));
              }}
            >
              <FolderOpen size={16} />
            </IconBtn>
          )}
          <IconBtn
            title={item.isPinned ? "Unpin (P)" : "Pin (P)"}
            active={item.isPinned}
            onClick={() => props.onPin(item.id)}
          >
            <Pin size={16} className={item.isPinned ? "fill-current" : undefined} />
          </IconBtn>
          <IconBtn
            title={isClipFile ? "Remove from library, keep file (Del)" : "Delete (Del)"}
            danger
            onClick={() => props.onDelete(item.id)}
          >
            <Trash2 size={16} />
          </IconBtn>
          {isClipFile && (
            <IconBtn
              title="Delete file: move to Recycle Bin (Shift+Del)"
              danger
              onClick={() => props.onDeleteFile(item.id)}
            >
              <FileX size={16} />
            </IconBtn>
          )}
          <span className="mx-1 h-4 w-px bg-line-strong" />
          <IconBtn
            title={fs ? "Exit fullscreen (F)" : "Fullscreen (F)"}
            onClick={() => void toggleFullscreen()}
          >
            {fs ? <Minimize size={16} /> : <Maximize size={16} />}
          </IconBtn>
          <IconBtn title="Close (Esc)" onClick={props.onClose}>
            <X size={16} />
          </IconBtn>
        </div>
      </div>

      {hasPrev && (
        <button
          type="button"
          data-chrome
          title="Previous (←)"
          aria-label="Previous"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => go("prev")}
          className={clsx(
            "absolute left-3 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-raised/80 text-fg-secondary hover:bg-hover hover:text-fg",
            chromeCls
          )}
        >
          <ChevronLeft size={20} />
        </button>
      )}
      {hasNext && (
        <button
          type="button"
          data-chrome
          title="Next (→)"
          aria-label="Next"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => go("next")}
          className={clsx(
            "absolute right-3 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-raised/80 text-fg-secondary hover:bg-hover hover:text-fg",
            chromeCls
          )}
        >
          <ChevronRight size={20} />
        </button>
      )}
    </div>
  );
}
