import type { ClipboardItem } from "./types";

/** Mirror backend list filter — used for live clipboard-item events. */
export function itemMatchesSearch(item: ClipboardItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (item.contentType === "image" || item.contentType === "screenshot") {
    return item.preview.toLowerCase().includes(q);
  }
  if (item.contentType === "gif" || item.contentType === "video") {
    return (
      item.preview.toLowerCase().includes(q) ||
      item.content.toLowerCase().includes(q)
    );
  }
  return (
    item.preview.toLowerCase().includes(q) ||
    item.content.toLowerCase().includes(q)
  );
}

export function itemMatchesCategory(
  item: ClipboardItem,
  category: string
): boolean {
  if (category === "all") return true;
  if (category === "text") return item.contentType === "text";
  if (category === "images") return item.contentType === "image";
  if (category === "screenshots") return item.contentType === "screenshot";
  if (category === "videos")
    return item.contentType === "video" || item.contentType === "gif";
  if (category === "links") return item.contentType === "link";
  if (category === "pinned") return item.isPinned;
  return true;
}
