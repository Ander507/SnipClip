import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { VideoEditorModal } from "./components/VideoEditorModal";
import {
  closeVideoEditor,
  discardRecording,
  processVideoClip,
  saveProcessedRecording,
  videoEditorReady,
  type VideoEditorPayload,
} from "./lib/api";

export function VideoEditorPage() {
  const [session, setSession] = useState<VideoEditorPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.classList.add("video-editor-mode");
    document.body.classList.add("video-editor-mode");

    let unlisten: (() => void) | undefined;

    void videoEditorReady()
      .then((pending) => {
        if (pending) setSession(pending);
      })
      .catch(console.error);

    void listen<VideoEditorPayload>("video-editor-open", (event) => {
      setError(null);
      setBusy(false);
      setSession(event.payload);
    }).then((u) => {
      unlisten = u;
    });

    return () => {
      unlisten?.();
      document.documentElement.classList.remove("video-editor-mode");
      document.body.classList.remove("video-editor-mode");
    };
  }, []);

  async function handleSave(opts: {
    outputFormat: "mp4" | "gif";
    startSec: number;
    endSec: number;
    crop: { x: number; y: number; width: number; height: number } | null;
    muteAudio: boolean;
  }) {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const outPath = await processVideoClip({
        inputPath: session.filePath,
        outputFormat: opts.outputFormat,
        startSec: opts.startSec,
        endSec: opts.endSec,
        crop: opts.crop,
        muteAudio: opts.muteAudio,
      });
      const cropW = opts.crop?.width ?? session.width;
      const cropH = opts.crop?.height ?? session.height;
      await saveProcessedRecording({
        filePath: outPath,
        outputFormat: opts.outputFormat,
        width: cropW,
        height: cropH,
        vaultId: session.vaultId ?? null,
        discardInput: session.isDraft ? session.filePath : null,
      });
      setSession(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDiscard() {
    if (!session) return;
    setBusy(true);
    try {
      await discardRecording(session.filePath, session.vaultId ?? null);
      setSession(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleClose() {
    if (busy) return;
    if (session?.isDraft) {
      await handleDiscard();
      return;
    }
    await closeVideoEditor();
    setSession(null);
  }

  if (!session) {
    return <div className="h-full w-full bg-app" />;
  }

  return (
    <VideoEditorModal
      session={{
        filePath: session.filePath,
        width: session.width,
        height: session.height,
        vaultId: session.vaultId,
        isDraft: session.isDraft,
      }}
      busy={busy}
      error={error}
      onSave={handleSave}
      onDiscard={handleDiscard}
      onClose={handleClose}
    />
  );
}
