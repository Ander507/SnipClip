import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import clsx from "clsx";
import {
  Maximize,
  Minimize,
  Pause,
  Play,
  Repeat,
  StepBack,
  StepForward,
  Trash2,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { ClipboardItem } from "../../lib/types";

export interface VideoStageHandle {
  togglePlay(): void;
  pause(): void;
  seekBy(sec: number): void;
  stepFrame(dir: 1 | -1): void;
  toggleMute(): void;
  nudgeVolume(delta: number): void;
  nudgeRate(dir: 1 | -1): void;
  toggleLoop(): void;
}

interface Props {
  item: ClipboardItem;
  chromeVisible: boolean;
  fullscreen: boolean;
  onToggleFullscreen(): void;
  onPlayingChange(playing: boolean): void;
  onDelete(id: number): void;
}

const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
const PREFS_KEY = "snipclip.viewer.v1";

interface ViewerPrefs {
  volume: number;
  muted: boolean;
  rate: number;
  loop: boolean;
}

const DEFAULT_PREFS: ViewerPrefs = { volume: 1, muted: false, rate: 1, loop: true };

function loadPrefs(): ViewerPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const p = JSON.parse(raw) as Partial<ViewerPrefs>;
    return {
      volume: typeof p.volume === "number" ? Math.min(1, Math.max(0, p.volume)) : 1,
      muted: typeof p.muted === "boolean" ? p.muted : false,
      rate: typeof p.rate === "number" && RATES.includes(p.rate) ? p.rate : 1,
      loop: typeof p.loop === "boolean" ? p.loop : true,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(p: ViewerPrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: prefs just don't persist */
  }
}

function fmtTime(t: number, hundredths: boolean): string {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const total = Math.floor(t);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const base =
    h > 0
      ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${m}:${String(s).padStart(2, "0")}`;
  if (!hundredths) return base;
  const cs = Math.floor((t - total) * 100);
  return `${base}.${String(cs).padStart(2, "0")}`;
}

function bufferedEnd(v: HTMLVideoElement): number {
  const b = v.buffered;
  const t = v.currentTime;
  for (let i = 0; i < b.length; i++) {
    if (b.start(i) <= t + 0.25 && b.end(i) >= t) return b.end(i);
  }
  return b.length > 0 ? b.end(b.length - 1) : 0;
}

/** Release the file handle so the mp4 can be replaced or deleted after the viewer closes. */
function releaseVideo(v: HTMLVideoElement | null) {
  if (!v) return;
  try {
    v.pause();
    v.removeAttribute("src");
    v.load();
  } catch {
    /* element already gone */
  }
}

type FrameCb = (now: number, meta: { mediaTime: number }) => void;
type FrameVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: FrameCb) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

export const VideoStage = forwardRef<VideoStageHandle, Props>(function VideoStage(
  { item, chromeVisible, fullscreen, onToggleFullscreen, onPlayingChange, onDelete },
  ref
) {
  const videoRef = useRef<FrameVideo>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const bufRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const prefsRef = useRef<ViewerPrefs>(loadPrefs());
  const frameDur = useRef(1 / 30);
  const scrubRatio = useRef<number | null>(null);
  const scrubRaf = useRef<number | null>(null);
  const flashTimer = useRef<number | null>(null);

  const [paused, setPaused] = useState(true);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [prefs, setPrefsState] = useState<ViewerPrefs>(prefsRef.current);
  const [scrubbing, setScrubbing] = useState(false);
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const src = item.content?.trim() ? convertFileSrc(item.content.trim()) : null;

  const updatePrefs = useCallback((patch: Partial<ViewerPrefs>) => {
    prefsRef.current = { ...prefsRef.current, ...patch };
    setPrefsState(prefsRef.current);
    savePrefs(prefsRef.current);
  }, []);

  const showFlash = useCallback((text: string) => {
    setFlash(text);
    if (flashTimer.current != null) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 800);
  }, []);

  /** Write progress straight to the DOM; a React render per frame is wasted work. */
  const paint = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const dur = v.duration;
    const ratio =
      scrubRatio.current != null
        ? scrubRatio.current
        : Number.isFinite(dur) && dur > 0
          ? Math.min(1, v.currentTime / dur)
          : 0;
    const pct = `${ratio * 100}%`;
    if (fillRef.current) fillRef.current.style.width = pct;
    if (thumbRef.current) thumbRef.current.style.left = pct;
    if (bufRef.current) {
      bufRef.current.style.width =
        Number.isFinite(dur) && dur > 0 ? `${Math.min(1, bufferedEnd(v) / dur) * 100}%` : "0%";
    }
    if (timeRef.current) {
      const cur = scrubRatio.current != null && Number.isFinite(dur) ? scrubRatio.current * dur : v.currentTime;
      timeRef.current.textContent = `${fmtTime(cur, v.paused)} / ${fmtTime(Number.isFinite(dur) ? dur : 0, false)}`;
    }
  }, []);

  // Release the file on unmount (contract 6) and run the progress loop.
  useEffect(() => {
    const v = videoRef.current;
    // StrictMode re-runs effects: put the source back if the simulated unmount released it.
    if (v && src && v.getAttribute("src") !== src) v.src = src;
    return () => releaseVideo(v);
  }, [src]);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      paint();
      raf = requestAnimationFrame(loop);
    };
    if (!paused) raf = requestAnimationFrame(loop);
    else paint();
    return () => cancelAnimationFrame(raf);
  }, [paused, paint]);

  // Frame duration from real decoded frame timestamps.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || typeof v.requestVideoFrameCallback !== "function") return;
    let handle = 0;
    let last: number | null = null;
    let best = Infinity;
    const cb: FrameCb = (_now, meta) => {
      if (last != null) {
        const d = Math.abs(meta.mediaTime - last);
        if (d >= 1 / 240 && d < best) {
          best = d;
          frameDur.current = d;
        }
      }
      last = meta.mediaTime;
      handle = v.requestVideoFrameCallback!(cb);
    };
    handle = v.requestVideoFrameCallback(cb);
    return () => v.cancelVideoFrameCallback?.(handle);
  }, []);

  // Autoplay; a refusal leaves the clip paused with the big play button showing.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !src) return;
    v.play().catch(() => {
      /* paused state is picked up from the element's events */
    });
  }, [src]);

  useEffect(() => {
    onPlayingChange(!paused && !failed);
  }, [paused, failed, onPlayingChange]);

  useEffect(() => {
    return () => {
      if (scrubRaf.current != null) cancelAnimationFrame(scrubRaf.current);
      if (flashTimer.current != null) window.clearTimeout(flashTimer.current);
    };
  }, []);

  function applyPrefsToVideo(v: HTMLVideoElement) {
    const p = prefsRef.current;
    v.volume = p.volume;
    v.muted = p.muted;
    v.playbackRate = p.rate;
    v.loop = p.loop;
  }

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v || failed) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  }, [failed]);

  useImperativeHandle(
    ref,
    () => ({
      togglePlay,
      pause: () => videoRef.current?.pause(),
      seekBy(sec) {
        const v = videoRef.current;
        if (!v || !Number.isFinite(v.duration)) return;
        v.currentTime = Math.min(v.duration, Math.max(0, v.currentTime + sec));
        paint();
      },
      stepFrame(dir) {
        const v = videoRef.current;
        if (!v || !Number.isFinite(v.duration)) return;
        v.pause();
        v.currentTime = Math.min(v.duration, Math.max(0, v.currentTime + dir * frameDur.current));
        paint();
      },
      toggleMute() {
        const v = videoRef.current;
        if (!v) return;
        const nextMuted = !v.muted;
        v.muted = nextMuted;
        if (!nextMuted && v.volume === 0) v.volume = 0.5;
        updatePrefs({ muted: v.muted, volume: v.volume });
        showFlash(v.muted ? "Muted" : `Volume ${Math.round(v.volume * 100)}%`);
      },
      nudgeVolume(delta) {
        const v = videoRef.current;
        if (!v) return;
        const next = Math.min(1, Math.max(0, Math.round((v.volume + delta) * 100) / 100));
        v.volume = next;
        v.muted = next === 0 ? v.muted : false;
        updatePrefs({ volume: next, muted: v.muted });
        showFlash(`Volume ${Math.round(next * 100)}%`);
      },
      nudgeRate(dir) {
        const v = videoRef.current;
        if (!v) return;
        let idx = RATES.findIndex((r) => Math.abs(r - v.playbackRate) < 0.001);
        if (idx < 0) idx = RATES.indexOf(1);
        const next = RATES[Math.min(RATES.length - 1, Math.max(0, idx + dir))];
        v.playbackRate = next;
        updatePrefs({ rate: next });
        showFlash(`${next}×`);
      },
      toggleLoop() {
        const v = videoRef.current;
        if (!v) return;
        v.loop = !v.loop;
        updatePrefs({ loop: v.loop });
        showFlash(v.loop ? "Loop on" : "Loop off");
      },
    }),
    [togglePlay, paint, updatePrefs, showFlash]
  );

  function cycleRate() {
    const v = videoRef.current;
    if (!v) return;
    let idx = RATES.findIndex((r) => Math.abs(r - v.playbackRate) < 0.001);
    if (idx < 0) idx = RATES.indexOf(1);
    const next = RATES[(idx + 1) % RATES.length];
    v.playbackRate = next;
    updatePrefs({ rate: next });
  }

  // Scrubbing: pointer capture, live seek throttled to one per animation frame.
  function ratioFromEvent(e: ReactPointerEvent<HTMLDivElement>): number {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  }

  function queueSeek(ratio: number) {
    scrubRatio.current = ratio;
    paint();
    if (scrubRaf.current != null) return;
    scrubRaf.current = requestAnimationFrame(() => {
      scrubRaf.current = null;
      const v = videoRef.current;
      const r = scrubRatio.current;
      if (v && r != null && Number.isFinite(v.duration)) v.currentTime = r * v.duration;
    });
  }

  function onScrubDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || !Number.isFinite(videoRef.current?.duration)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setScrubbing(true);
    queueSeek(ratioFromEvent(e));
  }

  function onScrubMove(e: ReactPointerEvent<HTMLDivElement>) {
    const v = videoRef.current;
    const ratio = ratioFromEvent(e);
    if (v && Number.isFinite(v.duration)) {
      setHover({ x: ratio * e.currentTarget.offsetWidth, t: ratio * v.duration });
    }
    if (scrubRatio.current != null) queueSeek(ratio);
  }

  function onScrubUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (scrubRatio.current == null) return;
    const v = videoRef.current;
    if (v && Number.isFinite(v.duration)) v.currentTime = scrubRatio.current * v.duration;
    scrubRatio.current = null;
    setScrubbing(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    paint();
  }

  const showBigPlay = ready && paused && !scrubbing && !failed;
  const VolIcon = prefs.muted || prefs.volume === 0 ? VolumeX : prefs.volume < 0.5 ? Volume1 : Volume2;

  if (failed || !src) {
    return (
      <div className="absolute inset-0 flex items-center justify-center p-8">
        <div className="max-w-md text-center">
          <p className="text-[14px] font-semibold text-fg">
            This clip's file is missing or can't be played
          </p>
          {item.content && (
            <p className="mt-2 break-all font-mono text-[11px] text-fg-muted">{item.content}</p>
          )}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onDelete(item.id)}
            className="mx-auto mt-4 inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-raised px-3 text-[12px] text-fg-secondary hover:bg-hover"
          >
            <Trash2 size={14} />
            Remove from library
          </button>
        </div>
      </div>
    );
  }

  const chromeCls = clsx(
    "transition-opacity duration-200",
    !chromeVisible && "pointer-events-none opacity-0"
  );

  return (
    <div className="absolute inset-0 bg-black">
      <video
        ref={videoRef}
        src={src}
        autoPlay
        playsInline
        preload="auto"
        className="h-full w-full object-contain"
        onClick={togglePlay}
        onDoubleClick={onToggleFullscreen}
        onLoadedMetadata={(e) => {
          applyPrefsToVideo(e.currentTarget);
          setReady(true);
          paint();
        }}
        onPlay={() => setPaused(false)}
        onPlaying={() => setPaused(false)}
        onPause={() => {
          setPaused(true);
          paint();
        }}
        onSeeked={paint}
        onTimeUpdate={paint}
        onProgress={paint}
        onError={() => setFailed(true)}
        onVolumeChange={(e) => {
          const v = e.currentTarget;
          if (v.volume !== prefsRef.current.volume || v.muted !== prefsRef.current.muted) {
            updatePrefs({ volume: v.volume, muted: v.muted });
          }
        }}
      />

      {showBigPlay && (
        <button
          type="button"
          aria-label="Play"
          onMouseDown={(e) => e.preventDefault()}
          onClick={togglePlay}
          className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white transition-transform hover:scale-105"
        >
          <Play size={28} className="ml-1 fill-current" />
        </button>
      )}

      {flash && (
        <div className="pointer-events-none absolute left-1/2 top-16 -translate-x-1/2 rounded-full bg-black/65 px-3 py-1 font-mono text-[12px] text-white">
          {flash}
        </div>
      )}

      <div
        data-chrome
        className={clsx(
          "absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-4 pb-3 pt-10 text-white",
          chromeCls
        )}
      >
        <div
          className="group relative flex h-4 cursor-pointer items-center touch-none"
          onPointerDown={onScrubDown}
          onPointerMove={onScrubMove}
          onPointerUp={onScrubUp}
          onPointerCancel={onScrubUp}
          onPointerLeave={() => scrubRatio.current == null && setHover(null)}
        >
          <div
            className={clsx(
              "relative w-full overflow-hidden rounded-full bg-white/25 transition-[height] duration-150",
              scrubbing ? "h-1.5" : "h-1 group-hover:h-1.5"
            )}
          >
            <div ref={bufRef} className="absolute inset-y-0 left-0 bg-white/35" style={{ width: 0 }} />
            <div ref={fillRef} className="absolute inset-y-0 left-0 bg-accent" style={{ width: 0 }} />
          </div>
          <div
            ref={thumbRef}
            className={clsx(
              "pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent transition-opacity duration-150",
              scrubbing ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            )}
            style={{ left: 0 }}
          />
          {hover && (
            <div
              className="pointer-events-none absolute bottom-full mb-2 -translate-x-1/2 rounded-md bg-black/75 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-white"
              style={{ left: hover.x }}
            >
              {fmtTime(hover.t, false)}
            </div>
          )}
        </div>

        <div className="mt-1 flex items-center gap-1">
          <CtlBtn title="Play / Pause (Space)" onClick={togglePlay}>
            {paused ? <Play size={18} className="fill-current" /> : <Pause size={18} className="fill-current" />}
          </CtlBtn>
          <span
            ref={timeRef}
            className="ml-1 min-w-[7.5rem] font-mono text-[12px] tabular-nums text-white/90"
          />
          <span className="flex-1" />
          <CtlBtn
            title="Previous frame (,)"
            onClick={() => {
              const v = videoRef.current;
              if (!v) return;
              v.pause();
              v.currentTime = Math.max(0, v.currentTime - frameDur.current);
              paint();
            }}
          >
            <StepBack size={16} />
          </CtlBtn>
          <CtlBtn
            title="Next frame (.)"
            onClick={() => {
              const v = videoRef.current;
              if (!v || !Number.isFinite(v.duration)) return;
              v.pause();
              v.currentTime = Math.min(v.duration, v.currentTime + frameDur.current);
              paint();
            }}
          >
            <StepForward size={16} />
          </CtlBtn>
          <CtlBtn
            title={prefs.loop ? "Loop on (R)" : "Loop off (R)"}
            active={prefs.loop}
            onClick={() => {
              const v = videoRef.current;
              if (!v) return;
              v.loop = !v.loop;
              updatePrefs({ loop: v.loop });
            }}
          >
            <Repeat size={16} />
          </CtlBtn>
          <button
            type="button"
            title="Playback speed (< >)"
            onMouseDown={(e) => e.preventDefault()}
            onClick={cycleRate}
            className="h-8 min-w-[2.75rem] rounded-md px-2 font-mono text-[12px] tabular-nums text-white/90 transition-colors hover:bg-white/15"
          >
            {prefs.rate}×
          </button>
          <CtlBtn
            title={prefs.muted ? "Unmute (M)" : "Mute (M)"}
            onClick={() => {
              const v = videoRef.current;
              if (!v) return;
              v.muted = !v.muted;
              if (!v.muted && v.volume === 0) v.volume = 0.5;
              updatePrefs({ muted: v.muted, volume: v.volume });
            }}
          >
            <VolIcon size={16} />
          </CtlBtn>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={prefs.muted ? 0 : prefs.volume}
            aria-label="Volume"
            onChange={(e) => {
              const v = videoRef.current;
              const val = Number(e.target.value);
              if (v) {
                v.volume = val;
                v.muted = val === 0;
              }
              updatePrefs({ volume: val, muted: val === 0 });
            }}
            className="h-1 w-[72px] cursor-pointer accent-accent"
          />
          <CtlBtn
            title={fullscreen ? "Exit fullscreen (F)" : "Fullscreen (F)"}
            onClick={onToggleFullscreen}
          >
            {fullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
          </CtlBtn>
        </div>
      </div>
    </div>
  );
});

function CtlBtn({
  title,
  onClick,
  active,
  children,
}: {
  title: string;
  onClick(): void;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={clsx(
        "flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-white/15",
        active ? "text-accent" : "text-white/90"
      )}
    >
      {children}
    </button>
  );
}
