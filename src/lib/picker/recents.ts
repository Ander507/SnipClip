/** "Recently used" rows for the popup's emoji / GIF / kaomoji / symbol tabs (per machine). */

const MAX = 24;
const key = (kind: string) => `snipclip.picker.recent.${kind}`;

export function loadRecents<T>(kind: string): T[] {
  try {
    const raw = localStorage.getItem(key(kind));
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

/** Move `item` to the front (deduped by `id`) and persist. Returns the new list. */
export function pushRecent<T>(kind: string, item: T, id: (x: T) => string = (x) => String(x)): T[] {
  const next = [item, ...loadRecents<T>(kind).filter((x) => id(x) !== id(item))].slice(0, MAX);
  try {
    localStorage.setItem(key(kind), JSON.stringify(next));
  } catch {
    // Storage disabled — recents are a convenience only.
  }
  return next;
}
