import clsx from "clsx";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Copy, Pencil, Pin, ScanText, Trash2 } from "lucide-react";
import type { ClipboardItem } from "../lib/types";
import { THUMB_PX, type ThumbSize } from "../lib/uiPrefs";
import { detectLanguage } from "../lib/codeDetect";
import { dimensionsLabel, sourceLabel } from "../lib/itemMeta";
import { parseMathContent } from "../lib/mathContent";
import { parseTranslatedContent } from "../lib/translatedContent";
import { useItemThumbnail } from "../lib/thumbnails";
import { displayUrl, isLinkItem } from "../lib/urls";
import {
  ActionButton,
  HEADER_HEIGHT,
  LIST_PAD_Y,
  SectionHeader,
  TypeIcon,
  coverEdge,
  groupItems,
  imageFallback,
  isImageItem,
  isVideoItem,
  itemTimeLabel,
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

  const minTile = THUMB_PX[thumbSize];
  const cols = Math.max(1, Math.floor((width + GAP) / (minTile + GAP)));
  const tileW = width > 0 ? Math.floor((width - GAP * (cols - 1)) / cols) : minTile;
  const tileRowH = Math.round((tileW - 2) * 0.75) + TILE_CHROME_PX;
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
  const dims = dimensionsLabel(item);
  const source = sourceLabel(item);
  const time = itemTimeLabel(item.createdAt, now, underDayHeader);
  const isCode =
    item.contentType === "text" && detectLanguage(item.content || item.preview) !== "plain";
  const snippet = isImage ? "" : tileSnippet(item);
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
        "group relative cursor-pointer overflow-hidden rounded-lg border bg-raised transition-colors",
        selected
          ? "border-accent ring-1 ring-accent"
          : "border-line hover:border-line-strong hover:bg-hover"
      )}
      onClick={onSelect}
      onDoubleClick={() => {
        if (isImage) onPreviewImage();
        else if (isVideo) onEditVideo?.();
        else onCopy();
      }}
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-inset">
        {isImage && src ? (
          <img
            src={src}
            alt=""
            draggable={false}
            decoding="async"
            className="h-full w-full object-cover"
          />
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

        <div
          className={clsx(
            "absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded-md border border-line bg-raised/95 p-0.5 shadow-sm transition-opacity",
            selected
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100"
          )}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <ActionButton title="Copy" small onClick={onCopy}>
            <Copy size={12} />
          </ActionButton>
          {isImage && ocrAvailable && (
            <ActionButton title="Copy Text (OCR)" small onClick={onExtractText}>
              <ScanText size={12} />
            </ActionButton>
          )}
          {isVideo && onEditVideo && (
            <ActionButton title="Edit recording" small onClick={onEditVideo}>
              <Pencil size={12} />
            </ActionButton>
          )}
          <ActionButton
            title={item.isPinned ? "Unpin" : "Pin"}
            tone="neutral"
            active={item.isPinned}
            small
            onClick={onPin}
          >
            <Pin size={12} />
          </ActionButton>
          <ActionButton title="Delete" tone="danger" small onClick={onDelete}>
            <Trash2 size={12} />
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
        {dims ? (
          <span className="ml-auto shrink-0 font-mono text-fg-faint">{dims}</span>
        ) : source ? (
          <span className="ml-auto min-w-0 truncate text-fg-faint">{source}</span>
        ) : null}
      </div>
    </div>
  );
}
