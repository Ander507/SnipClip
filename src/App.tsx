import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { emit, listen } from "@tauri-apps/api/event";
import { TitleBar } from "./components/TitleBar";
import { Sidebar, LIBRARY_TABS } from "./components/Sidebar";
import { SearchBar } from "./components/SearchBar";
import { ClipboardList } from "./components/ClipboardList";
import { EmptyState } from "./components/EmptyState";
import { MediaViewer } from "./components/media/MediaViewer";
import { isImageItem, isVideoItem } from "./components/itemParts";
import { SnipOverlay } from "./components/SnipOverlay";
import { SettingsView } from "./components/SettingsView";
import {
  clearHistory,
  copyItem,
  copyText,
  deleteItem,
  deleteItemFile,
  listItems,
  togglePin,
  openUrl,
  updateClipboardItem,
  formatHotkeyShort,
  beginSnip,
  delayedSnip,
  getItem,
  getClipboardPaused,
  toggleClipboardPaused,
  copyTextFromImage,
  isVaultLocked,
  unlockVault,
  showMainWindow,
  openVideoEditor,
  getCategoryCounts,
  pasteItem,
  pasteTargetInfo,
  NO_PASTE_TARGET_MESSAGE,
  updateSettings,
  isOcrAvailable,
  beginRecord,
  saveReplayClip,
} from "./lib/api";
import type { PasteTarget } from "./lib/api";
import {
  AlertCircle,
  Aperture,
  CheckCircle2,
  Film,
  Image as ImageIcon,
  Inbox,
  Info,
  LayoutGrid,
  Pin,
  Rewind,
  Rows3,
  SearchX,
  Video,
} from "lucide-react";
import clsx from "clsx";
import type { AppSettings, CaptureResult, Category, ClipboardItem } from "./lib/types";
import { DEFAULT_SETTINGS } from "./lib/types";
import { applyUiScale } from "./lib/theme";
import {
  applySavedTheme,
  fetchSettingsWithRetry,
  themeInputFromSettings,
} from "./lib/themeSync";
import { normalizeAppSettings } from "./lib/settings";
import type { UiPrefs } from "./lib/uiPrefs";
import { forgetThumbnails } from "./lib/thumbnails";
import type { ImageView } from "./lib/uiPrefs";
import { itemMatchesCategory, itemMatchesSearch } from "./lib/search";
import { useStatusToast } from "./lib/useStatusToast";
import { parseTranslatedContent } from "./lib/translatedContent";
import { parseMathContent } from "./lib/mathContent";
import {
  applyCompactDockLayout,
  applyStudioLayout,
  setMainAlwaysOnTop,
} from "./lib/compactDock";

function Hint({ k, children }: { k: string; children: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-1">
      <kbd className="shrink-0 rounded border border-line bg-muted px-1 font-mono text-[10px] text-fg-muted">
        {k}
      </kbd>
      <span className="min-w-0 max-w-[15rem] truncate">{children}</span>
    </span>
  );
}

/** Sidebar count keys an item is tallied under (mirrors db.rs category_counts). */
function countKeysFor(item: ClipboardItem): string[] {
  const keys = ["all"];
  switch (item.contentType) {
    case "text":
    case "translated":
      keys.push("text");
      break;
    case "image":
      keys.push("images");
      break;
    case "screenshot":
      keys.push("screenshots");
      break;
    case "video":
    case "gif":
      keys.push("videos");
      break;
    case "link":
      keys.push("links");
      break;
    case "math":
      keys.push("math");
      break;
  }
  if (item.isPinned) keys.push("pinned");
  return keys;
}

/** Counts as they will read once `item` is gone: used while a delete waits on its Undo. */
function countsWithout(counts: Record<string, number>, item: ClipboardItem): Record<string, number> {
  const next = { ...counts };
  for (const key of countKeysFor(item)) {
    if (key in next) next[key] = Math.max(0, next[key] - 1);
  }
  return next;
}

interface ScreenshotEditorRequest {
  vaultId: number;
  width: number;
  height: number;
}

function App() {
  const [items, setItems] = useState<ClipboardItem[]>([]);
  const [category, setCategory] = useState<Category>("all");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [capture, setCapture] = useState<CaptureResult | null>(null);
  const [status, setStatus] = useStatusToast();
  const [view, setView] = useState<"vault" | "settings">("vault");
  const [settingsSection, setSettingsSection] = useState<string | null>(null);
  // Media Viewer: the open item's id (null = closed)
  const [viewerId, setViewerId] = useState<number | null>(null);
  // A freshly saved replay the user asked to watch; opens once it is in the list
  const [watchId, setWatchId] = useState<number | null>(null);
  const [savingClip, setSavingClip] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [clipboardPaused, setClipboardPaused] = useState(false);
  const [vaultLocked, setVaultLocked] = useState(false);
  const [vaultPassword, setVaultPassword] = useState("");
  const [vaultUnlocking, setVaultUnlocking] = useState(false);
  const [vaultError, setVaultError] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [ocrAvailable, setOcrAvailable] = useState(false);
  // Settings previews layout prefs (sidebar side, icons…) before they're saved
  const [uiPreview, setUiPreview] = useState<UiPrefs | null>(null);
  const ui = uiPreview ?? settings.uiPrefs;
  // Deleted rows wait here a few seconds so the toast can offer Undo
  const pendingDeleteRef = useRef<{ id: number; timer: number; item?: ClipboardItem } | null>(null);
  // The app Enter would paste into (null = nothing safe, Enter only copies)
  const [pasteTarget, setPasteTarget] = useState<PasteTarget | null>(null);
  const categoryRef = useRef(category);
  categoryRef.current = category;
  const debouncedQueryRef = useRef(debouncedQuery);
  debouncedQueryRef.current = debouncedQuery;
  const searchRef = useRef<HTMLInputElement>(null);
  const queryRef = useRef(query);
  queryRef.current = query;
  const lastRefreshQueryRef = useRef(debouncedQuery);
  const selectedIdRef = useRef<number | null>(null);
  selectedIdRef.current = selectedId;

  // Set when a fetch fails before the backend is ready, so the settings load can retry it.
  const loadFailedRef = useRef(false);

  // Bumped per refresh so a slow older listItems() can't overwrite newer results.
  const refreshSeqRef = useRef(0);
  const refresh = useCallback(async () => {
    const seq = ++refreshSeqRef.current;
    try {
      const pendingId = pendingDeleteRef.current?.id;
      const raw = await listItems(category, debouncedQuery);
      if (seq !== refreshSeqRef.current) return;
      const data = (raw ?? []).filter((i) => i.id !== pendingId);
      setItems(Array.isArray(data) ? data : []);
      // A new search starts on its top hit, so "type, Enter" copies what you see first
      const queryChanged = lastRefreshQueryRef.current !== debouncedQuery;
      lastRefreshQueryRef.current = debouncedQuery;
      setSelectedId((prev) => {
        if (!queryChanged && prev && data.some((i) => i.id === prev)) return prev;
        return data[0]?.id ?? null;
      });
    } catch (err) {
      console.error(err);
      loadFailedRef.current = true;
      if (seq !== refreshSeqRef.current) return;
      setItems([]);
      setSelectedId(null);
    }
  }, [category, debouncedQuery]);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  const refreshCounts = useCallback(async () => {
    try {
      const fresh = await getCategoryCounts();
      // A delete still inside its Undo window is already gone from the list: keep it out of the badges
      const pending = pendingDeleteRef.current?.item;
      setCounts(pending ? countsWithout(fresh, pending) : fresh);
    } catch (err) {
      console.error(err);
      loadFailedRef.current = true;
    }
  }, []);

  /** Normalize persisted settings into state and apply theme, prefs, scale and pin-on-top. */
  const applyLoadedSettings = useCallback((s: AppSettings): AppSettings => {
    const next = normalizeAppSettings(s);
    setSettings(next);
    applySavedTheme(themeInputFromSettings(next), { uiPrefs: next.uiPrefs });
    applyUiScale(next.uiScale);
    void setMainAlwaysOnTop(next.mainAlwaysOnTop).catch(console.error);
    return next;
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedQuery(query), 200);
    return () => window.clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Which app Enter pastes into. Re-read when the window is shown or focused (no polling):
  // the backend remembers the app you were in before SnipClip came forward.
  const refreshPasteTarget = useCallback(async () => {
    try {
      setPasteTarget(await pasteTargetInfo());
    } catch {
      setPasteTarget(null);
    }
  }, []);

  useEffect(() => {
    void refreshPasteTarget();
    const onShown = () => {
      if (document.visibilityState === "hidden") return;
      void refreshPasteTarget();
      // the popup can pin / clear while this window is in the background
      void refreshCounts();
    };
    window.addEventListener("focus", onShown);
    document.addEventListener("visibilitychange", onShown);
    return () => {
      window.removeEventListener("focus", onShown);
      document.removeEventListener("visibilitychange", onShown);
    };
  }, [refreshPasteTarget, refreshCounts]);

  useEffect(() => {
    let cancelled = false;
    // Retries until setup() has managed the database — a failed first call used to leave
    // the default theme up until Settings was opened.
    void fetchSettingsWithRetry()
      .then((s) => {
        if (cancelled) return;
        const next = applyLoadedSettings(s);
        if (next.compactDock) {
          void applyCompactDockLayout().catch(console.error);
        }
        if (loadFailedRef.current) {
          loadFailedRef.current = false;
          void refreshRef.current();
        }
        void refreshCounts();
        void isOcrAvailable().then(setOcrAvailable).catch(console.error);
        void getClipboardPaused().then(setClipboardPaused).catch(console.error);
        void isVaultLocked()
          .then((locked) => {
            if (locked) {
              setVaultLocked(true);
              void emit("vault-locked");
            }
          })
          .catch(console.error);
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [applyLoadedSettings, refreshCounts]);

  const startSnip = useCallback(async () => {
    try {
      setStatus(null);
      const delayMs = settings.snipDelayEnabled ? settings.snipDelayMs : 0;
      if (delayMs > 0) {
        setStatus(`Snipping in ${Math.round(delayMs / 1000)}s… switch apps, hands off keyboard`, delayMs);
        await delayedSnip(delayMs);
      } else {
        await beginSnip();
      }
    } catch (err) {
      setStatus(`Snip failed: ${err}`, 2400, { tone: "error" });
    }
  }, [settings.snipDelayEnabled, settings.snipDelayMs]);

  const startDelayedSnip = useCallback(async (delayMs = 3000) => {
    try {
      setStatus(`Snipping in ${Math.round(delayMs / 1000)}s… switch apps, hands off keyboard`, delayMs);
      await delayedSnip(delayMs);
    } catch (err) {
      setStatus(`Snip failed: ${err}`, 2400, { tone: "error" });
    }
  }, []);

  useEffect(() => {
    const unsubs: Array<() => void> = [];
    // listen() resolves async: if cleanup already ran (StrictMode / re-subscribe), unlisten at once.
    let disposed = false;
    const keep = (u: () => void) => (disposed ? u() : void unsubs.push(u));

    void listen<ClipboardItem>("clipboard-item", (event) => {
      const item = event.payload;
      if (!item) return;
      void refreshCounts();
      const cat = categoryRef.current;
      const q = debouncedQueryRef.current;
      if (!itemMatchesCategory(item, cat)) return;
      if (!itemMatchesSearch(item, q)) return;

      setItems((prev) => {
        const base = Array.isArray(prev) ? prev : [];
        return [item, ...base.filter((i) => i.id !== item.id)].slice(0, 500);
      });
      setSelectedId(item.id);
    }).then(keep);

    // The popup's GIF tab links here when no KLIPY key is set
    void listen<{ section?: string }>("open-settings", (event) => {
      setViewerId(null);
      setSettingsSection(event.payload?.section ?? null);
      setView("settings");
      void showMainWindow();
    }).then(keep);

    void listen("focus-search", () => {
      setViewerId(null);
      setView("vault");
      searchRef.current?.focus();
      searchRef.current?.select();
    }).then(keep);

    void listen<boolean>("clipboard-paused", (event) => {
      setClipboardPaused(Boolean(event.payload));
    }).then(keep);

    // The popup pinned or cleared something: order and sidebar badges both change
    void listen("library-changed", () => {
      void refreshRef.current();
      void refreshCounts();
    }).then(keep);

    void listen<{ lineCount?: number; preview?: string; charCount?: number }>("ocr-extracted", (event) => {
      const lines = event.payload?.lineCount ?? 0;
      const chars = event.payload?.charCount;
      const preview = event.payload?.preview?.trim();
      if (lines > 0) {
        const countBit =
          chars != null
            ? `${lines} line${lines === 1 ? "" : "s"} · ${chars} chars`
            : `${lines} line${lines === 1 ? "" : "s"}`;
        setStatus(
          preview ? `OCR copied · ${countBit}: ${preview}` : `OCR copied · ${countBit}`,
          2800,
          { tone: "success" }
        );
      } else {
        setStatus("OCR text copied", 2000, { tone: "success" });
      }
    }).then(keep);

    void listen<{ targetLang?: string; preview?: string }>("auto-translated", (event) => {
      const lang = (event.payload?.targetLang ?? "en").toUpperCase();
      const preview = event.payload?.preview?.trim();
      setStatus(
        preview ? `Translated → ${lang}: ${preview}` : `Translated → ${lang}`,
        2800
      );
      void refreshCounts();
    }).then(keep);

    void listen<{ expression?: string; result?: string }>("math-solved", (event) => {
      const expr = event.payload?.expression?.trim();
      const result = event.payload?.result?.trim();
      if (expr && result) {
        setStatus(`Math: ${expr} → ${result} (clipboard unchanged)`, 2400);
      }
      void refreshCounts();
    }).then(keep);

    void listen<{ message?: string }>("hotkey-conflict", (event) => {
      const msg = event.payload?.message?.trim() || "A hotkey is already taken by another app";
      setStatus(`Hotkey conflict: ${msg}`, 6000, { tone: "error" });
    }).then(keep);

    void listen<{ seconds?: number; vaultId?: number }>("replay-saved", (event) => {
      const secs = event.payload?.seconds;
      const vaultId = event.payload?.vaultId;
      setStatus(secs ? `Replay saved (last ${secs}s)` : "Replay saved", 4500, {
        action:
          vaultId != null
            ? {
                label: "Watch",
                onClick: () => {
                  setStatus(null);
                  setQuery("");
                  setView("vault");
                  setCategory("videos");
                  setWatchId(vaultId);
                },
              }
            : undefined,
      });
    }).then(keep);

    void listen<{ message?: string }>("replay-error", (event) => {
      const msg = event.payload?.message?.trim() || "Could not save the replay";
      setStatus(msg, 5000, { tone: "error" });
    }).then(keep);

    void listen<{ path?: string }>("vault-imported", (event) => {
      const p = event.payload?.path ? ` from ${event.payload.path}` : "";
      setStatus(`Vault staged for restore${p}. Restart SnipClip to apply.`, 6000);
    }).then(keep);

    void listen<{ locked?: boolean }>("vault-lock-changed", (event) => {
      const locked = Boolean(event.payload?.locked);
      setVaultLocked(locked);
      setVaultPassword("");
      setVaultError(null);
      if (!locked) {
        setVaultUnlocking(false);
        void refreshRef.current();
        void refreshCounts();
        // Launch read the locked placeholder's default settings — load the real theme now.
        void fetchSettingsWithRetry().then(applyLoadedSettings).catch(console.error);
      }
    }).then(keep);

    void listen<ScreenshotEditorRequest>("open-screenshot-editor", (event) => {
      const payload = event.payload;
      if (!payload) return;
      void (async () => {
        await showMainWindow();
        setViewerId(null);
        setView("vault");
        setStatus("Loading editor…", 1200);
        await new Promise((r) => setTimeout(r, 50));
        try {
          const full = await getItem(payload.vaultId);
          const src =
            full?.content?.startsWith("data:image") ? full.content
            : full?.preview?.startsWith("data:image") ? full.preview
            : null;
          if (!src) {
            setStatus("Screenshot not found", 2000, { tone: "error" });
            return;
          }
          setCapture({
            dataUrl: src,
            width: payload.width,
            height: payload.height,
            monitorName: "screenshot",
            vaultId: payload.vaultId,
          });
          setStatus(null);
        } catch (err) {
          setStatus(String(err), 2400, { tone: "error" });
        }
      })();
    }).then(keep);

    return () => {
      disposed = true;
      unsubs.forEach((u) => u());
    };
  }, [refreshCounts, applyLoadedSettings]);

  async function handleExtractText(id: number) {
    try {
      const text = await copyTextFromImage(id);
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0).length;
      const chars = text.length;
      setStatus(`OCR copied · ${lines} line${lines === 1 ? "" : "s"} · ${chars} chars`, 2200, {
        tone: "success",
      });
    } catch (err) {
      setStatus(String(err), 2400, { tone: "error" });
    }
  }

  async function handleUnlockVault() {
    setVaultUnlocking(true);
    setVaultError(null);
    try {
      await unlockVault(vaultPassword);
      // vault-lock-changed listener clears vaultLocked and refreshes
    } catch (err) {
      setVaultError(String(err));
    } finally {
      setVaultUnlocking(false);
    }
  }

  async function handleCopy(id: number, message?: string) {
    try {
      const item = items.find((i) => i.id === id);
      await copyItem(id);
      setStatus(
        message ?? (item?.contentType === "translated" ? "Copied translation" : "Copied"),
        message ? 2000 : 1200,
        { tone: "success" }
      );
    } catch (err) {
      const msg = String(err);
      if (msg.toLowerCase().includes("not found")) {
        setStatus("Item no longer available", 1600, { tone: "error" });
        await refresh();
      } else {
        setStatus(msg, 2400, { tone: "error" });
      }
    }
  }

  async function handlePaste(
    id: number,
    mode: "paste" | "typeOut" | "copyOnly" = "paste"
  ) {
    try {
      const result = await pasteItem(id, mode);
      if (mode === "copyOnly") {
        setStatus("Copied", 1200, { tone: "success" });
        return;
      }
      if (result.fallbackCopy) {
        // the tracked app vanished between the hint and the keypress
        setStatus(NO_PASTE_TARGET_MESSAGE, 2000, { tone: "success" });
        void refreshPasteTarget();
        return;
      }
      const where = result.targetTitle?.trim();
      setStatus(
        where
          ? `${result.typed ? "Typed" : "Pasted"} → ${where.slice(0, 40)}`
          : result.typed
            ? "Typed into previous app"
            : "Pasted into previous app",
        1400,
        { tone: "success" }
      );
    } catch (err) {
      setStatus(String(err), 2400, { tone: "error" });
    }
  }

  /**
   * Enter: paste into the verified previous app, else copy and say so. The target is
   * re-checked here (not trusted from the hint) so a closed app never gets a blind Ctrl+V.
   */
  async function handleEnterAction(id: number, typeOut = false) {
    let target: PasteTarget | null = null;
    if (settings.directPasteEnabled) {
      try {
        target = await pasteTargetInfo();
      } catch {
        target = null;
      }
      setPasteTarget(target);
    }
    if (!target) {
      await handleCopy(id, settings.directPasteEnabled ? NO_PASTE_TARGET_MESSAGE : undefined);
      return;
    }
    await handlePaste(id, typeOut ? "typeOut" : "paste");
  }
  const handleEnterActionRef = useRef(handleEnterAction);
  handleEnterActionRef.current = handleEnterAction;

  async function handleCopyOriginal(id: number) {
    try {
      const item =
        items.find((i) => i.id === id) ?? (await getItem(id));
      if (!item) {
        setStatus("Item no longer available", 1600, { tone: "error" });
        return;
      }
      const { original } = parseTranslatedContent(item.content || "");
      if (!original) {
        setStatus("No original text", 1600, { tone: "error" });
        return;
      }
      await copyText(original);
      setStatus("Copied original", 1200, { tone: "success" });
    } catch (err) {
      setStatus(String(err), 2400, { tone: "error" });
    }
  }

  async function handleCopyMathResult(id: number) {
    try {
      const item =
        items.find((i) => i.id === id) ?? (await getItem(id));
      if (!item) {
        setStatus("Item no longer available", 1600, { tone: "error" });
        return;
      }
      const { result } = parseMathContent(item.content || "", item.preview || "");
      if (!result) {
        setStatus("No result to copy", 1600, { tone: "error" });
        return;
      }
      await copyText(result);
      setStatus("Copied result", 1200, { tone: "success" });
    } catch (err) {
      setStatus(String(err), 2400, { tone: "error" });
    }
  }

  async function persistWindowPrefs(patch: Partial<AppSettings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    try {
      setSettings(normalizeAppSettings(await updateSettings(next)));
    } catch (err) {
      console.error(err);
      setStatus(String(err), 2400, { tone: "error" });
    }
  }

  async function handleToggleCompact() {
    const next = !settings.compactDock;
    if (next) {
      await applyCompactDockLayout().catch(console.error);
      if (!settings.mainAlwaysOnTop) {
        await setMainAlwaysOnTop(true).catch(console.error);
        await persistWindowPrefs({ compactDock: true, mainAlwaysOnTop: true });
        return;
      }
    } else {
      await applyStudioLayout().catch(console.error);
    }
    await persistWindowPrefs({ compactDock: next });
  }

  async function handleToggleAlwaysOnTop() {
    const next = !settings.mainAlwaysOnTop;
    await setMainAlwaysOnTop(next).catch(console.error);
    await persistWindowPrefs({ mainAlwaysOnTop: next });
  }

  function handleToggleSidebar() {
    const sidebarCollapsed = !ui.sidebarCollapsed;
    // Settings may be previewing prefs — keep that preview in step with the button
    setUiPreview((prev) => (prev ? { ...prev, sidebarCollapsed } : prev));
    void persistWindowPrefs({ uiPrefs: { ...settings.uiPrefs, sidebarCollapsed } });
  }

  const toggleDockRef = useRef(handleToggleCompact);
  toggleDockRef.current = handleToggleCompact;

  useEffect(() => {
    let disposed = false;
    let unlistenDock: (() => void) | undefined;
    let unlistenPrune: (() => void) | undefined;
    void listen("toggle-compact-dock", () => {
      void toggleDockRef.current();
    }).then((u) => {
      if (disposed) u();
      else unlistenDock = u;
    });
    void listen<{ removed?: number; maxHistory?: number }>("history-pruned", (event) => {
      const n = event.payload?.removed ?? 0;
      const cap = event.payload?.maxHistory;
      if (n > 0) {
        setStatus(
          `Trimmed ${n} unpinned item${n === 1 ? "" : "s"}${cap ? ` (cap ${cap})` : ""}`,
          2800
        );
        void refreshRef.current();
        void refreshCounts();
      }
    }).then((u) => {
      if (disposed) u();
      else unlistenPrune = u;
    });
    return () => {
      disposed = true;
      unlistenDock?.();
      unlistenPrune?.();
    };
  }, [refreshCounts]);

  const gridView =
    !settings.compactDock &&
    ui.imageView === "grid" &&
    (category === "images" || category === "screenshots" || category === "videos");
  const mediaTab =
    !settings.compactDock &&
    (category === "images" || category === "screenshots" || category === "videos");

  const dockItems = useMemo(
    () =>
      settings.compactDock
        ? [
            ...items.filter((i) => i.isPinned),
            ...items.filter((i) => !i.isPinned).slice(0, 10),
          ]
        : items,
    [items, settings.compactDock]
  );

  // What the Media Viewer steps through: the media on screen, in list order
  const mediaItems = useMemo(
    () => dockItems.filter((i) => isImageItem(i) || isVideoItem(i)),
    [dockItems]
  );

  function openViewer(id: number) {
    setSelectedId(id);
    setViewerId(id);
  }

  // "Watch" on the replay toast: open that clip once it has reached the list
  useEffect(() => {
    if (watchId == null) return;
    if (items.some((i) => i.id === watchId)) {
      openViewer(watchId);
      setWatchId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchId, items]);

  async function handlePin(id: number) {
    try {
      await togglePin(id);
      // badges and list together: Pinned and the item's own tab both move
      await Promise.all([refresh(), refreshCounts()]);
    } catch (err) {
      setStatus(String(err), 2400, { tone: "error" });
      await Promise.all([refresh(), refreshCounts()]);
    }
  }

  const handlePinRef = useRef(handlePin);
  handlePinRef.current = handlePin;

  /** Run the delete that's waiting on its Undo window (or nothing). */
  const commitPendingDelete = useCallback(() => {
    const pending = pendingDeleteRef.current;
    if (!pending) return;
    window.clearTimeout(pending.timer);
    pendingDeleteRef.current = null;
    void deleteItem(pending.id)
      .then(() => refreshCounts())
      .catch((err) => {
        setStatus(String(err), 2400, { tone: "error" });
        void refreshRef.current();
        void refreshCounts();
      });
  }, [refreshCounts, setStatus]);

  // Don't drop a pending delete if the window reloads mid-countdown
  useEffect(() => commitPendingDelete, [commitPendingDelete]);

  function handleDelete(id: number) {
    commitPendingDelete();
    const list = settings.compactDock ? dockItems : items;
    const idx = list.findIndex((i) => i.id === id);
    let neighbor = list[idx + 1] ?? list[idx - 1] ?? null;
    if (viewerId === id) {
      // The viewer moves on to the next media item (else the previous one, else closes)
      const mi = mediaItems.findIndex((i) => i.id === id);
      const nextMedia = mediaItems[mi + 1] ?? mediaItems[mi - 1] ?? null;
      setViewerId(nextMedia?.id ?? null);
      if (nextMedia) neighbor = nextMedia;
    }
    setItems((prev) => prev.filter((i) => i.id !== id));
    setSelectedId((cur) => (cur === id ? neighbor?.id ?? null : cur));
    const timer = window.setTimeout(commitPendingDelete, 5000);
    const removed = list[idx];
    pendingDeleteRef.current = { id, timer, item: removed };
    // The row is gone now, so the sidebar badges drop now too (not 5 s later, when it commits)
    if (removed) setCounts((prev) => countsWithout(prev, removed));
    const keepsFile = removed?.contentType === "video" || removed?.contentType === "gif";
    setStatus(keepsFile ? "Removed from library · file kept" : "Deleted", 5000, {
      action: {
        label: "Undo",
        onClick: () => {
          const pending = pendingDeleteRef.current;
          if (!pending || pending.id !== id) return;
          window.clearTimeout(pending.timer);
          pendingDeleteRef.current = null;
          setStatus(null);
          void refreshCounts(); // the row is back: so are its counts
          void refresh().then(() => setSelectedId(id));
        },
      },
    });
  }

  /** Clips/GIFs only: move the file to the Recycle Bin and drop the entry (after confirming). */
  async function handleDeleteFile(id: number) {
    const list = settings.compactDock ? dockItems : items;
    const item = list.find((i) => i.id === id) ?? mediaItems.find((i) => i.id === id);
    if (!item || (item.contentType !== "video" && item.contentType !== "gif")) {
      handleDelete(id);
      return;
    }
    const name = item.content.split(/[\/]/).pop() ?? "this file";
    const ok = await ask(
      `Move "${name}" to the Recycle Bin and remove it from SnipClip?

You can restore it from the Recycle Bin.`,
      { title: "Delete file", kind: "warning", okLabel: "Delete file", cancelLabel: "Cancel" }
    );
    if (!ok) return;
    commitPendingDelete();
    // Unmount any <video> showing this file first, or WebView2 keeps it locked.
    if (viewerId === id) {
      const mi = mediaItems.findIndex((i) => i.id === id);
      const next = mediaItems[mi + 1] ?? mediaItems[mi - 1] ?? null;
      setViewerId(next?.id ?? null);
    }
    const idx = list.findIndex((i) => i.id === id);
    const neighbor = list[idx + 1] ?? list[idx - 1] ?? null;
    setItems((prev) => prev.filter((i) => i.id !== id));
    setSelectedId((cur) => (cur === id ? neighbor?.id ?? null : cur));
    setCounts((prev) => countsWithout(prev, item));
    await new Promise((r) => window.setTimeout(r, 200));
    try {
      const fileName = await deleteItemFile(id);
      setStatus(`Moved ${fileName} to the Recycle Bin`, 3200);
      void refreshCounts();
    } catch (err) {
      setStatus(String(err), 3200, { tone: "error" });
      void refreshRef.current();
      void refreshCounts(); // the optimistic drop is wrong now: take the real numbers
    }
  }

  const handleDeleteFileRef = useRef(handleDeleteFile);
  handleDeleteFileRef.current = handleDeleteFile;

  async function handleOpenLink(url: string) {
    try {
      await openUrl(url);
    } catch (err) {
      setStatus(String(err), 2400, { tone: "error" });
    }
  }

  async function handleEditVideo(id: number) {
    try {
      const full = await getItem(id);
      const path = full?.content?.trim();
      if (!path) {
        setStatus("Recording file not found", 2000, { tone: "error" });
        return;
      }
      await openVideoEditor({
        filePath: path,
        vaultId: id,
        width: 1280,
        height: 720,
      });
    } catch (err) {
      setStatus(String(err), 2400, { tone: "error" });
    }
  }

  async function handleUpdateItem(id: number, content: string) {
    try {
      await updateClipboardItem(id, content);
      await Promise.all([refresh(), refreshCounts()]);
      setStatus("Snippet updated", 1200, { tone: "success" });
    } catch (err) {
      setStatus(String(err), 2400, { tone: "error" });
      await refresh();
    }
  }

  async function handleClear() {
    try {
      commitPendingDelete();
      setViewerId(null);
      setCapture(null);
      setQuery("");
      setItems([]);
      setSelectedId(null);
      await clearHistory();
      await refresh();
      await refreshCounts();
      const remaining = (await listItems("all", "")) ?? [];
      const pinnedLeft = remaining.filter((i) => i.isPinned).length;
      setStatus(
        pinnedLeft > 0
          ? `Cleared · ${pinnedLeft} pinned item${pinnedLeft === 1 ? "" : "s"} kept`
          : "History cleared",
        1800,
        { tone: "success" }
      );
    } catch (err) {
      setStatus(String(err), 2400, { tone: "error" });
      await refresh();
      await refreshCounts();
    }
  }

  /** Open the annotation editor with an existing vault image (not a fresh snip). */
  async function handleEditImage(id: number, imageSrc: string) {
    try {
      const size = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        const img = new Image();
        img.onload = () =>
          resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
        img.onerror = () => reject(new Error("Failed to load image for editing"));
        img.src = imageSrc;
      });
      setViewerId(null);
      setCapture({
        dataUrl: imageSrc,
        width: size.width,
        height: size.height,
        monitorName: "vault",
        vaultId: id,
      });
    } catch (err) {
      setStatus(String(err), 2400, { tone: "error" });
    }
  }

  function setImageView(imageView: ImageView) {
    // Settings may be previewing prefs: keep that preview in step with the toggle
    setUiPreview((prev) => (prev ? { ...prev, imageView } : prev));
    void persistWindowPrefs({ uiPrefs: { ...settings.uiPrefs, imageView } });
  }

  async function startRecord() {
    try {
      await beginRecord();
    } catch (err) {
      setStatus(`Record failed: ${err}`, 2400, { tone: "error" });
    }
  }

  async function saveClip() {
    if (savingClip) return;
    setSavingClip(true);
    try {
      await saveReplayClip();
    } catch (err) {
      setStatus(String(err), 5000, { tone: "error" });
    } finally {
      setSavingClip(false);
    }
  }

  function openSettings() {
    setSettingsSection(null);
    setView("settings");
  }

  /** Per-context empty state; every one offers a next step. */
  function renderEmpty() {
    const q = debouncedQuery.trim();
    if (q) {
      return (
        <EmptyState
          icon={<SearchX size={22} />}
          title={`No matches for \u201C${q}\u201D`}
          body="Try fewer or different words."
          action={{
            label: "Clear search",
            onClick: () => {
              setQuery("");
              setDebouncedQuery("");
              searchRef.current?.focus();
            },
          }}
          secondary={
            category !== "all"
              ? { label: "Search all tabs", onClick: () => setCategory("all") }
              : undefined
          }
        />
      );
    }
    const snipKey = formatHotkeyShort(settings.hotkeySnip);
    switch (category) {
      case "videos": {
        const recordKey = formatHotkeyShort(settings.hotkeyRecord);
        const replayKey = formatHotkeyShort(settings.replayHotkey);
        return (
          <EmptyState
            icon={<Film size={22} />}
            title="No clips yet"
            body={
              settings.replayEnabled
                ? `Press ${recordKey} to record your screen, or ${replayKey} to save the last ${settings.replaySeconds} seconds.`
                : `Press ${recordKey} to record your screen.`
            }
            action={{ label: "Record", onClick: () => void startRecord() }}
            secondary={
              settings.replayEnabled
                ? { label: `Clip last ${settings.replaySeconds}s`, onClick: () => void saveClip() }
                : { label: "Open settings", onClick: openSettings }
            }
          />
        );
      }
      case "screenshots":
        return (
          <EmptyState
            icon={<Aperture size={22} />}
            title="No screenshots yet"
            body={`Snip any part of your screen with ${snipKey}.`}
            action={{ label: "Snip", onClick: () => void startSnip() }}
          />
        );
      case "images":
        return (
          <EmptyState
            icon={<ImageIcon size={22} />}
            title="Copied images land here"
            body="Copy an image anywhere and it shows up in this tab."
          />
        );
      case "pinned":
        return (
          <EmptyState
            icon={<Pin size={22} />}
            title="Nothing pinned"
            body="Press P on any item to keep it on top."
          />
        );
      default:
        return (
          <EmptyState
            icon={<Inbox size={22} />}
            title="Your library is empty"
            body={`Copy anything (text, links or images) and it shows up here automatically. Alt+C opens quick paste, ${snipKey} snips a region.`}
            action={{ label: "Snip", onClick: () => void startSnip() }}
          />
        );
    }
  }

  useEffect(() => {
    function navItems() {
      if (!settings.compactDock) return items;
      return [
        ...items.filter((i) => i.isPinned),
        ...items.filter((i) => !i.isPinned).slice(0, 10),
      ];
    }

    function onKey(e: KeyboardEvent) {
      if (capture || view === "settings" || viewerId != null) return;
      const tag = (e.target as HTMLElement)?.tagName;
      const inInput = tag === "INPUT" || tag === "TEXTAREA";
      // A focused button/link/select owns Enter, Space, Delete, P and digits (Tab + Enter must
      // press it, not copy the selected item).
      const tgt = e.target as HTMLElement | null;
      const onControl =
        tag === "BUTTON" || tag === "SELECT" || tag === "A" || tgt?.getAttribute?.("role") === "button";
      // Plain keys only: Ctrl/Alt/Meta combos belong to the OS or other shortcuts.
      const noMod = !e.ctrlKey && !e.altKey && !e.metaKey;
      // Enter keeps its Ctrl/Meta meaning (paste); Alt+Enter is not ours.
      const enterOk = !onControl && !e.altKey;
      const plainOk = !onControl && noMod;
      // Enter in the search field acts on the top hit, so "type, Enter" copies it
      const inSearch = e.target === searchRef.current;

      // Ctrl+F focuses and selects the search text from anywhere (also stops WebView2's find bar)
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }

      // Ctrl+P pins the selected item from anywhere, typing in the search box included
      // (and never opens the webview print dialog). Plain P below still works outside inputs.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        if (selectedIdRef.current != null) void handlePinRef.current(selectedIdRef.current);
        return;
      }

      if (e.key === "/" && !inInput) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }

      // Native text editing (Ctrl+A/C/V/X/Z, Home/End, Shift+arrows, caret moves) stays with
      // the field: only Enter in the search box, Esc and plain Up/Down are ours there.
      const navMod = e.ctrlKey || e.altKey || e.metaKey || e.shiftKey;
      if (
        inInput &&
        e.key !== "Escape" &&
        !((e.key === "ArrowDown" || e.key === "ArrowUp") && !navMod) &&
        !(e.key === "Enter" && inSearch && !e.isComposing)
      ) {
        return;
      }

      if (e.key === "Escape") {
        searchRef.current?.blur();
        setQuery("");
        return;
      }

      const gridNav = gridView && !inInput;
      if (e.key === "ArrowDown" || e.key === "j" || (gridNav && e.key === "ArrowRight")) {
        if (e.key === "j" && inInput) return;
        e.preventDefault();
        const list = navItems();
        setSelectedId((cur) => {
          const idx = list.findIndex((i) => i.id === cur);
          const next = list[Math.min(list.length - 1, Math.max(0, idx + 1))];
          return next?.id ?? cur;
        });
      }

      if (e.key === "ArrowUp" || e.key === "k" || (gridNav && e.key === "ArrowLeft")) {
        if (e.key === "k" && inInput) return;
        e.preventDefault();
        const list = navItems();
        setSelectedId((cur) => {
          const idx = list.findIndex((i) => i.id === cur);
          const next = list[Math.max(0, (idx < 0 ? 0 : idx) - 1)];
          return next?.id ?? cur;
        });
      }

      let enterId = selectedIdRef.current;
      if (e.key === "Enter" && enterOk && inSearch && queryRef.current !== debouncedQueryRef.current) {
        // Typed faster than the search debounce: take the first loaded item that matches
        const hit = navItems().find((i) => itemMatchesSearch(i, queryRef.current));
        if (hit) {
          enterId = hit.id;
          setSelectedId(hit.id);
        }
      }
      // One standard with the popup: Enter pastes into the verified previous app (else copies),
      // Ctrl+Enter only copies, Shift+Enter types it out.
      if (e.key === "Enter" && enterOk && enterId != null && !e.isComposing) {
        e.preventDefault();
        const id = enterId;
        if (e.ctrlKey || e.metaKey) {
          void handleCopy(id);
        } else {
          void handleEnterActionRef.current(id, e.shiftKey);
        }
      }

      // Space previews like Quick Look: images and clips open the Media Viewer
      if (e.key === " " && plainOk && !inInput && selectedIdRef.current != null) {
        const item = navItems().find((i) => i.id === selectedIdRef.current);
        if (item && (isImageItem(item) || isVideoItem(item))) {
          e.preventDefault();
          openViewer(item.id);
        }
      }

      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        plainOk &&
        !inInput &&
        selectedIdRef.current != null
      ) {
        e.preventDefault();
        if (e.shiftKey && e.key === "Delete") void handleDeleteFileRef.current(selectedIdRef.current);
        else handleDelete(selectedIdRef.current);
      }

      if ((e.key === "p" || e.key === "P") && plainOk && !inInput && selectedIdRef.current != null) {
        e.preventDefault();
        void handlePinRef.current(selectedIdRef.current);
      }

      // Digit keys jump to the Nth visible library tab
      if (plainOk && !inInput && /^[1-9]$/.test(e.key)) {
        const n = Number(e.key);
        const visibleTabs =
          settings.sidebarTabs.length > 0
            ? settings.sidebarTabs
            : ["all", "text", "images", "screenshots", "videos", "math", "links", "pinned"];
        const target = visibleTabs[n - 1];
        if (target) {
          e.preventDefault();
          setCategory(target as Category);
          setView("vault");
        }
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    items,
    capture,
    view,
    viewerId,
    counts,
    gridView,
    settings.sidebarTabs,
    settings.compactDock,
    settings.directPasteEnabled,
  ]);

  // Enter hint follows what Enter will really do: paste only when a verified app is tracked
  const enterAction =
    settings.directPasteEnabled && pasteTarget ? `paste into ${pasteTarget.name}` : "copy";
  const enterHint = `Enter ${enterAction}`;

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-app text-fg">
      <TitleBar
        paused={clipboardPaused}
        onTogglePause={() => {
          void toggleClipboardPaused().then(setClipboardPaused).catch(console.error);
        }}
        compactDock={settings.compactDock}
        alwaysOnTop={settings.mainAlwaysOnTop}
        onToggleCompact={() => void handleToggleCompact()}
        onToggleAlwaysOnTop={() => void handleToggleAlwaysOnTop()}
      />
      <div
        className={clsx(
          "flex min-h-0 flex-1 overflow-hidden",
          ui.sidebarPosition === "right" && "flex-row-reverse"
        )}
      >
        {!settings.compactDock && (
          <Sidebar
            category={category}
            onCategory={(c) => {
              setCategory(c);
              setView("vault");
            }}
            onSnip={() => void startSnip()}
            onDelayedSnip={() => void startDelayedSnip(3000)}
            onSettings={() => {
              setSettingsSection(null);
              setView("settings");
            }}
            settingsOpen={view === "settings"}
            counts={counts}
            sidebarTabs={settings.sidebarTabs}
            snipHotkeyLabel={formatHotkeyShort(settings.hotkeySnip)}
            snipDelayEnabled={settings.snipDelayEnabled}
            position={ui.sidebarPosition}
            collapsed={ui.sidebarCollapsed}
            onToggleCollapsed={handleToggleSidebar}
            tabColors={ui.tabColors}
            tabIcons={ui.tabIcons}
          />
        )}
        <main className="flex min-w-0 flex-1 flex-col bg-app">
          {view === "settings" ? (
            <SettingsView
              onClose={() => {
                setView("vault");
                setSettingsSection(null);
              }}
              initialSection={settingsSection}
              historyCount={counts.all ?? items.length}
              onClearHistory={() => handleClear()}
              onPreviewUiPrefs={setUiPreview}
              onSaved={(s) => {
                const next = applyLoadedSettings(s);
                if (next.compactDock) {
                  void applyCompactDockLayout().catch(console.error);
                } else {
                  void applyStudioLayout().catch(console.error);
                }
              }}
            />
          ) : (
            <>
              <div className="border-b border-line px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <SearchBar ref={searchRef} value={query} onChange={setQuery} />
                  </div>
                  {mediaTab && (
                    <div
                      role="group"
                      aria-label="Layout"
                      className="flex shrink-0 items-center gap-0.5 rounded-lg border border-line bg-inset p-0.5"
                    >
                      {(
                        [
                          { id: "grid", label: "Grid view", icon: <LayoutGrid size={15} /> },
                          { id: "list", label: "List view", icon: <Rows3 size={15} /> },
                        ] as { id: ImageView; label: string; icon: ReactNode }[]
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          title={opt.label}
                          aria-label={opt.label}
                          aria-pressed={ui.imageView === opt.id}
                          onClick={() => setImageView(opt.id)}
                          className={clsx(
                            "flex h-8 w-8 items-center justify-center rounded-md transition-colors",
                            ui.imageView === opt.id
                              ? "bg-raised text-fg shadow-sm"
                              : "text-fg-muted hover:text-fg"
                          )}
                        >
                          {opt.icon}
                        </button>
                      ))}
                    </div>
                  )}
                  {!settings.compactDock && (
                    <>
                      <button
                        type="button"
                        title={`Record a clip (${formatHotkeyShort(settings.hotkeyRecord)})`}
                        onClick={() => void startRecord()}
                        className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[12px] text-fg-secondary transition-colors hover:bg-hover"
                      >
                        <Video size={15} />
                        <span className="hidden min-[900px]:inline">Record</span>
                      </button>
                      {settings.replayEnabled && (
                        <button
                          type="button"
                          disabled={savingClip}
                          title={`Save the last ${settings.replaySeconds}s (${formatHotkeyShort(settings.replayHotkey)})`}
                          onClick={() => void saveClip()}
                          className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[12px] text-fg-secondary transition-colors hover:bg-hover disabled:opacity-40"
                        >
                          <Rewind size={15} />
                          <span className="hidden min-[900px]:inline">
                            Clip last {settings.replaySeconds}s
                          </span>
                        </button>
                      )}
                    </>
                  )}
                </div>
                {settings.compactDock ? (
                  <p className="mt-2 text-[11px] text-fg-faint">
                    {settings.directPasteEnabled
                      ? `Pins + last 10 · ${enterHint} · Shift+Enter type · Ctrl+Enter copy`
                      : "Pins + last 10 · Enter copy · enable Direct paste in Settings"}
                  </p>
                ) : (
                  <div className="mt-2 flex h-5 items-center justify-between">
                    <span className="text-[12px] font-medium text-fg-secondary">
                      {LIBRARY_TABS.find((t) => t.id === category)?.label ?? "All"}{" "}
                      <span className="tabular-nums text-fg-faint">
                        {debouncedQuery.trim()
                          ? dockItems.length
                          : counts[category] ?? dockItems.length}
                      </span>
                    </span>
                    <div className="hidden min-w-0 items-center gap-3 whitespace-nowrap text-[11px] text-fg-faint min-[820px]:flex">
                      {mediaTab && <Hint k="Space">view</Hint>}
                      <Hint k="Enter">{enterAction}</Hint>
                      {/* Only worth showing when Enter pastes; otherwise both keys just copy. */}
                      {enterAction !== "copy" && <Hint k="Ctrl+Enter">copy</Hint>}
                      <Hint k="Ctrl+P">pin</Hint>
                      <Hint k="Del">remove</Hint>
                      {clipboardPaused && <span>listening paused</span>}
                    </div>
                  </div>
                )}
                {settings.compactDock && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => void startSnip()}
                      className="rounded-md border border-line px-2 py-1 text-[11px] text-fg-secondary hover:bg-hover"
                    >
                      Snip
                    </button>
                    <button
                      type="button"
                      onClick={() => setView("settings")}
                      className="rounded-md border border-line px-2 py-1 text-[11px] text-fg-secondary hover:bg-hover"
                    >
                      Settings
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleToggleCompact()}
                      className="rounded-md border border-accent/40 bg-accent-soft px-2 py-1 text-[11px] text-accent"
                    >
                      Full studio
                    </button>
                  </div>
                )}
              </div>
              {dockItems.length === 0 ? (
                renderEmpty()
              ) : (
              <ClipboardList
                items={dockItems}
                selectedId={selectedId}
                hotkeySnip={formatHotkeyShort(settings.hotkeySnip)}
                hotkeyPalette="Alt+C"
                ocrAvailable={ocrAvailable}
                groupByDay
                density={ui.density}
                view={gridView ? "grid" : "list"}
                thumbSize={ui.thumbSize}
                onSelect={setSelectedId}
                onCopy={(id) =>
                  void (settings.compactDock && settings.directPasteEnabled
                    ? handleEnterAction(id)
                    : handleCopy(id))
                }
                onCopyOriginal={(id) => void handleCopyOriginal(id)}
                onCopyMathResult={(id) => void handleCopyMathResult(id)}
                onExtractText={(id) => void handleExtractText(id)}
                onPin={(id) => void handlePin(id)}
                onDelete={handleDelete}
                onPreviewImage={openViewer}
                onEditVideo={(id) => void handleEditVideo(id)}
                onOpenLink={(url) => void handleOpenLink(url)}
                onUpdate={(id, content) => void handleUpdateItem(id, content)}
              />
              )}
            </>
          )}
        </main>
      </div>

      {status && (
        <div
          role="status"
          className={clsx(
            viewerId != null ? "bottom-24" : "bottom-4",
            "absolute left-1/2 z-[200] flex max-w-[min(90vw,28rem)] -translate-x-1/2 items-center gap-2 rounded-lg border bg-raised py-2 pl-3 text-[12px] text-fg shadow-lg",
            status.action ? "pointer-events-auto pr-1.5" : "pointer-events-none pr-3.5",
            status.tone === "error" ? "border-danger/40" : "border-line"
          )}
        >
          {status.tone === "error" ? (
            <AlertCircle size={14} className="shrink-0 text-danger" />
          ) : status.tone === "success" ? (
            <CheckCircle2 size={14} className="shrink-0 text-accent" />
          ) : (
            <Info size={14} className="shrink-0 text-fg-muted" />
          )}
          <span className="min-w-0 break-words">{status.message}</span>
          {status.action && (
            <button
              type="button"
              onClick={status.action.onClick}
              className="ml-1 shrink-0 rounded-md px-2 py-1 text-[12px] font-semibold text-accent transition hover:bg-hover"
            >
              {status.action.label}
            </button>
          )}
        </div>
      )}

      {viewerId != null && (
        <MediaViewer
          items={mediaItems}
          activeId={viewerId}
          ocrAvailable={ocrAvailable}
          onNavigate={(id) => {
            setViewerId(id);
            setSelectedId(id);
          }}
          onClose={() => setViewerId(null)}
          onCopy={handleCopy}
          onPin={(id) => void handlePin(id)}
          onDelete={handleDelete}
          onDeleteFile={(id) => void handleDeleteFile(id)}
          onExtractText={handleExtractText}
          onEditImage={(id, src) => void handleEditImage(id, src)}
          onEditVideo={(id) => void handleEditVideo(id)}
          onError={(m) => setStatus(m, 2400, { tone: "error" })}
        />
      )}

      {capture && (
        <SnipOverlay
          capture={capture}
          onClose={() => setCapture(null)}
          onSaved={() => {
            if (capture.vaultId != null) forgetThumbnails(capture.vaultId);
            void refresh();
          }}
        />
      )}

      {vaultLocked && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/80 p-6 select-none">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleUnlockVault();
            }}
            className="w-full max-w-sm rounded-xl border border-line-strong bg-raised p-5 shadow-2xl"
          >
            <h2 className="text-[14px] font-semibold text-fg">Vault locked</h2>
            <p className="mt-1 text-[12px] text-fg-muted">
              Enter your password to decrypt the vault.
            </p>
            <input
              type="password"
              autoFocus
              autoComplete="current-password"
              value={vaultPassword}
              onChange={(e) => setVaultPassword(e.target.value)}
              disabled={vaultUnlocking}
              placeholder="Password"
              className="mt-3 w-full rounded-md border border-line bg-inset px-3 py-2 text-[13px] text-fg outline-none placeholder:text-fg-faint focus:border-accent"
            />
            {vaultError && (
              <p className="mt-2 text-[12px] text-danger">{vaultError}</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setVaultLocked(false);
                  setVaultPassword("");
                  setVaultError(null);
                }}
                className="rounded-md px-3 py-1.5 text-[12px] text-fg-muted hover:bg-hover hover:text-fg"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={vaultUnlocking || !vaultPassword}
                className="rounded-md bg-accent px-3.5 py-1.5 text-[12px] font-semibold text-accent-fg hover:brightness-110 disabled:opacity-50"
              >
                {vaultUnlocking ? "Unlocking…" : "Unlock"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export default App;



