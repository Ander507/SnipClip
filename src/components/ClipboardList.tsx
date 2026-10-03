import { useCallback, useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Copy } from "lucide-react";
import type { ClipboardItem } from "../lib/types";
import type { Density, ThumbSize } from "../lib/uiPrefs";
import { detectLanguage } from "../lib/codeDetect";
import { useNow } from "../lib/itemMeta";
import { ClipboardItemRow } from "./ClipboardItemRow";
import { ClipboardGrid } from "./ClipboardGrid";
import { codeBlockHeight } from "./CodePreview";
import {
  HEADER_HEIGHT,
  LIST_PAD_Y,
  ROW_METRICS,
  SectionHeader,
  groupItems,
  isImageItem,
  isVideoItem,
  type RowMetrics,
} from "./itemParts";

/** Rough first-paint heights; real ones come from measuring each row. */
const TEXT_LINE_PX = 16;
const META_PX = 19;
const MATH_BODY_PX = 42;
const TRANSLATED_BODY_PX = 35;
const CHARS_PER_LINE = 60;

interface Props {
  items: ClipboardItem[];
  selectedId: number | null;
  hotkeySnip?: string;
  hotkeyPalette?: string;
  ocrAvailable?: boolean;
  /** Group rows under Pinned / Today / Yesterday / weekday / date headers. Default true. */
  groupByDay?: boolean;
  /** From UI prefs. Default "comfortable". */
  density?: Density;
  /** "grid" renders the items as a thumbnail grid (used for the Images / Screenshots tabs). Default "list". */
  view?: "list" | "grid";
  /** Grid tile size. Default "medium". */
  thumbSize?: ThumbSize;
  onSelect: (id: number) => void;
  onCopy: (id: number) => void;
  onCopyOriginal?: (id: number) => void;
  onCopyMathResult?: (id: number) => void;
  onExtractText: (id: number) => void;
  onPin: (id: number) => void;
  onDelete: (id: number) => void;
  onPreviewImage: (id: number) => void;
  onEditVideo?: (id: number) => void;
  onOpenLink: (url: string) => void;
  onUpdate: (id: number, content: string) => void;
}

export function ClipboardList({
  items,
  hotkeySnip = "Ctrl+Shift+S",
  hotkeyPalette = "Alt+C",
  groupByDay = true,
  density = "comfortable",
  view = "list",
  thumbSize = "medium",
  ocrAvailable = false,
  ...rest
}: Props) {
  const now = useNow();
  const safeItems = Array.isArray(items) ? items : [];

  if (safeItems.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
        <div className="rounded-lg border border-line bg-raised px-10 py-12">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-md bg-muted text-accent">
            <Copy size={18} />
          </div>
          <p className="text-sm font-medium text-fg-secondary">Your library is empty</p>
          <p className="mt-1.5 max-w-[280px] text-[12px] leading-relaxed text-fg-muted">
            Copy anything — text, links, or images — and it will show up here automatically.
          </p>
          <p className="mt-4 text-[11px] leading-relaxed text-fg-faint">
            {hotkeyPalette} quick paste · {hotkeySnip} snip a region
          </p>
        </div>
      </div>
    );
  }

  if (view === "grid") {
    return (
      <ClipboardGrid
        items={safeItems}
        now={now}
        groupByDay={groupByDay}
        thumbSize={thumbSize}
        ocrAvailable={ocrAvailable}
        selectedId={rest.selectedId}
        onSelect={rest.onSelect}
        onCopy={rest.onCopy}
        onExtractText={rest.onExtractText}
        onPin={rest.onPin}
        onDelete={rest.onDelete}
        onPreviewImage={rest.onPreviewImage}
        onEditVideo={rest.onEditVideo}
      />
    );
  }

  return (
    <ItemRows
      {...rest}
      items={safeItems}
      now={now}
      groupByDay={groupByDay}
      density={density}
      ocrAvailable={ocrAvailable}
    />
  );
}

type Row =
  | { kind: "header"; key: string; label: string }
  | { kind: "item"; key: number; item: ClipboardItem; dated: boolean };

function estimateItemHeight(item: ClipboardItem, m: RowMetrics): number {
  const body = item.content || item.preview || "";
  let lead = m.iconPx;
  let content: number;
  if (isImageItem(item)) {
    lead = m.thumbH;
    content = TEXT_LINE_PX;
  } else if (isVideoItem(item)) {
    content = TEXT_LINE_PX;
  } else if (item.contentType === "math") {
    content = MATH_BODY_PX;
  } else if (item.contentType === "translated") {
    content = TRANSLATED_BODY_PX;
  } else if (item.contentType === "text" && detectLanguage(body) !== "plain") {
    content = codeBlockHeight(body, m.codeLines) + 4;
  } else {
    const text = body.slice(0, 600).trim();
    const lines = Math.max(text.split("\n").length, Math.ceil(text.length / CHARS_PER_LINE));
    content = TEXT_LINE_PX * Math.min(m.lines, Math.max(1, lines));
  }
  // +2 for the card border.
  return Math.max(lead, content + META_PX) + m.padPx * 2 + 2;
}

function ItemRows({
  items,
  now,
  selectedId,
  groupByDay,
  density,
  ocrAvailable,
  onSelect,
  onCopy,
  onCopyOriginal,
  onCopyMathResult,
  onExtractText,
  onPin,
  onDelete,
  onPreviewImage,
  onEditVideo,
  onOpenLink,
  onUpdate,
}: Omit<Props, "hotkeySnip" | "hotkeyPalette" | "view" | "thumbSize"> & {
  now: number;
  groupByDay: boolean;
  density: Density;
  ocrAvailable: boolean;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const m = ROW_METRICS[density];
  // Day labels only move at midnight; don't regroup on every clock tick.
  const today = new Date(now).toDateString();

  const rows = useMemo(() => {
    const out: Row[] = [];
    for (const group of groupItems(items, groupByDay, now)) {
      if (group.label) out.push({ kind: "header", key: `h:${group.key}`, label: group.label });
      for (const item of group.items) {
        out.push({ kind: "item", key: item.id, item, dated: group.dated });
      }
    }
    return out;
  }, [items, groupByDay, today]);

  const estimates = useMemo(
    () => rows.map((row) => (row.kind === "header" ? HEADER_HEIGHT : estimateItemHeight(row.item, m))),
    [rows, m]
  );

  const rowIndexById = useMemo(() => {
    const map = new Map<number, number>();
    rows.forEach((row, i) => {
      if (row.kind === "item") map.set(row.item.id, i);
    });
    return map;
  }, [rows]);

  const getItemKey = useCallback((index: number) => rows[index]?.key ?? index, [rows]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    getItemKey,
    // The `gap` option spaces rows, so estimates are the card alone.
    estimateSize: (index) => estimates[index] ?? HEADER_HEIGHT,
    // offsetHeight ignores the UI-scale `zoom` on #root, matching the translateY space.
    measureElement: (el) => (el as HTMLElement).offsetHeight,
    overscan: 10,
    // Vertical padding lives in the virtualizer (not CSS) so scrollToIndex lands rows fully
    // in view instead of 12px under the edge.
    paddingStart: LIST_PAD_Y,
    paddingEnd: LIST_PAD_Y,
    scrollPaddingStart: LIST_PAD_Y,
    scrollPaddingEnd: LIST_PAD_Y,
    gap: m.rowGap,
  });

  // Follow the selection, and an item that moved (new clip on top, tab switch) — but not
  // every refresh, or a manual scroll would keep snapping back.
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
    // Moving up onto the first item of a group: bring its header along.
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
      <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index];
          if (!row) return null;
          const shift = row.kind === "header" ? m.headerShift : 0;

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
                <ClipboardItemRow
                  item={row.item}
                  selected={row.item.id === selectedId}
                  now={now}
                  underDayHeader={row.dated}
                  density={density}
                  ocrAvailable={ocrAvailable}
                  onSelect={() => onSelect(row.item.id)}
                  onCopy={() => onCopy(row.item.id)}
                  onCopyOriginal={onCopyOriginal ? () => onCopyOriginal(row.item.id) : undefined}
                  onCopyMathResult={
                    onCopyMathResult ? () => onCopyMathResult(row.item.id) : undefined
                  }
                  onExtractText={() => onExtractText(row.item.id)}
                  onPin={() => onPin(row.item.id)}
                  onDelete={() => onDelete(row.item.id)}
                  onPreviewImage={() => onPreviewImage(row.item.id)}
                  onEditVideo={onEditVideo ? () => onEditVideo(row.item.id) : undefined}
                  onOpenLink={onOpenLink}
                  onUpdate={onUpdate}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
