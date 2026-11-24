import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";

export interface AppStatus {
  replay: {
    enabled: boolean;
    running: boolean;
    bufferedSecs: number;
    targetSecs: number;
    error: string | null;
    encoder: string | null;
  };
  recording: {
    state: "idle" | "recording" | "paused";
    elapsedMs: number;
    format: string | null;
  };
  clipboard: {
    paused: boolean;
  };
}

/** Events the recorder bar window listens for; it runs its normal stop/pause flow. */
export const RECORDER_REQUEST_STOP = "recorder-request-stop";
export const RECORDER_REQUEST_PAUSE = "recorder-request-pause";

export function appStatus(): Promise<AppStatus> {
  return invoke("app_status");
}

export function requestRecorderStop(): Promise<void> {
  return emit(RECORDER_REQUEST_STOP);
}

export function requestRecorderPause(): Promise<void> {
  return emit(RECORDER_REQUEST_PAUSE);
}

export type PillTone = "neutral" | "accent" | "red" | "amber";
export type PillKind = "recording" | "recording-paused" | "clipboard" | "replay";

export interface PillModel {
  kind: PillKind;
  tone: PillTone;
  label: string;
  /** Short label for the compact dock, where the title bar has little room. */
  compactLabel: string;
  /** Monospace suffix (elapsed time), rendered after the label. */
  mono?: string;
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function replayModel(replay: AppStatus["replay"]): PillModel | null {
  if (!replay.enabled) return null;
  if (replay.error && !replay.running) {
    return {
      kind: "replay",
      tone: "red",
      label: "Replay unavailable",
      compactLabel: "Replay off",
    };
  }
  if (!replay.running) {
    return {
      kind: "replay",
      tone: "neutral",
      label: "Preparing replay…",
      compactLabel: "Preparing…",
    };
  }
  const target = replay.targetSecs;
  if (replay.bufferedSecs >= target) {
    return {
      kind: "replay",
      tone: "accent",
      label: `Replay ready · ${target}s`,
      compactLabel: `Replay · ${target}s`,
    };
  }
  return {
    kind: "replay",
    tone: "accent",
    label: `Replay buffering · ${replay.bufferedSecs}s`,
    compactLabel: `Buffering · ${replay.bufferedSecs}s`,
  };
}

/**
 * Primary pill. Priority: recording > clipboard paused > replay. Clipboard-paused is the one
 * state that must never be silently hidden, so when recording wins it is reported separately and
 * shown as a small amber dot beside the pill.
 */
export function derivePill(status: AppStatus | null): {
  primary: PillModel | null;
  clipboardPausedDot: boolean;
} {
  if (!status) return { primary: null, clipboardPausedDot: false };
  const { recording, clipboard, replay } = status;
  if (recording.state !== "idle") {
    const paused = recording.state === "paused";
    const time = formatElapsed(recording.elapsedMs);
    return {
      primary: {
        kind: paused ? "recording-paused" : "recording",
        tone: paused ? "amber" : "red",
        label: paused ? "Recording paused" : "Recording",
        compactLabel: paused ? "Paused" : "Rec",
        mono: time,
      },
      clipboardPausedDot: clipboard.paused,
    };
  }
  if (clipboard.paused) {
    return {
      primary: {
        kind: "clipboard",
        tone: "amber",
        label: "Clipboard paused",
        compactLabel: "Paused",
      },
      clipboardPausedDot: false,
    };
  }
  return { primary: replayModel(replay), clipboardPausedDot: false };
}

/**
 * Polls `app_status` while the window is visible: about once a second, twice a second during a
 * recording so the elapsed clock never skips a digit. Stops when the document is hidden and reads
 * again as soon as it becomes visible. `refresh` forces a read now.
 */
export function useAppStatus(): {
  status: AppStatus | null;
  refresh: () => void;
} {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const refreshRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;
    let inFlight = false;

    const stop = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
    };
    const read = () => {
      if (inFlight || disposed || document.hidden) return;
      inFlight = true;
      stop();
      appStatus()
        .then((next) => {
          if (disposed) return;
          setStatus(next);
          schedule(next.recording.state === "recording" ? 500 : 1000);
        })
        .catch(() => {
          if (!disposed) schedule(2000);
        })
        .finally(() => {
          inFlight = false;
        });
    };
    function schedule(delay: number) {
      stop();
      if (disposed || document.hidden) return;
      timer = window.setTimeout(read, delay);
    }
    const onVisibility = () => {
      if (document.hidden) stop();
      else read();
    };

    refreshRef.current = read;
    read();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const refresh = useCallback(() => refreshRef.current(), []);
  return { status, refresh };
}
