export type ThemeMode = "dark" | "light";
/** What the user picked — "system" resolves to dark/light from Windows. */
export type ThemePreference = ThemeMode | "system";
/** Native Windows 11 window material behind the (then translucent) UI. */
export type ThemeBackdrop = "none" | "mica" | "acrylic";

export type PresetAccent =
  | "cyan"
  | "blue"
  | "indigo"
  | "purple"
  | "pink"
  | "red"
  | "orange"
  | "yellow"
  | "green";
/** A preset id, or any `#rrggbb` picked in the accent color picker. */
export type AccentColor = PresetAccent | `#${string}`;

export const ACCENTS: { id: PresetAccent; label: string; hex: string }[] = [
  { id: "cyan", label: "Cyan", hex: "#00e8c6" },
  { id: "blue", label: "Blue", hex: "#60a5fa" },
  { id: "indigo", label: "Indigo", hex: "#818cf8" },
  { id: "purple", label: "Purple", hex: "#c084fc" },
  { id: "pink", label: "Pink", hex: "#f472b6" },
  { id: "red", label: "Red", hex: "#f87171" },
  { id: "orange", label: "Orange", hex: "#fb923c" },
  { id: "yellow", label: "Yellow", hex: "#facc15" },
  { id: "green", label: "Green", hex: "#4ade80" },
];

export type ThemeTokenKey =
  | "app"
  | "raised"
  | "hover"
  | "muted"
  | "inset"
  | "line"
  | "lineStrong"
  | "fg"
  | "fgSecondary"
  | "fgMuted"
  | "fgFaint"
  | "danger"
  | "scroll"
  | "accent"
  | "accentFg";

export type ThemeCustomColors = Record<ThemeTokenKey, string>;

export const THEME_CSS_VARS: Record<ThemeTokenKey, string> = {
  app: "--sc-app",
  raised: "--sc-raised",
  hover: "--sc-hover",
  muted: "--sc-muted",
  inset: "--sc-inset",
  line: "--sc-line",
  lineStrong: "--sc-line-strong",
  fg: "--sc-fg",
  fgSecondary: "--sc-fg-secondary",
  fgMuted: "--sc-fg-muted",
  fgFaint: "--sc-fg-faint",
  danger: "--sc-danger",
  scroll: "--sc-scroll",
  accent: "--sc-accent",
  accentFg: "--sc-accent-fg",
};

export const THEME_TOKEN_GROUPS: {
  title: string;
  tokens: { key: ThemeTokenKey; label: string; hint?: string }[];
}[] = [
  {
    title: "Surfaces",
    tokens: [
      { key: "app", label: "App background" },
      { key: "raised", label: "Raised panels" },
      { key: "hover", label: "Hover state" },
      { key: "muted", label: "Muted fill" },
      { key: "inset", label: "Inset / input bg" },
    ],
  },
  {
    title: "Borders",
    tokens: [
      { key: "line", label: "Border" },
      { key: "lineStrong", label: "Strong border" },
    ],
  },
  {
    title: "Text",
    tokens: [
      { key: "fg", label: "Primary text" },
      { key: "fgSecondary", label: "Secondary text" },
      { key: "fgMuted", label: "Muted text" },
      { key: "fgFaint", label: "Faint text" },
    ],
  },
  {
    title: "Accent & status",
    tokens: [
      { key: "accent", label: "Accent" },
      { key: "accentFg", label: "Accent foreground" },
      { key: "danger", label: "Danger / delete" },
      { key: "scroll", label: "Scrollbar thumb" },
    ],
  },
];

type BaseColors = Omit<ThemeCustomColors, "accent" | "accentFg">;

const DARK_BASE: BaseColors = {
  app: "#202020",
  raised: "#191919",
  hover: "#2d2d2d",
  muted: "#252525",
  inset: "#121212",
  line: "#2d2d2d",
  lineStrong: "#3d3d3d",
  fg: "#ffffff",
  fgSecondary: "#eeeeee",
  fgMuted: "#777777",
  fgFaint: "#666666",
  danger: "#ff6b6b",
  scroll: "#3d3d3d",
};

const LIGHT_BASE: BaseColors = {
  app: "#f3f3f3",
  raised: "#ffffff",
  hover: "#e8e8e8",
  muted: "#ececec",
  inset: "#fafafa",
  line: "#e0e0e0",
  lineStrong: "#cfcfcf",
  fg: "#1a1a1a",
  fgSecondary: "#2a2a2a",
  fgMuted: "#6b6b6b",
  fgFaint: "#8a8a8a",
  danger: "#d13438",
  scroll: "#c4c4c4",
};

export function isHexColor(value: unknown): value is `#${string}` {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

export function accentHex(accent: AccentColor): string {
  if (isHexColor(accent)) return accent.toLowerCase();
  return ACCENTS.find((a) => a.id === accent)?.hex ?? ACCENTS[0].hex;
}

/** Black or white — whichever reads better on `hex` (WCAG relative luminance). */
export function contrastFg(hex: string): "#000000" | "#ffffff" {
  const rgb = parseHex(hex);
  if (!rgb) return "#000000";
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Contrast vs black beats contrast vs white above ~0.179
  return luminance > 0.179 ? "#000000" : "#ffffff";
}

function accentPair(accent: AccentColor): { accent: string; accentFg: string } {
  const hex = accentHex(accent);
  return { accent: hex, accentFg: contrastFg(hex) };
}

export function getPresetThemeColors(
  mode: ThemeMode,
  accent: AccentColor
): ThemeCustomColors {
  const base = mode === "light" ? LIGHT_BASE : DARK_BASE;
  return { ...base, ...accentPair(accent) };
}

export function resolveThemeMode(pref: ThemePreference): ThemeMode {
  if (pref !== "system") return pref;
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/** Accent pick. A custom palette carries its own accent, so update that too or the swatch does nothing. */
export function withAccent<T extends ThemeApplyInput>(settings: T, accent: AccentColor): T {
  return {
    ...settings,
    accentColor: accent,
    themeCustom: settings.themeCustom
      ? { ...settings.themeCustom, ...accentPair(accent) }
      : settings.themeCustom,
  };
}

/**
 * Dark/Light/System pick. A custom palette's surfaces and text were tuned for the old mode, so
 * rebase them onto the new mode's preset (keeping the accent) — a half-rebased palette ends up
 * unreadable. Switching between choices that resolve to the same mode keeps the palette.
 */
export function withThemeMode<T extends ThemeApplyInput>(settings: T, pref: ThemePreference): T {
  if (settings.themeMode === pref) return settings;
  const nextMode = resolveThemeMode(pref);
  if (!settings.themeCustom || resolveThemeMode(settings.themeMode) === nextMode) {
    return { ...settings, themeMode: pref };
  }
  const preset = getPresetThemeColors(nextMode, settings.accentColor);
  return {
    ...settings,
    themeMode: pref,
    themeCustom: {
      ...preset,
      accent: settings.themeCustom.accent ?? preset.accent,
      accentFg: settings.themeCustom.accentFg ?? preset.accentFg,
    },
  };
}

export function normalizeThemeMode(value: string | undefined): ThemePreference {
  if (value === "light" || value === "system") return value;
  return "dark";
}

export function normalizeAccent(value: string | undefined): AccentColor {
  if (isHexColor(value)) return value.toLowerCase() as AccentColor;
  const preset = ACCENTS.find((a) => a.id === value);
  return preset ? preset.id : "cyan";
}

export function normalizeBackdrop(value: string | undefined): ThemeBackdrop {
  return value === "mica" || value === "acrylic" ? value : "none";
}

export interface ThemeApplyInput {
  themeMode: ThemePreference;
  accentColor: AccentColor;
  themeUseCustom?: boolean;
  themeCustom?: ThemeCustomColors | null;
  themeGlassmorphic?: boolean;
  themeTranslucency?: number;
  themeBackgroundImage?: string | null;
  themeBackdrop?: ThemeBackdrop;
}

export interface ThemePack {
  id: string;
  name: string;
  themeMode: string;
  accentColor: string;
  colors?: ThemeCustomColors | null;
  glassmorphic: boolean;
  translucency: number;
  backgroundImage?: string | null;
  createdAt: string;
}

/** Built-in looks for the theme gallery. `colors: null` means the plain preset (custom off). */
export interface ThemePreset {
  id: string;
  name: string;
  mode: ThemeMode;
  accent: AccentColor;
  colors: BaseColors | null;
}

export const THEME_PRESETS: ThemePreset[] = [
  { id: "default-dark", name: "SnipClip Dark", mode: "dark", accent: "cyan", colors: null },
  { id: "default-light", name: "SnipClip Light", mode: "light", accent: "blue", colors: null },
  {
    id: "oled",
    name: "OLED Black",
    mode: "dark",
    accent: "#00e8c6",
    colors: {
      app: "#000000",
      raised: "#0a0a0a",
      hover: "#1a1a1a",
      muted: "#111111",
      inset: "#000000",
      line: "#1f1f1f",
      lineStrong: "#2e2e2e",
      fg: "#ffffff",
      fgSecondary: "#e6e6e6",
      fgMuted: "#8a8a8a",
      fgFaint: "#5c5c5c",
      danger: "#ff6b6b",
      scroll: "#2e2e2e",
    },
  },
  {
    id: "nord",
    name: "Nord",
    mode: "dark",
    accent: "#88c0d0",
    colors: {
      app: "#2e3440",
      raised: "#272c36",
      hover: "#3b4252",
      muted: "#343a46",
      inset: "#242933",
      line: "#3b4252",
      lineStrong: "#4c566a",
      fg: "#eceff4",
      fgSecondary: "#e5e9f0",
      fgMuted: "#9aa3b5",
      fgFaint: "#6c7689",
      danger: "#bf616a",
      scroll: "#4c566a",
    },
  },
  {
    id: "dracula",
    name: "Dracula",
    mode: "dark",
    accent: "#bd93f9",
    colors: {
      app: "#282a36",
      raised: "#21222c",
      hover: "#343746",
      muted: "#2c2e3b",
      inset: "#1e1f29",
      line: "#343746",
      lineStrong: "#44475a",
      fg: "#f8f8f2",
      fgSecondary: "#e9e9e4",
      fgMuted: "#9ea1b8",
      fgFaint: "#6272a4",
      danger: "#ff5555",
      scroll: "#44475a",
    },
  },
  {
    id: "catppuccin",
    name: "Catppuccin Mocha",
    mode: "dark",
    accent: "#cba6f7",
    colors: {
      app: "#1e1e2e",
      raised: "#181825",
      hover: "#313244",
      muted: "#252536",
      inset: "#11111b",
      line: "#313244",
      lineStrong: "#45475a",
      fg: "#cdd6f4",
      fgSecondary: "#bac2de",
      fgMuted: "#9399b2",
      fgFaint: "#6c7086",
      danger: "#f38ba8",
      scroll: "#45475a",
    },
  },
  {
    id: "rose-pine",
    name: "Rosé Pine",
    mode: "dark",
    accent: "#ebbcba",
    colors: {
      app: "#191724",
      raised: "#1f1d2e",
      hover: "#26233a",
      muted: "#21202e",
      inset: "#13111c",
      line: "#26233a",
      lineStrong: "#403d52",
      fg: "#e0def4",
      fgSecondary: "#d4d1ea",
      fgMuted: "#908caa",
      fgFaint: "#6e6a86",
      danger: "#eb6f92",
      scroll: "#403d52",
    },
  },
  {
    id: "win11-light",
    name: "Windows Light",
    mode: "light",
    accent: "#0067c0",
    colors: {
      app: "#f3f3f3",
      raised: "#fbfbfb",
      hover: "#eaeaea",
      muted: "#f0f0f0",
      inset: "#ffffff",
      line: "#e5e5e5",
      lineStrong: "#d1d1d1",
      fg: "#1b1b1b",
      fgSecondary: "#2b2b2b",
      fgMuted: "#616161",
      fgFaint: "#8a8a8a",
      danger: "#c42b1c",
      scroll: "#c2c2c2",
    },
  },
  {
    id: "solarized-light",
    name: "Solarized Light",
    mode: "light",
    accent: "#268bd2",
    colors: {
      app: "#fdf6e3",
      raised: "#fffbef",
      hover: "#eee8d5",
      muted: "#f5efdc",
      inset: "#fffdf6",
      line: "#e6dfc8",
      lineStrong: "#d6cfb6",
      fg: "#073642",
      fgSecondary: "#1f4a55",
      fgMuted: "#657b83",
      fgFaint: "#93a1a1",
      danger: "#dc322f",
      scroll: "#d6cfb6",
    },
  },
];

/** Full color set a gallery preset paints with (for preview swatches and applying). */
export function presetColors(preset: ThemePreset): ThemeCustomColors {
  if (!preset.colors) return getPresetThemeColors(preset.mode, preset.accent);
  return { ...preset.colors, ...accentPair(preset.accent) };
}

/** Apply a gallery preset onto settings — keeps glass/translucency/wallpaper as they are. */
export function withThemePreset<T extends ThemeApplyInput>(settings: T, preset: ThemePreset): T {
  return {
    ...settings,
    themeMode: preset.mode,
    accentColor: preset.accent,
    themeUseCustom: Boolean(preset.colors),
    themeCustom: preset.colors ? presetColors(preset) : settings.themeCustom ?? null,
  };
}

const SURFACE_KEYS: ThemeTokenKey[] = ["app", "raised", "hover", "muted", "inset"];

function parseHex(hex: string): [number, number, number] | null {
  const raw = hex.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    return [
      parseInt(raw[0] + raw[0], 16),
      parseInt(raw[1] + raw[1], 16),
      parseInt(raw[2] + raw[2], 16),
    ];
  }
  if (/^[0-9a-fA-F]{6}/.test(raw)) {
    return [
      parseInt(raw.slice(0, 2), 16),
      parseInt(raw.slice(2, 4), 16),
      parseInt(raw.slice(4, 6), 16),
    ];
  }
  return null;
}

/** Apply alpha to a hex (or passthrough if already rgba / unparsable). */
function withAlpha(color: string, alpha: number): string {
  if (alpha >= 0.999) return color;
  const rgb = parseHex(color);
  if (!rgb) return color;
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 1000) / 1000;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`;
}

const THEME_BG_ID = "sc-theme-bg";
let lastThemeBg: string | null = null;

/** Paint wallpaper on a fixed layer so large data-URLs don't break CSS vars. */
function syncThemeBackground(dataUrl: string | null | undefined) {
  if (typeof document === "undefined") return;
  const next = dataUrl || null;
  if (next === lastThemeBg) return;
  lastThemeBg = next;

  let el = document.getElementById(THEME_BG_ID);
  if (!next) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("div");
    el.id = THEME_BG_ID;
    el.setAttribute("aria-hidden", "true");
    document.body.prepend(el);
  }
  // JSON.stringify quotes safely for url(...)
  el.style.backgroundImage = `url(${JSON.stringify(next)})`;
}

let lastApplied: ThemeApplyInput | null = null;
let systemListenerBound = false;

/** Re-apply when Windows flips light/dark while the theme is set to System. */
function bindSystemListener() {
  if (systemListenerBound || typeof window === "undefined" || !window.matchMedia) return;
  systemListenerBound = true;
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (lastApplied?.themeMode === "system") applyTheme(lastApplied);
  });
}

/** Apply theme to <html> so CSS variables (and Tailwind tokens) update globally. */
export function applyTheme(
  modeOrSettings: ThemePreference | ThemeApplyInput,
  accent?: AccentColor
) {
  const root = document.documentElement;
  const settings: ThemeApplyInput =
    typeof modeOrSettings === "string"
      ? { themeMode: modeOrSettings, accentColor: accent ?? "cyan" }
      : modeOrSettings;
  lastApplied = settings;
  bindSystemListener();

  const mode = resolveThemeMode(settings.themeMode);
  root.dataset.theme = mode;
  root.dataset.themePref = settings.themeMode;
  root.dataset.accent = isHexColor(settings.accentColor) ? "custom" : settings.accentColor;

  const glass = Boolean(settings.themeGlassmorphic);
  const translucency = Math.min(100, Math.max(0, settings.themeTranslucency ?? 0));
  const bg = settings.themeBackgroundImage || null;
  const backdrop = settings.themeBackdrop ?? "none";
  const effectsOn = glass || translucency > 0 || Boolean(bg) || backdrop !== "none";

  root.dataset.glass = glass ? "true" : "false";
  root.dataset.backdrop = backdrop;
  if (bg) root.dataset.bgImage = "true";
  else delete root.dataset.bgImage;

  // 0% → fully opaque; 100% → ~28% opaque panels. Glass alone still softens.
  let panelAlpha = 1 - (translucency / 100) * 0.72;
  if (glass) panelAlpha = Math.min(panelAlpha, bg ? 0.62 : 0.78);
  // Mica / Acrylic only show where the page is see-through
  if (backdrop !== "none") panelAlpha = Math.min(panelAlpha, 0.72);
  if (!effectsOn) panelAlpha = 1;
  let appAlpha = effectsOn ? Math.min(panelAlpha, bg ? 0.55 : panelAlpha) : 1;
  if (backdrop !== "none") appAlpha = Math.min(appAlpha, 0.45);

  root.style.setProperty("--sc-translucency", String(translucency));
  root.style.setProperty("--sc-surface-alpha", String(panelAlpha));

  syncThemeBackground(bg);

  const base = getPresetThemeColors(mode, settings.accentColor);
  const colors: ThemeCustomColors =
    settings.themeUseCustom && settings.themeCustom
      ? { ...base, ...settings.themeCustom }
      : base;

  // Always inline — accents can be any hex now, so the [data-accent] CSS presets can't cover them.
  for (const key of Object.keys(THEME_CSS_VARS) as ThemeTokenKey[]) {
    const solid = colors[key] || base[key];
    let value = solid;
    if (SURFACE_KEYS.includes(key) && effectsOn) {
      value = withAlpha(solid, key === "app" ? appAlpha : panelAlpha);
    }
    root.style.setProperty(THEME_CSS_VARS[key], value);
  }
}

/** Apply theme from persisted app settings (custom colors, glass, wallpaper). */
export function applyThemeFromSettings(settings: ThemeApplyInput) {
  applyTheme({
    themeMode: settings.themeMode,
    accentColor: settings.accentColor,
    themeUseCustom: settings.themeUseCustom ?? false,
    themeCustom: settings.themeCustom ?? null,
    themeGlassmorphic: settings.themeGlassmorphic ?? false,
    themeTranslucency: settings.themeTranslucency ?? 0,
    themeBackgroundImage: settings.themeBackgroundImage ?? null,
    themeBackdrop: settings.themeBackdrop ?? "none",
  });
}

export function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/** Zoom the whole vault chrome (90–125%). Snip overlays stay independent. */
export function applyUiScale(percent: number) {
  const scale = Math.min(125, Math.max(90, Math.round(percent || 100))) / 100;
  document.documentElement.style.setProperty("--sc-ui-scale", String(scale));
  const root = document.getElementById("root");
  if (root) {
    root.style.zoom = String(scale);
  }
}

export function settingsToThemePack(
  name: string,
  settings: ThemeApplyInput & { themeCustom?: ThemeCustomColors | null },
  id = ""
): ThemePack {
  return {
    id,
    name,
    themeMode: settings.themeMode,
    accentColor: settings.accentColor,
    colors: settings.themeUseCustom ? settings.themeCustom ?? null : null,
    glassmorphic: Boolean(settings.themeGlassmorphic),
    translucency: settings.themeTranslucency ?? 0,
    backgroundImage: settings.themeBackgroundImage ?? null,
    createdAt: "",
  };
}
