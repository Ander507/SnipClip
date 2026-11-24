import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import clsx from "clsx";
import { Maximize, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import type { ClipboardItem } from "../../lib/types";
import { getItem } from "../../lib/api";
import { useItemThumbnail } from "../../lib/thumbnails";

export interface ImageStageHandle {
  zoomBy(factor: number): void;
  fit(): void;
  actual(): void;
}

interface Props {
  item: ClipboardItem;
  /** True for GIFs: the file on disk is shown directly. */
  isFile: boolean;
  chromeVisible: boolean;
  /** Full-resolution data URL once loaded (for the annotation editor). */
  onFullSrc(src: string | null): void;
  onDelete(id: number): void;
}

const PAD_TOP = 48;
const PAD_BOTTOM = 56;
const PAD_SIDE = 56;
const MAX_SCALE = 8;
const WHEEL_STEP = 1.15;

interface View {
  s: number;
  tx: number;
  ty: number;
  /** While true the image tracks the fit scale (window resizes keep it centered). */
  fitted: boolean;
}

export const ImageStage = forwardRef<ImageStageHandle, Props>(function ImageStage(
  { item, isFile, chromeVisible, onFullSrc, onDelete },
  ref
) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [view, setView] = useState<View>({ s: 1, tx: 0, ty: 0, fitted: true });
  const [dragging, setDragging] = useState(false);
  const [fullSrc, setFullSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const thumb = useItemThumbnail(item.id, 720, item.preview ?? null, !isFile);
  const fileSrc = isFile && item.content ? convertFileSrc(item.content) : null;
  const src = isFile ? fileSrc : fullSrc ?? thumb;

  const nw = item.width || natural?.w || 0;
  const nh = item.height || natural?.h || 0;

  // Full-resolution image: show the thumbnail at once, swap when the blob arrives.
  useEffect(() => {
    if (isFile) return;
    let cancelled = false;
    void getItem(item.id)
      .then((full) => {
        if (cancelled) return;
        const data = full?.content?.startsWith("data:image")
          ? full.content
          : full?.preview?.startsWith("data:image")
            ? full.preview
            : null;
        if (data) {
          setFullSrc(data);
          onFullSrc(data);
        } else if (!thumb) {
          setFailed(true);
        }
      })
      .catch(() => {
        if (!cancelled && !thumb) setFailed(true);
      });
    return () => {
      cancelled = true;
      onFullSrc(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, isFile]);

  // Stage size in local (UI-zoom independent) pixels.
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStage({ w: el.offsetWidth, h: el.offsetHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const availW = Math.max(1, stage.w - PAD_SIDE * 2);
  const availH = Math.max(1, stage.h - PAD_TOP - PAD_BOTTOM);
  const fitScale = nw > 0 && nh > 0 ? Math.min(availW / nw, availH / nh, 1) : 1;
  const maxScale = Math.max(MAX_SCALE, fitScale);

  /** Centered position for a given scale (inside the padded area vertically). */
  const centered = useCallback(
    (s: number) => ({
      tx: stage.w / 2 - (nw * s) / 2,
      ty: PAD_TOP + availH / 2 - (nh * s) / 2,
    }),
    [stage.w, availH, nw, nh]
  );

  const clamp = useCallback(
    (s: number, tx: number, ty: number) => {
      const w = nw * s;
      const h = nh * s;
      const c = centered(s);
      const x = w <= stage.w ? c.tx : Math.min(0, Math.max(stage.w - w, tx));
      const y = h <= stage.h ? c.ty : Math.min(0, Math.max(stage.h - h, ty));
      return { tx: x, ty: y };
    },
    [centered, nw, nh, stage.w, stage.h]
  );

  // Effective view: fitted tracks the current fit scale, custom views are clamped.
  const eff = view.fitted
    ? { s: fitScale, ...centered(fitScale) }
    : (() => {
        const s = Math.min(maxScale, Math.max(fitScale, view.s));
        return { s, ...clamp(s, view.tx, view.ty) };
      })();
  const effRef = useRef(eff);
  effRef.current = eff;

  /** Pointer position in the stage's local pixels (undoes the UI zoom). */
  const toLocal = useCallback((clientX: number, clientY: number) => {
    const el = stageRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    const ratio = el.offsetWidth > 0 ? rect.width / el.offsetWidth : 1;
    return { x: (clientX - rect.left) / (ratio || 1), y: (clientY - rect.top) / (ratio || 1) };
  }, []);

  const zoomTo = useCallback(
    (target: number, px: number, py: number) => {
      const cur = effRef.current;
      const s = Math.min(maxScale, Math.max(fitScale, target));
      if (Math.abs(s - fitScale) < 0.0005) {
        setView({ s: fitScale, tx: 0, ty: 0, fitted: true });
        return;
      }
      const k = s / cur.s;
      const tx = px - (px - cur.tx) * k;
      const ty = py - (py - cur.ty) * k;
      setView({ s, ...clamp(s, tx, ty), fitted: false });
    },
    [clamp, fitScale, maxScale]
  );

  useImperativeHandle(
    ref,
    () => ({
      zoomBy: (factor: number) => zoomTo(effRef.current.s * factor, stage.w / 2, stage.h / 2),
      fit: () => setView({ s: fitScale, tx: 0, ty: 0, fitted: true }),
      actual: () => zoomTo(1, stage.w / 2, stage.h / 2),
    }),
    [zoomTo, stage.w, stage.h, fitScale]
  );

  // Wheel zoom around the cursor (needs a non-passive listener to stop page scroll).
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const { x, y } = toLocal(e.clientX, e.clientY);
      const dir = e.deltaY < 0 ? 1 : -1;
      const notches = Math.min(3, Math.max(1, Math.abs(e.deltaY) / 100));
      zoomTo(effRef.current.s * Math.pow(WHEEL_STEP, dir * notches), x, y);
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [toLocal, zoomTo]);

  const drag = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null);

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const cur = effRef.current;
    const { x, y } = toLocal(e.clientX, e.clientY);
    drag.current = { x, y, tx: cur.tx, ty: cur.ty, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    const { x, y } = toLocal(e.clientX, e.clientY);
    const dx = x - d.x;
    const dy = y - d.y;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    d.moved = true;
    const cur = effRef.current;
    if (view.fitted && cur.s <= fitScale + 0.0005) return; // nothing to pan
    setDragging(true);
    setView({ s: cur.s, ...clamp(cur.s, d.tx + dx, d.ty + dy), fitted: false });
  }

  function endDrag(e: ReactPointerEvent<HTMLDivElement>) {
    drag.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  function onDoubleClick(e: ReactMouseEvent<HTMLDivElement>) {
    const { x, y } = toLocal(e.clientX, e.clientY);
    const cur = effRef.current;
    const atFit = Math.abs(cur.s - fitScale) < 0.0005;
    if (!atFit) {
      setView({ s: fitScale, tx: 0, ty: 0, fitted: true });
    } else {
      zoomTo(fitScale < 0.9995 ? 1 : 2, x, y);
    }
  }

  const pct = Math.round(eff.s * 100);
  const zoomed = eff.s > fitScale + 0.0005;

  if (failed || (isFile && !fileSrc)) {
    return (
      <div className="absolute inset-0 flex items-center justify-center p-8">
        <div className="max-w-sm text-center">
          <p className="text-[14px] font-semibold text-fg">This image can't be shown</p>
          <p className="mt-1.5 text-[12px] text-fg-muted">The file is missing or unreadable.</p>
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

  return (
    <div
      ref={stageRef}
      className={clsx(
        "absolute inset-0 overflow-hidden touch-none",
        zoomed ? (dragging ? "cursor-grabbing" : "cursor-grab") : "cursor-default"
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onDoubleClick}
    >
      {src && nw > 0 && nh > 0 && (
        <div
          className="absolute left-0 top-0"
          style={{
            width: nw,
            height: nh,
            transformOrigin: "0 0",
            transform: `translate3d(${eff.tx}px, ${eff.ty}px, 0) scale(${eff.s})`,
            willChange: "transform",
          }}
        >
          <img
            src={src}
            alt=""
            draggable={false}
            onLoad={(e) => {
              const img = e.currentTarget;
              if (!item.width || !item.height) {
                setNatural({ w: img.naturalWidth, h: img.naturalHeight });
              }
            }}
            onError={() => {
              if (isFile || src === fullSrc) setFailed(true);
            }}
            className="block h-full w-full select-none"
            style={{ imageRendering: eff.s >= 3 ? "pixelated" : "auto" }}
          />
        </div>
      )}
      {/* Size unknown until the first pixels arrive: load invisibly to measure it. */}
      {src && !(nw > 0 && nh > 0) && (
        <img
          src={src}
          alt=""
          className="absolute h-0 w-0 opacity-0"
          onLoad={(e) =>
            setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
          }
          onError={() => setFailed(true)}
        />
      )}
      {!src && (
        <div className="absolute inset-0 flex items-center justify-center text-[12px] text-fg-muted">
          Loading…
        </div>
      )}

      <div
        data-chrome
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        className={clsx(
          "absolute bottom-4 left-1/2 flex h-9 -translate-x-1/2 items-center gap-0.5 rounded-full border border-line bg-raised/90 px-1 shadow-lg transition-opacity duration-200",
          !chromeVisible && "pointer-events-none opacity-0"
        )}
      >
        <button
          type="button"
          title="Zoom out (−)"
          aria-label="Zoom out"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => zoomTo(eff.s / 1.25, stage.w / 2, stage.h / 2)}
          className="flex h-7 w-7 items-center justify-center rounded-full text-fg-secondary transition-colors hover:bg-hover hover:text-fg"
        >
          <ZoomOut size={15} />
        </button>
        <button
          type="button"
          title="Actual size (1)"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => zoomTo(1, stage.w / 2, stage.h / 2)}
          className="h-7 min-w-[3.25rem] rounded-full px-1.5 font-mono text-[12px] tabular-nums text-fg-secondary transition-colors hover:bg-hover hover:text-fg"
        >
          {pct}%
        </button>
        <button
          type="button"
          title="Zoom in (+)"
          aria-label="Zoom in"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => zoomTo(eff.s * 1.25, stage.w / 2, stage.h / 2)}
          className="flex h-7 w-7 items-center justify-center rounded-full text-fg-secondary transition-colors hover:bg-hover hover:text-fg"
        >
          <ZoomIn size={15} />
        </button>
        <span className="mx-1 h-4 w-px bg-line" />
        <button
          type="button"
          title="Fit to window (0)"
          aria-label="Fit to window"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setView({ s: fitScale, tx: 0, ty: 0, fitted: true })}
          className="flex h-7 w-7 items-center justify-center rounded-full text-fg-secondary transition-colors hover:bg-hover hover:text-fg"
        >
          <Maximize size={15} />
        </button>
      </div>
    </div>
  );
});
