import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emitTo } from "@tauri-apps/api/event";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Pencil, X } from "lucide-react";
import { closeScreenshotPopup } from "./lib/api";
import { useThemeSync } from "./lib/themeSync";

export interface ScreenshotPopupData {
  vaultId: number;
  width: number;
  height: number;
  thumbnailDataUrl?: string;
  mediaPath?: string;
  mediaKind?: string;
}

const AUTO_DISMISS_MS = 5000;

/**
 * macOS-style corner thumbnail after a snip — edit or dismiss.
 */
export function ScreenshotPopupPage() {
  const [payload, setPayload] = useState<ScreenshotPopupData | null>(null);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  useThemeSync({ effects: false });

  useEffect(() => {
    document.documentElement.classList.add("popup-mode");
    document.body.classList.add("popup-mode");
    const root = document.getElementById("root");
    document.documentElement.style.setProperty("background-color", "transparent", "important");
    document.body.style.setProperty("background-color", "transparent", "important");
    root?.style.setProperty("background-color", "transparent", "important");

    let dismissTimer: number | undefined;
    let unlisten: (() => void) | undefined;

    void listen<ScreenshotPopupData>("screenshot-popup-show", (event) => {
      busyRef.current = false;
      setBusy(false);
      setPayload(event.payload);
      setVisible(false);
      requestAnimationFrame(() => setVisible(true));

      if (dismissTimer) window.clearTimeout(dismissTimer);
      dismissTimer = window.setTimeout(() => {
        void dismiss();
      }, AUTO_DISMISS_MS);
    }).then((u) => {
      unlisten = u;
    });

    return () => {
      unlisten?.();
      if (dismissTimer) window.clearTimeout(dismissTimer);
      document.documentElement.classList.remove("popup-mode");
      document.body.classList.remove("popup-mode");
    };
  }, []);

  async function dismiss() {
    if (busyRef.current) return;
    setVisible(false);
    try {
      await closeScreenshotPopup();
    } catch {
      await getCurrentWindow().hide();
    }
  }

  async function handleEdit() {
    if (!payload || busyRef.current) return;
    if (payload.mediaKind === "gif" || payload.mediaKind === "video") {
      if (!payload.mediaPath) {
        void dismiss();
        return;
      }
      busyRef.current = true;
      setBusy(true);
      try {
        await closeScreenshotPopup();
        const { openVideoEditor } = await import("./lib/api");
        await openVideoEditor({
          filePath: payload.mediaPath,
          width: payload.width,
          height: payload.height,
          vaultId: payload.vaultId,
        });
      } catch (err) {
        console.error(err);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
      return;
    }
    busyRef.current = true;
    setBusy(true);
    const { vaultId, width, height } = payload;
    try {
      await closeScreenshotPopup();
      await emitTo("main", "open-screenshot-editor", { vaultId, width, height });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  if (!payload) {
    return <div className="h-full w-full bg-transparent" />;
  }

  const thumb = payload.thumbnailDataUrl;
  const mediaSrc = payload.mediaPath ? convertFileSrc(payload.mediaPath) : null;
  const isVideo = payload.mediaKind === "video";
  const isGif = payload.mediaKind === "gif";

  return (
    <div
      className={`screenshot-popup-shell h-full w-full bg-transparent p-2 transition-all duration-300 ease-out ${
        visible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
      }`}
    >
      <div className="flex h-full items-stretch gap-2 rounded-xl border border-line-strong bg-raised/95 p-2 shadow-2xl backdrop-blur-md">
        <button
          type="button"
          className="group relative min-w-0 flex-1 overflow-hidden rounded-lg border border-line bg-inset disabled:opacity-50"
          onClick={() => void handleEdit()}
          disabled={busy}
          title={isVideo || isGif ? "Edit recording" : "Edit screenshot"}
        >
          {isVideo && mediaSrc ? (
            <video
              src={mediaSrc}
              className="h-full w-full object-cover"
              autoPlay
              loop
              muted
              playsInline
            />
          ) : isGif && mediaSrc ? (
            <img
              src={mediaSrc}
              alt="Recording preview"
              className="h-full w-full object-cover"
            />
          ) : thumb?.startsWith("data:image") ? (
            <img
              src={thumb}
              alt="Screenshot preview"
              className="h-full w-full object-cover transition group-hover:scale-[1.02]"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-[10px] text-fg-muted">
              {isVideo ? "Video" : isGif ? "GIF" : "Screenshot"}
            </div>
          )}
        </button>
        <div className="flex flex-col justify-between gap-1">
          <button
            type="button"
            title="Edit"
            disabled={busy}
            className="rounded-md p-1.5 text-fg-secondary transition hover:bg-hover hover:text-fg disabled:opacity-50"
            onClick={() => void handleEdit()}
          >
            <Pencil size={14} />
          </button>
          <button
            type="button"
            title="Dismiss"
            disabled={busy}
            className="rounded-md p-1.5 text-fg-muted transition hover:bg-hover hover:text-fg disabled:opacity-50"
            onClick={() => void dismiss()}
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

export { ScreenshotPopupPage as ScreenshotPopup };

