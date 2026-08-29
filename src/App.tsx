import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
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
  getItem,
  getClipboardPaused,
  toggleClipboardPaused,
  copyTextFromImage,
  isOcrAvailable,
  saveSnipToVault,
} from "./lib/api";
import type { AppSettings, CaptureResult, Category, ClipboardItem } from "./lib/types";
import { DEFAULT_SETTINGS } from "./lib/types";
import { applyTheme } from "./lib/theme";
import { itemMatchesCategory, itemMatchesSearch } from "./lib/search";
import { useStatusToast } from "./lib/useStatusToast";

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
  const [ocrAvailable, setOcrAvailable] = useState(false);
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
        };
        setSettings(next);
        applyTheme(next);
      })
      .catch(console.error);
    void getClipboardPaused().then(setClipboardPaused).catch(console.error);
    void isOcrAvailable().then(setOcrAvailable).catch(() => setOcrAvailable(false));
  }, []);

  const startSnip = useCallback(async () => {
    try {
      setStatus(null);
      // Rust hides main, captures, shows the preloaded snipper window
      await beginSnip();
    } catch (err) {
      setStatus(`Snip failed: ${err}`);
    }
  }, []);

  useEffect(() => {
    const unsubs: Array<() => void> = [];

    void listen<ClipboardItem>("clipboard-item", (event) => {
      const item = event.payload;
      if (!item) return;
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

    // Cropped region finished in the snipper window — always vault as Screenshots
    void listen<CaptureResult>("snip-complete", (event) => {
      const result = event.payload;
      if (!result) return;
      void (async () => {
        let vaultId: number | undefined;
        try {
          const item = await saveSnipToVault(result.dataUrl, result.width, result.height);
          vaultId = item.id;
          const cat = categoryRef.current;
          const q = debouncedQueryRef.current;
          if (itemMatchesCategory(item, cat) && itemMatchesSearch(item, q)) {
            setItems((prev) => {
              const base = Array.isArray(prev) ? prev : [];
              return [item, ...base.filter((i) => i.id !== item.id)].slice(0, 500);
            });
            setSelectedId(item.id);
          }
        } catch (err) {
          console.error(err);
        }
        setCapture({ ...result, vaultId });
      })();
    }).then((u) => unsubs.push(u));

    return () => unsubs.forEach((u) => u());
  }, []);

  async function handleExtractText(id: number) {
    try {
      const text = await copyTextFromImage(id);
      const preview = text.length > 48 ? `${text.slice(0, 48)}…` : text;
      setStatus(`Copied text: ${preview}`, 2200);
    } catch (err) {
      setStatus(String(err), 2000);
    }
  }

  async function handleCopy(id: number) {
    try {
      await copyItem(id);
      setStatus("Copied", 1200);
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

  async function handlePin(id: number) {
    try {
      await togglePin(id);
      await refresh();
    } catch (err) {
      setStatus(String(err), 1600);
      await refresh();
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteItem(id);
      if (previewId === id) closeImagePreview();
      await refresh();
    } catch (err) {
      setStatus(String(err), 1600);
      await refresh();
    }
  }

  async function handleOpenLink(url: string) {
    try {
      await openUrl(url);
    } catch (err) {
      setStatus(String(err), 1600);
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
      setStatus("History cleared", 1400);
    } catch (err) {
      setStatus(String(err), 1600);
      await refresh();
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
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, capture, view]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-app text-fg">
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
          onClear={() => void handleClear()}
          onSettings={() => setView("settings")}
          settingsOpen={view === "settings"}
          count={items.length}
          snipHotkeyLabel={formatHotkeyShort(settings.hotkeySnip)}
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
                  {clipboardPaused ? " · listening paused" : ""}
                </p>
              </div>
              <ClipboardList
                items={items}
                selectedId={selectedId}
                ocrAvailable={ocrAvailable}
                onSelect={setSelectedId}
                onCopy={(id) => void handleCopy(id)}
                onExtractText={(id) => void handleExtractText(id)}
                onPin={(id) => void handlePin(id)}
                onDelete={(id) => void handleDelete(id)}
                onPreviewImage={(id) => void openImagePreview(id)}
                onOpenLink={(url) => void handleOpenLink(url)}
                onUpdate={(id, content) => void handleUpdateItem(id, content)}
              />
              {status && (
                <div className="border-t border-line px-4 py-2 text-[11px] text-accent">
                  {status}
                </div>
              )}
            </>
          )}
        </main>
      </div>

      <ImageViewerModal
        imageSrc={previewSrc}
        loading={previewLoading}
        ocrAvailable={ocrAvailable}
        onClose={closeImagePreview}
        onCopy={() => {
          if (previewId != null) void handleCopy(previewId);
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
    </div>
  );
}

export default App;



