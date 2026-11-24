import clsx from "clsx";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { convertFileSrc } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Copy, Film, FolderOpen, Maximize2, Pencil, Pin, Play, ScanText, Trash2 } from "lucide-react";
import type { ClipboardItem } from "../lib/types";
import { THUMB_PX, type ThumbSize } from "../lib/uiPrefs";
import { detectLanguage } from "../lib/codeDetect";
import { dimensionsLabel, sourceLabel } from "../lib/itemMeta";
import { parseMathContent } from "../lib/mathContent";
import { parseTranslatedContent } from "../lib/translatedContent";
import { useItemThumbnail, useVideoPoster } from "../lib/thumbnails";
import { displayUrl, isLinkItem } from "../lib/urls";
import {
  ActionButton,
  HEADER_HEIGHT,
  LIST_PAD_Y,
  SectionHeader,
  TypeIcon,
  coverEdge,
  formatDuration,
  groupItems,
  imageFallback,
  isImageItem,
  isVideoItem,
  itemTimeLabel,
  videoKindLabel,
} from "./itemParts";

const GAP = 12;
const HEADER_SHIFT = 4;
/** Footer (py-1.5 + a 15px line + its top border) plus the tile's own border. */
const TILE_CHROME_PX = 30;

interface Props {
  items: ClipboardItem[];
  selectedId: number | null;
  now: number;
  groupByDay: boolean;
  thumbSize: ThumbSize;
  ocrAvailable: boolean;
  onSelect: (id: number) => void;
  onCopy: (id: number) => void;
  onExtractText: (id: number) => void;
  onPin: (id: number) => void;
  onDelete: (id: number) => void;
  onPreviewImage: (id: number) => void;
  onEditVideo?: (id: number) => void;
}

type GridRow =
  | { kind: "header"; key: string; label: string }
  | { kind: "tiles"; key: string; items: ClipboardItem[]; dated: boolean };

export function ClipboardGrid({
  items,
  selectedId,
  now,
  groupByDay,
  thumbSize,
  ocrAvailable,
  onSelect,
  onCopy,
  onExtractText,
  onPin,
  onDelete,
  onPreviewImage,
  onEditVideo,
}: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const sizerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = sizerRef.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // A grid of nothing but clips gets 16:9 posters and wider tiles; mixed grids stay 4:3.
  const wide = useMemo(() => items.length > 0 && items.every(isVideoItem), [items]);
  const ratio = wide ? 9 / 16 : 3 / 4;
  const minTile = Math.round(THUMB_PX[thumbSize] * (wide ? 1.4 : 1));
  const cols = Math.max(1, Math.floor((width + GAP) / (minTile + GAP)));
  const tileW = width > 0 ? Math.floor((width - GAP * (cols - 1)) / cols) : minTile;
  const tileRowH = Math.round((tileW - 2) * ratio) + TILE_CHROME_PX;
  const today = new Date(now).toDateString();

  const rows = useMemo(() => {
    const out: GridRow[] = [];
    for (const group of groupItems(items, groupByDay, now)) {
      if (group.label) out.push({ kind: "header", key: `h:${group.key}`, label: group.label });
      for (let i = 0; i < group.items.length; i += cols) {
        out.push({
          kind: "tiles",
          key: `${group.key}:${cols}:${i / cols}`,
          items: group.items.slice(i, i + cols),
          dated: group.dated,
        });
      }
    }
    return out;
  }, [items, groupByDay, today, cols]);

  const rowIndexById = useMemo(() => {
    const map = new Map<number, number>();
    rows.forEach((row, i) => {
      if (row.kind === "tiles") for (const item of row.items) map.set(item.id, i);
    });
    return map;
  }, [rows]);

  const getItemKey = useCallback((index: number) => rows[index]?.key ?? index, [rows]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    getItemKey,
    estimateSize: (index) => (rows[index]?.kind === "header" ? HEADER_HEIGHT : tileRowH),
    measureElement: (el) => (el as HTMLElement).offsetHeight,
    overscan: 4,
    paddingStart: LIST_PAD_Y,
    paddingEnd: LIST_PAD_Y,
    scrollPaddingStart: LIST_PAD_Y,
    scrollPaddingEnd: LIST_PAD_Y,
    gap: GAP,
  });

  // Arrow Up/Down move by one visual row (same column), across day headers. Capture phase so
  // it runs before App's one-item-sideways handler.
  const nav = useRef({ rows, rowIndexById, selectedId, onSelect });
  nav.current = { rows, rowIndexById, selectedId, onSelect };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      // Leave arrows to text fields, selects and sliders; only the main search box keeps grid nav
      // (identified by its placeholder, since SearchBar owns the element).
      const t = e.target as HTMLElement | null;
      if (t?.tagName === "TEXTAREA" || t?.tagName === "SELECT" || t?.isContentEditable) return;
      if (t?.tagName === "INPUT" && !(t as HTMLInputElement).placeholder.startsWith("Search clips")) return;
      if (document.querySelector("[data-media-viewer],[data-snip-editor]")) return;
      const { rows: r, rowIndexById: byId, selectedId: sel, onSelect: select } = nav.current;
      if (sel == null) return;
      const rowIndex = byId.get(sel);
      const current = rowIndex == null ? undefined : r[rowIndex];
      if (rowIndex == null || current?.kind !== "tiles") return;
      const col = current.items.findIndex((it) => it.id === sel);
      const step = e.key === "ArrowDown" ? 1 : -1;
      let i = rowIndex + step;
      while (r[i] && r[i].kind !== "tiles") i += step;
      e.preventDefault();
      e.stopPropagation();
      const target = r[i];
      if (target?.kind !== "tiles") return;
      const next = target.items[Math.min(col, target.items.length - 1)];
      if (next) select(next.id);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const lastScrolled = useRef<{ id: number; index: number } | null>(null);
  useEffect(() => {
    if (selectedId == null) return;
    const index = rowIndexById.get(selectedId);
    if (index == null) return;
    const last = lastScrolled.current;
    if (last && last.id === selectedId && last.index === index) return;
    lastScrolled.current = { id: selectedId, index };
    const above = rows[index - 1];
    const start = virtualizer.measurementsCache[index]?.start;
    if (above?.kind === "header" && start != null && start < (virtualizer.scrollOffset ?? 0)) {
      virtualizer.scrollToIndex(index - 1, { align: "start" });
    } else {
      virtualizer.scrollToIndex(index, { align: "auto" });
    }
  }, [selectedId, rowIndexById, rows, virtualizer]);

  return (
    <div
      ref={parentRef}
      className="min-h-0 flex-1 overflow-y-auto px-4"
      role="listbox"
      aria-label="Clipboard history"
    >
      <div
        ref={sizerRef}
        className="relative w-full"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index];
          if (!row) return null;
          const shift = row.kind === "header" ? HEADER_SHIFT : 0;

          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 top-0 w-full"
              style={{ transform: `translateY(${virtualRow.start + shift}px)` }}
            >
              {row.kind === "header" ? (
                <SectionHeader label={row.label} />
              ) : (
                <div
                  className="grid"
                  style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: GAP }}
                >
                  {row.items.map((item) => (
                    <GridTile
                      key={item.id}
                      item={item}
                      selected={item.id === selectedId}
                      now={now}
                      underDayHeader={row.dated}
                      tileW={tileW}
                      ratio={ratio}
                      ocrAvailable={ocrAvailable}
                      onSelect={() => onSelect(item.id)}
                      onCopy={() => onCopy(item.id)}
                      onExtractText={() => onExtractText(item.id)}
                      onPin={() => onPin(item.id)}
                      onDelete={() => onDelete(item.id)}
                      onPreviewImage={() => onPreviewImage(item.id)}
                      onEditVideo={onEditVideo ? () => onEditVideo(item.id) : undefined}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function tileSnippet(item: ClipboardItem): string {
  if (isVideoItem(item)) {
    return item.preview || (item.contentType === "gif" ? "GIF recording" : "Video recording");
  }
  if (isImageItem(item)) return "";
  const body = item.content || item.preview || "";
  if (item.contentType === "math") {
    return parseMathContent(item.content || "", item.preview || "").expression;
  }
  if (item.contentType === "translated") return parseTranslatedContent(body).translated;
  if (isLinkItem(item.contentType, body)) return displayUrl(body);
  return body.slice(0, 240).trim();
}

interface TileProps {
  item: ClipboardItem;
  selected: boolean;
  now: number;
  underDayHeader: boolean;
  tileW: number;
  ratio: number;
  ocrAvailable: boolean;
  onSelect: () => void;
  onCopy: () => void;
  onExtractText: () => void;
  onPin: () => void;
  onDelete: () => void;
  onPreviewImage: () => void;
  onEditVideo?: () => void;
}

function GridTile({
  item,
  selected,
  now,
  underDayHeader,
  tileW,
  ratio,
  ocrAvailable,
  onSelect,
  onCopy,
  onExtractText,
  onPin,
  onDelete,
  onPreviewImage,
  onEditVideo,
}: TileProps) {
  const isImage = isImageItem(item);
  const isVideo = isVideoItem(item);
  const frameW = tileW - 2;
  const src = useItemThumbnail(
    item.id,
    coverEdge(item, frameW, Math.round(frameW * 0.75)),
    imageFallback(item),
    isImage
  );
  const poster = useVideoPoster(item.content, isVideo);
  const [hovering, setHovering] = useState(false);
  const hoverTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);
  const dims = dimensionsLabel(item);
  const source = sourceLabel(item);
  const time = itemTimeLabel(item.createdAt, now, underDayHeader);
  const isCode =
    item.contentType === "text" && detectLanguage(item.content || item.preview) !== "plain";
  const snippet = isImage || isVideo ? "" : tileSnippet(item);
  const isGif = item.contentType === "gif";
  const kind =
    item.contentType === "screenshot"
      ? "Screenshot"
      : isImage
        ? "Image"
        : isVideo
          ? "Recording"
          : "Clip";

  return (
    <div
      role="option"
      aria-selected={selected}
      aria-label={[kind, dims, source && `from ${source}`, time].filter(Boolean).join(", ")}
      className={clsx(
        "group relative cursor-pointer overflow-hidden rounded-xl border bg-raised transition-colors",
        selected
          ? "border-accent ring-2 ring-accent/50"
          : "border-line hover:border-line-strong hover:bg-hover"
      )}
      onClick={onSelect}
      onDoubleClick={() => {
        if (isImage || isVideo) onPreviewImage();
        else onCopy();
      }}
      onMouseEnter={() => {
        if (!isVideo) return;
        window.clearTimeout(hoverTimer.current);
        hoverTimer.current = window.setTimeout(() => setHovering(true), 250);
      }}
      onMouseLeave={() => {
        window.clearTimeout(hoverTimer.current);
        setHovering(false);
      }}
    >
      <div
        className={clsx(
          "relative w-full overflow-hidden bg-inset",
          ratio < 0.7 ? "aspect-video" : "aspect-[4/3]"
        )}
      >
        {isImage && src ? (
          <img
            src={src}
            alt=""
            draggable={false}
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : isVideo ? (
          poster.src ? (
            <img
              src={poster.src}
              alt=""
              draggable={false}
              decoding="async"
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-fg-muted">
              <Film size={20} />
              {poster.failed && <span className="text-[10px] text-fg-faint">No preview</span>}
            </div>
          )
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-3 text-fg-muted">
            <TypeIcon type={item.contentType} isCode={isCode} size={18} />
            {snippet && (
              <p
                className={clsx(
                  "line-clamp-3 w-full whitespace-pre-wrap break-words text-[11px] leading-snug text-fg-secondary",
                  isCode ? "font-mono" : "text-center"
                )}
              >
                {snippet}
              </p>
            )}
          </div>
        )}

        {isVideo && hovering && <HoverPreview path={item.content} gif={isGif} />}

        {isVideo && (
          <>
            {isGif && (
              <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded-md bg-black/65 px-1.5 py-0.5 font-mono text-[10px] font-medium text-white">
                GIF
              </span>
            )}
            {poster.durationSec != null && (
              <span className="pointer-events-none absolute bottom-1.5 right-1.5 rounded-md bg-black/65 px-1.5 py-0.5 font-mono text-[10px] font-medium tabular-nums text-white">
                {formatDuration(poster.durationSec)}
              </span>
            )}
            <button
              type="button"
              title="Play"
              aria-label="Play"
              className={clsx(
                "absolute left-1/2 top-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white transition hover:bg-black/75",
                selected
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              )}
              onClick={(e) => {
                e.stopPropagation();
                onPreviewImage();
              }}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              <Play size={16} fill="currentColor" />
            </button>
          </>
        )}

        <div
          className={clsx(
            "absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded-md border border-line bg-raised/95 p-0.5 shadow-sm transition-opacity",
            selected
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100"
          )}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {isImage && (
            <ActionButton title="Open" small onClick={onPreviewImage}>
              <Maximize2 size={14} />
            </ActionButton>
          )}
          <ActionButton title="Copy" small onClick={onCopy}>
            <Copy size={14} />
          </ActionButton>
          {isImage && ocrAvailable && (
            <ActionButton title="Copy Text (OCR)" small onClick={onExtractText}>
              <ScanText size={14} />
            </ActionButton>
          )}
          {isVideo && onEditVideo && (
            <ActionButton title="Edit recording" small onClick={onEditVideo}>
              <Pencil size={14} />
            </ActionButton>
          )}
          {isVideo && (
            <ActionButton
              title="Show in folder"
              small
              onClick={() => {
                revealItemInDir(item.content).catch((err) => console.error(err));
              }}
            >
              <FolderOpen size={14} />
            </ActionButton>
          )}
          <ActionButton
            title={item.isPinned ? "Unpin" : "Pin"}
            tone="neutral"
            active={item.isPinned}
            small
            onClick={onPin}
          >
            <Pin size={14} />
          </ActionButton>
          <ActionButton
            title={isVideo ? "Remove from library (file kept · Shift+Del deletes it)" : "Delete"}
            tone="danger"
            small
            onClick={onDelete}
          >
            <Trash2 size={14} />
          </ActionButton>
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-1.5 border-t border-line px-2 py-1.5 text-[10px] leading-[15px]">
        {item.isPinned && <Pin size={9} className="shrink-0 text-accent" aria-label="Pinned" />}
        <time
          dateTime={item.createdAt}
          title={new Date(item.createdAt).toLocaleString()}
          className="min-w-0 truncate font-mono text-fg-muted"
        >
          {time}
        </time>
        {isVideo ? (
          <span className="ml-auto shrink-0 text-fg-faint">{videoKindLabel(item)}</span>
        ) : dims ? (
          <span className="ml-auto shrink-0 font-mono text-fg-faint">{dims}</span>
        ) : source ? (
          <span className="ml-auto min-w-0 truncate text-fg-faint">{source}</span>
        ) : null}
      </div>
    </div>
  );
}

/** Muted looping preview over the poster. Releases the file on unmount (WebView2 file lock). */
function HoverPreview({ path, gif }: { path: string; gif: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const src = convertFileSrc(path);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    // StrictMode re-runs effects: put the source back if the simulated unmount released it.
    if (v.getAttribute("src") !== src) v.src = src;
    v.muted = true;
    void v.play().catch(() => {});
    return () => {
      v.pause();
      v.removeAttribute("src");
      v.load();
    };
  }, [src]);

  if (gif) {
    return (
      <img
        src={src}
        alt=""
        draggable={false}
        className="pointer-events-none absolute inset-0 h-full w-full object-cover"
      />
    );
  }

  return (
    <>
      <video
        ref={videoRef}
        src={src}
        muted
        loop
        playsInline
        preload="auto"
        className={clsx(
          "pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-200",
          playing ? "opacity-100" : "opacity-0"
        )}
        onPlaying={() => setPlaying(true)}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          if (barRef.current && v.duration > 0) {
            barRef.current.style.width = `${(v.currentTime / v.duration) * 100}%`;
          }
        }}
      />
      {playing && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-black/30">
          <div ref={barRef} className="h-full w-0 bg-accent" />
        </div>
      )}
    </>
  );
}
