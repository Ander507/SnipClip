import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import clsx from "clsx";
import { ExternalLink, KeyRound, LoaderCircle, RotateCcw } from "lucide-react";
import { klipyGifs, openUrl, type GifItem, type GifPage } from "../../lib/api";
import { loadRecents, pushRecent } from "../../lib/picker/recents";
import { SectionLabel, gridKey, wheelToHorizontal } from "./PickerGrid";
import type { PanelKeyHandler } from "./EmojiPanel";

export type GifInsertMode = "paste" | "copyOnly" | "link";

const QUICK_TERMS = ["thanks", "lol", "yes", "no", "wow", "love", "sad", "facepalm", "party", "ok"];
const SEARCH_DEBOUNCE_MS = 450;
// Test keys allow ~100 calls/hour, so reuse pages for the life of the popup window
const CACHE_TTL_MS = 10 * 60_000;
const pageCache = new Map<string, { at: number; page: GifPage }>();

async function fetchPage(term: string, page: number): Promise<GifPage> {
  const key = `${term.toLowerCase()}|${page}`;
  const hit = pageCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.page;
  const result = await klipyGifs(term, page);
  pageCache.set(key, { at: Date.now(), page: result });
  return result;
}

interface Props {
  query: string;
  setQuery: (q: string) => void;
  keyRef: MutableRefObject<PanelKeyHandler | null>;
  /** Resolves once the GIF is pasted / copied. */
  onInsert: (gif: GifItem, mode: GifInsertMode) => Promise<void>;
  onOpenSettings: () => void;
}

/** GIF tab — KLIPY trending + search, recents, infinite scroll. */
export function GifPanel({ query, setQuery, keyRef, onInsert, onOpenSettings }: Props) {
  const [term, setTerm] = useState(query.trim());
  const [items, setItems] = useState<GifItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [recents, setRecents] = useState(() => loadRecents<GifItem>("gif"));
  const [selected, setSelected] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    const handle = window.setTimeout(() => setTerm(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [query]);

  const load = useCallback(async (t: string, p: number) => {
    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchPage(t, p);
      if (seq !== seqRef.current) return;
      setItems((prev) => {
        if (p === 1) return result.items;
        const seen = new Set(prev.map((g) => g.id));
        return [...prev, ...result.items.filter((g) => !seen.has(g.id))];
      });
      setPage(p);
      setHasNext(result.hasNext);
    } catch (err) {
      if (seq === seqRef.current) setError(String(err));
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setSelected(0);
    scrollRef.current?.scrollTo({ top: 0 });
    void load(term, 1);
  }, [term, load]);

  // Infinite scroll
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasNext) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !loading) void load(term, page + 1);
      },
      { root: scrollRef.current, rootMargin: "200px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNext, loading, load, term, page]);

  const keyMissing = error === "KLIPY_KEY_MISSING";
  const keyInvalid = error === "KLIPY_KEY_INVALID";
  const showRecents = !term && recents.length > 0;
  const shown = useMemo(() => (showRecents ? [...recents, ...items] : items), [showRecents, recents, items]);

  useEffect(() => {
    scrollRef.current
      ?.querySelector(`[data-pick-index="${selected}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  async function pick(gif: GifItem | undefined, mode: GifInsertMode) {
    if (!gif || busyId) return;
    setBusyId(gif.id);
    setError(null);
    try {
      await onInsert(gif, mode);
      setRecents(pushRecent("gif", gif, (g) => g.id).slice(0, 12));
    } catch (err) {
      setError(String(err));
    } finally {
      setBusyId(null);
    }
  }

  keyRef.current = (e) => {
    const next = gridKey(e.key, scrollRef.current, selected, shown.length);
    if (next !== null) {
      setSelected(next);
      return true;
    }
    if (e.key === "Enter") {
      void pick(shown[selected], e.ctrlKey || e.metaKey ? "copyOnly" : e.shiftKey ? "link" : "paste");
      return true;
    }
    return false;
  };


  const tile = (gif: GifItem, index: number) => (
    <button
      key={`${index < (showRecents ? recents.length : 0) ? "r" : "g"}:${gif.id}`}
      type="button"
      data-pick-index={index}
      title={gif.title || "GIF"}
      aria-label={gif.title || "GIF"}
      onMouseEnter={() => setSelected(index)}
      onClick={(e) => void pick(gif, e.ctrlKey || e.metaKey ? "copyOnly" : e.shiftKey ? "link" : "paste")}
      className={clsx(
        "relative aspect-square overflow-hidden rounded-lg border bg-inset transition",
        index === selected ? "border-accent ring-1 ring-accent" : "border-transparent hover:border-line-strong"
      )}
    >
      <img
        src={gif.previewUrl}
        alt=""
        loading="lazy"
        draggable={false}
        className="h-full w-full object-cover"
      />
      {busyId === gif.id && (
        <span className="absolute inset-0 flex items-center justify-center bg-raised/70">
          <LoaderCircle size={18} className="animate-spin text-accent" />
        </span>
      )}
    </button>
  );

  return (
    <>
      {!query.trim() && !keyMissing && !keyInvalid && (
        <div
          className="no-scrollbar flex shrink-0 gap-1 overflow-x-auto border-b border-line px-2 py-1.5"
          onWheel={wheelToHorizontal}
        >
          {QUICK_TERMS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setQuery(t)}
              className="shrink-0 rounded-full border border-line px-2.5 py-0.5 text-[11px] text-fg-secondary transition hover:border-line-strong hover:bg-hover"
            >
              {t}
            </button>
          ))}
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {keyMissing || keyInvalid ? (
          <div className="mx-1 mt-4 space-y-3 rounded-xl border border-line bg-muted p-4 text-center">
            <KeyRound size={20} className="mx-auto text-accent" />
            <p className="text-[12.5px] font-medium text-fg-secondary">
              {keyMissing ? "GIFs need a free KLIPY key" : "KLIPY didn't accept the API key"}
            </p>
            <p className="text-[11.5px] leading-relaxed text-fg-muted">
              Create one at klipy.com, then paste it into Settings → Clipboard popup.
            </p>
            <div className="flex justify-center gap-2">
              <button
                type="button"
                onClick={() => void openUrl("https://klipy.com/developers")}
                className="inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1.5 text-[11.5px] text-fg-secondary hover:bg-hover"
              >
                Get a key <ExternalLink size={11} />
              </button>
              <button
                type="button"
                onClick={onOpenSettings}
                className="rounded-md bg-accent px-2.5 py-1.5 text-[11.5px] font-semibold text-accent-fg hover:brightness-110"
              >
                Open Settings
              </button>
            </div>
          </div>
        ) : (
          <>
            {showRecents && (
              <>
                <SectionLabel className="pt-2.5">Recently used</SectionLabel>
                <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                  {recents.map((gif, i) => tile(gif, i))}
                </div>
              </>
            )}
            <SectionLabel className="pt-2.5">{term ? `“${term}”` : "Trending"}</SectionLabel>
            {error ? (
              <div className="mt-3 space-y-2 text-center">
                <p className="text-[12px] text-danger">{error}</p>
                <button
                  type="button"
                  onClick={() => void load(term, 1)}
                  className="inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1 text-[11.5px] text-fg-secondary hover:bg-hover"
                >
                  <RotateCcw size={11} /> Retry
                </button>
              </div>
            ) : items.length === 0 && !loading ? (
              <p className="py-6 text-center text-[12px] text-fg-muted">No GIFs found.</p>
            ) : (
              <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                {items.map((gif, i) => tile(gif, i + (showRecents ? recents.length : 0)))}
              </div>
            )}
            {loading && (
              <p className="flex items-center justify-center gap-1.5 py-3 text-[11.5px] text-fg-muted">
                <LoaderCircle size={13} className="animate-spin" /> Loading GIFs…
              </p>
            )}
            <div ref={sentinelRef} className="h-px" />
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-line px-3 py-1.5 text-[10.5px] text-fg-faint">
        <span className="truncate">{shown[selected]?.title || " "}</span>
        <button
          type="button"
          onClick={() => void openUrl("https://klipy.com")}
          className="shrink-0 font-medium text-fg-muted hover:text-fg"
        >
          Powered by KLIPY
        </button>
      </div>
    </>
  );
}
