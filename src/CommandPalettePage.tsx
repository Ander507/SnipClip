import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import clsx from "clsx";
import { ClipboardList, GripHorizontal, ImagePlay, Omega, Search, Smile, Wand2, X } from "lucide-react";
import {
  clearHistory,
  copyText,
  formatHotkeyLabel,
  pasteFile,
  pasteText,
  prepareGif,
  type GifItem,
  hideCommandPalette,
  pasteItem,
  pasteItems,
  searchClipboard,
  togglePin,
  transformOptions,
  transformPreview,
  type PaletteShowPayload,
  type PasteMode,
  type TransformKind,
  type TransformOption,
} from "./lib/api";
import type { ClipboardItem } from "./lib/types";
import { useThemeSync } from "./lib/themeSync";
import { DEFAULT_UI_PREFS, normalizeUiPrefs, type PaletteAnchor, type UiPrefs } from "./lib/uiPrefs";
import { useNow } from "./lib/itemMeta";
import { PaletteItem } from "./components/palette/PaletteItem";
import { useCursorPlacement, type Point } from "./components/palette/useCursorPlacement";
import { useDragPosition } from "./components/palette/useDragPosition";
import { EmojiPanel, type PanelKeyHandler } from "./components/palette/EmojiPanel";
import { TextPickerPanel } from "./components/palette/TextPickerPanel";
import { GifPanel, type GifInsertMode } from "./components/palette/GifPanel";
import { KAOMOJI_GROUPS } from "./lib/picker/kaomoji";
import { SYMBOL_GROUPS } from "./lib/picker/symbols";

const CLEAR_CONFIRM_MS = 3000;

type PaletteTab = "clipboard" | "emoji" | "gif" | "kaomoji" | "symbols";

const TABS: { id: PaletteTab; label: string; placeholder: string; icon: ReactNode }[] = [
  { id: "clipboard", label: "Clipboard", placeholder: "Search clipboard", icon: <ClipboardList size={15} /> },
  { id: "emoji", label: "Emoji", placeholder: "Search emoji", icon: <Smile size={15} /> },
  { id: "gif", label: "GIFs", placeholder: "Search KLIPY GIFs", icon: <ImagePlay size={15} /> },
  {
    id: "kaomoji",
    label: "Kaomoji",
    placeholder: "Search kaomoji",
    icon: <span className="text-[11px] font-semibold leading-none">;-)</span>,
  },
  { id: "symbols", label: "Symbols", placeholder: "Search symbols", icon: <Omega size={15} /> },
];

/** Backdrop flex alignment per anchor; "cursor" positions the panel absolutely instead. */
const ANCHOR_LAYOUT: Record<Exclude<PaletteAnchor, "cursor">, string> = {
  "bottom-right": "items-end justify-end p-5 pb-8 pr-6",
  "bottom-center": "items-end justify-center p-5 pb-8",
  center: "items-center justify-center p-5",
};

function isTextual(item: ClipboardItem | undefined): boolean {
  if (!item) return false;
  return !["image", "screenshot", "video", "gif"].includes(item.contentType);
}

function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={clsx(
        "px-1 text-[10px] font-medium uppercase tracking-wider text-fg-faint",
        className
      )}
    >
      {children}
    </p>
  );
}

/** Floating Win+V-style clipboard history (Alt+C / Ctrl+Shift+D). */
export function CommandPalette() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ClipboardItem[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const [dockHotkey, setDockHotkey] = useState("Ctrl+Shift+D");
  const [directPaste, setDirectPaste] = useState(false);
  const [prefs, setPrefs] = useState<UiPrefs>(DEFAULT_UI_PREFS);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [shownAt, setShownAt] = useState(() => Date.now());
  const [picked, setPicked] = useState<number[]>([]);
  const [options, setOptions] = useState<TransformOption[]>([]);
  const [transform, setTransform] = useState<TransformKind | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [tab, setTab] = useState<PaletteTab>("clipboard");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const ignoreBlurRef = useRef(false);
  const searchSeqRef = useRef(0);
  const confirmTimerRef = useRef<number | undefined>(undefined);
  // Emoji / GIF / kaomoji / symbol panels handle their own arrow keys and Enter
  const panelKeyRef = useRef<PanelKeyHandler | null>(null);
  // Read through a ref so runSearch stays stable for the mount-time listeners.
  const maxItemsRef = useRef(prefs.paletteMaxItems);
  maxItemsRef.current = prefs.paletteMaxItems;

  // Theme, dock hotkey, direct-paste and popup prefs follow every Settings save via `settings-changed`.
  useThemeSync({
    effects: false,
    onSettings: (s) => {
      setDockHotkey(formatHotkeyLabel(s.hotkeyDock || "Control+Shift+D"));
      setDirectPaste(s.directPasteEnabled ?? false);
      setPrefs(normalizeUiPrefs(s.uiPrefs));
    },
  });

  // Timers are throttled while the window is hidden, so don't trust `useNow` right after a show.
  const now = Math.max(useNow(), shownAt);
  const current = results[selected];
  const atCursor = prefs.paletteAnchor === "cursor" && cursor !== null;
  const drag = useDragPosition(panelRef, prefs.paletteAnchor, shownAt);
  const placement = useCursorPlacement(panelRef, atCursor && !drag.pos ? cursor : null);
  const cardWidth = prefs.paletteWidth - 24;

  const runSearch = useCallback(async (q: string) => {
    const seq = ++searchSeqRef.current;
    setLoading(true);
    try {
      const items = await searchClipboard(q, maxItemsRef.current);
      if (seq !== searchSeqRef.current) return;
      setResults(items);
      setSelected(0);
    } catch (err) {
      console.error(err);
      if (seq === searchSeqRef.current) setResults([]);
    } finally {
      if (seq === searchSeqRef.current) setLoading(false);
    }
  }, []);

  const dismiss = useCallback(async () => {
    try {
      await hideCommandPalette();
    } catch {
      await getCurrentWindow().hide();
    }
  }, []);

  const disarmClear = useCallback(() => {
    window.clearTimeout(confirmTimerRef.current);
    setConfirmClear(false);
  }, []);

  useEffect(() => {
    document.documentElement.classList.add("palette-mode");
    document.body.classList.add("palette-mode");
    const root = document.getElementById("root");
    document.documentElement.style.backgroundColor = "transparent";
    document.body.style.backgroundColor = "transparent";
    if (root) root.style.backgroundColor = "transparent";

    void runSearch("");

    let cancelled = false;
    let unlistenShow: (() => void) | undefined;
    let unlistenBlur: (() => void) | undefined;

    void listen<PaletteShowPayload>("palette-show", ({ payload }) => {
      ignoreBlurRef.current = true;
      window.setTimeout(() => {
        ignoreBlurRef.current = false;
      }, 250);
      const x = payload?.cursorX;
      const y = payload?.cursorY;
      setCursor(
        typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y)
          ? { x, y }
          : null
      );
      setShownAt(Date.now());
      setTab("clipboard");
      setQuery("");
      setSelected(0);
      setPicked([]);
      setTransform(null);
      setError(null);
      disarmClear();
      void runSearch("");
      requestAnimationFrame(() => inputRef.current?.focus());
    }).then((u) => {
      if (cancelled) u();
      else unlistenShow = u;
    });

    void getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (!focused && !ignoreBlurRef.current) void dismiss();
      })
      .then((u) => {
        if (cancelled) u();
        else unlistenBlur = u;
      });

    requestAnimationFrame(() => inputRef.current?.focus());

    return () => {
      cancelled = true;
      unlistenShow?.();
      unlistenBlur?.();
      window.clearTimeout(confirmTimerRef.current);
      document.documentElement.classList.remove("palette-mode");
      document.body.classList.remove("palette-mode");
    };
  }, [runSearch, dismiss, disarmClear]);

  // Also re-runs when the item-count pref changes.
  useEffect(() => {
    if (tab !== "clipboard") return;
    const t = window.setTimeout(() => void runSearch(query), 100);
    return () => window.clearTimeout(t);
  }, [query, prefs.paletteMaxItems, runSearch, tab]);

  function switchTab(next: PaletteTab) {
    if (next === tab) return;
    setTab(next);
    setQuery("");
    setError(null);
    panelKeyRef.current = null;
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function insertText(text: string, mode: PasteMode) {
    try {
      setError(null);
      // Opt-in: without Direct paste, only copy and close
      await pasteText(text, directPaste ? mode : "copyOnly");
    } catch (err) {
      setError(String(err));
    }
  }

  async function insertGif(gif: GifItem, mode: GifInsertMode) {
    if (mode === "link") {
      await copyText(gif.gifUrl);
      await dismiss();
      return;
    }
    const path = await prepareGif(gif.gifUrl, gif.slug);
    await pasteFile(path, directPaste ? mode : "copyOnly");
  }

  function openPopupSettings() {
    void emit("open-settings", { section: "popup" });
    void dismiss();
  }

  useEffect(() => {
    // Item 0 sits under the "Pinned" heading — scroll fully up so the heading shows too.
    if (selected === 0) {
      listRef.current?.scrollTo({ top: 0 });
      return;
    }
    const el = listRef.current?.querySelector(`[data-index="${selected}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selected, results]);

  // Content-aware transform bar follows the highlighted clip
  useEffect(() => {
    setTransform(null);
    setPreview(null);
    if (!isTextual(current)) {
      setOptions([]);
      return;
    }
    let live = true;
    void transformOptions(current.id)
      .then((opts) => {
        if (live) setOptions(opts);
      })
      .catch(() => {
        if (live) setOptions([]);
      });
    return () => {
      live = false;
    };
  }, [current?.id]);

  useEffect(() => {
    if (!transform || !current) {
      setPreview(null);
      return;
    }
    let live = true;
    void transformPreview(current.id, transform)
      .then((text) => {
        if (live) {
          setPreview(text);
          setError(null);
        }
      })
      .catch((err) => {
        if (live) {
          setPreview(null);
          setError(String(err));
        }
      });
    return () => {
      live = false;
    };
  }, [transform, current?.id]);

  function togglePick(id: number) {
    setPicked((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  }

  function cycleTransform(direction: 1 | -1) {
    if (options.length === 0) return;
    const chain: (TransformKind | null)[] = [null, ...options.map((o) => o.kind)];
    const at = chain.indexOf(transform);
    const next = chain[(at + direction + chain.length) % chain.length];
    setTransform(next ?? null);
  }

  async function activate(index: number, mode: PasteMode = "paste", fieldFill = false) {
    const item = results[index];
    if (!item && picked.length === 0) return;
    // Opt-in: without Direct paste, only stage the clipboard and close
    const effective: PasteMode = directPaste ? mode : "copyOnly";
    try {
      setError(null);
      if (picked.length > 1) {
        await pasteItems(
          picked,
          effective,
          transform,
          directPaste && fieldFill ? "tab" : "none"
        );
      } else if (item) {
        const id = picked[0] ?? item.id;
        await pasteItem(id, effective, transform);
      }
    } catch (err) {
      setError(String(err));
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

  // Two-step: the first click arms the button, a second click within CLEAR_CONFIRM_MS clears.
  async function handleClearAll() {
    if (!confirmClear) {
      window.clearTimeout(confirmTimerRef.current);
      setConfirmClear(true);
      confirmTimerRef.current = window.setTimeout(() => setConfirmClear(false), CLEAR_CONFIRM_MS);
      return;
    }
    disarmClear();
    try {
      await clearHistory();
      setPicked([]);
      await runSearch(query);
    } catch (err) {
      console.error(err);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.ctrlKey && e.key === "Tab") {
      e.preventDefault();
      const at = TABS.findIndex((t) => t.id === tab);
      switchTab(TABS[(at + (e.shiftKey ? -1 : 1) + TABS.length) % TABS.length].id);
      return;
    }
    if (tab !== "clipboard") {
      if (e.key === "Escape") {
        e.preventDefault();
        void dismiss();
        return;
      }
      if (panelKeyRef.current?.(e)) e.preventDefault();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      if (transform) {
        setTransform(null);
        return;
      }
      if (picked.length > 0) {
        setPicked([]);
        return;
      }
      void dismiss();
      return;
    }
    // Alt+1..9 fires the Nth clip straight into the app you came from
    if (e.altKey && /^Digit[1-9]$/.test(e.code)) {
      const index = Number(e.code.slice(5)) - 1;
      if (results[index]) {
        e.preventDefault();
        void activate(index);
      }
      return;
    }
    if (e.ctrlKey && e.code === "Space") {
      e.preventDefault();
      if (current) togglePick(current.id);
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      cycleTransform(e.shiftKey ? -1 : 1);
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
    if (e.key === "Enter" && (results.length > 0 || picked.length > 0)) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        void activate(selected, "copyOnly");
      } else if (e.shiftKey) {
        // keystroke mode: type it out, or walk form fields when several are picked
        void activate(selected, picked.length > 1 ? "paste" : "typeOut", picked.length > 1);
      } else {
        void activate(selected, "paste");
      }
    }
  }

  const activeTransformLabel = options.find((o) => o.kind === transform)?.label;
  // Search puts pins first; split them out only for the plain recent list.
  const showSections = !query.trim() && results[0]?.isPinned === true;
  const firstRecent = showSections ? results.findIndex((r) => !r.isPinned) : -1;

  return (
    <div
      className={clsx(
        "flex h-full min-h-0 w-full bg-transparent",
        atCursor || drag.pos
          ? "relative"
          : ANCHOR_LAYOUT[prefs.paletteAnchor === "cursor" ? "bottom-right" : prefs.paletteAnchor]
      )}
      onMouseDown={() => void dismiss()}
      onKeyDown={onKeyDown}
    >
      <div
        ref={panelRef}
        className={clsx(
          "command-palette-shell flex h-[min(80vh,600px)] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-line-strong bg-raised/95 shadow-2xl backdrop-blur-xl",
          (atCursor || drag.pos) && "absolute"
        )}
        style={{
          width: prefs.paletteWidth,
          ...(drag.pos
            ? drag.pos
            : atCursor && cursor
              ? {
                  left: placement?.left ?? cursor.x + 8,
                  top: placement?.top ?? cursor.y + 8,
                }
              : null),
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Drag handle + tabs — like the Win+V header */}
        <div
          className={clsx(
            "flex shrink-0 select-none items-center gap-0.5 border-b border-line px-1.5 pt-1.5",
            drag.dragging ? "cursor-grabbing" : "cursor-grab"
          )}
          onPointerDown={drag.onPointerDown}
          onDoubleClick={drag.reset}
          title="Drag to move · double-click to snap back"
        >
          <GripHorizontal size={14} className="mx-1 mb-1.5 shrink-0 text-fg-faint" />
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => switchTab(t.id)}
              title={`${t.label} (Ctrl+Tab)`}
              aria-label={t.label}
              aria-pressed={tab === t.id}
              className={clsx(
                "relative mb-1 flex h-8 w-9 items-center justify-center rounded-md transition",
                tab === t.id ? "bg-hover text-fg" : "text-fg-muted hover:bg-hover hover:text-fg"
              )}
            >
              {t.icon}
              {tab === t.id && (
                <span className="absolute -bottom-1 left-1/2 h-0.5 w-4 -translate-x-1/2 rounded-full bg-accent" />
              )}
            </button>
          ))}
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => void dismiss()}
            className="mb-1 rounded-md p-1.5 text-fg-muted transition hover:bg-hover hover:text-fg"
            title="Close"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {/* Search */}
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
          <Search size={15} className="shrink-0 text-fg-muted" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={TABS.find((t) => t.id === tab)?.placeholder}
            spellCheck={false}
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-faint"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              className="rounded-md p-1 text-fg-faint transition hover:bg-hover hover:text-fg"
              aria-label="Clear search"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {tab === "emoji" && (
          <EmojiPanel query={query} keyRef={panelKeyRef} onInsert={(t, m) => void insertText(t, m)} />
        )}
        {tab === "gif" && (
          <GifPanel
            query={query}
            setQuery={setQuery}
            keyRef={panelKeyRef}
            onInsert={insertGif}
            onOpenSettings={openPopupSettings}
          />
        )}
        {tab === "kaomoji" && (
          <TextPickerPanel
            kind="kaomoji"
            groups={KAOMOJI_GROUPS}
            query={query}
            keyRef={panelKeyRef}
            onInsert={(t, m) => void insertText(t, m)}
          />
        )}
        {tab === "symbols" && (
          <TextPickerPanel
            kind="symbols"
            groups={SYMBOL_GROUPS}
            query={query}
            keyRef={panelKeyRef}
            onInsert={(t, m) => void insertText(t, m)}
          />
        )}

        {tab === "clipboard" && (
        <>
        {/* Clipboard section */}
        <div className="flex shrink-0 items-center justify-between px-4 pb-1 pt-3">
          <h2 className="text-[12px] font-semibold tracking-wide text-fg-secondary">
            {picked.length > 0 ? `${picked.length} picked` : "Clipboard"}
          </h2>
          {picked.length > 0 ? (
            <button
              type="button"
              onClick={() => setPicked([])}
              className="rounded-md px-2 py-0.5 text-[11px] text-fg-muted transition hover:bg-hover hover:text-fg"
            >
              Clear picks
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleClearAll()}
              title={confirmClear ? "Click again to delete every unpinned clip" : undefined}
              className={clsx(
                "rounded-md px-2 py-0.5 text-[11px] transition",
                confirmClear
                  ? "bg-danger/10 font-medium text-danger"
                  : "text-fg-muted hover:bg-hover hover:text-fg"
              )}
            >
              {confirmClear ? "Clear all?" : "Clear all"}
            </button>
          )}
        </div>

        <div ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3 pt-1">
          {loading && results.length === 0 ? (
            <p className="px-1 py-4 text-center text-[12px] text-fg-muted">Loading…</p>
          ) : results.length === 0 ? (
            <p className="px-1 py-6 text-center text-[12px] text-fg-muted">
              {query.trim()
                ? "No matches"
                : "Copy something — recent clips show up here"}
            </p>
          ) : (
            results.map((item, index) => (
              <Fragment key={item.id}>
                {showSections && index === 0 && <SectionLabel>Pinned</SectionLabel>}
                {index === firstRecent && <SectionLabel className="pt-1">Recent</SectionLabel>}
                <PaletteItem
                  item={item}
                  index={index}
                  selected={index === selected}
                  pickOrder={picked.indexOf(item.id)}
                  showImages={prefs.paletteShowImages}
                  cardWidth={cardWidth}
                  now={now}
                  onHover={() => setSelected(index)}
                  onClick={(e) => {
                    if (e.ctrlKey || e.metaKey) {
                      togglePick(item.id);
                      return;
                    }
                    void activate(index);
                  }}
                  onTogglePin={(e) => void handlePin(item.id, e)}
                />
              </Fragment>
            ))
          )}
        </div>

        {/* Transform bar — content-aware hits first, Tab cycles */}
        {options.length > 0 && (
          <div className="shrink-0 border-t border-line px-2 py-1.5">
            <div className="flex gap-1 overflow-x-auto pb-0.5">
              <Wand2 size={12} className="mt-1 shrink-0 text-fg-faint" />
              {options.map((opt) => (
                <button
                  key={opt.kind}
                  type="button"
                  onClick={() =>
                    setTransform((prev) => (prev === opt.kind ? null : opt.kind))
                  }
                  className={clsx(
                    "shrink-0 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10.5px] transition",
                    transform === opt.kind
                      ? "bg-accent text-accent-fg"
                      : opt.suggested
                        ? "bg-hover text-fg-secondary hover:bg-line-strong"
                        : "text-fg-muted hover:bg-hover hover:text-fg"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {preview && (
              <p className="mt-1 max-h-10 overflow-hidden whitespace-pre-wrap break-words px-1 font-mono text-[10px] leading-snug text-accent/90">
                {preview.slice(0, 220)}
              </p>
            )}
          </div>
        )}

        </>
        )}

        {error && (
          <p className="shrink-0 border-t border-danger/30 bg-danger/10 px-3 py-1.5 text-[10.5px] text-danger">
            {error}
          </p>
        )}

        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-line px-3 py-2 text-[10px] text-fg-faint">
          <span className="truncate">
            {!directPaste
              ? "Enter copy · enable Direct paste in Settings"
              : tab === "gif"
                ? "Enter paste GIF · Shift+Enter copy link · Ctrl+Enter copy"
                : tab !== "clipboard"
                  ? "Enter paste · Shift+Enter type (keeps clipboard) · Ctrl+Enter copy"
                  : picked.length > 1
                    ? "Enter merge · Shift+Enter fill fields (Tab)"
                    : activeTransformLabel
                      ? `Enter paste as ${activeTransformLabel} · Tab next`
                      : "Enter paste · Tab transform · Ctrl+Space pick"}
          </span>
          <span className="shrink-0 font-mono text-fg-muted">
            Alt+C · {dockHotkey}
          </span>
        </div>
      </div>
    </div>
  );
}
