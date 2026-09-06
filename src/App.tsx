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
  deleteItem,
  listItems,
  togglePin,
  openUrl,
  updateClipboardItem,
  getSettings,
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
  copyText,
} from "./lib/api";
import type { AppSettings, CaptureResult, Category, ClipboardItem } from "./lib/types";
import { DEFAULT_SETTINGS } from "./lib/types";
import { applyTheme } from "./lib/theme";
import { itemMatchesCategory, itemMatchesSearch } from "./lib/search";
import { useStatusToast } from "./lib/useStatusToast";
import { parseTranslatedContent } from "./lib/translatedContent";

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
  const categoryRef = useRef(category);
  categoryRef.current = category;
  const debouncedQueryRef = useRef(debouncedQuery);
  debouncedQueryRef.current = debouncedQuery;
  const searchRef = useRef<HTMLInputElement>(null);
  const selectedIdRef = useRef<number | null>(null);
  selectedIdRef.current = selectedId;

  const refresh = useCallback(async () => {
    try {
      const data = (await listItems(category, debouncedQuery)) ?? [];
      setItems(Array.isArray(data) ? data : []);
      setSelectedId((prev) => {
        if (prev && data.some((i) => i.id === prev)) return prev;
        return data[0]?.id ?? null;
      });
    } catch (err) {
      console.error(err);
      setItems([]);
      setSelectedId(null);
    }
  }, [category, debouncedQuery]);

  const refreshCounts = useCallback(async () => {
    try {
      setCounts(await getCategoryCounts());
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedQuery(query), 200);
    return () => window.clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void getSettings()
      .then((s) => {
        const next = {
          ...s,
          ignoreList: s.ignoreList ?? [],
          themeUseCustom: s.themeUseCustom ?? false,
          themeCustom: s.themeCustom ?? null,
          themeGlassmorphic: s.themeGlassmorphic ?? false,
          themeTranslucency: s.themeTranslucency ?? 0,
          themeBackgroundImage: s.themeBackgroundImage ?? null,
          snipDelayEnabled: s.snipDelayEnabled ?? false,
          snipDelayMs: s.snipDelayMs ?? 3000,
          sidebarTabs: s.sidebarTabs ?? DEFAULT_SETTINGS.sidebarTabs,
          autoTranslateEnabled: s.autoTranslateEnabled ?? false,
          autoTranslateTargetLang: s.autoTranslateTargetLang ?? "en",
        };
        setSettings(next);
        applyTheme(next);
      })
      .catch(console.error);
    void getClipboardPaused().then(setClipboardPaused).catch(console.error);
    void getCategoryCounts().then(setCounts).catch(console.error);
    void isVaultLocked()
      .then((locked) => {
        if (locked) {
          setVaultLocked(true);
          void emit("vault-locked");
        }
      })
      .catch(console.error);
  }, []);

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
      setStatus(`Snip failed: ${err}`);
    }
  }, [settings.snipDelayEnabled, settings.snipDelayMs]);

  const startDelayedSnip = useCallback(async (delayMs = 3000) => {
    try {
      setStatus(`Snipping in ${Math.round(delayMs / 1000)}s… switch apps, hands off keyboard`, delayMs);
      await delayedSnip(delayMs);
    } catch (err) {
      setStatus(`Snip failed: ${err}`);
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
          2800
        );
      } else {
        setStatus("OCR text copied", 2000);
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

    void listen<{ message?: string }>("hotkey-conflict", (event) => {
      const msg = event.payload?.message?.trim() || "A hotkey is already taken by another app";
      setStatus(`Hotkey conflict: ${msg}`, 6000);
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
            setStatus("Screenshot not found", 2000);
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
          setStatus(String(err), 2000);
        }
      })();
    }).then((u) => unsubs.push(u));

    return () => unsubs.forEach((u) => u());
  }, [refresh, refreshCounts]);

  async function handleExtractText(id: number) {
    try {
      const text = await copyTextFromImage(id);
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0).length;
      const chars = text.length;
      setStatus(`OCR copied · ${lines} line${lines === 1 ? "" : "s"} · ${chars} chars`, 2200);
    } catch (err) {
      setStatus(String(err), 2000);
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
        1200
      );
    } catch (err) {
      const msg = String(err);
      if (msg.toLowerCase().includes("not found")) {
        setStatus("Item no longer available", 1600);
        await refresh();
      } else {
        setStatus(msg, 1600);
      }
    }
  }

  async function handleCopyOriginal(id: number) {
    try {
      const item =
        items.find((i) => i.id === id) ?? (await getItem(id));
      if (!item) {
        setStatus("Item no longer available", 1600);
        return;
      }
      const { original } = parseTranslatedContent(item.content || "");
      if (!original) {
        setStatus("No original text", 1600);
        return;
      }
      await copyText(original);
      setStatus("Copied original", 1200);
    } catch (err) {
      setStatus(String(err), 1600);
    }
  }

  async function handlePin(id: number) {
    try {
      await togglePin(id);
      await refresh();
      await refreshCounts();
    } catch (err) {
      setStatus(String(err), 1600);
      await refresh();
      await refreshCounts();
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteItem(id);
      if (previewId === id) closeImagePreview();
      await refresh();
      await refreshCounts();
    } catch (err) {
      setStatus(String(err), 1600);
      await refresh();
      await refreshCounts();
    }
  }

  async function handleOpenLink(url: string) {
    try {
      await openUrl(url);
    } catch (err) {
      setStatus(String(err), 1600);
    }
  }

  async function handleEditVideo(id: number) {
    try {
      const full = await getItem(id);
      const path = full?.content?.trim();
      if (!path) {
        setStatus("Recording file not found", 2000);
        return;
      }
      await openVideoEditor({
        filePath: path,
        vaultId: id,
        width: 1280,
        height: 720,
      });
    } catch (err) {
      setStatus(String(err), 2000);
    }
  }

  async function handleUpdateItem(id: number, content: string) {
    try {
      await updateClipboardItem(id, content);
      await refresh();
      setStatus("Snippet updated", 1200);
    } catch (err) {
      setStatus(String(err), 1600);
      await refresh();
    }
  }

  async function handleClear() {
    try {
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
        1800
      );
    } catch (err) {
      setStatus(String(err), 1600);
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
      setStatus(String(err));
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
      setStatus(String(err), 1600);
    }
  }

  useEffect(() => {
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

      if (e.key === "ArrowDown" || e.key === "j") {
        if (e.key === "j" && inInput) return;
        e.preventDefault();
        setSelectedId((cur) => {
          const idx = items.findIndex((i) => i.id === cur);
          const next = items[Math.min(items.length - 1, Math.max(0, idx + 1))];
          return next?.id ?? cur;
        });
      }

      if (e.key === "ArrowUp" || e.key === "k") {
        if (e.key === "k" && inInput) return;
        e.preventDefault();
        setSelectedId((cur) => {
          const idx = items.findIndex((i) => i.id === cur);
          const next = items[Math.max(0, (idx < 0 ? 0 : idx) - 1)];
          return next?.id ?? cur;
        });
      }

      if (e.key === "Enter" && selectedIdRef.current != null) {
        e.preventDefault();
        void handleCopy(selectedIdRef.current);
      }

      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        !inInput &&
        selectedIdRef.current != null
      ) {
        e.preventDefault();
        void handleDelete(selectedIdRef.current);
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
  }, [items, capture, view, counts, settings.sidebarTabs]);

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-app text-fg">
      <TitleBar
        paused={clipboardPaused}
        onTogglePause={() => {
          void toggleClipboardPaused().then(setClipboardPaused).catch(console.error);
        }}
      />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar
          category={category}
          onCategory={(c) => {
            setCategory(c);
            setView("vault");
          }}
          onSnip={() => void startSnip()}
          onDelayedSnip={() => void startDelayedSnip(3000)}
          onClear={() => void handleClear()}
          onSettings={() => setView("settings")}
          settingsOpen={view === "settings"}
          count={counts.all ?? items.length}
          counts={counts}
          sidebarTabs={settings.sidebarTabs}
          snipHotkeyLabel={formatHotkeyShort(settings.hotkeySnip)}
          snipDelayEnabled={settings.snipDelayEnabled}
        />
        <main className="flex min-w-0 flex-1 flex-col bg-app">
          {view === "settings" ? (
            <SettingsView
              onClose={() => setView("vault")}
              onSaved={(s) => {
                setSettings(s);
                applyTheme(s);
              }}
            />
          ) : (
            <>
              <div className="border-b border-line px-4 py-3">
                <SearchBar ref={searchRef} value={query} onChange={setQuery} />
                <p className="mt-2 text-[11px] text-fg-faint">
                  ↑↓ navigate · Enter copy ·{" "}
                  {formatHotkeyShort(settings.hotkeyClipboard)} toggle
                  {clipboardPaused ? " · listening paused" : ""} · 1–9 switch tab
                </p>
              </div>
              <ClipboardList
                items={items}
                selectedId={selectedId}
                hotkeySnip={formatHotkeyShort(settings.hotkeySnip)}
                hotkeyPalette="Alt+C"
                onSelect={setSelectedId}
                onCopy={(id) => void handleCopy(id)}
                onCopyOriginal={(id) => void handleCopyOriginal(id)}
                onExtractText={(id) => void handleExtractText(id)}
                onPin={(id) => void handlePin(id)}
                onDelete={(id) => void handleDelete(id)}
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
          className="pointer-events-none absolute bottom-4 left-1/2 z-[200] max-w-[min(90vw,28rem)] -translate-x-1/2 rounded-lg border border-line bg-raised px-3.5 py-2 text-center text-[12px] text-fg shadow-lg"
        >
          {status}
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
          onSaved={() => void refresh()}
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



