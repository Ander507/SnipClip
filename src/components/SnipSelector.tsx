import { useEffect, useRef, useState } from "react";

import { getCurrentWindow } from "@tauri-apps/api/window";

import {
  captureRegionOcr,
  captureScreenRegion,
  closeSnipper,
  showRecorderBar,
} from "../lib/api";

import type { CaptureResult } from "../lib/types";
import { sanitizeRecordRegion } from "../lib/recordDimensions";

import type { RecordFormat } from "./RecordControls";

export type OverlayMode = "snip" | "record";

export interface OverlayOrigin {
  originX: number;
  originY: number;
}

interface Props {
  active: boolean;
  initialMode?: OverlayMode;
  showControls?: boolean;
  /** Physical top-left of this overlay window (from snip-ready). */
  overlayOrigin?: OverlayOrigin | null;
  onCaptured: (result: CaptureResult) => void;
  onCancel: () => void;
}

interface FrozenRegion {
  left: number;
  top: number;
  width: number;
  height: number;
  physX: number;
  physY: number;
  physW: number;
  physH: number;
}

/** multiplying logical css pixels by devicePixelRatio so the rust crop matches the physical monitor resolution */
async function selectionToPhysical(
  x: number,
  y: number,
  width: number,
  height: number,
  fallbackOrigin: OverlayOrigin | null | undefined
) {
  const win = getCurrentWindow();
  const [pos, scale] = await Promise.all([
    win.outerPosition().catch(() => null),
    win.scaleFactor().catch(() => window.devicePixelRatio || 1),
  ]);
  const originX = pos?.x ?? fallbackOrigin?.originX ?? 0;
  const originY = pos?.y ?? fallbackOrigin?.originY ?? 0;
  const dpr = scale || window.devicePixelRatio || 1;
  return {
    physX: Math.round(originX + x * dpr),
    physY: Math.round(originY + y * dpr),
    physW: Math.max(1, Math.round(width * dpr)),
    physH: Math.max(1, Math.round(height * dpr)),
  };
}

/**
 * Lightweight translucent overlay — desktop shows through; region is captured after release.
 * UI is fully cleared + window hidden BEFORE the screen buffer is grabbed.
 */
export function SnipSelector({
  active,
  initialMode = "snip",
  showControls = true,
  overlayOrigin = null,
  onCaptured,
  onCancel,
}: Props) {
  const [mode, setMode] = useState<OverlayMode>(initialMode);
  const [dragging, setDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [startY, setStartY] = useState(0);
  const [currentX, setCurrentX] = useState(0);
  const [currentY, setCurrentY] = useState(0);
  /** When true, render nothing so no badge/box can bake into the shot */
  const [armed, setArmed] = useState(false);
  const [frozen, setFrozen] = useState<FrozenRegion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const originRef = useRef(overlayOrigin);
  originRef.current = overlayOrigin;
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  function resetInteraction() {
    setDragging(false);
    setStartX(0);
    setStartY(0);
    setCurrentX(0);
    setCurrentY(0);
    setArmed(false);
    setFrozen(null);
    setError(null);
    void getCurrentWindow()
      .setIgnoreCursorEvents(false)
      .catch(() => undefined);
  }

  useEffect(() => {
    if (active) {
      // Fresh snip-ready can reopen a parked window without active ever going false —
      // always clear leftover REC freeze from a prior record handoff.
      resetInteraction();
      setMode(initialMode);
    } else {
      resetInteraction();
      setMode("snip");
    }
  }, [active, initialMode]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Esc must work while frozen (REC preview) so a failed handoff never traps the desktop
      if (e.key === "Escape" && !armed) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, armed]);

  function handleMouseDown(e: React.MouseEvent) {
    if (armed || frozen || e.button !== 0) return;
    void getCurrentWindow()
      .setFocus()
      .catch(() => undefined);
    setDragging(true);
    setStartX(e.clientX);
    setStartY(e.clientY);
    setCurrentX(e.clientX);
    setCurrentY(e.clientY);
    setError(null);
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!dragging || armed || frozen) return;
    setCurrentX(e.clientX);
    setCurrentY(e.clientY);
  }

  async function beginRecording(
    left: number,
    top: number,
    width: number,
    height: number,
    physX: number,
    physY: number,
    physW: number,
    physH: number
  ) {
    setFrozen({ left, top, width, height, physX, physY, physW, physH });
    setDragging(false);

    const win = getCurrentWindow();
    const pos = await win.outerPosition().catch(() => null);
    const barX = left;
    const barY = top + height + 10;
    const dpr = (await win.scaleFactor().catch(() => window.devicePixelRatio || 1)) || 1;
    const originX = pos?.x ?? originRef.current?.originX ?? 0;
    const originY = pos?.y ?? originRef.current?.originY ?? 0;
    const screenX = Math.round(originX + barX * dpr);
    const screenY = Math.round(originY + barY * dpr);

    try {
      await showRecorderBar({
        screenX,
        screenY,
        region: sanitizeRecordRegion({ physX, physY, physW, physH }),
        format: "mp4" as RecordFormat,
        fps: 0,
      });
      // Recorder bar parks snippers; clear overlay session so a later snip isn't stuck on REC
      if (mountedRef.current) onCancel();
    } catch (err) {
      if (!mountedRef.current) return;
      setFrozen(null);
      setError(String(err));
    }
  }

  async function handleMouseUp(e?: React.MouseEvent) {
    if (!dragging || armed || frozen) return;
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
      const { physX, physY, physW, physH } = await selectionToPhysical(
        x,
        y,
        width,
        height,
        originRef.current
      );

      if (mode === "record") {
        await beginRecording(x, y, width, height, physX, physY, physW, physH);
        return;
      }

      setStartX(0);
      setStartY(0);
      setCurrentX(0);
      setCurrentY(0);
      setArmed(true);

      await new Promise<void>((r) => requestAnimationFrame(() => r()));

      // Hold Shift while releasing to OCR the region straight to the clipboard
      if (e?.shiftKey) {
        const result = await captureRegionOcr(physX, physY, physW, physH);
        setArmed(false);
        setError(
          result.lineCount > 0
            ? `Extracted ${result.lineCount} line${result.lineCount === 1 ? "" : "s"} of text`
            : "Text copied"
        );
        window.setTimeout(() => {
          void closeSnipper(false);
        }, 700);
        return;
      }

      const result = await captureScreenRegion(physX, physY, physW, physH);

      onCaptured(result);
    } catch (err) {
      setArmed(false);
      setFrozen(null);
      setError(String(err));
      try {
        await closeSnipper(false);
      } catch {
        /* ignore */
      }
    }
  }

  const left = frozen?.left ?? Math.min(startX, currentX);
  const top = frozen?.top ?? Math.min(startY, currentY);
  const w = frozen?.width ?? Math.abs(currentX - startX);
  const h = frozen?.height ?? Math.abs(currentY - startY);
  const showRect = (dragging && (w > 0 || h > 0)) || Boolean(frozen);

  const dimmed = !frozen;

  return (
    <div
      className={`fixed inset-0 z-[9999] select-none ${
        frozen ? "cursor-default bg-transparent" : "cursor-crosshair bg-black/10 backdrop-blur-[1px]"
      }`}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={(e) => void handleMouseUp(e)}
      onMouseLeave={() => {
        if (dragging && !frozen) void handleMouseUp();
      }}
      style={!active || armed ? { pointerEvents: "none", opacity: 0 } : undefined}
    >
      {showRect && (
        <>
          <div
            className={`pointer-events-none absolute border shadow-2xl ${
              frozen ? "border-red-500 bg-red-500/5" : "border-accent bg-accent/10"
            }`}
            style={{ left, top, width: w, height: h }}
          />
          {!frozen && dragging && (
            <div
              className="pointer-events-none absolute rounded bg-black/60 px-2 py-0.5 font-mono text-[11px] text-accent"
              style={{ left, top: Math.max(8, top - 26) }}
            >
              {Math.round(w)} × {Math.round(h)}
            </div>
          )}
          {frozen && (
            <div
              className="pointer-events-none absolute rounded bg-red-600/80 px-2 py-0.5 text-[10px] font-medium text-white"
              style={{ left, top: Math.max(8, top - 22) }}
            >
              REC
            </div>
          )}
        </>
      )}

      {dimmed && showControls && (
        <div
          className="pointer-events-auto absolute bottom-20 left-1/2 z-[10000] flex -translate-x-1/2 flex-col items-center gap-3"
          onMouseDown={(e) => e.stopPropagation()}
          onMouseUp={(e) => e.stopPropagation()}
        >
          <div className="flex rounded-lg border border-white/15 bg-black/55 p-0.5 text-[11px] text-white/80">
            <button
              type="button"
              className={`rounded-md px-3 py-1 transition ${
                mode === "snip" ? "bg-accent/25 text-accent" : "hover:bg-white/10"
              }`}
              onClick={() => setMode("snip")}
            >
              Snip
            </button>
            <button
              type="button"
              className={`rounded-md px-3 py-1 transition ${
                mode === "record" ? "bg-red-500/25 text-red-300" : "hover:bg-white/10"
              }`}
              onClick={() => setMode("record")}
            >
              Record
            </button>
          </div>
          <div className="rounded-md border border-white/10 bg-black/50 px-4 py-2 text-[12px] text-white/90">
            {mode === "record"
              ? "Drag a region to record · Esc to cancel"
              : "Drag to snip · Hold Shift to OCR text · Esc to cancel"}
          </div>
        </div>
      )}

      {error && (
        <div className="pointer-events-none absolute left-1/2 top-8 -translate-x-1/2 rounded-md bg-red-900/80 px-4 py-2 text-[12px] text-red-100">
          {error}
        </div>
      )}
    </div>
  );
}
