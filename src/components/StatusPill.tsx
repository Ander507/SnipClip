import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { emit } from "@tauri-apps/api/event";
import { Pause, Play, Save, Settings2, Square } from "lucide-react";
import { saveReplayClip } from "../lib/api";
import {
  derivePill,
  formatElapsed,
  replayModel,
  requestRecorderPause,
  requestRecorderStop,
  type AppStatus,
  type PillTone,
} from "../lib/status";

interface Props {
  status: AppStatus | null;
  /** Clipboard pause as the app knows it (updates instantly from its own event). */
  clipboardPaused: boolean;
  compact: boolean;
  onToggleClipboardPause: () => void;
  /** Force a status read right after an action so the pill does not lag a poll behind. */
  onActed: () => void;
}

const TONE: Record<PillTone, { pill: string; dot: string }> = {
  neutral: { pill: "border-line bg-muted", dot: "bg-fg-muted" },
  accent: { pill: "border-transparent bg-accent-soft", dot: "bg-accent" },
  red: { pill: "border-danger/40 bg-danger/15", dot: "bg-danger" },
  amber: { pill: "border-amber-500/40 bg-amber-500/15", dot: "bg-amber-500" },
};

const ACTION =
  "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs text-fg-secondary transition-colors hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-40";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="px-1 py-1">
      <div className="px-2 pb-0.5 pt-1 text-[10px] font-medium uppercase tracking-wide text-fg-faint">
        {title}
      </div>
      {children}
    </div>
  );
}

export function StatusPill({
  status,
  clipboardPaused,
  compact,
  onToggleClipboardPause,
  onActed,
}: Props) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();

  // The app's own pause flag is instant; the polled one can be a second behind.
  const merged: AppStatus | null = status
    ? { ...status, clipboard: { paused: clipboardPaused } }
    : clipboardPaused
      ? {
          replay: {
            enabled: false,
            running: false,
            bufferedSecs: 0,
            targetSecs: 0,
            error: null,
            encoder: null,
          },
          recording: { state: "idle", elapsedMs: 0, format: null },
          clipboard: { paused: true },
        }
      : null;
  const { primary, clipboardPausedDot } = derivePill(merged);

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  // Focus the first control on open; close on Esc or an outside press.
  useEffect(() => {
    if (!open) return;
    popoverRef.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close(true);
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, [open]);

  // Nothing worth showing any more (e.g. recording ended): drop the popover with it.
  useEffect(() => {
    if (!primary && open) setOpen(false);
  }, [primary, open]);

  if (!merged || !primary) return null;

  const tone = TONE[primary.tone];
  const rec = merged.recording;
  const replay = merged.replay;
  const replayInfo = replayModel(replay);
  const fullLabel = primary.mono ? `${primary.label} · ${primary.mono}` : primary.label;
  const ariaLabel = clipboardPausedDot ? `${fullLabel}. Clipboard paused.` : fullLabel;

  async function act(fn: () => Promise<unknown> | void) {
    close(true);
    try {
      await fn();
    } catch (err) {
      console.error(err);
    }
    // the recorder bar answers asynchronously; read again once it has had time to act
    window.setTimeout(onActed, 250);
  }

  async function saveNow() {
    if (saving) return;
    setSaving(true);
    close(true);
    try {
      // App listens for "replay-saved" / "replay-error" and shows the toast
      await saveReplayClip();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  const replayLine = !replay.enabled
    ? "Replay off"
    : replayInfo?.tone === "red"
      ? `Unavailable${replay.error ? ` · ${replay.error}` : ""}`
      : replay.running
        ? `${replay.encoder ? `${replay.encoder} · ` : ""}${Math.min(replay.bufferedSecs, replay.targetSecs)}s of ${replay.targetSecs}s buffered`
        : "Preparing…";

  return (
    <div ref={rootRef} className="relative mr-1.5">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        aria-label={ariaLabel}
        title={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        onMouseDown={(e) => e.stopPropagation()}
        className={clsx(
          "flex h-6 max-w-[220px] items-center gap-1.5 rounded-full border px-2.5 text-xs text-fg transition-colors hover:brightness-110",
          tone.pill
        )}
      >
        <span className={clsx("h-1.5 w-1.5 shrink-0 rounded-full", tone.dot)} aria-hidden="true" />
        <span className="truncate">{compact ? primary.compactLabel : primary.label}</span>
        {primary.mono && (
          <span className="shrink-0 font-mono tabular-nums">{primary.mono}</span>
        )}
        {clipboardPausedDot && (
          <span
            className="ml-0.5 flex shrink-0 items-center border-l border-line pl-1.5"
            title="Clipboard paused"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
          </span>
        )}
      </button>

      {open && (
        <div
          ref={popoverRef}
          id={popoverId}
          role="dialog"
          aria-label="Status"
          className="sc-pop-in absolute right-0 top-full z-50 mt-1.5 w-64 rounded-xl border border-line-strong bg-raised py-1 shadow-2xl"
        >
          {rec.state !== "idle" && (
            <Section title="Recording">
              <div className="px-2 pb-1 text-xs text-fg">
                {rec.state === "paused" ? "Paused" : "Recording"} ·{" "}
                <span className="font-mono tabular-nums">{formatElapsed(rec.elapsedMs)}</span>
                {rec.format ? ` · ${rec.format.toUpperCase()}` : ""}
              </div>
              <button
                type="button"
                className={ACTION}
                onClick={() => void act(requestRecorderPause)}
              >
                {rec.state === "paused" ? <Play size={13} /> : <Pause size={13} />}
                {rec.state === "paused" ? "Resume recording" : "Pause recording"}
              </button>
              <button
                type="button"
                className={ACTION}
                onClick={() => void act(requestRecorderStop)}
              >
                <Square size={12} className="text-danger" fill="currentColor" />
                Stop and save
              </button>
            </Section>
          )}

          {merged.clipboard.paused && (
            <Section title="Clipboard">
              <div className="px-2 pb-1 text-xs text-fg">New copies are not being saved.</div>
              <button
                type="button"
                className={ACTION}
                onClick={() => void act(onToggleClipboardPause)}
              >
                <Play size={13} />
                Resume clipboard
              </button>
            </Section>
          )}

          <Section title="Replay">
            <div className="break-words px-2 pb-1 text-xs text-fg">{replayLine}</div>
            {replay.enabled && (
              <button
                type="button"
                className={ACTION}
                disabled={saving || !replay.running || replay.bufferedSecs < 1}
                onClick={() => void saveNow()}
              >
                <Save size={13} />
                Save clip now
              </button>
            )}
            <button
              type="button"
              className={ACTION}
              onClick={() => void act(() => emit("open-settings", { section: "replay" }))}
            >
              <Settings2 size={13} />
              Replay settings
            </button>
          </Section>
        </div>
      )}
    </div>
  );
}
