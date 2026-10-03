import { useEffect, useState } from "react";
import type { ClipboardItem } from "./types";

/** "Code.exe" → "Code", "chrome.exe" → "Chrome". Null when the source is unknown. */
export function sourceLabel(item: Pick<ClipboardItem, "sourceApp">): string | null {
  const raw = item.sourceApp?.trim();
  if (!raw) return null;
  const stem = raw.replace(/\.exe$/i, "");
  if (!stem) return null;
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}

/** "1920×1080" for images that carry their size. */
export function dimensionsLabel(item: Pick<ClipboardItem, "width" | "height">): string | null {
  if (!item.width || !item.height) return null;
  return `${item.width}×${item.height}`;
}

/** "1,204 chars" for text-like items. */
export function charCountLabel(text: string): string | null {
  const n = text.length;
  if (n === 0) return null;
  return `${n.toLocaleString()} char${n === 1 ? "" : "s"}`;
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "just now" · "5m ago" · "14:08" — the day itself comes from the group header. */
export function relativeTime(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  const t = d.getTime();
  if (Number.isNaN(t)) return "";
  const diff = Math.max(0, now - t);
  if (diff < 60_000) return "just now";
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)}m ago`;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * One label where there is no day header (popup, grid tiles): "5m ago" / "14:08" today,
 * otherwise "Yesterday" · "Monday" · "Sep 14".
 */
export function shortWhen(iso: string, now = Date.now()): string {
  const day = dayLabel(iso, now);
  return day === "Today" ? relativeTime(iso, now) : day;
}

/** Group label for a timestamp: Today · Yesterday · Monday · Sep 14 · Sep 14, 2025. */
export function dayLabel(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Earlier";
  const today = startOfDay(new Date(now));
  const day = startOfDay(d);
  const days = Math.round((today - day) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString([], { weekday: "long" });
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString(
    [],
    sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" }
  );
}

/** Re-render every `ms` so relative times ("5m ago") stay fresh. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const handle = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(handle);
  }, [ms]);
  return now;
}
