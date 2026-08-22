export type ThemeMode = "dark" | "light";
export type AccentColor = "cyan" | "purple" | "green" | "orange";

export const ACCENTS: { id: AccentColor; label: string; hex: string }[] = [
  { id: "cyan", label: "Cyan", hex: "#00e8c6" },
  { id: "purple", label: "Purple", hex: "#c084fc" },
  { id: "green", label: "Green", hex: "#4ade80" },
  { id: "orange", label: "Orange", hex: "#fb923c" },
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

const ACCENT_HEX: Record<AccentColor, { accent: string; accentFg: string }> = {
  cyan: { accent: "#00e8c6", accentFg: "#000000" },
  purple: { accent: "#c084fc", accentFg: "#000000" },
  green: { accent: "#4ade80", accentFg: "#000000" },
  orange: { accent: "#fb923c", accentFg: "#000000" },
};

const DARK_BASE: Omit<ThemeCustomColors, "accent" | "accentFg"> = {
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

const LIGHT_BASE: Omit<ThemeCustomColors, "accent" | "accentFg"> = {
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

export function getPresetThemeColors(
  mode: ThemeMode,
  accent: AccentColor
): ThemeCustomColors {
  const base = mode === "light" ? LIGHT_BASE : DARK_BASE;
  const accentPair = ACCENT_HEX[accent] ?? ACCENT_HEX.cyan;
  return { ...base, ...accentPair };
}

export function normalizeThemeMode(value: string | undefined): ThemeMode {
  return value === "light" ? "light" : "dark";
}

export function normalizeAccent(value: string | undefined): AccentColor {
  if (value === "purple" || value === "green" || value === "orange") return value;
  return "cyan";
}

export interface ThemeApplyInput {
  themeMode: ThemeMode;
  accentColor: AccentColor;
  themeUseCustom?: boolean;
  themeCustom?: ThemeCustomColors | null;
  themeGlassmorphic?: boolean;
  themeTranslucency?: number;
  themeBackgroundImage?: string | null;
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

const SURFACE_KEYS: ThemeTokenKey[] = ["app", "raised", "hover", "muted", "inset"];

function clearCustomVars(root: HTMLElement) {
  for (const cssVar of Object.values(THEME_CSS_VARS)) {
    root.style.removeProperty(cssVar);
  }
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

/** Apply theme to <html> so CSS variables (and Tailwind tokens) update globally. */
export function applyTheme(
  modeOrSettings: ThemeMode | ThemeApplyInput,
  accent?: AccentColor
) {
  const root = document.documentElement;
  const settings: ThemeApplyInput =
    typeof modeOrSettings === "string"
      ? { themeMode: modeOrSettings, accentColor: accent ?? "cyan" }
      : modeOrSettings;

  root.dataset.theme = settings.themeMode;
  root.dataset.accent = settings.accentColor;

  const glass = Boolean(settings.themeGlassmorphic);
  const translucency = Math.min(100, Math.max(0, settings.themeTranslucency ?? 0));
  const bg = settings.themeBackgroundImage || null;
  const effectsOn = glass || translucency > 0 || Boolean(bg);

  root.dataset.glass = glass ? "true" : "false";
  if (bg) root.dataset.bgImage = "true";
  else delete root.dataset.bgImage;

  // 0% → fully opaque; 100% → ~28% opaque panels. Glass alone still softens.
  let panelAlpha = 1 - (translucency / 100) * 0.72;
  if (glass) panelAlpha = Math.min(panelAlpha, bg ? 0.62 : 0.78);
  if (!effectsOn) panelAlpha = 1;
  const appAlpha = effectsOn ? Math.min(panelAlpha, bg ? 0.55 : panelAlpha) : 1;

  root.style.setProperty("--sc-translucency", String(translucency));
  root.style.setProperty("--sc-surface-alpha", String(panelAlpha));

  syncThemeBackground(bg);

  const base = getPresetThemeColors(settings.themeMode, settings.accentColor);
  const colors: ThemeCustomColors =
    settings.themeUseCustom && settings.themeCustom
      ? { ...base, ...settings.themeCustom }
      : base;

  if (settings.themeUseCustom || effectsOn) {
    for (const key of Object.keys(THEME_CSS_VARS) as ThemeTokenKey[]) {
      const solid = colors[key] || base[key];
      let value = solid;
      if (SURFACE_KEYS.includes(key) && effectsOn) {
        const alpha = key === "app" ? appAlpha : panelAlpha;
        value = withAlpha(solid, alpha);
      }
      root.style.setProperty(THEME_CSS_VARS[key], value);
    }
  } else {
    clearCustomVars(root);
  }
}

export function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
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
