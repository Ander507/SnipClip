import { useEffect, useState } from "react";

import { getCurrentWindow } from "@tauri-apps/api/window";

import {
  captureScreenRegion,
  closeSnipper,
  showRecorderBar,
} from "../lib/api";

import type { CaptureResult } from "../lib/types";
import { sanitizeRecordRegion } from "../lib/recordDimensions";

import type { RecordFormat } from "./RecordControls";



export type OverlayMode = "snip" | "record";



interface Props {
  active: boolean;
  initialMode?: OverlayMode;
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
function selectionToPhysical(
  x: number,
  y: number,
  width: number,
  height: number,
  originX: number,
  originY: number
) {
  const dpr = window.devicePixelRatio || 1;
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

export function SnipSelector({ active, initialMode = "snip", onCaptured, onCancel }: Props) {

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



  useEffect(() => {
    if (active) {
      setMode(initialMode);
    }
  }, [active, initialMode]);

  useEffect(() => {

    if (!active) {

      setDragging(false);

      setStartX(0);

      setStartY(0);

      setCurrentX(0);

      setCurrentY(0);

      setArmed(false);

      setFrozen(null);

      setError(null);

      setMode("snip");

      void getCurrentWindow()
        .setIgnoreCursorEvents(false)
        .catch(() => undefined);

    }

  }, [active]);



  useEffect(() => {

    function onKey(e: KeyboardEvent) {

      if (e.key === "Escape" && !armed && !frozen) onCancel();

    }

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);

  }, [onCancel, armed, frozen]);



  function handleMouseDown(e: React.MouseEvent) {

    if (armed || frozen || e.button !== 0) return;

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
    const pos = await win.outerPosition();
    const barX = left;
    const barY = top + height + 10;
    const dpr = window.devicePixelRatio || 1;
    const screenX = Math.round(pos.x + barX * dpr);
    const screenY = Math.round(pos.y + barY * dpr);

    await showRecorderBar({
      screenX,
      screenY,

      region: sanitizeRecordRegion({ physX, physY, physW, physH }),

      format: "mp4" as RecordFormat,

      fps: 0,

    });

  }



  async function handleMouseUp() {

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

      const win = getCurrentWindow();
      const pos = await win.outerPosition();
      const { physX, physY, physW, physH } = selectionToPhysical(
        x,
        y,
        width,
        height,
        pos.x,
        pos.y
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

      onMouseUp={() => void handleMouseUp()}

      onMouseLeave={() => {

        if (dragging && !frozen) void handleMouseUp();

      }}

      style={!active || armed ? { pointerEvents: "none", opacity: 0 } : undefined}

    >

      {showRect && (

        <>

          <div

            className={`pointer-events-none absolute border shadow-2xl ${

              frozen

                ? "border-red-500 bg-red-500/5"

                : "border-accent bg-accent/10"

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



      {dimmed && (
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
              : "Drag to select on any screen · Esc to cancel"}
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


