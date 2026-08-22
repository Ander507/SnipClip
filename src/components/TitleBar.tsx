import clsx from "clsx";
import { Minus, Pause, Play, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface Props {
  paused: boolean;
  onTogglePause: () => void;
}

export function TitleBar({ paused, onTogglePause }: Props) {
  const appWindow = getCurrentWindow();

  return (
    <header
      data-tauri-drag-region
      className="flex h-10 shrink-0 items-center justify-between border-b border-line bg-app px-3 select-none"
    >
      <div data-tauri-drag-region className="flex items-center gap-2 pl-1">
        <img
          src="/icon.png"
          alt=""
          width={16}
          height={16}
          className="pointer-events-none h-4 w-4 rounded-[3px]"
          draggable={false}
        />
        <span className="text-xs font-semibold tracking-wide text-fg-secondary">
          SnipClip
        </span>
      </div>

      <div className="no-drag flex h-full items-stretch">
        <button
          type="button"
          aria-pressed={paused}
          aria-label={paused ? "Resume clipboard listening" : "Pause clipboard listening"}
          title={paused ? "Resume clipboard listening" : "Pause clipboard listening"}
          className={clsx(
            "flex items-center gap-1.5 px-2.5 text-[11px] font-medium transition",
            paused
              ? "bg-accent-soft text-accent"
              : "text-fg-secondary hover:bg-hover"
          )}
          onClick={onTogglePause}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {paused ? <Play size={12} /> : <Pause size={12} />}
          {paused ? "Paused" : "Pause"}
        </button>
        <button
          type="button"
          aria-label="Minimize"
          className="flex w-11 items-center justify-center text-fg-secondary transition hover:bg-hover"
          onClick={() => void appWindow.minimize()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <Minus size={14} />
        </button>
        <button
          type="button"
          aria-label="Maximize"
          className="flex w-11 items-center justify-center text-fg-secondary transition hover:bg-hover"
          onClick={() => void appWindow.toggleMaximize()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <Square size={12} />
        </button>
        <button
          type="button"
          aria-label="Close"
          className="flex w-11 items-center justify-center text-fg-secondary transition hover:bg-[#c42b1c] hover:text-white"
          onClick={() => void appWindow.close()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <X size={14} />
        </button>
      </div>
    </header>
  );
}
