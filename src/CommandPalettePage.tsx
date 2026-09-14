import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import clsx from "clsx";
import {
  Image as ImageIcon,
  Link2,
  Pin,
  Search,
  Sigma,
  Type,
  X,
} from "lucide-react";
import {
  clearHistory,
  formatHotkeyLabel,
  getSettings,
  hideCommandPalette,
  paletteCopyItem,
  searchClipboard,
  togglePin,
} from "./lib/api";
import type { ClipboardItem } from "./lib/types";
import { applyThemeFromSettings } from "./lib/theme";
import { parseMathContent } from "./lib/mathContent";

function resultLabel(item: ClipboardItem): string {
  if (item.contentType === "image" || item.contentType === "screenshot") {
    return item.preview?.startsWith("data:") ? "Image" : item.preview || "Image";
  }
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

async function syncPaletteTheme() {
  const settings = await getSettings();
  applyThemeFromSettings({
    themeMode: settings.themeMode,
    accentColor: settings.accentColor,
    themeUseCustom: settings.themeUseCustom ?? false,
    themeCustom: settings.themeCustom ?? null,
    themeGlassmorphic: settings.themeGlassmorphic ?? false,
    themeTranslucency: settings.themeTranslucency ?? 0,
    themeBackgroundImage: settings.themeBackgroundImage ?? null,
  });
}

/** Floating Win+V-style clipboard history (Alt+C / Ctrl+Shift+D). */
export function CommandPalette() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ClipboardItem[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const [dockHotkey, setDockHotkey] = useState("Ctrl+Shift+D");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const ignoreBlurRef = useRef(false);

  const runSearch = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const items = await searchClipboard(q);
      setResults(items);
      setSelected(0);
    } catch (err) {
      console.error(err);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const dismiss = useCallback(async () => {
    try {
      await hideCommandPalette();
    } catch {
      await getCurrentWindow().hide();
    }
  }, []);

  useEffect(() => {
    document.documentElement.classList.add("palette-mode");
    document.body.classList.add("palette-mode");
    const root = document.getElementById("root");
    document.documentElement.style.backgroundColor = "transparent";
    document.body.style.backgroundColor = "transparent";
    if (root) root.style.backgroundColor = "transparent";

    void syncPaletteTheme().catch(console.error);
    void getSettings()
      .then((s) => {
        setDockHotkey(formatHotkeyLabel(s.hotkeyDock || "Control+Shift+D"));
      })
      .catch(console.error);
    void runSearch("");

    let unlistenShow: (() => void) | undefined;
    let unlistenBlur: (() => void) | undefined;

    void listen("palette-show", () => {
      ignoreBlurRef.current = true;
      window.setTimeout(() => {
        ignoreBlurRef.current = false;
      }, 250);
      void syncPaletteTheme().catch(console.error);
      setQuery("");
      setSelected(0);
      void runSearch("");
      requestAnimationFrame(() => inputRef.current?.focus());
    }).then((u) => {
      unlistenShow = u;
    });

    void getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (!focused && !ignoreBlurRef.current) void dismiss();
      })
      .then((u) => {
        unlistenBlur = u;
      });

    requestAnimationFrame(() => inputRef.current?.focus());

    return () => {
      unlistenShow?.();
      unlistenBlur?.();
      document.documentElement.classList.remove("palette-mode");
      document.body.classList.remove("palette-mode");
    };
  }, [runSearch, dismiss]);

  useEffect(() => {
    const t = window.setTimeout(() => void runSearch(query), 100);
    return () => window.clearTimeout(t);
  }, [query, runSearch]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${selected}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selected, results]);

  async function activate(index: number) {
    const item = results[index];
    if (!item) return;
    try {
      await paletteCopyItem(item.id);
    } catch (err) {
      console.error(err);
    }
  }

  async function handlePin(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    try {
      await togglePin(id);
      await runSearch(query);
    } catch (err) {
      console.error(err);
    }
  }

  async function handleClearAll() {
    try {
      await clearHistory();
      await runSearch(query);
    } catch (err) {
      console.error(err);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      void dismiss();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((i) => Math.min(i + 1, Math.max(0, results.length - 1)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((i) => Math.max(i - 1, 0));
      return;
    }
    if ((e.key === "p" || e.key === "P") && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const item = results[selected];
      if (item && document.activeElement !== inputRef.current) {
        e.preventDefault();
        void togglePin(item.id).then(() => runSearch(query)).catch(console.error);
        return;
      }
    }
    if (e.key === "Enter" && results.length > 0) {
      e.preventDefault();
      void activate(selected);
    }
  }

  return (
    <div
      className="flex h-full min-h-0 w-full items-end justify-end bg-transparent p-5 pb-8 pr-6"
      onMouseDown={() => void dismiss()}
      onKeyDown={onKeyDown}
    >
      <div
        className="command-palette-shell flex max-h-[min(78vh,640px)] w-full max-w-[380px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#1c1c1cee] shadow-2xl backdrop-blur-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Search — like Win+V header */}
        <div className="flex shrink-0 items-center gap-2 border-b border-white/10 px-3 py-2.5">
          <Search size={15} className="shrink-0 text-white/45" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search clipboard"
            spellCheck={false}
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-white/40"
          />
          <button
            type="button"
            onClick={() => void dismiss()}
            className="rounded-md p-1 text-white/45 transition hover:bg-white/10 hover:text-white"
            title="Close"
          >
            <X size={14} />
          </button>
        </div>

        {/* Clipboard section */}
        <div className="flex shrink-0 items-center justify-between px-4 pb-1 pt-3">
          <h2 className="text-[12px] font-semibold tracking-wide text-white/90">Clipboard</h2>
          <button
            type="button"
            onClick={() => void handleClearAll()}
            className="rounded-md px-2 py-0.5 text-[11px] text-white/55 transition hover:bg-white/10 hover:text-white"
          >
            Clear all
          </button>
        </div>

        <div ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3 pt-1">
          {loading && results.length === 0 ? (
            <p className="px-1 py-4 text-center text-[12px] text-white/45">Loading…</p>
          ) : results.length === 0 ? (
            <p className="px-1 py-6 text-center text-[12px] text-white/45">
              {query.trim()
                ? "No matches"
                : "Copy something — recent clips show up here"}
            </p>
          ) : (
            results.map((item, index) => {
              const thumb =
                item.preview?.startsWith("data:image") ? item.preview : null;
              const math =
                item.contentType === "math"
                  ? parseMathContent(item.content || "", item.preview || "")
                  : null;
              const isImage =
                item.contentType === "image" || item.contentType === "screenshot";
              const selectedRow = index === selected;

              return (
                <div
                  key={item.id}
                  data-index={index}
                  role="button"
                  tabIndex={-1}
                  className={clsx(
                    "group relative w-full cursor-pointer overflow-hidden rounded-xl border text-left transition",
                    selectedRow
                      ? "border-white/35 bg-white/10 ring-1 ring-white/20"
                      : "border-white/10 bg-white/[0.04] hover:border-white/20 hover:bg-white/[0.07]"
                  )}
                  onMouseEnter={() => setSelected(index)}
                  onClick={() => void activate(index)}
                >
                  {isImage && thumb ? (
                    <div className="relative aspect-[16/10] w-full bg-black/40">
                      <img src={thumb} alt="" className="h-full w-full object-cover" />
                    </div>
                  ) : (
                    <div className="flex gap-2.5 px-3 py-2.5">
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-black/30 text-white/60">
                        <TypeBadge type={item.contentType} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="whitespace-pre-wrap break-words text-[12.5px] leading-snug text-white/90 line-clamp-4">
                          {resultLabel(item)}
                        </p>
                        {math?.result && (
                          <p className="mt-1 font-mono text-[11px] text-accent">
                            = {math.result}
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="absolute bottom-1.5 right-1.5 flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                    <button
                      type="button"
                      title={item.isPinned ? "Unpin" : "Pin"}
                      className={clsx(
                        "rounded-md border border-white/15 bg-black/55 p-1 backdrop-blur-sm transition hover:bg-black/75",
                        item.isPinned ? "text-accent opacity-100" : "text-white/80"
                      )}
                      style={item.isPinned ? { opacity: 1 } : undefined}
                      onClick={(e) => void handlePin(item.id, e)}
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
            })
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-white/10 px-3 py-2 text-[10px] text-white/40">
          <span>↑↓ · Enter paste · P pin · Esc</span>
          <span className="font-mono text-white/50">
            Alt+C · {dockHotkey}
          </span>
        </div>
      </div>
    </div>
  );
}
