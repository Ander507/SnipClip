import { Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function TitleBar() {
  const appWindow = getCurrentWindow();

  return (
    <header
      data-tauri-drag-region
      className="flex h-10 shrink-0 items-center justify-between border-b border-[#2d2d2d] bg-[#202020] px-3 select-none"
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
        <span className="text-xs font-semibold tracking-wide text-[#cccccc]">
          SnipClip
        </span>
      </div>

      <div className="no-drag flex h-full items-stretch">
        <button
          type="button"
          aria-label="Minimize"
          className="flex w-11 items-center justify-center text-[#cccccc] transition hover:bg-[#2d2d2d]"
          onClick={() => void appWindow.minimize()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <Minus size={14} />
        </button>
        <button
          type="button"
          aria-label="Maximize"
          className="flex w-11 items-center justify-center text-[#cccccc] transition hover:bg-[#2d2d2d]"
          onClick={() => void appWindow.toggleMaximize()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <Square size={12} />
        </button>
        <button
          type="button"
          aria-label="Close"
          className="flex w-11 items-center justify-center text-[#cccccc] transition hover:bg-[#c42b1c] hover:text-white"
          onClick={() => void appWindow.close()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <X size={14} />
        </button>
      </div>
    </header>
  );
}
