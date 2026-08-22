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
}

function clearCustomVars(root: HTMLElement) {
  for (const cssVar of Object.values(THEME_CSS_VARS)) {
    root.style.removeProperty(cssVar);
  }
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

  if (settings.themeUseCustom && settings.themeCustom) {
    for (const [key, cssVar] of Object.entries(THEME_CSS_VARS) as [
      ThemeTokenKey,
      string,
    ][]) {
      const value = settings.themeCustom[key];
      if (value) root.style.setProperty(cssVar, value);
    }
  } else {
    clearCustomVars(root);
  }
}

export function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}
