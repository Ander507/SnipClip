import { useCallback, useEffect, useRef, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { TitleBar } from "./components/TitleBar";
import { Sidebar } from "./components/Sidebar";
import { SearchBar } from "./components/SearchBar";
import { ClipboardList } from "./components/ClipboardList";
import { SnipOverlay } from "./components/SnipOverlay";
import { SettingsView } from "./components/SettingsView";
import { ImageViewerModal } from "./components/ImageViewerModal";
import {
  clearHistory,
  copyItem,
  copyText,
  deleteItem,
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
  updateSettings,
  isOcrAvailable,
} from "./lib/api";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";
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
import { itemMatchesCategory, itemMatchesSearch } from "./lib/search";
import { useStatusToast } from "./lib/useStatusToast";
import { parseTranslatedContent } from "./lib/translatedContent";
import { parseMathContent } from "./lib/mathContent";
import {
  applyCompactDockLayout,
  applyStudioLayout,
  setMainAlwaysOnTop,
} from "./lib/compactDock";

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
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
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
  const pendingDeleteRef = useRef<{ id: number; timer: number } | null>(null);
  const categoryRef = useRef(category);
  categoryRef.current = category;
  const debouncedQueryRef = useRef(debouncedQuery);
  debouncedQueryRef.current = debouncedQuery;
  const searchRef = useRef<HTMLInputElement>(null);
  const selectedIdRef = useRef<number | null>(null);
  selectedIdRef.current = selectedId;

  // Set when a fetch fails before the backend is ready, so the settings load can retry it.
  const loadFailedRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const pendingId = pendingDeleteRef.current?.id;
      const data = ((await listItems(category, debouncedQuery)) ?? []).filter(
        (i) => i.id !== pendingId
      );
      setItems(Array.isArray(data) ? data : []);
      setSelectedId((prev) => {
        if (prev && data.some((i) => i.id === prev)) return prev;
        return data[0]?.id ?? null;
      });
    } catch (err) {
      console.error(err);
      loadFailedRef.current = true;
      setItems([]);
      setSelectedId(null);
    }
  }, [category, debouncedQuery]);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  const refreshCounts = useCallback(async () => {
    try {
      setCounts(await getCategoryCounts());
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
    }).then((u) => unsubs.push(u));

    // The popup's GIF tab links here when no KLIPY key is set
    void listen<{ section?: string }>("open-settings", (event) => {
      setSettingsSection(event.payload?.section ?? null);
      setView("settings");
      void showMainWindow();
    }).then((u) => unsubs.push(u));

    void listen("focus-search", () => {
      setView("vault");
      searchRef.current?.focus();
      searchRef.current?.select();
    }).then((u) => unsubs.push(u));

    void listen<boolean>("clipboard-paused", (event) => {
      setClipboardPaused(Boolean(event.payload));
    }).then((u) => unsubs.push(u));

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
    }).then((u) => unsubs.push(u));

    void listen<{ targetLang?: string; preview?: string }>("auto-translated", (event) => {
      const lang = (event.payload?.targetLang ?? "en").toUpperCase();
      const preview = event.payload?.preview?.trim();
      setStatus(
        preview ? `Translated → ${lang}: ${preview}` : `Translated → ${lang}`,
        2800
      );
      void refreshCounts();
    }).then((u) => unsubs.push(u));

    void listen<{ expression?: string; result?: string }>("math-solved", (event) => {
      const expr = event.payload?.expression?.trim();
      const result = event.payload?.result?.trim();
      if (expr && result) {
        setStatus(`Math: ${expr} → ${result} (clipboard unchanged)`, 2400);
      }
      void refreshCounts();
    }).then((u) => unsubs.push(u));

    void listen<{ message?: string }>("hotkey-conflict", (event) => {
      const msg = event.payload?.message?.trim() || "A hotkey is already taken by another app";
      setStatus(`Hotkey conflict: ${msg}`, 6000, { tone: "error" });
    }).then((u) => unsubs.push(u));

    void listen<{ path?: string }>("vault-imported", (event) => {
      const p = event.payload?.path ? ` from ${event.payload.path}` : "";
      setStatus(`Vault staged for restore${p}. Restart SnipClip to apply.`, 6000);
    }).then((u) => unsubs.push(u));

    void listen<{ locked?: boolean }>("vault-lock-changed", (event) => {
      const locked = Boolean(event.payload?.locked);
      setVaultLocked(locked);
      setVaultPassword("");
      setVaultError(null);
      if (!locked) {
        setVaultUnlocking(false);
        void refresh();
        void refreshCounts();
        // Launch read the locked placeholder's default settings — load the real theme now.
        void fetchSettingsWithRetry().then(applyLoadedSettings).catch(console.error);
      }
    }).then((u) => unsubs.push(u));

    void listen<ScreenshotEditorRequest>("open-screenshot-editor", (event) => {
      const payload = event.payload;
      if (!payload) return;
      void (async () => {
        await showMainWindow();
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
    }).then((u) => unsubs.push(u));

    return () => unsubs.forEach((u) => u());
  }, [refresh, refreshCounts, applyLoadedSettings]);

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

  async function handleCopy(id: number) {
    try {
      const item = items.find((i) => i.id === id);
      await copyItem(id);
      setStatus(
        item?.contentType === "translated" ? "Copied translation" : "Copied",
        1200,
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
    let unlistenDock: (() => void) | undefined;
    let unlistenPrune: (() => void) | undefined;
    void listen("toggle-compact-dock", () => {
      void toggleDockRef.current();
    }).then((u) => {
      unlistenDock = u;
    });
    void listen<{ removed?: number; maxHistory?: number }>("history-pruned", (event) => {
      const n = event.payload?.removed ?? 0;
      const cap = event.payload?.maxHistory;
      if (n > 0) {
        setStatus(
          `Trimmed ${n} unpinned item${n === 1 ? "" : "s"}${cap ? ` (cap ${cap})` : ""}`,
          2800
        );
        void refresh();
        void refreshCounts();
      }
    }).then((u) => {
      unlistenPrune = u;
    });
    return () => {
      unlistenDock?.();
      unlistenPrune?.();
    };
  }, [refresh, refreshCounts]);

  const gridView =
    !settings.compactDock &&
    ui.imageView === "grid" &&
    (category === "images" || category === "screenshots");

  const dockItems = settings.compactDock
    ? [
        ...items.filter((i) => i.isPinned),
        ...items.filter((i) => !i.isPinned).slice(0, 10),
      ]
    : items;

  async function handlePin(id: number) {
    try {
      await togglePin(id);
      await refresh();
      await refreshCounts();
    } catch (err) {
      setStatus(String(err), 2400, { tone: "error" });
      await refresh();
      await refreshCounts();
    }
  }

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
      });
  }, [refreshCounts, setStatus]);

  // Don't drop a pending delete if the window reloads mid-countdown
  useEffect(() => commitPendingDelete, [commitPendingDelete]);

  function handleDelete(id: number) {
    commitPendingDelete();
    if (previewId === id) closeImagePreview();
    const list = settings.compactDock ? dockItems : items;
    const idx = list.findIndex((i) => i.id === id);
    const neighbor = list[idx + 1] ?? list[idx - 1] ?? null;
    setItems((prev) => prev.filter((i) => i.id !== id));
    setSelectedId((cur) => (cur === id ? neighbor?.id ?? null : cur));
    const timer = window.setTimeout(commitPendingDelete, 5000);
    pendingDeleteRef.current = { id, timer };
    setStatus("Deleted", 5000, {
      action: {
        label: "Undo",
        onClick: () => {
          const pending = pendingDeleteRef.current;
          if (!pending || pending.id !== id) return;
          window.clearTimeout(pending.timer);
          pendingDeleteRef.current = null;
          setStatus(null);
          void refresh().then(() => setSelectedId(id));
        },
      },
    });
  }

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
      await refresh();
      setStatus("Snippet updated", 1200, { tone: "success" });
    } catch (err) {
      setStatus(String(err), 2400, { tone: "error" });
      await refresh();
    }
  }

  async function handleClear() {
    try {
      commitPendingDelete();
      closeImagePreview();
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

  async function openImagePreview(id: number) {
    setPreviewId(id);
    setPreviewLoading(true);
    setPreviewSrc(null);
    try {
      const full = await getItem(id);
      if (full?.content?.startsWith("data:image")) {
        setPreviewSrc(full.content);
      } else if (full?.preview?.startsWith("data:image")) {
        setPreviewSrc(full.preview);
      }
    } catch (err) {
      setStatus(String(err), 2400, { tone: "error" });
      setPreviewId(null);
    } finally {
      setPreviewLoading(false);
    }
  }

  function closeImagePreview() {
    setPreviewId(null);
    setPreviewSrc(null);
    setPreviewLoading(false);
  }

  /** Open the annotation editor with an existing vault image (not a fresh snip). */
  async function handleEditImage(imageSrc: string) {
    try {
      const size = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        const img = new Image();
        img.onload = () =>
          resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
        img.onerror = () => reject(new Error("Failed to load image for editing"));
        img.src = imageSrc;
      });
      closeImagePreview();
      setCapture({
        dataUrl: imageSrc,
        width: size.width,
        height: size.height,
        monitorName: "vault",
        vaultId: previewId ?? undefined,
      });
    } catch (err) {
      setStatus(String(err), 2400, { tone: "error" });
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
      if (capture || view === "settings") return;
      const tag = (e.target as HTMLElement)?.tagName;
      const inInput = tag === "INPUT" || tag === "TEXTAREA";

      if (e.key === "/" && !inInput) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }

      if (inInput && e.key !== "Escape" && e.key !== "ArrowDown" && e.key !== "ArrowUp") {
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

      if (e.key === "Enter" && selectedIdRef.current != null) {
        e.preventDefault();
        const id = selectedIdRef.current;
        const canPaste = settings.directPasteEnabled;
        if (e.shiftKey) {
          if (canPaste) void handlePaste(id, "typeOut");
          else void handleCopy(id);
        } else if (e.ctrlKey || e.metaKey) {
          if (canPaste) {
            if (settings.compactDock) {
              void handlePaste(id, "copyOnly");
            } else {
              void handlePaste(id, "paste");
            }
          } else {
            void handleCopy(id);
          }
        } else if (settings.compactDock && canPaste) {
          void handlePaste(id, "paste");
        } else {
          void handleCopy(id);
        }
      }

      // Space previews like Quick Look — images open the viewer, recordings the editor
      if (e.key === " " && !inInput && selectedIdRef.current != null) {
        const item = navItems().find((i) => i.id === selectedIdRef.current);
        if (item?.contentType === "image" || item?.contentType === "screenshot") {
          e.preventDefault();
          void openImagePreview(item.id);
        } else if (item?.contentType === "video" || item?.contentType === "gif") {
          e.preventDefault();
          void handleEditVideo(item.id);
        }
      }

      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        !inInput &&
        selectedIdRef.current != null
      ) {
        e.preventDefault();
        handleDelete(selectedIdRef.current);
      }

      if (e.key === "p" && !inInput && selectedIdRef.current != null) {
        e.preventDefault();
        void handlePin(selectedIdRef.current);
      }

      // Digit keys jump to the Nth visible library tab
      if (!inInput && /^[1-9]$/.test(e.key)) {
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
    counts,
    gridView,
    settings.sidebarTabs,
    settings.compactDock,
    settings.directPasteEnabled,
  ]);

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
                <SearchBar ref={searchRef} value={query} onChange={setQuery} />
                <p className="mt-2 text-[11px] text-fg-faint">
                  {settings.compactDock
                    ? settings.directPasteEnabled
                      ? "Pins + last 10 · Enter paste · Shift+Enter type · Ctrl+Enter copy"
                      : "Pins + last 10 · Enter copy · enable Direct paste in Settings"
                    : settings.directPasteEnabled
                      ? `↑↓ navigate · Enter copy · Ctrl+Enter paste · Space preview · ${formatHotkeyShort(settings.hotkeyClipboard)} toggle${
                          clipboardPaused ? " · listening paused" : ""
                        } · 1–9 switch tab`
                      : `↑↓ navigate · Enter copy · Space preview · ${formatHotkeyShort(settings.hotkeyClipboard)} toggle${
                          clipboardPaused ? " · listening paused" : ""
                        } · 1–9 switch tab`}
                </p>
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
                    ? handlePaste(id, "paste")
                    : handleCopy(id))
                }
                onCopyOriginal={(id) => void handleCopyOriginal(id)}
                onCopyMathResult={(id) => void handleCopyMathResult(id)}
                onExtractText={(id) => void handleExtractText(id)}
                onPin={(id) => void handlePin(id)}
                onDelete={handleDelete}
                onPreviewImage={(id) => void openImagePreview(id)}
                onEditVideo={(id) => void handleEditVideo(id)}
                onOpenLink={(url) => void handleOpenLink(url)}
                onUpdate={(id, content) => void handleUpdateItem(id, content)}
              />
            </>
          )}
        </main>
      </div>

      {status && (
        <div
          role="status"
          className={clsx(
            "absolute bottom-4 left-1/2 z-[200] flex max-w-[min(90vw,28rem)] -translate-x-1/2 items-center gap-2 rounded-lg border bg-raised py-2 pl-3 text-[12px] text-fg shadow-lg",
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

      <ImageViewerModal
        imageSrc={previewSrc}
        loading={previewLoading}
        onClose={closeImagePreview}
        onCopy={async () => {
          if (previewId != null) await handleCopy(previewId);
        }}
        onExtractText={() => {
          if (previewId != null) void handleExtractText(previewId);
        }}
        onEdit={(src) => void handleEditImage(src)}
      />

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



