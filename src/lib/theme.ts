export type ThemeMode = "dark" | "light";
export type AccentColor = "cyan" | "purple" | "green" | "orange";

export const ACCENTS: { id: AccentColor; label: string; hex: string }[] = [
  { id: "cyan", label: "Cyan", hex: "#00e8c6" },
  { id: "purple", label: "Purple", hex: "#c084fc" },
  { id: "green", label: "Green", hex: "#4ade80" },
  { id: "orange", label: "Orange", hex: "#fb923c" },
];

export function normalizeThemeMode(value: string | undefined): ThemeMode {
  return value === "light" ? "light" : "dark";
}

export function normalizeAccent(value: string | undefined): AccentColor {
  if (value === "purple" || value === "green" || value === "orange") return value;
  return "cyan";
}

/** Apply theme to <html> so CSS variables (and Tailwind tokens) update globally. */
export function applyTheme(mode: ThemeMode, accent: AccentColor) {
  const root = document.documentElement;
  root.dataset.theme = mode;
  root.dataset.accent = accent;
}

export function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}
