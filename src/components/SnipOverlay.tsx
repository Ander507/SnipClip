import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import {
  ArrowUpRight,
  Highlighter,
  Pen,
  Square,
  Droplets,
  Hash,
  Copy,
  Save,
  X,
  MousePointer2,
  Pipette,
  Minus,
  Plus,
} from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { AnnotateTool, CaptureResult } from "../lib/types";
import { copyImage, saveSnip, saveSnipToVault } from "../lib/api";
import { save } from "@tauri-apps/plugin-dialog";

interface Props {
  capture: CaptureResult;
  onClose: () => void;
  onSaved: () => void;
}

interface Stroke {
  tool: AnnotateTool;
  color: string;
  width: number;
  points: { x: number; y: number }[];
  number?: number;
  blurStrength?: number;
}

interface ViewLayout {
  ax: number;
  ay: number;
  scale: number;
  fit: number;
  aw: number;
  ah: number;
}

const TOOLS: { id: AnnotateTool; icon: typeof Pen; label: string }[] = [
  { id: "select", icon: MousePointer2, label: "Move" },
  { id: "pen", icon: Pen, label: "Pen" },
  { id: "arrow", icon: ArrowUpRight, label: "Arrow" },
  { id: "rect", icon: Square, label: "Rectangle" },
  { id: "highlight", icon: Highlighter, label: "Highlight" },
  { id: "blur", icon: Droplets, label: "Blur" },
  { id: "number", icon: Hash, label: "Callout" },
  { id: "eyedropper", icon: Pipette, label: "Color picker" },
];

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;
const ZOOM_INTENSITY = 0.15;

function clampZoom(z: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100));
}

function rgbToHex(r: number, g: number, b: number): string {
  return (
    "#" +
    [r, g, b]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}

function sampleImageColor(
  img: HTMLImageElement,
  x: number,
  y: number
): { hex: string; rgb: string } | null {
  const ix = Math.max(0, Math.min(img.naturalWidth - 1, Math.floor(x)));
  const iy = Math.max(0, Math.min(img.naturalHeight - 1, Math.floor(y)));
  const off = document.createElement("canvas");
  off.width = 1;
  off.height = 1;
  const ctx = off.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, ix, iy, 1, 1, 0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return { hex: rgbToHex(r, g, b), rgb: `rgb(${r}, ${g}, ${b})` };
}

function computeLayout(
  captureW: number,
  captureH: number,
  zoom: number,
  panX: number,
  panY: number
): ViewLayout {
  const maxW = window.innerWidth - 80;
  const maxH = window.innerHeight - 160;
  const fit = Math.min(maxW / captureW, maxH / captureH, 2);
  const scale = fit * zoom;
  const aw = captureW * scale;
  const ah = captureH * scale;
  const ax = (window.innerWidth - aw) / 2 + panX;
  const ay = (window.innerHeight - ah) / 2 + 10 + panY;
  return { ax, ay, scale, fit, aw, ah };
}

/**
 * Seamless image-space gaussian blur (no mosaic grid, no background tint).
 * Samples with edge padding so filter blur doesn't darken at the clip boundary.
 */
function drawBlurRegion(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  ox: number,
  oy: number,
  scale: number,
  blurStrength: number
) {
  const sx = Math.max(0, Math.floor(x));
  const sy = Math.max(0, Math.floor(y));
  const sw = Math.max(1, Math.min(img.naturalWidth - sx, Math.ceil(w)));
  const sh = Math.max(1, Math.min(img.naturalHeight - sy, Math.ceil(h)));
  if (sw < 2 || sh < 2) return;

  const radius = Math.max(1, Math.round(blurStrength));
  const pad = Math.ceil(radius * 3);

  // Expanded sample (clamped to image) so blur kernel has neighbors — no dark fringe
  const srcX = Math.max(0, sx - pad);
  const srcY = Math.max(0, sy - pad);
  const srcR = Math.min(img.naturalWidth, sx + sw + pad);
  const srcB = Math.min(img.naturalHeight, sy + sh + pad);
  const srcW = Math.max(1, srcR - srcX);
  const srcH = Math.max(1, srcB - srcY);

  const temp = document.createElement("canvas");
  temp.width = srcW;
  temp.height = srcH;
  const tctx = temp.getContext("2d");
  if (!tctx) return;
  tctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);

  const blurred = document.createElement("canvas");
  blurred.width = srcW;
  blurred.height = srcH;
  const bctx = blurred.getContext("2d");
  if (!bctx) return;
  bctx.filter = `blur(${radius}px)`;
  bctx.drawImage(temp, 0, 0);
  bctx.filter = "none";

  const cutX = sx - srcX;
  const cutY = sy - srcY;
  const dx = ox + sx * scale;
  const dy = oy + sy * scale;
  const dw = sw * scale;
  const dh = sh * scale;

  ctx.save();
  ctx.beginPath();
  ctx.rect(dx, dy, dw, dh);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(blurred, cutX, cutY, sw, sh, dx, dy, dw, dh);
  ctx.restore();
}

const SHAPE_TOOLS: AnnotateTool[] = ["blur", "rect", "highlight", "arrow"];

/** Annotation editor for an already-cropped snip region. */
export function SnipOverlay({ capture, onClose, onSaved }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [tool, setTool] = useState<AnnotateTool>("pen");
  const [drawColor, setDrawColor] = useState("#ff5c5c");
  const [blurStrength, setBlurStrength] = useState(16);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isPanning, setIsPanning] = useState(false);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [current, setCurrent] = useState<Stroke | null>(null);
  const [dragging, setDragging] = useState(false);
  const [callout, setCallout] = useState(1);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [hoverColor, setHoverColor] = useState<string | null>(null);

  const layoutRef = useRef<ViewLayout>({ ax: 0, ay: 0, scale: 1, fit: 1, aw: 0, ah: 0 });
  const viewRef = useRef({ zoom: 1, panX: 0, panY: 0 });
  const panDragRef = useRef<{ startX: number; startY: number } | null>(null);
  const blurStrengthRef = useRef(blurStrength);
  blurStrengthRef.current = blurStrength;
  viewRef.current = { zoom: zoomLevel, panX, panY };

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const { zoom, panX: px, panY: py } = viewRef.current;
    const layout = computeLayout(capture.width, capture.height, zoom, px, py);
    layoutRef.current = layout;
    const { ax, ay, scale, aw, ah } = layout;

    ctx.fillStyle = "#121212";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, capture.width, capture.height, ax, ay, aw, ah);

    const all = current ? [...strokes, current] : strokes;
    const strength = blurStrengthRef.current;
    for (const s of all) drawStroke(ctx, s, ax, ay, scale, img, strength);
  }, [capture.width, capture.height, strokes, current]);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      redraw();
    };
    img.src = capture.dataUrl;
  }, [capture.dataUrl, redraw]);

  useEffect(() => {
    redraw();
    const onResize = () => redraw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [redraw]);

  useEffect(() => {
    redraw();
  }, [blurStrength, zoomLevel, panX, panY, redraw]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if ((e.ctrlKey || e.metaKey) && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        setZoomLevel((z) => clampZoom(Math.round((z + ZOOM_STEP) * 100) / 100));
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "-") {
        e.preventDefault();
        setZoomLevel((z) => clampZoom(Math.round((z - ZOOM_STEP) * 100) / 100));
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "0") {
        e.preventDefault();
        setZoomLevel(1);
        setPanX(0);
        setPanY(0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Wheel zoom centered on cursor
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { zoom, panX: px, panY: py } = viewRef.current;
      const old = computeLayout(capture.width, capture.height, zoom, px, py);
      if (old.scale <= 0) return;
      const imgX = (e.clientX - old.ax) / old.scale;
      const imgY = (e.clientY - old.ay) / old.scale;

      const next = clampZoom(
        e.deltaY < 0 ? zoom + ZOOM_INTENSITY : zoom - ZOOM_INTENSITY
      );
      if (Math.abs(next - zoom) < 0.0001) return;

      const newScale = old.fit * next;
      const newAw = capture.width * newScale;
      const newAh = capture.height * newScale;
      const newPanX =
        e.clientX - (window.innerWidth - newAw) / 2 - imgX * newScale;
      const newPanY =
        e.clientY - (window.innerHeight - newAh) / 2 - 10 - imgY * newScale;

      viewRef.current = { zoom: next, panX: newPanX, panY: newPanY };
      setZoomLevel(next);
      setPanX(newPanX);
      setPanY(newPanY);
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [capture.width, capture.height]);

  // End pan/draw on window mouseup (single place — avoids double-commit + pan drift)
  useEffect(() => {
    const end = () => {
      if (panDragRef.current) {
        panDragRef.current = null;
        setIsPanning(false);
      }
      setCurrent((c) => {
        if (!c) return null;
        // Shape tools: discard accidental clicks / tiny boxes
        if (SHAPE_TOOLS.includes(c.tool) && c.points.length >= 2) {
          const a = c.points[0];
          const b = c.points[c.points.length - 1];
          if (Math.abs(b.x - a.x) < 5 || Math.abs(b.y - a.y) < 5) return null;
        } else if (SHAPE_TOOLS.includes(c.tool)) {
          return null;
        }
        setStrokes((s) => [...s, c]);
        return null;
      });
      setDragging(false);
    };
    window.addEventListener("mouseup", end);
    return () => window.removeEventListener("mouseup", end);
  }, []);

  // Block middle-click auto-scroll / paste
  useEffect(() => {
    const block = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
    };
    window.addEventListener("mousedown", block, { capture: true });
    window.addEventListener("auxclick", block, { capture: true });
    return () => {
      window.removeEventListener("mousedown", block, { capture: true });
      window.removeEventListener("auxclick", block, { capture: true });
    };
  }, []);

  function startPan(e: React.MouseEvent) {
    setIsPanning(true);
    panDragRef.current = {
      startX: e.clientX - viewRef.current.panX,
      startY: e.clientY - viewRef.current.panY,
    };
  }

  function annotatePoint(e: React.MouseEvent) {
    const { ax, ay, scale } = layoutRef.current;
    if (scale <= 0) return { x: 0, y: 0 };
    return {
      x: (e.clientX - ax) / scale,
      y: (e.clientY - ay) / scale,
    };
  }

  async function pickColorAt(e: React.MouseEvent) {
    const img = imgRef.current;
    if (!img) return;
    const p = annotatePoint(e);
    if (p.x < 0 || p.y < 0 || p.x >= capture.width || p.y >= capture.height) return;
    const sample = sampleImageColor(img, p.x, p.y);
    if (!sample) return;
    setDrawColor(sample.hex);
    setHoverColor(sample.hex);
    try {
      await writeText(sample.hex);
      setToast(`${sample.hex} copied`);
      setTimeout(() => setToast(null), 1400);
    } catch {
      setToast(sample.hex);
      setTimeout(() => setToast(null), 1400);
    }
  }

  function onPointerDown(e: React.MouseEvent) {
    // Middle mouse OR Shift+drag — pan
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      e.preventDefault();
      startPan(e);
      return;
    }
    if (e.button !== 0) return;
    if (tool === "select") {
      startPan(e);
      return;
    }
    if (tool === "eyedropper") {
      void pickColorAt(e);
      return;
    }
    const p = annotatePoint(e);
    const stroke: Stroke = {
      tool,
      color:
        tool === "highlight"
          ? "rgba(245,197,66,0.35)"
          : tool === "blur"
            ? "transparent"
            : tool === "number"
              ? "#60a5fa"
              : drawColor,
      width: tool === "highlight" ? 18 : tool === "blur" ? 24 : 3,
      points: [p],
      number: tool === "number" ? callout : undefined,
      blurStrength: tool === "blur" ? blurStrength : undefined,
    };
    if (tool === "number") {
      setCallout((n) => n + 1);
      setStrokes((s) => [...s, stroke]);
      return;
    }
    setCurrent(stroke);
    setDragging(true);
  }

  function onPointerMove(e: React.MouseEvent) {
    if (panDragRef.current) {
      const nx = e.clientX - panDragRef.current.startX;
      const ny = e.clientY - panDragRef.current.startY;
      viewRef.current = { ...viewRef.current, panX: nx, panY: ny };
      setPanX(nx);
      setPanY(ny);
      return;
    }
    if (tool === "eyedropper" && imgRef.current) {
      const p = annotatePoint(e);
      if (p.x >= 0 && p.y >= 0 && p.x < capture.width && p.y < capture.height) {
        const sample = sampleImageColor(imgRef.current, p.x, p.y);
        setHoverColor(sample?.hex ?? null);
      } else {
        setHoverColor(null);
      }
    }
    if (!dragging || !current) return;
    const p = annotatePoint(e);
    // Shape tools: mutate ONE live box (start + end) — never stack frames as new boxes
    if (SHAPE_TOOLS.includes(current.tool)) {
      setCurrent({ ...current, points: [current.points[0], p] });
    } else {
      setCurrent({ ...current, points: [...current.points, p] });
    }
  }

  async function exportAnnotated() {
    if (!imgRef.current) return null;
    const off = document.createElement("canvas");
    off.width = capture.width;
    off.height = capture.height;
    const ctx = off.getContext("2d")!;
    ctx.drawImage(imgRef.current, 0, 0);
    for (const s of strokes) {
      drawStroke(ctx, s, 0, 0, 1, imgRef.current, blurStrength);
    }
    return { dataUrl: off.toDataURL("image/png"), w: off.width, h: off.height };
  }

  async function handleCopy() {
    setBusy(true);
    try {
      const out = await exportAnnotated();
      if (!out) return;
      await copyImage(out.dataUrl);
      await saveSnipToVault(out.dataUrl, out.w, out.h);
      setToast("Copied to clipboard");
      onSaved();
      setTimeout(onClose, 450);
    } catch (err) {
      setToast(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    setBusy(true);
    try {
      const out = await exportAnnotated();
      if (!out) return;
      const path = await save({
        defaultPath: `snip-${Date.now()}.png`,
        filters: [{ name: "PNG", extensions: ["png"] }],
      });
      if (path) {
        await saveSnip(out.dataUrl, path);
        await saveSnipToVault(out.dataUrl, out.w, out.h);
        setToast("Saved");
        onSaved();
        setTimeout(onClose, 450);
      }
    } catch (err) {
      setToast(String(err));
    } finally {
      setBusy(false);
    }
  }

  const showBlurControls = tool === "blur" || strokes.some((s) => s.tool === "blur");

  return (
    <div className="fixed inset-0 z-50 flex flex-col">
      <canvas
        ref={canvasRef}
        className={clsx(
          "absolute inset-0",
          isPanning
            ? "cursor-grabbing"
            : tool === "select"
              ? "cursor-grab"
              : "cursor-crosshair"
        )}
        onMouseDown={onPointerDown}
        onMouseMove={onPointerMove}
        onMouseLeave={() => {
          if (tool === "eyedropper") setHoverColor(null);
        }}
        onContextMenu={(e) => e.preventDefault()}
      />

      <div className="pointer-events-auto absolute left-1/2 top-5 z-10 flex -translate-x-1/2 select-none items-center gap-3 rounded-lg border border-[#2d2d2d] bg-[#191919] px-3 py-2 text-[11px] text-[#cccccc]">
        {showBlurControls && (
          <>
            <div className="flex items-center gap-2">
              <span className="text-[#888]">Blur</span>
              <input
                type="range"
                min={4}
                max={35}
                value={blurStrength}
                onChange={(e) => setBlurStrength(Number(e.target.value))}
                className="h-1 w-24 cursor-pointer accent-[#60cdff]"
              />
              <span className="w-7 font-mono text-right text-[#aaaaaa]">{blurStrength}px</span>
            </div>
            <div className="h-4 w-px bg-[#333]" />
          </>
        )}
        <div className="flex items-center gap-1.5">
          <span className="text-[#888]">Zoom</span>
          <button
            type="button"
            title="Zoom out"
            onClick={() => setZoomLevel((z) => clampZoom(Math.round((z - ZOOM_STEP) * 100) / 100))}
            className="flex h-6 w-6 items-center justify-center rounded bg-[#252525] text-[#ccc] hover:bg-[#333]"
          >
            <Minus size={12} />
          </button>
          <span className="w-10 text-center font-mono text-[#aaa]">
            {Math.round(zoomLevel * 100)}%
          </span>
          <button
            type="button"
            title="Zoom in"
            onClick={() => setZoomLevel((z) => clampZoom(Math.round((z + ZOOM_STEP) * 100) / 100))}
            className="flex h-6 w-6 items-center justify-center rounded bg-[#252525] text-[#ccc] hover:bg-[#333]"
          >
            <Plus size={12} />
          </button>
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-3 right-3 z-10 rounded-md border border-white/10 bg-black/70 px-3 py-1 font-mono text-[11px] text-[#cccccc]">
        Zoom: {Math.round(zoomLevel * 100)}% · Scroll zoom · Wheel / Shift-drag to pan
      </div>

      <div className="pointer-events-auto absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-[#2d2d2d] bg-[#1e1e1e] p-1.5 shadow-xl">
        {TOOLS.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            type="button"
            title={label}
            onClick={() => setTool(id)}
            className={clsx(
              "flex h-9 w-9 items-center justify-center rounded-md transition",
              tool === id
                ? "bg-[#2d2d2d] text-white"
                : "text-[#888888] hover:bg-[#2a2a2a] hover:text-white"
            )}
          >
            <Icon size={15} />
          </button>
        ))}

        <div className="mx-1 h-6 w-px bg-[#2d2d2d]" />

        <label
          className="relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-[#333] hover:border-[#555]"
          title="Draw color"
        >
          <span
            className="h-5 w-5 rounded-sm border border-black/40"
            style={{ backgroundColor: hoverColor || drawColor }}
          />
          <input
            type="color"
            value={drawColor}
            onChange={(e) => setDrawColor(e.target.value)}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>

        <div className="mx-1 h-6 w-px bg-[#2d2d2d]" />
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleCopy()}
          className="flex h-9 items-center gap-1.5 rounded-md bg-[#60cdff] px-3 text-[12px] font-semibold text-black transition hover:brightness-110 disabled:opacity-50"
        >
          <Copy size={13} /> Copy
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleSave()}
          className="flex h-9 items-center gap-1.5 rounded-md bg-[#2d2d2d] px-3 text-[12px] font-medium text-[#eeeeee] transition hover:bg-[#3d3d3d] disabled:opacity-50"
        >
          <Save size={13} /> Save
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-md text-[#888888] hover:bg-[#c42b1c] hover:text-white"
        >
          <X size={15} />
        </button>
      </div>

      {tool === "eyedropper" && hoverColor && (
        <div className="pointer-events-none absolute left-1/2 top-16 z-20 flex -translate-x-1/2 items-center gap-2 rounded-md border border-[#2d2d2d] bg-[#1e1e1e] px-3 py-1.5 font-mono text-[12px] text-[#ccc]">
          <span
            className="h-4 w-4 rounded-sm border border-white/20"
            style={{ backgroundColor: hoverColor }}
          />
          {hoverColor}
          <span className="text-[#666]">click to copy</span>
        </div>
      )}

      {toast && (
        <div className="absolute left-1/2 top-16 z-20 -translate-x-1/2 rounded-md border border-[#2d2d2d] bg-[#1e1e1e] px-4 py-1.5 text-[12px] text-[#60cdff]">
          {toast}
        </div>
      )}
    </div>
  );
}

function drawStroke(
  ctx: CanvasRenderingContext2D,
  s: Stroke,
  ox: number,
  oy: number,
  scale: number,
  img: HTMLImageElement,
  globalBlurStrength: number
) {
  const pts = s.points.map((p) => ({ x: ox + p.x * scale, y: oy + p.y * scale }));
  if (pts.length === 0) return;

  if (s.tool === "number" && s.number != null) {
    const p = pts[0];
    const r = 12 * scale;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = s.color || "#60a5fa";
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${Math.max(10, 12 * scale)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(s.number), p.x, p.y + 0.5);
    return;
  }

  if (s.tool === "blur" && pts.length >= 2) {
    const a = s.points[0];
    const b = s.points[s.points.length - 1];
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x);
    const h = Math.abs(b.y - a.y);
    const strength = globalBlurStrength || s.blurStrength || 16;
    drawBlurRegion(ctx, img, x, y, w, h, ox, oy, scale, strength);
    return;
  }

  if ((s.tool === "rect" || s.tool === "highlight") && pts.length >= 2) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x);
    const h = Math.abs(b.y - a.y);
    if (s.tool === "highlight") {
      ctx.fillStyle = s.color;
      ctx.fillRect(x, y, w, h);
    } else {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width * scale;
      ctx.strokeRect(x, y, w, h);
    }
    return;
  }

  if (s.tool === "arrow" && pts.length >= 2) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = s.width * scale;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const head = 12 * scale;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(
      b.x - head * Math.cos(angle - Math.PI / 6),
      b.y - head * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      b.x - head * Math.cos(angle + Math.PI / 6),
      b.y - head * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();
    return;
  }

  if (s.tool === "eyedropper") return;

  ctx.strokeStyle = s.color;
  ctx.lineWidth = s.width * scale;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}
