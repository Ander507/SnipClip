import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { RecordControls, type RecordFormat } from "./components/RecordControls";
import {
  finalizeRecording,
  hideRecorderBar,
  recorderBarReady,
  type RecorderBarPayload,
} from "./lib/api";
import { useThemeSync } from "./lib/themeSync";

export type { RecorderBarPayload };

export function RecorderBarPage() {
  const [payload, setPayload] = useState<RecorderBarPayload | null>(null);
  const [session, setSession] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useThemeSync({ effects: false });

  useEffect(() => {
    document.documentElement.classList.add("recorder-mode");
    document.body.classList.add("recorder-mode");
    const root = document.getElementById("root");
    document.documentElement.style.backgroundColor = "transparent";
    document.body.style.backgroundColor = "transparent";
    if (root) root.style.backgroundColor = "transparent";

    const unlisteners: Array<() => void> = [];
    let disposed = false;
    const keep = (u: () => void) => (disposed ? u() : void unlisteners.push(u));

    function showBar(next: RecorderBarPayload) {
      setError(null);
      // Force a fresh RecordControls mount — the webview stays alive between recordings,
      // so without a new key the previous Stop/timer state would stick on the next show.
      setSession((n) => n + 1);
      setPayload(next);
    }

    void recorderBarReady()
      .then((pending) => {
        if (pending) showBar(pending);
      })
      .catch(console.error);

    void listen<RecorderBarPayload>("recorder-bar-show", (event) => {
      showBar(event.payload);
    }).then(keep);

    void listen("recorder-bar-hide", () => {
      setPayload(null);
      setError(null);
    }).then(keep);

    return () => {
      disposed = true;
      for (const u of unlisteners) u();
      document.documentElement.classList.remove("recorder-mode");
      document.body.classList.remove("recorder-mode");
    };
  }, []);

  async function handleStopped(
    filePath: string,
    format: RecordFormat,
    width: number,
    height: number
  ) {
    try {
      await finalizeRecording(filePath, format, width, height);
      setPayload(null);
    } catch (err) {
      // The bar is already hidden at this point and the payload used to be cleared first, so
      // this error was never shown anywhere. Bring the bar back to say what went wrong.
      console.error(err);
      setError(`Recording was saved to ${filePath}, but adding it to the vault failed: ${String(err)}`);
      await getCurrentWindow().show().catch(() => undefined);
    }
    // Do not closeSnipper here — snippers were already parked when the bar opened.
    // A late close after finalize was racing and killing the next snip overlay.
  }

  if (!payload && !error) {
    return <div className="h-full w-full bg-transparent" />;
  }

  return (
    <div className="flex h-full w-full items-center justify-center bg-transparent p-1">
      {error ? (
        <div className="flex max-w-full items-center gap-2 rounded-md border border-danger/40 bg-raised px-3 py-1.5 text-[11px] text-danger shadow-2xl">
          <span className="min-w-0 truncate" title={error}>
            {error}
          </span>
          {/* An error used to leave the bar stuck on screen with nothing to click. */}
          <button
            type="button"
            onClick={() => {
              setError(null);
              setPayload(null);
              void hideRecorderBar().catch(() => undefined);
            }}
            className="shrink-0 rounded border border-line px-1.5 py-0.5 text-fg-secondary transition hover:bg-hover"
          >
            Close
          </button>
        </div>
      ) : payload ? (
        <RecordControls
          key={session}
          region={payload.region}
          initialFormat={
            payload.format === "mp4" || payload.format === "gif" ? payload.format : undefined
          }
          fps={payload.fps}
          onStopped={(path, fmt, w, h) => void handleStopped(path, fmt, w, h)}
          onError={(msg) => setError(msg)}
        />
      ) : null}
    </div>
  );
}
