import { useEffect, useState } from "react";
import { itemThumbnail } from "./api";

/**
 * Crisp previews for image / screenshot items. The stored `preview` is a 64 px thumbnail —
 * fine for a list icon, blurry anywhere bigger — so larger views ask the backend for a
 * downscaled copy of the full image and keep it here for the session.
 */
const MAX_ENTRIES = 300;
const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

function keyFor(id: number, size: number) {
  return `${id}:${size}`;
}

function remember(key: string, url: string) {
  cache.delete(key);
  cache.set(key, url);
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

/** Snap requests to a few sizes so list rows, tiles and the popup share cache entries. */
export function thumbBucket(px: number): number {
  const want = Math.ceil(px * (typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1));
  for (const bucket of [96, 192, 320, 480, 720]) {
    if (want <= bucket) return bucket;
  }
  return 960;
}

export function loadThumbnail(id: number, size: number): Promise<string | null> {
  const key = keyFor(id, size);
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  const pending = inflight.get(key);
  if (pending) return pending;
  const request = itemThumbnail(id, size)
    .then((url) => {
      if (url) remember(key, url);
      return url;
    })
    .catch((err) => {
      console.error(err);
      return null;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, request);
  return request;
}

/** Drop cached previews for an item whose image changed (e.g. after annotating). */
export function forgetThumbnails(id: number) {
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`${id}:`)) cache.delete(key);
  }
}

/**
 * `displayPx` is the on-screen edge length. Returns the cached/loaded preview, or `fallback`
 * (usually `item.preview`) until it arrives. Pass `enabled: false` for non-image items.
 */
export function useItemThumbnail(
  id: number,
  displayPx: number,
  fallback: string | null,
  enabled = true
): string | null {
  const size = thumbBucket(displayPx);
  const [src, setSrc] = useState<string | null>(() =>
    enabled ? cache.get(keyFor(id, size)) ?? fallback : fallback
  );

  useEffect(() => {
    if (!enabled) {
      setSrc(fallback);
      return;
    }
    const hit = cache.get(keyFor(id, size));
    if (hit) {
      setSrc(hit);
      return;
    }
    setSrc(fallback);
    let cancelled = false;
    void loadThumbnail(id, size).then((url) => {
      if (!cancelled && url) setSrc(url);
    });
    return () => {
      cancelled = true;
    };
  }, [id, size, fallback, enabled]);

  return src;
}
