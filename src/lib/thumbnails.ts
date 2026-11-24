import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
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

/* ---------------------------------------------------------------------------------------------
 * Video / GIF poster frames, captured on the frontend (no backend poster source exists).
 * ------------------------------------------------------------------------------------------- */

export interface VideoPoster {
  src: string | null;
  durationSec: number | null;
  failed: boolean;
}

const POSTER_MAX_ENTRIES = 300;
const POSTER_MAX_EDGE = 720;
const POSTER_TIMEOUT_MS = 10_000;
const POSTER_CONCURRENCY = 2;

type PosterResult = VideoPoster;
const posterCache = new Map<string, PosterResult>();
const posterInflight = new Map<string, Promise<PosterResult>>();
const posterQueue: Array<() => void> = [];
let posterActive = 0;

function rememberPoster(path: string, result: PosterResult) {
  posterCache.delete(path);
  posterCache.set(path, result);
  if (posterCache.size > POSTER_MAX_ENTRIES) {
    const oldest = posterCache.keys().next().value;
    if (oldest !== undefined) posterCache.delete(oldest);
  }
}

function runQueued<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const start = () => {
      posterActive += 1;
      task()
        .then(resolve, reject)
        .finally(() => {
          posterActive -= 1;
          // Newest first: the tiles requested last are the ones on screen now, so they
          // shouldn't wait behind clips the user already scrolled past.
          posterQueue.pop()?.();
        });
    };
    if (posterActive < POSTER_CONCURRENCY) start();
    else posterQueue.push(start);
  });
}

function drawToJpeg(source: CanvasImageSource, w: number, h: number): string {
  const scale = Math.min(1, POSTER_MAX_EDGE / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.8);
}

function withTimeout<T>(work: Promise<T>, onTimeout: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      onTimeout();
      reject(new Error("poster capture timed out"));
    }, POSTER_TIMEOUT_MS);
    work.then(
      (v) => {
        window.clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(timer);
        reject(e);
      }
    );
  });
}

async function captureGif(path: string): Promise<PosterResult> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = convertFileSrc(path);
  try {
    await withTimeout(img.decode(), () => {});
    const src = drawToJpeg(img, img.naturalWidth || 1, img.naturalHeight || 1);
    return { src, durationSec: null, failed: false };
  } finally {
    img.removeAttribute("src");
  }
}

function releaseVideo(v: HTMLVideoElement) {
  try {
    v.pause();
    v.removeAttribute("src");
    v.load();
  } catch {
    /* already released */
  }
}

async function captureVideo(path: string): Promise<PosterResult> {
  const v = document.createElement("video");
  v.crossOrigin = "anonymous";
  v.muted = true;
  v.preload = "auto";
  const once = (name: string) =>
    new Promise<void>((resolve, reject) => {
      v.addEventListener(name, () => resolve(), { once: true });
      v.addEventListener("error", () => reject(new Error("video error")), { once: true });
    });
  try {
    return await withTimeout(
      (async () => {
        const meta = once("loadedmetadata");
        v.src = convertFileSrc(path);
        await meta;
        const duration = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null;
        const seeked = once("seeked");
        v.currentTime = Math.min(0.5, (duration ?? 1) / 2);
        await seeked;
        if (v.readyState < 2) await once("loadeddata");
        const src = drawToJpeg(v, v.videoWidth || 1, v.videoHeight || 1);
        return { src, durationSec: duration, failed: false };
      })(),
      () => releaseVideo(v)
    );
  } finally {
    releaseVideo(v);
  }
}

function loadPoster(path: string, isGif: boolean): Promise<PosterResult> {
  const hit = posterCache.get(path);
  if (hit) return Promise.resolve(hit);
  const pending = posterInflight.get(path);
  if (pending) return pending;
  const request = runQueued(() => (isGif ? captureGif(path) : captureVideo(path)))
    .catch((): PosterResult => ({ src: null, durationSec: null, failed: true }))
    .then((result) => {
      rememberPoster(path, result);
      return result;
    })
    .finally(() => posterInflight.delete(path));
  posterInflight.set(path, request);
  return request;
}

const PENDING_POSTER: VideoPoster = { src: null, durationSec: null, failed: false };

/**
 * Poster frame + duration for a video/gif file. Captured once per path (bounded LRU, two at a
 * time) so scrolling a virtualized grid doesn't re-decode clips. Failures are cached too, so a
 * missing file shows its placeholder without a retry loop.
 */
export function useVideoPoster(path: string, enabled = true): VideoPoster {
  const [poster, setPoster] = useState<VideoPoster>(
    () => (enabled && posterCache.get(path)) || PENDING_POSTER
  );

  useEffect(() => {
    if (!enabled || !path) {
      setPoster(PENDING_POSTER);
      return;
    }
    const hit = posterCache.get(path);
    if (hit) {
      setPoster(hit);
      return;
    }
    setPoster(PENDING_POSTER);
    let cancelled = false;
    const isGif = /\.gif$/i.test(path);
    void loadPoster(path, isGif).then((result) => {
      if (!cancelled) setPoster(result);
    });
    return () => {
      cancelled = true;
    };
  }, [path, enabled]);

  return poster;
}
