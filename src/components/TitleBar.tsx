import clsx from "clsx";
import {
  LayoutPanelTop,
  Minus,
  PanelRight,
  Pause,
  Pin,
  Play,
  Square,
  X,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAppStatus } from "../lib/status";
import { StatusPill } from "./StatusPill";

interface Props {
  paused: boolean;
  onTogglePause: () => void;
  compactDock: boolean;
  alwaysOnTop: boolean;
  onToggleCompact: () => void;
  onToggleAlwaysOnTop: () => void;
}

export function TitleBar({
  paused,
  onTogglePause,
  compactDock,
  alwaysOnTop,
  onToggleCompact,
  onToggleAlwaysOnTop,
}: Props) {
  const appWindow = getCurrentWindow();
  const { status, refresh } = useAppStatus();

  return (
    <header
      data-tauri-drag-region
      className="flex h-10 shrink-0 items-center justify-between border-b border-line bg-raised pl-3 pr-0 select-none"
    >
      <div data-tauri-drag-region className="flex items-center gap-2 pl-1">
        <img
          src="/icon.png"
          alt=""
          width={16}
          height={16}
          className="pointer-events-none h-4 w-4"
          draggable={false}
        />
        <span className="text-xs font-semibold tracking-wide text-fg-secondary">
          SnipClip
        </span>
        {compactDock && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-fg-muted">
            Dock
          </span>
        )}
      </div>

      <div className="no-drag flex h-full items-center">
        <StatusPill
          status={status}
          clipboardPaused={paused}
          compact={compactDock}
          onToggleClipboardPause={onTogglePause}
          onActed={refresh}
        />
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            aria-pressed={paused}
            aria-label={paused ? "Resume clipboard listening" : "Pause clipboard listening"}
            title={paused ? "Resume clipboard listening" : "Pause clipboard listening"}
            className={clsx(
              "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
              paused
                ? "bg-accent-soft text-accent"
                : "text-fg-muted hover:bg-hover hover:text-fg"
            )}
            onClick={onTogglePause}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {paused ? <Play size={12} /> : <Pause size={13} />}
          </button>
          <button
            type="button"
            aria-pressed={compactDock}
            aria-label={compactDock ? "Expand full studio" : "Compact vault layout"}
            title={compactDock ? "Expand full studio" : "Compact vault layout"}
            className={clsx(
              "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
              compactDock
                ? "bg-accent-soft text-accent"
                : "text-fg-muted hover:bg-hover hover:text-fg"
            )}
            onClick={onToggleCompact}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {compactDock ? <LayoutPanelTop size={13} /> : <PanelRight size={13} />}
          </button>
          <button
            type="button"
            aria-pressed={alwaysOnTop}
            aria-label={alwaysOnTop ? "Disable always on top" : "Always on top"}
            title={alwaysOnTop ? "Unpin from top" : "Always on top"}
            className={clsx(
              "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
              alwaysOnTop
                ? "bg-accent-soft text-accent"
                : "text-fg-muted hover:bg-hover hover:text-fg"
            )}
            onClick={onToggleAlwaysOnTop}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <Pin size={13} className={alwaysOnTop ? "fill-current" : undefined} />
          </button>
        </div>
        <div className="mx-1.5 h-4 w-px bg-line" aria-hidden="true" />
        <div className="flex h-full items-stretch">
          <button
            type="button"
            aria-label="Minimize"
            className="flex w-11 items-center justify-center text-fg-muted transition-colors hover:bg-hover hover:text-fg"
            onClick={() => void appWindow.minimize()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <Minus size={14} />
          </button>
          {!compactDock && (
            <button
              type="button"
              aria-label="Maximize"
              className="flex w-11 items-center justify-center text-fg-muted transition-colors hover:bg-hover hover:text-fg"
              onClick={() => void appWindow.toggleMaximize()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <Square size={12} />
            </button>
          )}
          <button
            type="button"
            aria-label="Close"
            className="flex w-11 items-center justify-center text-fg-muted transition-colors hover:bg-[#c42b1c] hover:text-white"
            onClick={() => void appWindow.close()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </header>
  );
}
