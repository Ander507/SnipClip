import { useMemo, useRef, useState } from "react";
import { Circle, Pause, Play, Square, Volume2, VolumeX } from "lucide-react";
import {
  hideRecorderBar,
  pauseRegionRecording,
  startRegionRecording,
  stopRegionRecording,
} from "../lib/api";
import { isValidRecordRegion, sanitizeRecordRegion } from "../lib/recordDimensions";

export type RecordFormat = "gif" | "mp4";

export interface RecordRegion {
  physX: number;
  physY: number;
  physW: number;
  physH: number;
}

interface Props {
  region: RecordRegion;
  initialFormat?: RecordFormat;
  fps?: number;
  onStopped: (filePath: string, format: RecordFormat, width: number, height: number) => void;
  onError: (message: string) => void;
}

function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function RecordControls({
  region,
  initialFormat = "gif",
  fps = 0,
  onStopped,
  onError,
}: Props) {
  const [format, setFormat] = useState<RecordFormat>(initialFormat);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [systemAudio, setSystemAudio] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const tickRef = useRef<number | undefined>(undefined);
  const safeRegion = useMemo(() => sanitizeRecordRegion(region), [region]);

  async function handleStart() {
    if (recording || busy) return;
    if (!isValidRecordRegion(safeRegion)) {
      onError("Recording region is too small");
      return;
    }
    setBusy(true);
    // the backend only resolves once frames are flowing, so the timer below stays in sync
    // with the encoded video instead of counting the encoder's startup time
    setStatus("Starting…");
    try {
      await startRegionRecording(
        safeRegion.physX,
        safeRegion.physY,
        safeRegion.physW,
        safeRegion.physH,
        fps,
        format,
        systemAudio && format === "mp4"
      );
      setStatus(null);
      setRecording(true);
      setElapsed(0);
      tickRef.current = window.setInterval(() => {
        setElapsed((n) => n + 1);
      }, 1000);
    } catch (err) {
      setStatus(null);
      onError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handlePause() {
    try {
      const nowPaused = await pauseRegionRecording();
      setPaused(nowPaused);
    } catch (err) {
      onError(String(err));
    }
  }

  async function handleStop() {
    if (busy || !recording) return;
    setBusy(true);
    setStatus("Finalizing…");
    if (tickRef.current) {
      window.clearInterval(tickRef.current);
      tickRef.current = undefined;
    }
    try {
      const path = await stopRegionRecording();
      setStatus(null);
      await hideRecorderBar();
      onStopped(path, format, safeRegion.physW, safeRegion.physH);
    } catch (err) {
      setStatus(null);
      onError(String(err));
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/15 bg-[#141414ee] px-3 py-2 shadow-2xl backdrop-blur-md">
      <span className="min-w-[3.25rem] rounded bg-black/50 px-2 py-0.5 font-mono text-[11px] tabular-nums text-white/90">
        {status ?? formatTimer(elapsed)}
      </span>

      {!recording ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleStart()}
          className="flex items-center gap-1 rounded-md bg-red-600 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-red-500 disabled:opacity-50"
        >
          <Circle size={12} fill="currentColor" />
          Start
        </button>
      ) : (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleStop()}
            className="flex items-center gap-1 rounded-md bg-red-600 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-red-500 disabled:opacity-50"
          >
            <Square size={12} fill="currentColor" />
            Stop
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => void handlePause()}
            className="flex items-center gap-1 rounded-md border border-white/15 px-2 py-1 text-[11px] text-white/85 transition hover:bg-white/10 disabled:opacity-50"
            title={paused ? "Resume" : "Pause"}
          >
            {paused ? <Play size={12} /> : <Pause size={12} />}
            {paused ? "Resume" : "Pause"}
          </button>
        </>
      )}

      <div className="ml-1 flex overflow-hidden rounded-md border border-white/10 text-[10px]">
        <button
          type="button"
          disabled={recording}
          onClick={() => setFormat("gif")}
          className={`px-2 py-0.5 transition ${
            format === "gif" ? "bg-accent/30 text-accent" : "text-white/60 hover:bg-white/5"
          } disabled:opacity-40`}
        >
          GIF
        </button>
        <button
          type="button"
          disabled={recording}
          onClick={() => setFormat("mp4")}
          className={`px-2 py-0.5 transition ${
            format === "mp4" ? "bg-accent/30 text-accent" : "text-white/60 hover:bg-white/5"
          } disabled:opacity-40`}
        >
          MP4
        </button>
      </div>

      <button
        type="button"
        disabled={recording || format !== "mp4"}
        aria-pressed={systemAudio}
        title={format === "mp4" ? "Capture desktop audio" : "Desktop audio requires MP4"}
        onClick={() => setSystemAudio((enabled) => !enabled)}
        className={`rounded-md border border-white/10 p-1 transition ${
          systemAudio && format === "mp4"
            ? "bg-accent/30 text-accent"
            : "text-white/50 hover:bg-white/5"
        } disabled:opacity-30`}
      >
        {systemAudio && format === "mp4" ? <Volume2 size={13} /> : <VolumeX size={13} />}
      </button>
    </div>
  );
}
