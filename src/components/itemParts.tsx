import type { MouseEvent, ReactNode } from "react";
import clsx from "clsx";
import { Code2, Film, Image as ImageIcon, Languages, Link2, Sigma, Type } from "lucide-react";
import type { ClipboardItem } from "../lib/types";
import type { Density } from "../lib/uiPrefs";
import { dayLabel, relativeTime, shortWhen } from "../lib/itemMeta";

export function isImageItem(item: Pick<ClipboardItem, "contentType">): boolean {
  return item.contentType === "image" || item.contentType === "screenshot";
}

export function isVideoItem(item: Pick<ClipboardItem, "contentType">): boolean {
  return item.contentType === "video" || item.contentType === "gif";
}

/** `0:07` / `1:02:03`. */
export function formatDuration(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

function baseName(path: string | null | undefined): string {
  return (path || "").replace(/\\/g, "/").split("/").pop() ?? "";
}

/** `GIF`, `Replay` (saved replay buffer) or `Recording`. */
export function videoKindLabel(item: Pick<ClipboardItem, "contentType" | "content">): string {
  if (item.contentType === "gif") return "GIF";
  const name = baseName(item.content);
  return name.startsWith("SnipClip Replay") ? "Replay" : "Recording";
}

/** File name of a video item's path. */
export function videoFileName(item: Pick<ClipboardItem, "content" | "preview">): string {
  const name = baseName(item.content);
  return name || (item.preview || "").replace(/^video:\s*/, "");
}

/** The stored 64 px preview, shown until the crisp thumbnail arrives. */
export function imageFallback(item: ClipboardItem): string | null {
  if (!isImageItem(item)) return null;
  if (item.preview?.startsWith("data:image")) return item.preview;
  if (item.content?.startsWith("data:image")) return item.content;
  return null;
}

/**
 * Long edge to request so `object-cover` fills a `boxW`×`boxH` frame without upscaling —
 * a tall screenshot is cropped to the frame's width, so its long edge must be bigger.
 */
export function coverEdge(item: ClipboardItem, boxW: number, boxH: number): number {
  const { width: w, height: h } = item;
  if (!w || !h) return Math.max(boxW, boxH);
  const long = Math.max(w, h);
  return Math.ceil(Math.max((boxW * long) / w, (boxH * long) / h));
}

/**
 * Long edge to request so an image shown whole (`object-contain`) in a `boxW`×`boxH` frame
 * is sharp without upscaling.
 */
export function containEdge(item: ClipboardItem, boxW: number, boxH: number): number {
  const { width: w, height: h } = item;
  if (!w || !h) return Math.max(boxW, boxH);
  return Math.ceil(Math.max(w, h) * Math.min(boxW / w, boxH / h));
}

/** Hover/keyboard-focus reveal for secondary action clusters (children of a `group`). */
export const REVEAL_ON_HOVER =
  "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100";

export function TypeIcon({
  type,
  isCode,
  size = 14,
}: {
  type: string;
  isCode?: boolean;
  size?: number;
}) {
  if (isCode) return <Code2 size={size} />;
  if (type === "image" || type === "screenshot") return <ImageIcon size={size} />;
  if (type === "video" || type === "gif") return <Film size={size} />;
  if (type === "link") return <Link2 size={size} />;
  if (type === "math") return <Sigma size={size} />;
  if (type === "translated") return <Languages size={size} />;
  return <Type size={size} />;
}

/**
 * Under a day header the day is already said ("5m ago" / "14:08"); elsewhere (Pinned group,
 * ungrouped lists) the label has to carry it ("Yesterday", "Sep 14").
 */
export function itemTimeLabel(iso: string, now: number, underDayHeader: boolean): string {
  return underDayHeader ? relativeTime(iso, now) : shortWhen(iso, now);
}

export interface ItemGroup {
  key: string;
  /** Null when grouping is off — render no header. */
  label: string | null;
  /** The header names a day, so item times can drop it. */
  dated: boolean;
  items: ClipboardItem[];
}

/**
 * Items arrive pinned-first, then newest-first: the leading pinned run becomes "Pinned",
 * everything after splits on day label.
 */
export function groupItems(items: ClipboardItem[], groupByDay: boolean, now: number): ItemGroup[] {
  if (!groupByDay) return [{ key: "all", label: null, dated: false, items }];
  const groups: ItemGroup[] = [];
  const seen = new Map<string, number>();
  let leadingPinned = true;
  for (const item of items) {
    const inPinned = leadingPinned && item.isPinned;
    if (!item.isPinned) leadingPinned = false;
    const label = inPinned ? "Pinned" : dayLabel(item.createdAt, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.items.push(item);
      continue;
    }
    const n = (seen.get(label) ?? 0) + 1;
    seen.set(label, n);
    groups.push({
      key: n === 1 ? label : `${label}#${n}`,
      label,
      dated: !inPinned,
      items: [item],
    });
  }
  return groups;
}

export function SectionHeader({ label }: { label: string }) {
  return (
    <div
      role="presentation"
      className="flex h-4 items-end px-1 text-[10px] font-semibold uppercase leading-none tracking-wider text-fg-muted"
    >
      {label}
    </div>
  );
}

/** Rendered height of `SectionHeader`. */
export const HEADER_HEIGHT = 16;

/** Space above the first and below the last row of the scrolling list. */
export const LIST_PAD_Y = 12;

export interface RowMetrics {
  pad: string;
  gap: string;
  iconBox: string;
  padPx: number;
  iconPx: number;
  /** Width of the leading icon/thumbnail column, so text lines up across every card type. */
  leadW: number;
  thumbW: number;
  thumbH: number;
  /** Space between the content and its meta line. */
  metaGap: string;
  metaGapPx: number;
  /** Plain-text preview lines. */
  lines: 1 | 2 | 3;
  codeLines: number;
  /** Space between cards. */
  rowGap: number;
  /** Pulls a day header toward the group it labels. */
  headerShift: number;
}

export const ROW_METRICS: Record<Density, RowMetrics> = {
  compact: {
    pad: "px-2.5 py-2",
    gap: "gap-2.5",
    iconBox: "h-8 w-8",
    padPx: 8,
    iconPx: 32,
    leadW: 48,
    thumbW: 48,
    thumbH: 36,
    metaGap: "mt-0.5",
    metaGapPx: 2,
    lines: 1,
    codeLines: 3,
    rowGap: 6,
    headerShift: 2,
  },
  comfortable: {
    pad: "p-3.5",
    gap: "gap-3.5",
    iconBox: "h-10 w-10",
    padPx: 14,
    iconPx: 40,
    leadW: 64,
    thumbW: 64,
    thumbH: 48,
    metaGap: "mt-1",
    metaGapPx: 4,
    lines: 2,
    codeLines: 6,
    rowGap: 12,
    headerShift: 4,
  },
  spacious: {
    pad: "p-4",
    gap: "gap-4",
    iconBox: "h-12 w-12",
    padPx: 16,
    iconPx: 48,
    leadW: 80,
    thumbW: 80,
    thumbH: 60,
    metaGap: "mt-1.5",
    metaGapPx: 6,
    lines: 3,
    codeLines: 10,
    rowGap: 16,
    headerShift: 6,
  },
};

export function ActionButton({
  title,
  onClick,
  tone = "accent",
  active = false,
  small: _small = false,
  children,
}: {
  title: string;
  onClick: () => void;
  /** Hover colour: accent for most actions, danger for delete, plain for pin/cancel. */
  tone?: "accent" | "danger" | "neutral";
  /** Highlighted state (e.g. already pinned). */
  active?: boolean;
  /** Accepted for call-site compatibility; the hit area is always 28×28 px. */
  small?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      className={clsx(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-hover",
        active
          ? "text-accent"
          : clsx(
              "text-fg-muted",
              tone === "danger" && "hover:text-danger",
              tone === "neutral" && "hover:text-fg",
              tone === "accent" && "hover:text-accent"
            )
      )}
      onClick={(e: MouseEvent) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

export interface MetaPart {
  key: string;
  node: ReactNode;
  /** Let this part give up width (its node should `truncate`). */
  shrink?: boolean;
}

/** Small "a · b · c" line; null/false parts are skipped. */
export function MetaLine({
  parts,
  className,
}: {
  parts: (MetaPart | null | false)[];
  className?: string;
}) {
  const shown = parts.filter((p): p is MetaPart => !!p);
  return (
    <div
      className={clsx(
        "flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-[11px] leading-4 text-fg-muted",
        className
      )}
    >
      {shown.map((part, i) => (
        <span
          key={part.key}
          className={clsx("flex items-center gap-1.5", part.shrink ? "min-w-0" : "shrink-0")}
        >
          {i > 0 && (
            <span aria-hidden className="text-fg-faint">
              ·
            </span>
          )}
          {part.node}
        </span>
      ))}
    </div>
  );
}
