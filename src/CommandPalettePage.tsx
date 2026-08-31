import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import clsx from "clsx";
import { Image as ImageIcon, Link2, Type } from "lucide-react";
import { getSettings, hideCommandPalette, paletteCopyItem, searchClipboard } from "./lib/api";
import type { ClipboardItem } from "./lib/types";
import { applyThemeFromSettings } from "./lib/theme";

function resultLabel(item: ClipboardItem): string {
  if (item.contentType === "image" || item.contentType === "screenshot") {
    return item.preview?.startsWith("data:") ? "Image capture" : item.preview || "Image";
  }
  return item.preview || item.content || "Untitled";
}

function TypeBadge({ type }: { type: string }) {
  if (type === "image" || type === "screenshot") {
    return <ImageIcon size={14} className="shrink-0 text-fg-muted" />;
  }
  if (type === "link") {
    return <Link2 size={14} className="shrink-0 text-fg-muted" />;
  }
  return <Type size={14} className="shrink-0 text-fg-muted" />;
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

export function CommandPalette() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ClipboardItem[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
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
    if (e.key === "Enter" && results.length > 0) {
      e.preventDefault();
      void activate(selected);
    }
  }

  return (
    <div
      className="flex h-full min-h-0 w-full items-start justify-center bg-transparent px-4 pb-6 pt-[10vh]"
      onMouseDown={() => void dismiss()}
      onKeyDown={onKeyDown}
    >
      <div
        className="command-palette-shell flex max-h-[min(72vh,440px)] w-full max-w-[560px] flex-col overflow-hidden rounded-2xl border border-line-strong bg-raised shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search clipboard history…"
          spellCheck={false}
          autoComplete="off"
          className="shrink-0 w-full bg-transparent px-5 py-4 text-lg text-fg outline-none placeholder:text-fg-muted"
        />

        <div
          ref={listRef}
          className="min-h-0 flex-1 overflow-y-auto border-t border-line py-1"
        >
          {loading && results.length === 0 ? (
            <p className="px-5 py-3 text-sm text-fg-muted">Searching…</p>
          ) : results.length === 0 ? (
            <p className="px-5 py-3 text-sm text-fg-muted">No matches</p>
          ) : (
            results.map((item, index) => {
              const thumb =
                item.preview?.startsWith("data:image") ? item.preview : null;
              return (
                <button
                  key={item.id}
                  type="button"
                  data-index={index}
                  className={clsx(
                    "flex w-full items-center gap-3 px-5 py-2.5 text-left transition",
                    index === selected
                      ? "bg-accent-soft text-fg"
                      : "text-fg-secondary hover:bg-hover"
                  )}
                  onMouseEnter={() => setSelected(index)}
                  onClick={() => void activate(index)}
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-muted">
                    {thumb ? (
                      <img src={thumb} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <TypeBadge type={item.contentType} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{resultLabel(item)}</p>
                    <p className="truncate font-mono text-[10px] uppercase tracking-wide text-fg-faint">
                      {item.contentType}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-line px-5 py-2.5 text-[11px] text-fg-faint">
          <span>↑↓ navigate · Enter copy · Esc close</span>
          <span className="font-mono text-fg-muted">Alt+C</span>
        </div>
      </div>
    </div>
  );
}
