import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { captureScreenRegion, hideSnipper, closeSnipper } from "../lib/api";
import type { CaptureResult } from "../lib/types";

interface Props {
  active: boolean;
  onCaptured: (result: CaptureResult) => void;
  onCancel: () => void;
}

/**
 * Lightweight translucent overlay — desktop shows through; region is captured after release.
 * UI is fully cleared + window hidden BEFORE the screen buffer is grabbed.
 */
export function SnipSelector({ active, onCaptured, onCancel }: Props) {
  const [dragging, setDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [startY, setStartY] = useState(0);
  const [currentX, setCurrentX] = useState(0);
  const [currentY, setCurrentY] = useState(0);
  /** When true, render nothing so no badge/box can bake into the shot */
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) {
      setDragging(false);
      setStartX(0);
      setStartY(0);
      setCurrentX(0);
      setCurrentY(0);
      setArmed(false);
      setError(null);
    }
  }, [active]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !armed) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, armed]);

  function handleMouseDown(e: React.MouseEvent) {
    if (armed || e.button !== 0) return;
    setDragging(true);
    setStartX(e.clientX);
    setStartY(e.clientY);
    setCurrentX(e.clientX);
    setCurrentY(e.clientY);
    setError(null);
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!dragging || armed) return;
    setCurrentX(e.clientX);
    setCurrentY(e.clientY);
  }

  async function handleMouseUp() {
    if (!dragging || armed) return;
    setDragging(false);

    const x = Math.min(startX, currentX);
    const y = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);

    if (width < 8 || height < 8) {
      setStartX(0);
      setStartY(0);
      setCurrentX(0);
      setCurrentY(0);
      return;
    }

    try {
      // Resolve physical coords while the window is still placed correctly
      const win = getCurrentWindow();
      const scale = await win.scaleFactor();
      const pos = await win.outerPosition();
      const physX = Math.round(pos.x + x * scale);
      const physY = Math.round(pos.y + y * scale);
      const physW = Math.max(1, Math.round(width * scale));
      const physH = Math.max(1, Math.round(height * scale));

      // 1) Wipe all overlay UI immediately (no "Capturing…" paint)
      setStartX(0);
      setStartY(0);
      setCurrentX(0);
      setCurrentY(0);
      setArmed(true);

      // Let React flush the empty frame before hiding
      await new Promise<void>((r) => requestAnimationFrame(() => r()));

      // 2) Hide the snipper window so nothing is composited over the desktop
      await hideSnipper();
      await new Promise((r) => setTimeout(r, 80));

      // 3) Capture a clean buffer
      const result = await captureScreenRegion(physX, physY, physW, physH);
      onCaptured(result);
    } catch (err) {
      setArmed(false);
      setError(String(err));
      try {
        await closeSnipper();
      } catch {
        /* ignore */
      }
    }
  }

  const left = Math.min(startX, currentX);
  const top = Math.min(startY, currentY);
  const w = Math.abs(currentX - startX);
  const h = Math.abs(currentY - startY);
  const showRect = dragging && (w > 0 || h > 0);

  if (!active || armed) {
    // Fully blank while capturing — nothing for the display grab to pick up
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[9999] cursor-crosshair select-none bg-black/10 backdrop-blur-[1px]"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={() => void handleMouseUp()}
      onMouseLeave={() => {
        if (dragging) void handleMouseUp();
      }}
    >
      {showRect && (
        <>
          <div
            className="pointer-events-none absolute border border-cyan-400 bg-cyan-500/10 shadow-2xl"
            style={{ left, top, width: w, height: h }}
          />
          <div
            className="pointer-events-none absolute rounded bg-black/60 px-2 py-0.5 font-mono text-[11px] text-cyan-300"
            style={{ left, top: Math.max(8, top - 26) }}
          >
            {Math.round(w)} × {Math.round(h)}
          </div>
        </>
      )}

      <div className="pointer-events-none absolute bottom-8 left-1/2 -translate-x-1/2 rounded-md border border-white/10 bg-black/50 px-4 py-2 text-[12px] text-white/90">
        Drag to select · Esc to cancel
      </div>

      {error && (
        <div className="pointer-events-none absolute left-1/2 top-8 -translate-x-1/2 rounded-md bg-red-900/80 px-4 py-2 text-[12px] text-red-100">
          {error}
        </div>
      )}
    </div>
  );
}
