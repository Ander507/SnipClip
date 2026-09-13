import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { RecordControls, type RecordFormat } from "./components/RecordControls";
import { closeSnipper, finalizeRecording, recorderBarReady, type RecorderBarPayload } from "./lib/api";

export type { RecorderBarPayload };

export function RecorderBarPage() {
  const [payload, setPayload] = useState<RecorderBarPayload | null>(null);
  const [session, setSession] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.classList.add("recorder-mode");
    document.body.classList.add("recorder-mode");
    const root = document.getElementById("root");
    document.documentElement.style.backgroundColor = "transparent";
    document.body.style.backgroundColor = "transparent";
    if (root) root.style.backgroundColor = "transparent";

    const unlisteners: Array<() => void> = [];

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
    }).then((u) => unlisteners.push(u));

    void listen("recorder-bar-hide", () => {
      setPayload(null);
      setError(null);
    }).then((u) => unlisteners.push(u));

    return () => {
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
    setPayload(null);
    try {
      await finalizeRecording(filePath, format, width, height);
    } catch (err) {
      console.error(err);
      setError(String(err));
    } finally {
      await closeSnipper(false);
    }
  }

  if (!payload) {
    return <div className="h-full w-full bg-transparent" />;
  }

  return (
    <div className="flex h-full w-full items-center justify-center bg-transparent p-1">
      {error ? (
        <div className="rounded-md bg-red-900/90 px-3 py-1.5 text-[11px] text-red-100">{error}</div>
      ) : (
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
      )}
    </div>
  );
}
