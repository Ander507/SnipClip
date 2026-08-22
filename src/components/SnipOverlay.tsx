import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import {
  ArrowUpRight,
  Highlighter,
  Pen,
  Square,
  Circle,
  Droplets,
  Hash,
  Copy,
  Save,
  X,
  MousePointer2,
  Pipette,
  Minus,
  Plus,
  Undo2,
  Redo2,
} from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { AnnotateTool, CaptureResult } from "../lib/types";
import { copyImage, saveSnip, saveSnipToVault, updateVaultImage } from "../lib/api";
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
  filled?: boolean;
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
  { id: "circle", icon: Circle, label: "Circle" },
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
  y: number,
  ctx?: CanvasRenderingContext2D | null
): { hex: string; rgb: string } | null {
  const ix = Math.max(0, Math.min(img.naturalWidth - 1, Math.floor(x)));
  const iy = Math.max(0, Math.min(img.naturalHeight - 1, Math.floor(y)));
  let sampleCtx = ctx;
  if (!sampleCtx) {
    const off = document.createElement("canvas");
    off.width = 1;
    off.height = 1;
    sampleCtx = off.getContext("2d", { willReadFrequently: true });
  }
  if (!sampleCtx) return null;
  sampleCtx.drawImage(img, ix, iy, 1, 1, 0, 0, 1, 1);
  const [r, g, b] = sampleCtx.getImageData(0, 0, 1, 1).data;
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

const SHAPE_TOOLS: AnnotateTool[] = ["blur", "rect", "circle", "highlight", "arrow"];
const WIDTH_TOOLS: AnnotateTool[] = ["pen", "arrow", "rect", "circle"];
const FILL_TOOLS: AnnotateTool[] = ["rect", "circle"];

function clampPoint(
  p: { x: number; y: number },
  width: number,
  height: number
): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(width, p.x)),
    y: Math.max(0, Math.min(height, p.y)),
  };
}

function isInsideImage(
  p: { x: number; y: number },
  width: number,
  height: number
): boolean {
  return p.x >= 0 && p.y >= 0 && p.x <= width && p.y <= height;
}

/** Clean filled arrow: shaft stops at head base so the tip stays sharp. */
function drawArrow(
  ctx: CanvasRenderingContext2D,
  a: { x: number; y: number },
  b: { x: number; y: number },
  strokeWidth: number,
  color: string
) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 2) return;

  const angle = Math.atan2(dy, dx);
  const headLen = Math.min(len * 0.4, Math.max(16, strokeWidth * 5));
  const headHalf = headLen * 0.55;
  const baseX = b.x - Math.cos(angle) * headLen;
  const baseY = b.y - Math.sin(angle) * headLen;
  const ox = Math.cos(angle + Math.PI / 2) * headHalf;
  const oy = Math.sin(angle + Math.PI / 2) * headHalf;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Shaft to head base
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(baseX, baseY);
  ctx.stroke();

  // Solid triangular head
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(baseX + ox, baseY + oy);
  ctx.lineTo(baseX - ox, baseY - oy);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Annotation editor for an already-cropped snip region. */
export function SnipOverlay({ capture, onClose, onSaved }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [tool, setTool] = useState<AnnotateTool>("pen");
  const [drawColor, setDrawColor] = useState("#ff5c5c");
  const [lineWidth, setLineWidth] = useState(4);
  const [shapeFilled, setShapeFilled] = useState(false);
  const [blurStrength, setBlurStrength] = useState(16);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isPanning, setIsPanning] = useState(false);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [redoStack, setRedoStack] = useState<Stroke[]>([]);
  const [dragging, setDragging] = useState(false);
  const [callout, setCallout] = useState(1);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [hoverColor, setHoverColor] = useState<string | null>(null);

  const layoutRef = useRef<ViewLayout>({ ax: 0, ay: 0, scale: 1, fit: 1, aw: 0, ah: 0 });
  const viewRef = useRef({ zoom: 1, panX: 0, panY: 0 });
  const panDragRef = useRef<{ startX: number; startY: number } | null>(null);
  const currentRef = useRef<Stroke | null>(null);
  const strokesRef = useRef(strokes);
  const redoRef = useRef(redoStack);
  const blurStrengthRef = useRef(blurStrength);
  const rafRef = useRef<number | null>(null);
  const canvasSizeRef = useRef({ w: 0, h: 0 });
  const sampleCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  blurStrengthRef.current = blurStrength;
  strokesRef.current = strokes;
  redoRef.current = redoStack;
  viewRef.current = { zoom: zoomLevel, panX, panY };

  function commitStroke(stroke: Stroke) {
    setStrokes((s) => {
      const next = [...s, stroke];
      strokesRef.current = next;
      return next;
    });
    setRedoStack([]);
    redoRef.current = [];
    scheduleRedraw();
  }

  function undo() {
    const s = strokesRef.current;
    if (s.length === 0) return;
    const removed = s[s.length - 1];
    const next = s.slice(0, -1);
    strokesRef.current = next;
    setStrokes(next);
    const nextRedo = [...redoRef.current, removed];
    redoRef.current = nextRedo;
    setRedoStack(nextRedo);
    scheduleRedraw();
    if (removed.tool === "number") {
      setCallout((n) => Math.max(1, n - 1));
    }
  }

  function redo() {
    const r = redoRef.current;
    if (r.length === 0) return;
    const restored = r[r.length - 1];
    const nextRedo = r.slice(0, -1);
    redoRef.current = nextRedo;
    setRedoStack(nextRedo);
    const nextStrokes = [...strokesRef.current, restored];
    strokesRef.current = nextStrokes;
    setStrokes(nextStrokes);
    scheduleRedraw();
    if (restored.tool === "number" && restored.number != null) {
      setCallout((n) => Math.max(n, restored.number! + 1));
    }
  }

  function finishCurrentStroke() {
    const c = currentRef.current;
    currentRef.current = null;
    setDragging(false);
    if (!c) return;

    if (SHAPE_TOOLS.includes(c.tool)) {
      if (c.points.length < 2) return;
      const a = c.points[0];
      const b = c.points[c.points.length - 1];
      if (Math.hypot(b.x - a.x, b.y - a.y) < 5) return;
      commitStroke(c);
      return;
    }

    // Pen: need at least 2 points or it's an invisible click
    if (c.points.length >= 2) commitStroke(c);
    else scheduleRedraw();
  }

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = window.innerWidth;
    const h = window.innerHeight;
    if (canvasSizeRef.current.w !== w || canvasSizeRef.current.h !== h) {
      canvas.width = w;
      canvas.height = h;
      canvasSizeRef.current = { w, h };
    }

    const { zoom, panX: px, panY: py } = viewRef.current;
    const layout = computeLayout(capture.width, capture.height, zoom, px, py);
    layoutRef.current = layout;
    const { ax, ay, scale, aw, ah } = layout;

    // Always opaque — theme translucency/glass would leave trails on redraw
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#121212";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    ctx.drawImage(img, 0, 0, capture.width, capture.height, ax, ay, aw, ah);

    ctx.save();
    ctx.beginPath();
    ctx.rect(ax, ay, aw, ah);
    ctx.clip();

    const live = currentRef.current;
    const all = live ? [...strokesRef.current, live] : strokesRef.current;
    const strength = blurStrengthRef.current;
    for (const s of all) drawStroke(ctx, s, ax, ay, scale, img, strength);
    ctx.restore();
  }, [capture.width, capture.height]);

  const scheduleRedraw = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      redraw();
    });
  }, [redraw]);

  function showToast(message: string, ms = 1400) {
    if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current);
    setToast(message);
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, ms);
  }

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!sampleCtxRef.current) {
      const off = document.createElement("canvas");
      off.width = 1;
      off.height = 1;
      sampleCtxRef.current = off.getContext("2d", { willReadFrequently: true });
    }
  }, []);

  useEffect(() => {
    strokesRef.current = strokes;
    scheduleRedraw();
  }, [strokes, scheduleRedraw]);

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

      if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z") && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      // Ctrl+Y / Ctrl+Shift+Z redo
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === "y" || e.key === "Y" || (e.shiftKey && (e.key === "z" || e.key === "Z")))
      ) {
        e.preventDefault();
        redo();
        return;
      }

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
      // Commit outside setState updaters — Strict Mode double-invokes updaters
      // and was duplicating every stroke (needed Ctrl+Z twice to undo).
      finishCurrentStroke();
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
    const raw = {
      x: (e.clientX - ax) / scale,
      y: (e.clientY - ay) / scale,
    };
    return clampPoint(raw, capture.width, capture.height);
  }

  async function pickColorAt(e: React.MouseEvent) {
    const img = imgRef.current;
    if (!img) return;
    const p = annotatePoint(e);
    if (p.x < 0 || p.y < 0 || p.x >= capture.width || p.y >= capture.height) return;
    const sample = sampleImageColor(img, p.x, p.y, sampleCtxRef.current);
    if (!sample) return;
    setDrawColor(sample.hex);
    setHoverColor(sample.hex);
    try {
      await writeText(sample.hex);
      showToast(`${sample.hex} copied`);
    } catch {
      showToast(sample.hex);
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
    const { ax, ay, scale } = layoutRef.current;
    if (scale <= 0) return;
    const raw = {
      x: (e.clientX - ax) / scale,
      y: (e.clientY - ay) / scale,
    };
    if (!isInsideImage(raw, capture.width, capture.height)) return;

    const p = clampPoint(raw, capture.width, capture.height);
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
      width:
        tool === "highlight" ? 18 : tool === "blur" ? 24 : lineWidth,
      points: [p],
      number: tool === "number" ? callout : undefined,
      blurStrength: tool === "blur" ? blurStrength : undefined,
      filled: FILL_TOOLS.includes(tool) ? shapeFilled : undefined,
    };
    if (tool === "number") {
      setCallout((n) => n + 1);
      commitStroke(stroke);
      return;
    }
    currentRef.current = stroke;
    setDragging(true);
    scheduleRedraw();
  }

  function onPointerMove(e: React.MouseEvent) {
    if (panDragRef.current) {
      const nx = e.clientX - panDragRef.current.startX;
      const ny = e.clientY - panDragRef.current.startY;
      viewRef.current = { ...viewRef.current, panX: nx, panY: ny };
      setPanX(nx);
      setPanY(ny);
      scheduleRedraw();
      return;
    }
    if (tool === "eyedropper" && imgRef.current) {
      const p = annotatePoint(e);
      if (p.x >= 0 && p.y >= 0 && p.x < capture.width && p.y < capture.height) {
        const sample = sampleImageColor(imgRef.current, p.x, p.y, sampleCtxRef.current);
        setHoverColor(sample?.hex ?? null);
      } else {
        setHoverColor(null);
      }
    }
    if (!dragging || !currentRef.current) return;
    const p = annotatePoint(e);
    const cur = currentRef.current;
    // Shape tools: mutate ONE live box (start + end) — never stack frames as new boxes
    const next = SHAPE_TOOLS.includes(cur.tool)
      ? { ...cur, points: [cur.points[0], p] }
      : { ...cur, points: [...cur.points, p] };
    currentRef.current = next;
    scheduleRedraw();
  }

  async function exportAnnotated() {
    if (!imgRef.current) return null;
    const off = document.createElement("canvas");
    off.width = capture.width;
    off.height = capture.height;
    const ctx = off.getContext("2d")!;
    ctx.drawImage(imgRef.current, 0, 0);
    for (const s of strokesRef.current) {
      drawStroke(ctx, s, 0, 0, 1, imgRef.current);
    }
    return { dataUrl: off.toDataURL("image/png"), w: off.width, h: off.height };
  }

  async function persistAnnotated(dataUrl: string, w: number, h: number) {
    if (capture.vaultId != null) {
      await updateVaultImage(capture.vaultId, dataUrl, w, h);
      return;
    }
    try {
      await saveSnipToVault(dataUrl, w, h);
    } catch (err) {
      if (!String(err).toLowerCase().includes("duplicate")) throw err;
    }
  }

  async function handleCopy() {
    setBusy(true);
    try {
      const out = await exportAnnotated();
      if (!out) return;
      await copyImage(out.dataUrl);
      await persistAnnotated(out.dataUrl, out.w, out.h);
      showToast("Copied to clipboard");
      onSaved();
      toastTimerRef.current = window.setTimeout(onClose, 450);
    } catch (err) {
      showToast(String(err));
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
        await persistAnnotated(out.dataUrl, out.w, out.h);
        showToast("Saved");
        onSaved();
        toastTimerRef.current = window.setTimeout(onClose, 450);
      }
    } catch (err) {
      showToast(String(err));
    } finally {
      setBusy(false);
    }
  }

  const showBlurControls = tool === "blur" || strokes.some((s) => s.tool === "blur");
  const showWidthControls = WIDTH_TOOLS.includes(tool);
  const showFillControls = FILL_TOOLS.includes(tool);

  return (
    <div
      data-snip-editor
      className="fixed inset-0 z-[200] flex flex-col"
      style={{ backgroundColor: "#121212" }}
    >
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

      <div
        className="pointer-events-auto absolute left-1/2 top-5 z-10 flex -translate-x-1/2 select-none items-center gap-3 rounded-lg border border-line px-3 py-2 text-[11px] text-fg-secondary"
        style={{ backgroundColor: "#1a1a1a" }}
      >
        {showBlurControls && (
          <>
            <div className="flex items-center gap-2">
              <span className="text-fg-muted">Blur</span>
              <input
                type="range"
                min={4}
                max={35}
                value={blurStrength}
                onChange={(e) => setBlurStrength(Number(e.target.value))}
                className="h-1 w-24 cursor-pointer accent-accent"
              />
              <span className="w-7 font-mono text-right text-fg-muted">{blurStrength}px</span>
            </div>
            <div className="h-4 w-px bg-line-strong" />
          </>
        )}
        {showWidthControls && (
          <>
            <div className="flex items-center gap-2">
              <span className="text-fg-muted">Width</span>
              <input
                type="range"
                min={1}
                max={24}
                value={lineWidth}
                onChange={(e) => setLineWidth(Number(e.target.value))}
                className="h-1 w-24 cursor-pointer accent-accent"
              />
              <span className="w-7 font-mono text-right text-fg-muted">{lineWidth}px</span>
            </div>
            <div className="h-4 w-px bg-line-strong" />
          </>
        )}
        {showFillControls && (
          <>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={shapeFilled}
                onChange={(e) => setShapeFilled(e.target.checked)}
                className="h-3.5 w-3.5 cursor-pointer rounded accent-accent"
              />
              <span className="text-fg-muted">Filled</span>
            </label>
            <div className="h-4 w-px bg-line-strong" />
          </>
        )}
        <div className="flex items-center gap-1.5">
          <span className="text-fg-muted">Zoom</span>
          <button
            type="button"
            title="Zoom out"
            onClick={() => setZoomLevel((z) => clampZoom(Math.round((z - ZOOM_STEP) * 100) / 100))}
            className="flex h-6 w-6 items-center justify-center rounded bg-muted text-fg-secondary hover:bg-hover"
          >
            <Minus size={12} />
          </button>
          <span className="w-10 text-center font-mono text-fg-muted">
            {Math.round(zoomLevel * 100)}%
          </span>
          <button
            type="button"
            title="Zoom in"
            onClick={() => setZoomLevel((z) => clampZoom(Math.round((z + ZOOM_STEP) * 100) / 100))}
            className="flex h-6 w-6 items-center justify-center rounded bg-muted text-fg-secondary hover:bg-hover"
          >
            <Plus size={12} />
          </button>
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-3 right-3 z-10 rounded-md border border-white/10 bg-black/70 px-3 py-1 font-mono text-[11px] text-fg-secondary">
        Zoom: {Math.round(zoomLevel * 100)}% · Scroll to zoom · Shift-drag to pan
      </div>

      <div
        className="pointer-events-auto absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-line p-1.5 shadow-xl"
        style={{ backgroundColor: "#1a1a1a" }}
      >
        {TOOLS.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            type="button"
            title={label}
            onClick={() => setTool(id)}
            className={clsx(
              "flex h-9 w-9 items-center justify-center rounded-md transition",
              tool === id
                ? "bg-hover text-fg"
                : "text-fg-muted hover:bg-muted hover:text-fg"
            )}
          >
            <Icon size={15} />
          </button>
        ))}

        <div className="mx-1 h-6 w-px bg-line" />

        <button
          type="button"
          title="Undo (Ctrl+Z)"
          disabled={strokes.length === 0}
          onClick={undo}
          className="flex h-9 w-9 items-center justify-center rounded-md text-fg-muted transition hover:bg-muted hover:text-fg disabled:opacity-30"
        >
          <Undo2 size={15} />
        </button>
        <button
          type="button"
          title="Redo (Ctrl+Y)"
          disabled={redoStack.length === 0}
          onClick={redo}
          className="flex h-9 w-9 items-center justify-center rounded-md text-fg-muted transition hover:bg-muted hover:text-fg disabled:opacity-30"
        >
          <Redo2 size={15} />
        </button>

        <div className="mx-1 h-6 w-px bg-line" />

        <label
          className="relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-line-strong hover:border-fg-muted"
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

        <div className="mx-1 h-6 w-px bg-line" />
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleCopy()}
          className="flex h-9 items-center gap-1.5 rounded-md bg-accent px-3 text-[12px] font-semibold text-accent-fg transition hover:brightness-110 disabled:opacity-50"
        >
          <Copy size={13} /> Copy
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleSave()}
          className="flex h-9 items-center gap-1.5 rounded-md bg-hover px-3 text-[12px] font-medium text-fg-secondary transition hover:bg-muted disabled:opacity-50"
        >
          <Save size={13} /> Save
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-md text-fg-muted hover:bg-[#c42b1c] hover:text-white"
        >
          <X size={15} />
        </button>
      </div>

      {tool === "eyedropper" && hoverColor && (
        <div
          className="pointer-events-none absolute left-1/2 top-16 z-20 flex -translate-x-1/2 items-center gap-2 rounded-md border border-line px-3 py-1.5 font-mono text-[12px] text-fg-secondary"
          style={{ backgroundColor: "#1a1a1a" }}
        >
          <span
            className="h-4 w-4 rounded-sm border border-white/20"
            style={{ backgroundColor: hoverColor }}
          />
          {hoverColor}
          <span className="text-fg-faint">click to copy</span>
        </div>
      )}

      {toast && (
        <div
          className="absolute left-1/2 top-16 z-20 -translate-x-1/2 rounded-md border border-line px-4 py-1.5 text-[12px] text-accent"
          style={{ backgroundColor: "#1a1a1a" }}
        >
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
  globalBlurStrength?: number
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
    const strength = s.blurStrength ?? globalBlurStrength ?? 16;
    drawBlurRegion(ctx, img, x, y, w, h, ox, oy, scale, strength);
    return;
  }

  if ((s.tool === "rect" || s.tool === "highlight" || s.tool === "circle") && pts.length >= 2) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x);
    const h = Math.abs(b.y - a.y);
    if (s.tool === "highlight") {
      ctx.fillStyle = s.color;
      ctx.fillRect(x, y, w, h);
    } else if (s.tool === "circle") {
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      if (s.filled) {
        ctx.fillStyle = s.color;
        ctx.fill();
      } else {
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.width * scale;
        ctx.stroke();
      }
    } else if (s.tool === "rect") {
      if (s.filled) {
        ctx.fillStyle = s.color;
        ctx.fillRect(x, y, w, h);
      } else {
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.width * scale;
        ctx.strokeRect(x, y, w, h);
      }
    }
    return;
  }

  if (s.tool === "arrow" && pts.length >= 2) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    drawArrow(ctx, a, b, s.width * scale, s.color);
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
