import clsx from "clsx";
import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Pin,
  Link2,
  Type,
  Image as ImageIcon,
  Trash2,
  Copy,
  Code2,
} from "lucide-react";
import type { ClipboardItem } from "../lib/types";
import {
  codePreview,
  detectLanguage,
  isCodeSnippet,
  languageLabel,
} from "../lib/codeDetect";

const ROW_HEIGHT = 76;
const CODE_ROW_HEIGHT = 188;
const ROW_GAP = 12;

function formatTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function TypeIcon({ type, isCode }: { type: string; isCode?: boolean }) {
  if (isCode) return <Code2 size={14} />;
  if (type === "image") return <ImageIcon size={14} />;
  if (type === "link") return <Link2 size={14} />;
  return <Type size={14} />;
}

function thumbSrc(item: ClipboardItem): string | null {
  if (item.contentType !== "image") return null;
  if (item.preview?.startsWith("data:image")) return item.preview;
  if (item.content?.startsWith("data:image")) return item.content;
  return null;
}

interface Props {
  items: ClipboardItem[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onCopy: (id: number) => void;
  onPin: (id: number) => void;
  onDelete: (id: number) => void;
  onPreviewImage: (id: number) => void;
}

export function ClipboardList({
  items,
  selectedId,
  onSelect,
  onCopy,
  onPin,
  onDelete,
  onPreviewImage,
}: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const safeItems = Array.isArray(items) ? items : [];

  const virtualizer = useVirtualizer({
    count: safeItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      const item = safeItems[index];
      if (!item) return ROW_HEIGHT + ROW_GAP;
      const base = isCodeSnippet(item.content || item.preview, item.contentType)
        ? CODE_ROW_HEIGHT
        : ROW_HEIGHT;
      return base + ROW_GAP;
    },
    overscan: 8,
    gap: ROW_GAP,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [safeItems, virtualizer]);

  useEffect(() => {
    if (selectedId == null) return;
    const idx = safeItems.findIndex((i) => i.id === selectedId);
    if (idx >= 0) virtualizer.scrollToIndex(idx, { align: "auto" });
  }, [selectedId, safeItems, virtualizer]);

  if (safeItems.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
        <div className="rounded-lg border border-line bg-raised px-10 py-12">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-md bg-muted text-fg-muted">
            <Copy size={18} />
          </div>
          <p className="text-sm font-medium text-fg-secondary">No items yet</p>
          <p className="mt-1.5 max-w-[240px] text-[12px] leading-relaxed text-fg-muted">
            Copy text, links, or images — they'll appear here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3" role="listbox">
      <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map((row) => {
          const item = safeItems[row.index];
          if (!item) return null;

          const selected = item.id === selectedId;
          const thumb = thumbSrc(item);
          const textBody = item.content || item.preview || "";
          const lang = item.contentType === "text" ? detectLanguage(textBody) : "plain";
          const isCode = lang !== "plain";
          const isImage = item.contentType === "image";

          return (
            <div
              key={item.id}
              role="option"
              aria-selected={selected}
              data-index={row.index}
              ref={virtualizer.measureElement}
              className={clsx(
                "group absolute left-0 top-0 flex w-full cursor-pointer items-center gap-3.5 rounded-lg border p-3.5 transition-all",
                selected
                  ? "border-accent bg-accent-soft"
                  : "border-line bg-raised hover:border-line-strong hover:bg-hover"
              )}
              style={{ transform: `translateY(${row.start}px)` }}
              onClick={() => {
                onSelect(item.id);
                if (isImage) onPreviewImage(item.id);
              }}
              onDoubleClick={() => {
                if (!isImage) onCopy(item.id);
              }}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-muted text-fg-muted">
                {thumb ? (
                  <img
                    src={thumb}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <TypeIcon type={item.contentType} isCode={isCode} />
                )}
              </div>

              <div className="min-w-0 flex-1 pr-2">
                {isImage ? (
                  <p className="truncate text-xs font-medium text-fg-secondary">
                    {item.preview?.startsWith("data:")
                      ? "Screenshot — click to preview"
                      : item.preview || "Image"}
                  </p>
                ) : isCode ? (
                  <div className="my-0.5 overflow-hidden rounded-md border border-line bg-inset">
                    <div className="flex items-center justify-between border-b border-line bg-muted px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                      <span>{languageLabel(lang)}</span>
                      <span className="text-fg-faint">snippet</span>
                    </div>
                    <pre className="max-h-36 overflow-x-auto overflow-y-auto whitespace-pre-wrap p-2.5 font-mono text-xs leading-relaxed text-accent">
                      <code>{codePreview(textBody)}</code>
                    </pre>
                  </div>
                ) : (
                  <p className="truncate text-xs font-medium text-fg-secondary">
                    {item.preview || item.content}
                  </p>
                )}

                <div className="mt-1 flex items-center gap-2">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                    {isCode ? languageLabel(lang) : item.contentType}
                  </span>
                  <span className="text-[10px] text-fg-faint">•</span>
                  <span className="font-mono text-[10px] text-fg-faint">
                    {formatTime(item.createdAt)}
                  </span>
                  {item.isPinned && (
                    <>
                      <span className="text-[10px] text-fg-faint">•</span>
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-accent">
                        <Pin size={9} /> Pinned
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  type="button"
                  title="Pin"
                  className={clsx(
                    "rounded p-1.5 transition hover:bg-hover",
                    item.isPinned ? "text-accent" : "text-fg-muted hover:text-fg"
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPin(item.id);
                  }}
                >
                  <Pin size={13} />
                </button>
                <button
                  type="button"
                  title="Delete"
                  className="rounded p-1.5 text-fg-muted transition hover:bg-hover hover:text-danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(item.id);
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
