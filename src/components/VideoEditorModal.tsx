import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  Crop,
  Film,
  Loader2,
  Pause,
  Play,
  Save,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import clsx from "clsx";
import type { CropParams } from "../lib/api";

export interface VideoEditorSession {
  filePath: string;
  width: number;
  height: number;
  vaultId?: number | null;
  isDraft?: boolean;
}

interface Props {
  session: VideoEditorSession;
  busy?: boolean;
  error?: string | null;
  onSave: (opts: {
    outputFormat: "mp4" | "gif";
    startSec: number;
    endSec: number;
    crop: CropParams | null;
    muteAudio: boolean;
  }) => void | Promise<void>;
  onDiscard: () => void | Promise<void>;
  onClose: () => void | Promise<void>;
}

function formatTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function VideoEditorModal({
  session,
  busy = false,
  error = null,
  onSave,
  onDiscard,
  onClose,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [inPoint, setInPoint] = useState(0);
  const [outPoint, setOutPoint] = useState(0);
  const [muteAudio, setMuteAudio] = useState(false);
  const [cropEnabled, setCropEnabled] = useState(false);
  const [outputFormat, setOutputFormat] = useState<"mp4" | "gif">("mp4");
  const [dragHandle, setDragHandle] = useState<"in" | "out" | "play" | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [cropDrag, setCropDrag] = useState<
    | null
    | { kind: "move"; startX: number; startY: number; orig: typeof crop }
    | { kind: "se"; startX: number; startY: number; orig: typeof crop }
  >(null);

  const src = convertFileSrc(session.filePath);
  const isGifSource = session.filePath.toLowerCase().endsWith(".gif");

  useEffect(() => {
    setOutputFormat(isGifSource ? "gif" : "mp4");
    setMuteAudio(false);
    setCropEnabled(false);
    setInPoint(0);
    setOutPoint(0);
    setCurrent(0);
  }, [session.filePath, isGifSource]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (busy) return;
      if (e.key === "Escape") {
        e.preventDefault();
        void onClose();
        return;
      }
      if (e.key === " " || e.code === "Space") {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "BUTTON") return;
        e.preventDefault();
        const v = videoRef.current;
        if (!v) return;
        if (v.paused) void v.play();
        else v.pause();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const seekTo = useCallback((t: number) => {
    const v = videoRef.current;
    if (!v || !Number.isFinite(t)) return;
    const clamped = Math.min(Math.max(0, t), v.duration || duration || 0);
    v.currentTime = clamped;
    setCurrent(clamped);
  }, [duration]);

  // syncing dual slider scrubber handles with html5 video currenttime
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    function onLoaded() {
      const d = v!.duration;
      if (!Number.isFinite(d) || d <= 0) return;
      setDuration(d);
      setOutPoint((prev) => (prev <= 0 ? d : Math.min(prev, d)));
      const vw = v!.videoWidth || session.width;
      const vh = v!.videoHeight || session.height;
      setCrop({
        x: Math.round(vw * 0.1),
        y: Math.round(vh * 0.1),
        width: Math.round(vw * 0.8),
        height: Math.round(vh * 0.8),
      });
    }
    function onTime() {
      const t = v!.currentTime;
      setCurrent(t);
      if (t >= outPoint - 0.04 && !v!.paused) {
        v!.pause();
        seekTo(inPoint);
      }
    }
    function onPlay() {
      setPlaying(true);
      if (v!.currentTime < inPoint || v!.currentTime >= outPoint) {
        v!.currentTime = inPoint;
      }
    }
    function onPause() {
      setPlaying(false);
    }

    v.addEventListener("loadedmetadata", onLoaded);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    if (v.readyState >= 1) onLoaded();
    return () => {
      v.removeEventListener("loadedmetadata", onLoaded);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
    };
  }, [inPoint, outPoint, seekTo, session.width, session.height]);

  useEffect(() => {
    if (!dragHandle) return;
    function onMove(e: MouseEvent) {
      const track = trackRef.current;
      if (!track || duration <= 0) return;
      const rect = track.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      const t = ratio * duration;
      if (dragHandle === "in") {
        const next = Math.min(t, outPoint - 0.05);
        setInPoint(Math.max(0, next));
        seekTo(Math.max(0, next));
      } else if (dragHandle === "out") {
        const next = Math.max(t, inPoint + 0.05);
        setOutPoint(Math.min(duration, next));
      } else {
        seekTo(t);
      }
    }
    function onUp() {
      setDragHandle(null);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragHandle, duration, inPoint, outPoint, seekTo]);

  useEffect(() => {
    if (!cropDrag) return;
    const drag = cropDrag;
    function onMove(e: MouseEvent) {
      const stage = stageRef.current;
      const v = videoRef.current;
      if (!stage || !v) return;
      const rect = stage.getBoundingClientRect();
      const vw = v.videoWidth || session.width;
      const vh = v.videoHeight || session.height;
      const scale = Math.min(rect.width / vw, rect.height / vh) || 1;
      const dx = (e.clientX - drag.startX) / scale;
      const dy = (e.clientY - drag.startY) / scale;
      const orig = drag.orig;

      if (drag.kind === "move") {
        let nx = Math.round(orig.x + dx);
        let ny = Math.round(orig.y + dy);
        nx = Math.min(Math.max(0, nx), vw - orig.width);
        ny = Math.min(Math.max(0, ny), vh - orig.height);
        setCrop({ ...orig, x: nx, y: ny });
      } else {
        let nw = Math.round(orig.width + dx);
        let nh = Math.round(orig.height + dy);
        nw = Math.min(Math.max(32, nw), vw - orig.x);
        nh = Math.min(Math.max(32, nh), vh - orig.y);
        setCrop({ ...orig, width: nw - (nw % 2), height: nh - (nh % 2) });
      }
    }
    function onUp() {
      setCropDrag(null);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [cropDrag, session.width, session.height]);

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  }

  async function handleSave() {
    const v = videoRef.current;
    const vw = v?.videoWidth || session.width;
    let vh = v?.videoHeight || session.height;
    const end = outPoint > inPoint ? outPoint : duration;
    let cropParams: CropParams | null = null;
    if (cropEnabled) {
      cropParams = {
        x: crop.x - (crop.x % 2),
        y: crop.y - (crop.y % 2),
        width: Math.max(2, crop.width - (crop.width % 2)),
        height: Math.max(2, crop.height - (crop.height % 2)),
      };
      vh = cropParams.height;
    }
    await onSave({
      outputFormat,
      startSec: inPoint,
      endSec: end,
      crop: cropParams,
      muteAudio: muteAudio || outputFormat === "gif",
    });
    void vw;
    void vh;
  }

  const inPct = duration > 0 ? (inPoint / duration) * 100 : 0;
  const outPct = duration > 0 ? (outPoint / duration) * 100 : 100;
  const playPct = duration > 0 ? (current / duration) * 100 : 0;

  const v = videoRef.current;
  const vw = v?.videoWidth || session.width || 1;
  const vh = v?.videoHeight || session.height || 1;

  return (
    <div className="flex h-full w-full flex-col bg-app text-fg select-none">
      <header
        data-tauri-drag-region
        className="flex h-10 shrink-0 items-center justify-between border-b border-line px-3"
      >
        <div data-tauri-drag-region className="flex items-center gap-2 pl-1">
          <Film size={14} className="text-accent" />
          <span className="text-xs font-semibold tracking-wide text-fg-secondary">
            Video editor
          </span>
        </div>
        <button
          type="button"
          className="rounded p-1.5 text-fg-muted transition hover:bg-hover hover:text-fg"
          onClick={() => void onClose()}
          disabled={busy}
          aria-label="Close"
        >
          <X size={14} />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <div
          ref={stageRef}
          className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border border-line bg-inset"
        >
          <video
            ref={videoRef}
            src={src}
            className="max-h-full max-w-full object-contain"
            playsInline
            muted={muteAudio}
            onClick={togglePlay}
          />
          {cropEnabled && (
            <CropOverlay
              videoWidth={vw}
              videoHeight={vh}
              crop={crop}
              stageRef={stageRef}
              onBeginMove={(e) =>
                setCropDrag({
                  kind: "move",
                  startX: e.clientX,
                  startY: e.clientY,
                  orig: crop,
                })
              }
              onBeginResize={(e) =>
                setCropDrag({
                  kind: "se",
                  startX: e.clientX,
                  startY: e.clientY,
                  orig: crop,
                })
              }
            />
          )}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            className="rounded-md border border-line bg-raised px-2.5 py-1.5 text-fg-secondary transition hover:bg-hover"
            onClick={togglePlay}
            disabled={busy}
            title="Space"
          >
            {playing ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <button
            type="button"
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition",
              muteAudio
                ? "border-accent/40 bg-accent-soft text-accent"
                : "border-line bg-raised text-fg-secondary hover:bg-hover"
            )}
            onClick={() => setMuteAudio((m) => !m)}
            disabled={busy}
          >
            {muteAudio ? <VolumeX size={13} /> : <Volume2 size={13} />}
            Mute audio
          </button>
          <button
            type="button"
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition",
              cropEnabled
                ? "border-accent/40 bg-accent-soft text-accent"
                : "border-line bg-raised text-fg-secondary hover:bg-hover"
            )}
            onClick={() => setCropEnabled((c) => !c)}
            disabled={busy}
          >
            <Crop size={13} />
            Crop
          </button>
          <div className="flex rounded-md border border-line bg-raised p-0.5 text-[11px]">
            <button
              type="button"
              className={clsx(
                "rounded px-2.5 py-1 transition",
                outputFormat === "mp4" ? "bg-accent/25 text-accent" : "text-fg-muted hover:text-fg"
              )}
              onClick={() => setOutputFormat("mp4")}
              disabled={busy}
            >
              MP4
            </button>
            <button
              type="button"
              className={clsx(
                "rounded px-2.5 py-1 transition",
                outputFormat === "gif" ? "bg-accent/25 text-accent" : "text-fg-muted hover:text-fg"
              )}
              onClick={() => setOutputFormat("gif")}
              disabled={busy}
            >
              GIF
            </button>
          </div>
          <span className="font-mono text-[11px] text-fg-faint">
            {formatTime(inPoint)} – {formatTime(outPoint || duration)} · {formatTime(current)}
          </span>
        </div>

        <div
          ref={trackRef}
          className="relative mx-1 h-8 cursor-pointer rounded-md bg-muted"
          onMouseDown={(e) => {
            if (busy) return;
            setDragHandle("play");
            const rect = trackRef.current?.getBoundingClientRect();
            if (!rect || duration <= 0) return;
            const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
            seekTo(ratio * duration);
          }}
        >
          <div
            className="absolute inset-y-1 rounded bg-accent/25"
            style={{ left: `${inPct}%`, width: `${Math.max(0, outPct - inPct)}%` }}
          />
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-fg"
            style={{ left: `${playPct}%` }}
          />
          <button
            type="button"
            aria-label="In point"
            className="absolute top-0 bottom-0 z-10 w-3 -translate-x-1/2 cursor-ew-resize rounded-sm bg-accent"
            style={{ left: `${inPct}%` }}
            onMouseDown={(e) => {
              e.stopPropagation();
              setDragHandle("in");
            }}
          />
          <button
            type="button"
            aria-label="Out point"
            className="absolute top-0 bottom-0 z-10 w-3 -translate-x-1/2 cursor-ew-resize rounded-sm bg-accent"
            style={{ left: `${outPct}%` }}
            onMouseDown={(e) => {
              e.stopPropagation();
              setDragHandle("out");
            }}
          />
        </div>

        {error && (
          <p className="rounded-md bg-red-900/40 px-3 py-2 text-[12px] text-red-200">{error}</p>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-2 text-[12px] text-danger transition hover:bg-hover disabled:opacity-50"
            onClick={() => void onDiscard()}
            disabled={busy}
          >
            <Trash2 size={14} />
            Discard
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-[12px] font-semibold text-accent-fg transition hover:opacity-90 disabled:opacity-50"
            onClick={() => void handleSave()}
            disabled={busy || duration <= 0}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Save &amp; Copy
          </button>
        </div>
      </div>
    </div>
  );
}

function CropOverlay({
  videoWidth,
  videoHeight,
  crop,
  stageRef,
  onBeginMove,
  onBeginResize,
}: {
  videoWidth: number;
  videoHeight: number;
  crop: { x: number; y: number; width: number; height: number };
  stageRef: React.RefObject<HTMLDivElement | null>;
  onBeginMove: (e: React.MouseEvent) => void;
  onBeginResize: (e: React.MouseEvent) => void;
}) {
  const stage = stageRef.current;
  if (!stage || videoWidth < 1 || videoHeight < 1) return null;
  const rect = stage.getBoundingClientRect();
  const scale = Math.min(rect.width / videoWidth, rect.height / videoHeight);
  const dispW = videoWidth * scale;
  const dispH = videoHeight * scale;
  const offsetX = (rect.width - dispW) / 2;
  const offsetY = (rect.height - dispH) / 2;

  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{ width: rect.width, height: rect.height }}
    >
      <div
        className="pointer-events-auto absolute border-2 border-accent bg-accent/10"
        style={{
          left: offsetX + crop.x * scale,
          top: offsetY + crop.y * scale,
          width: crop.width * scale,
          height: crop.height * scale,
        }}
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onBeginMove(e);
        }}
      >
        <button
          type="button"
          className="absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 cursor-nwse-resize rounded-sm bg-accent"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onBeginResize(e);
          }}
        />
      </div>
    </div>
  );
}
