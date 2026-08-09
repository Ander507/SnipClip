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
  getSettings,
  formatHotkeyShort,
  beginSnip,
  getItem,
} from "./lib/api";
import type { AppSettings, CaptureResult, Category, ClipboardItem } from "./lib/types";

function App() {
  const [items, setItems] = useState<ClipboardItem[]>([]);
  const [category, setCategory] = useState<Category>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [capture, setCapture] = useState<CaptureResult | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [view, setView] = useState<"vault" | "settings">("vault");
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [settings, setSettings] = useState<AppSettings>({
    hotkeyClipboard: "Control+Shift+V",
    hotkeySnip: "Control+Shift+S",
    clearOnBoot: false,
    clearInterval: "never",
    lastCleanup: 0,
    launchAtStartup: false,
  });
  const categoryRef = useRef(category);
  categoryRef.current = category;
  const searchRef = useRef<HTMLInputElement>(null);
  const selectedIdRef = useRef<number | null>(null);
  selectedIdRef.current = selectedId;

  const refresh = useCallback(async () => {
    try {
      const data = (await listItems(category, query)) ?? [];
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
  }, [category, query]);

  useEffect(() => {
    // Clear stale rows when switching category tabs
    setItems([]);
    setSelectedId(null);
  }, [category]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void getSettings().then(setSettings).catch(console.error);
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
      const matchesCategory =
        cat === "all" ||
        (cat === "text" && item.contentType === "text") ||
        (cat === "images" && item.contentType === "image") ||
        (cat === "links" && item.contentType === "link") ||
        (cat === "pinned" && item.isPinned);

      if (!matchesCategory) return;

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

    // Cropped region finished in the snipper window
    void listen<CaptureResult>("snip-complete", (event) => {
      setCapture(event.payload);
    }).then((u) => unsubs.push(u));

    return () => unsubs.forEach((u) => u());
  }, []);

  async function handleCopy(id: number) {
    try {
      await copyItem(id);
      setStatus("Copied");
      setTimeout(() => setStatus(null), 1200);
    } catch (err) {
      const msg = String(err);
      if (msg.toLowerCase().includes("not found")) {
        setStatus("Item no longer available");
        await refresh();
      } else {
        setStatus(msg);
      }
      setTimeout(() => setStatus(null), 1600);
    }
  }

  async function handlePin(id: number) {
    try {
      await togglePin(id);
      await refresh();
    } catch (err) {
      setStatus(String(err));
      setTimeout(() => setStatus(null), 1600);
      await refresh();
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteItem(id);
      if (previewId === id) closeImagePreview();
      await refresh();
    } catch (err) {
      setStatus(String(err));
      setTimeout(() => setStatus(null), 1600);
      await refresh();
    }
  }

  async function handleClear() {
    await clearHistory();
    await refresh();
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
      });
    } catch (err) {
      setStatus(String(err));
      setTimeout(() => setStatus(null), 1600);
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
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#202020] text-white">
      <TitleBar />
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
        <main className="flex min-w-0 flex-1 flex-col bg-[#202020]">
          {view === "settings" ? (
            <SettingsView
              onClose={() => setView("vault")}
              onSaved={(s) => setSettings(s)}
            />
          ) : (
            <>
              <div className="border-b border-[#2d2d2d] px-4 py-3">
                <SearchBar ref={searchRef} value={query} onChange={setQuery} />
                <p className="mt-2 text-[11px] text-[#666666]">
                  ↑↓ navigate · Enter copy ·{" "}
                  {formatHotkeyShort(settings.hotkeyClipboard)} toggle
                </p>
              </div>
              <ClipboardList
                items={items}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onCopy={(id) => void handleCopy(id)}
                onPin={(id) => void handlePin(id)}
                onDelete={(id) => void handleDelete(id)}
                onPreviewImage={(id) => void openImagePreview(id)}
              />
              {status && (
                <div className="border-t border-[#2d2d2d] px-4 py-2 text-[11px] text-[#60cdff]">
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
        onClose={closeImagePreview}
        onCopy={() => {
          if (previewId != null) void handleCopy(previewId);
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