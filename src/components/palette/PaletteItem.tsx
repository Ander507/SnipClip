import type { MouseEvent } from "react";
import clsx from "clsx";
import { Image as ImageIcon, Link2, Pin, Sigma, Type } from "lucide-react";
import type { ClipboardItem } from "../../lib/types";
import { parseMathContent } from "../../lib/mathContent";
import { dimensionsLabel, shortWhen, sourceLabel } from "../../lib/itemMeta";
import { useItemThumbnail } from "../../lib/thumbnails";

export function isImageItem(item: ClipboardItem): boolean {
  return item.contentType === "image" || item.contentType === "screenshot";
}

/** "Screenshot · 1920×1080", "Image from Chrome · 640×480". */
function imageTitle(item: ClipboardItem): string {
  const kind = item.contentType === "screenshot" ? "Screenshot" : "Image";
  const source = sourceLabel(item);
  return [source ? `${kind} from ${source}` : kind, dimensionsLabel(item)]
    .filter(Boolean)
    .join(" · ");
}

function resultLabel(item: ClipboardItem): string {
  if (isImageItem(item)) return imageTitle(item);
  if (item.contentType === "math") {
    const { expression } = parseMathContent(item.content || "", item.preview || "");
    return expression || item.preview || item.content || "Equation";
  }
  return item.preview || item.content || "Untitled";
}

function TypeBadge({ type }: { type: string }) {
  if (type === "image" || type === "screenshot") {
    return <ImageIcon size={16} className="shrink-0 text-fg-muted" />;
  }
  if (type === "link") {
    return <Link2 size={16} className="shrink-0 text-fg-muted" />;
  }
  if (type === "math") {
    return <Sigma size={16} className="shrink-0 text-fg-muted" />;
  }
  return <Type size={16} className="shrink-0 text-fg-muted" />;
}

/**
 * Longest edge the thumbnail needs so `object-cover` fills the card without upscaling —
 * a tall screenshot is cropped to the card's width, so its long edge must be much bigger.
 */
function coverEdge(cardW: number, cardH: number, item: ClipboardItem): number {
  const { width: w, height: h } = item;
  if (!w || !h) return cardW;
  const long = Math.max(w, h);
  return Math.ceil(Math.max((cardW * long) / w, (cardH * long) / h));
}

export interface PaletteItemProps {
  item: ClipboardItem;
  index: number;
  selected: boolean;
  /** Position in the pick list, or -1. */
  pickOrder: number;
  showImages: boolean;
  /** On-screen card width in px — sizes the image thumbnail request. */
  cardWidth: number;
  now: number;
  onHover: () => void;
  onClick: (e: MouseEvent) => void;
  onTogglePin: (e: MouseEvent) => void;
}

export function PaletteItem({
  item,
  index,
  selected,
  pickOrder,
  showImages,
  cardWidth,
  now,
  onHover,
  onClick,
  onTogglePin,
}: PaletteItemProps) {
  const isImage = isImageItem(item);
  const dataPreview = item.preview?.startsWith("data:image") ? item.preview : null;
  const thumb = useItemThumbnail(
    item.id,
    coverEdge(cardWidth, (cardWidth * 10) / 16, item),
    dataPreview,
    isImage && showImages
  );
  const asCard = isImage && showImages && thumb !== null;

  const math =
    item.contentType === "math"
      ? parseMathContent(item.content || "", item.preview || "")
      : null;
  const when = shortWhen(item.createdAt, now);
  // Image rows already name their source in the title.
  const meta = [when, isImage ? null : sourceLabel(item)].filter(Boolean).join(" · ");
  const chip = [when, dimensionsLabel(item)].filter(Boolean).join(" · ");

  return (
    <div
      data-index={index}
      role="button"
      tabIndex={-1}
      className={clsx(
        "group relative w-full cursor-pointer overflow-hidden rounded-xl border text-left transition",
        pickOrder >= 0
          ? "border-accent/60 bg-accent-soft ring-1 ring-accent/40"
          : selected
            ? "border-line-strong bg-hover ring-1 ring-line-strong"
            : "border-line bg-muted hover:border-line-strong hover:bg-hover"
      )}
      onMouseEnter={onHover}
      onClick={onClick}
    >
      {asCard ? (
        <div className="relative aspect-[16/10] w-full bg-inset">
          <img
            src={thumb}
            alt={imageTitle(item)}
            draggable={false}
            className="h-full w-full object-cover"
          />
          {chip && (
            <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded border border-line bg-raised/90 px-1 text-[9.5px] leading-4 text-fg-muted backdrop-blur-sm">
              {chip}
            </span>
          )}
        </div>
      ) : (
        <div className="flex gap-2.5 px-3 py-2.5">
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-inset text-fg-muted">
            <TypeBadge type={item.contentType} />
          </div>
          <div className="min-w-0 flex-1">
            <p
              className={clsx(
                "text-[12.5px] leading-snug text-fg-secondary",
                isImage ? "truncate" : "whitespace-pre-wrap break-words line-clamp-4"
              )}
            >
              {resultLabel(item)}
            </p>
            {math?.result && (
              <p className="mt-1 font-mono text-[11px] text-accent">= {math.result}</p>
            )}
            {meta && <p className="mt-0.5 truncate pr-5 text-[10px] text-fg-faint">{meta}</p>}
          </div>
        </div>
      )}

      {pickOrder >= 0 ? (
        <span className="absolute left-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-accent-fg">
          {pickOrder + 1}
        </span>
      ) : (
        index < 9 && (
          <span className="pointer-events-none absolute left-1.5 top-1.5 rounded border border-line bg-raised/90 px-1 font-mono text-[9px] text-fg-muted opacity-0 transition group-hover:opacity-100">
            Alt+{index + 1}
          </span>
        )
      )}

      <div className="absolute bottom-1.5 right-1.5 flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
        <button
          type="button"
          title={item.isPinned ? "Unpin" : "Pin"}
          className={clsx(
            "rounded-md border border-line bg-raised/90 p-1 backdrop-blur-sm transition hover:bg-hover",
            item.isPinned ? "text-accent opacity-100" : "text-fg-secondary"
          )}
          style={item.isPinned ? { opacity: 1 } : undefined}
          onClick={onTogglePin}
        >
          <Pin size={12} fill={item.isPinned ? "currentColor" : "none"} />
        </button>
      </div>
      {item.isPinned && (
        <Pin
          size={11}
          className="pointer-events-none absolute bottom-2 right-2 text-accent group-hover:opacity-0"
          fill="currentColor"
        />
      )}
    </div>
  );
}
