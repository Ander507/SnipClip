import { useCallback, useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Copy } from "lucide-react";
import type { ClipboardItem } from "../lib/types";
import { isCodeSnippet } from "../lib/codeDetect";
import { ClipboardItemRow } from "./ClipboardItemRow";

const ROW_HEIGHT = 76;
const CODE_ROW_HEIGHT = 188;
const ROW_GAP = 12;
const EDIT_BASE_HEIGHT = 72;
const EDIT_LINE_HEIGHT = 22;

interface Props {
  items: ClipboardItem[];
  selectedId: number | null;
  ocrAvailable?: boolean;
  onSelect: (id: number) => void;
  onCopy: (id: number) => void;
  onExtractText: (id: number) => void;
  onPin: (id: number) => void;
  onDelete: (id: number) => void;
  onPreviewImage: (id: number) => void;
  onOpenLink: (url: string) => void;
  onUpdate: (id: number, content: string) => void;
}

export function ClipboardList({
  items,
  selectedId,
  ocrAvailable = false,
  onSelect,
  onCopy,
  onExtractText,
  onPin,
  onDelete,
  onPreviewImage,
  onOpenLink,
  onUpdate,
}: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const safeItems = Array.isArray(items) ? items : [];
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editLines, setEditLines] = useState(2);

  const handleEditLayout = useCallback((id: number, editing: boolean, lines: number) => {
    setEditingId(editing ? id : null);
    setEditLines(Math.min(8, Math.max(2, lines)));
  }, []);

  // swapping out old image buttons for crisp native tailwind svg icons to make the UI feel instantly responsive
  const virtualizer = useVirtualizer({
    count: safeItems.length,
    getScrollElement: () => parentRef.current,
    getItemKey: (index) => safeItems[index]?.id ?? index,
    estimateSize: (index) => {
      const item = safeItems[index];
      if (!item) return ROW_HEIGHT + ROW_GAP;
      if (item.id === editingId) {
        return EDIT_BASE_HEIGHT + editLines * EDIT_LINE_HEIGHT + ROW_GAP;
      }
      const base = isCodeSnippet(item.content || item.preview, item.contentType)
        ? CODE_ROW_HEIGHT
        : ROW_HEIGHT;
      return base + ROW_GAP;
    },
    overscan: 10,
    gap: ROW_GAP,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [safeItems, editingId, editLines, virtualizer]);

  useEffect(() => {
    if (selectedId == null) return;
    const idx = safeItems.findIndex((i) => i.id === selectedId);
    if (idx >= 0) virtualizer.scrollToIndex(idx, { align: "auto" });
  }, [selectedId, safeItems, virtualizer]);

  if (safeItems.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
        <div className="rounded-lg border border-line bg-raised px-10 py-12">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-md bg-muted text-accent">
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

          return (
            <div
              key={item.id}
              data-index={row.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 top-0 w-full"
              style={{ transform: `translateY(${row.start}px)` }}
            >
              <ClipboardItemRow
                item={item}
                selected={item.id === selectedId}
                ocrAvailable={ocrAvailable}
                onSelect={() => onSelect(item.id)}
                onCopy={() => onCopy(item.id)}
                onExtractText={() => onExtractText(item.id)}
                onPin={() => onPin(item.id)}
                onDelete={() => onDelete(item.id)}
                onPreviewImage={() => onPreviewImage(item.id)}
                onOpenLink={onOpenLink}
                onUpdate={onUpdate}
                onEditLayout={(editing, lines) => handleEditLayout(item.id, editing, lines)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
