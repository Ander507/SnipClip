/** Layout, typography and popup preferences — persisted as one JSON blob (`ui_prefs`). */

export type Density = "compact" | "comfortable" | "spacious";
export type BorderStrength = "subtle" | "normal" | "strong";
export type SidebarPosition = "left" | "right";
export type ImageView = "list" | "grid";
export type ThumbSize = "small" | "medium" | "large";
export type PaletteAnchor = "bottom-right" | "bottom-center" | "center" | "cursor";

export interface UiPrefs {
  /** CSS font-family name for UI text. Empty = Segoe UI Variable. */
  fontFamily: string;
  /** CSS font-family name for code. Empty = Cascadia Mono. */
  monoFont: string;
  density: Density;
  /** Corner roundness as a percent of the default radii (0–200). */
  radius: number;
  borderStrength: BorderStrength;
  sidebarPosition: SidebarPosition;
  /** Icon-only sidebar. */
  sidebarCollapsed: boolean;
  /** How the Images / Screenshots tabs lay out. */
  imageView: ImageView;
  thumbSize: ThumbSize;
  paletteAnchor: PaletteAnchor;
  /** Popup panel width in px (320–560). */
  paletteWidth: number;
  /** Clips shown in the popup (10–50). */
  paletteMaxItems: number;
  paletteShowImages: boolean;
  /** Sidebar tab id → accent hex for its icon. */
  tabColors: Record<string, string>;
  /** Sidebar tab id → icon key from TAB_ICON_CHOICES. */
  tabIcons: Record<string, string>;
}

export const DEFAULT_UI_PREFS: UiPrefs = {
  fontFamily: "",
  monoFont: "",
  density: "comfortable",
  radius: 100,
  borderStrength: "normal",
  sidebarPosition: "left",
  sidebarCollapsed: false,
  imageView: "list",
  thumbSize: "medium",
  paletteAnchor: "bottom-right",
  paletteWidth: 380,
  paletteMaxItems: 25,
  paletteShowImages: true,
  tabColors: {},
  tabIcons: {},
};

/** Fonts that ship with Windows 10/11, so picking one never falls back silently. */
export const UI_FONT_CHOICES: { value: string; label: string }[] = [
  { value: "", label: "Segoe UI Variable (default)" },
  { value: "Segoe UI", label: "Segoe UI" },
  { value: "Bahnschrift", label: "Bahnschrift" },
  { value: "Arial", label: "Arial" },
  { value: "Verdana", label: "Verdana" },
  { value: "Georgia", label: "Georgia" },
  { value: "Cascadia Code", label: "Cascadia Code" },
];

export const MONO_FONT_CHOICES: { value: string; label: string }[] = [
  { value: "", label: "Cascadia Mono (default)" },
  { value: "Cascadia Code", label: "Cascadia Code" },
  { value: "Consolas", label: "Consolas" },
  { value: "Lucida Console", label: "Lucida Console" },
  { value: "Courier New", label: "Courier New" },
];

const DEFAULT_SANS = '"Segoe UI Variable", "Segoe UI", system-ui, sans-serif';
const DEFAULT_MONO = '"Cascadia Mono", "Consolas", "Courier New", monospace';

/** Tailwind v4 default radii (rem) — scaled by `radius`. */
const RADII: Record<string, number> = {
  "--radius-xs": 0.125,
  "--radius-sm": 0.25,
  "--radius-md": 0.375,
  "--radius-lg": 0.5,
  "--radius-xl": 0.75,
  "--radius-2xl": 1,
};

function clampNum(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function stringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string" && v.length <= 64) out[k] = v;
  }
  return out;
}

/** Font names go straight into CSS — keep them to plain family-name characters. */
function fontName(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().slice(0, 64);
  return /^[\w .\-]*$/.test(trimmed) ? trimmed : "";
}

export function normalizeUiPrefs(raw: unknown): UiPrefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof UiPrefs, unknown>>;
  const d = DEFAULT_UI_PREFS;
  return {
    fontFamily: fontName(r.fontFamily),
    monoFont: fontName(r.monoFont),
    density: pick(r.density, ["compact", "comfortable", "spacious"] as const, d.density),
    radius: clampNum(r.radius, 0, 200, d.radius),
    borderStrength: pick(r.borderStrength, ["subtle", "normal", "strong"] as const, d.borderStrength),
    sidebarPosition: pick(r.sidebarPosition, ["left", "right"] as const, d.sidebarPosition),
    sidebarCollapsed: typeof r.sidebarCollapsed === "boolean" ? r.sidebarCollapsed : d.sidebarCollapsed,
    imageView: pick(r.imageView, ["list", "grid"] as const, d.imageView),
    thumbSize: pick(r.thumbSize, ["small", "medium", "large"] as const, d.thumbSize),
    paletteAnchor: pick(
      r.paletteAnchor,
      ["bottom-right", "bottom-center", "center", "cursor"] as const,
      d.paletteAnchor
    ),
    paletteWidth: clampNum(r.paletteWidth, 320, 560, d.paletteWidth),
    paletteMaxItems: clampNum(r.paletteMaxItems, 10, 50, d.paletteMaxItems),
    paletteShowImages:
      typeof r.paletteShowImages === "boolean" ? r.paletteShowImages : d.paletteShowImages,
    tabColors: stringMap(r.tabColors),
    tabIcons: stringMap(r.tabIcons),
  };
}

/** Fonts, corner radii, border strength and density → CSS variables / data attributes on <html>. */
export function applyUiPrefs(prefs: UiPrefs) {
  const root = document.documentElement;
  root.style.setProperty(
    "--font-sans",
    prefs.fontFamily ? `"${prefs.fontFamily}", ${DEFAULT_SANS}` : DEFAULT_SANS
  );
  root.style.setProperty(
    "--font-mono",
    prefs.monoFont ? `"${prefs.monoFont}", ${DEFAULT_MONO}` : DEFAULT_MONO
  );
  const k = prefs.radius / 100;
  for (const [cssVar, rem] of Object.entries(RADII)) {
    root.style.setProperty(cssVar, `${Math.round(rem * k * 1000) / 1000}rem`);
  }
  root.dataset.density = prefs.density;
  root.dataset.borders = prefs.borderStrength;
}

/** Thumbnail edge (px) per size for grid tiles and image rows. */
export const THUMB_PX: Record<ThumbSize, number> = { small: 120, medium: 168, large: 232 };
