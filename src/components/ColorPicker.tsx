import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Pipette } from "lucide-react";

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function parseHex(hex: string): [number, number, number] | null {
  const raw = hex.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    return [
      parseInt(raw[0] + raw[0], 16),
      parseInt(raw[1] + raw[1], 16),
      parseInt(raw[2] + raw[2], 16),
    ];
  }
  if (/^[0-9a-fA-F]{6}$/.test(raw)) {
    return [
      parseInt(raw.slice(0, 2), 16),
      parseInt(raw.slice(2, 4), 16),
      parseInt(raw.slice(4, 6), 16),
    ];
  }
  return null;
}

function rgbToHex(r: number, g: number, b: number): string {
  return (
    "#" +
    [r, g, b]
      .map((c) => clamp(Math.round(c), 0, 255).toString(16).padStart(2, "0"))
      .join("")
  );
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return [h, s, max];
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (h < 60) [rp, gp, bp] = [c, x, 0];
  else if (h < 120) [rp, gp, bp] = [x, c, 0];
  else if (h < 180) [rp, gp, bp] = [0, c, x];
  else if (h < 240) [rp, gp, bp] = [0, x, c];
  else if (h < 300) [rp, gp, bp] = [x, 0, c];
  else [rp, gp, bp] = [c, 0, x];
  return [(rp + m) * 255, (gp + m) * 255, (bp + m) * 255];
}

function hexToHsv(hex: string): [number, number, number] {
  const rgb = parseHex(hex);
  if (!rgb) return [0, 0, 1];
  return rgbToHsv(rgb[0], rgb[1], rgb[2]);
}

function hsvToHex(h: number, s: number, v: number): string {
  const [r, g, b] = hsvToRgb(h, s, v);
  return rgbToHex(r, g, b);
}

const PANEL_W = 200;
const PANEL_H = 200;
const GAP = 6;

interface Props {
  value: string;
  onChange: (hex: string) => void;
  onPreview?: (hex: string) => void;
  label?: string;
}

export function ColorPicker({ value, onChange, onPreview, label }: Props) {
  const [open, setOpen] = useState(false);
  const [h, setH] = useState(0);
  const [s, setS] = useState(0);
  const [v, setV] = useState(1);
  const [hexText, setHexText] = useState(value);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const hsvRef = useRef({ h: 0, s: 0, v: 1 });
  const rafRef = useRef(0);
  const eyedropperActive = useRef(false);
  const eyeDropperSupported =
    typeof window !== "undefined" && "EyeDropper" in window;

  const display = value.startsWith("#") && value.length >= 7 ? value.slice(0, 7) : "#000000";

  function placePanel() {
    const btn = triggerRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - GAP;
    const openUp = spaceBelow < PANEL_H && rect.top > spaceBelow;
    let top = openUp ? rect.top - PANEL_H - GAP : rect.bottom + GAP;
    let left = rect.right - PANEL_W;
    left = clamp(left, 8, window.innerWidth - PANEL_W - 8);
    top = clamp(top, 8, window.innerHeight - PANEL_H - 8);
    setPos({ top, left });
  }

  useLayoutEffect(() => {
    if (!open) return;
    placePanel();
  }, [open]);

  useEffect(() => {
    if (open) return;
    const hsv = hexToHsv(display);
    setH(hsv[0]);
    setS(hsv[1]);
    setV(hsv[2]);
    hsvRef.current = { h: hsv[0], s: hsv[1], v: hsv[2] };
    setHexText(display);
  }, [display, open]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (eyedropperActive.current) return;
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !eyedropperActive.current) setOpen(false);
    }
    function onReposition() {
      placePanel();
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open]);

  function applyHex(hex: string, mode: "preview" | "commit") {
    const rgb = parseHex(hex);
    if (!rgb) return;
    const normalized = rgbToHex(rgb[0], rgb[1], rgb[2]);
    const hsv = rgbToHsv(rgb[0], rgb[1], rgb[2]);
    hsvRef.current = { h: hsv[0], s: hsv[1], v: hsv[2] };
    setH(hsv[0]);
    setS(hsv[1]);
    setV(hsv[2]);
    setHexText(normalized);
    if (mode === "commit") {
      onPreview?.(normalized);
      onChange(normalized);
    } else {
      onPreview?.(normalized);
    }
  }

  async function pickFromScreen() {
    if (!eyeDropperSupported) return;
    type EyeDropperCtor = new () => {
      open: () => Promise<{ sRGBHex: string }>;
    };
    const Ctor = (window as unknown as { EyeDropper: EyeDropperCtor }).EyeDropper;
    eyedropperActive.current = true;
    try {
      const result = await new Ctor().open();
      applyHex(result.sRGBHex, "commit");
    } catch {
      // cancelled
    } finally {
      eyedropperActive.current = false;
    }
  }

  function setHsv(nh: number, ns: number, nv: number, mode: "preview" | "commit") {
    hsvRef.current = { h: nh, s: ns, v: nv };
    setH(nh);
    setS(ns);
    setV(nv);
    const hex = hsvToHex(nh, ns, nv);
    setHexText(hex);
    if (mode === "commit") {
      onPreview?.(hex);
      onChange(hex);
      return;
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      onPreview?.(hex);
    });
  }

  function bindDrag(onMove: (cx: number, cy: number) => void) {
    const move = (e: PointerEvent) => onMove(e.clientX, e.clientY);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const { h: nh, s: ns, v: nv } = hsvRef.current;
      setHsv(nh, ns, nv, "commit");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function onSvPointer(e: React.PointerEvent) {
    e.preventDefault();
    const box = svRef.current;
    if (!box) return;
    const update = (cx: number, cy: number) => {
      const rect = box.getBoundingClientRect();
      const ns = clamp((cx - rect.left) / rect.width, 0, 1);
      const nv = 1 - clamp((cy - rect.top) / rect.height, 0, 1);
      setHsv(hsvRef.current.h, ns, nv, "preview");
    };
    update(e.clientX, e.clientY);
    bindDrag(update);
  }

  function onHuePointer(e: React.PointerEvent) {
    e.preventDefault();
    const box = hueRef.current;
    if (!box) return;
    const update = (cx: number) => {
      const rect = box.getBoundingClientRect();
      const nh = clamp(((cx - rect.left) / rect.width) * 360, 0, 359.99);
      setHsv(nh, hsvRef.current.s, hsvRef.current.v, "preview");
    };
    update(e.clientX);
    bindDrag((cx) => update(cx));
  }

  const hueColor = `hsl(${h}, 100%, 50%)`;

  const panel =
    open &&
    createPortal(
      <div
        ref={panelRef}
        className="fixed z-[9999] w-[200px] rounded-lg border border-line-strong bg-raised p-2.5 shadow-2xl"
        style={{ top: pos.top, left: pos.left }}
      >
        <div
          ref={svRef}
          onPointerDown={onSvPointer}
          className="relative h-[120px] w-full cursor-crosshair rounded-md"
          style={{
            backgroundImage: `
              linear-gradient(to top, #000, transparent),
              linear-gradient(to right, #fff, ${hueColor})
            `,
          }}
        >
          <span
            className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
            style={{
              left: `${s * 100}%`,
              top: `${(1 - v) * 100}%`,
              backgroundColor: hsvToHex(h, s, v),
            }}
          />
        </div>

        <div
          ref={hueRef}
          onPointerDown={onHuePointer}
          className="relative mt-2.5 h-3 w-full cursor-ew-resize rounded-full"
          style={{
            background:
              "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
          }}
        >
          <span
            className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
            style={{ left: `${(h / 360) * 100}%`, backgroundColor: hueColor }}
          />
        </div>

        <div className="mt-2.5 flex items-center gap-1.5">
          {eyeDropperSupported && (
            <button
              type="button"
              title="Pick color from screen"
              aria-label="Eyedropper"
              onClick={() => void pickFromScreen()}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-line bg-inset text-fg-muted outline-none hover:border-line-strong hover:text-fg focus-visible:border-accent"
            >
              <Pipette size={13} />
            </button>
          )}
          <input
            type="text"
            value={hexText}
            spellCheck={false}
            onChange={(e) => {
              const raw = e.target.value;
              setHexText(raw);
              const rgb = parseHex(raw);
              if (!rgb) return;
              applyHex(rgbToHex(rgb[0], rgb[1], rgb[2]), "commit");
            }}
            className="min-w-0 flex-1 rounded border border-line bg-inset px-2 py-1 font-mono text-[11px] text-fg-secondary outline-none focus:border-accent"
          />
        </div>
      </div>,
      document.body
    );

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label ? `${label} color` : "Pick color"}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="h-7 w-7 rounded border border-line bg-inset p-0.5 outline-none hover:border-line-strong focus-visible:border-accent"
      >
        <span
          className="block h-full w-full rounded-sm"
          style={{ backgroundColor: display }}
        />
      </button>
      {panel}
    </div>
  );
}
