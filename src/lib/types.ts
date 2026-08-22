export type ContentType = "text" | "image" | "link" | "screenshot";

export type Category = "all" | "text" | "images" | "screenshots" | "links" | "pinned";

export interface ClipboardItem {
  id: number;
  contentType: ContentType | string;
  content: string;
  preview: string;
  isPinned: boolean;
  createdAt: string;
}

export interface CaptureResult {
  dataUrl: string;
  width: number;
  height: number;
  monitorName: string;
  /** Set when auto-saved to the Screenshots vault on snip complete. */
  vaultId?: number;
}

export type { ThemeMode, AccentColor, ThemeCustomColors } from "./theme";
import type { ThemeMode, AccentColor, ThemeCustomColors } from "./theme";

export interface AppSettings {
  hotkeyClipboard: string;
  hotkeySnip: string;
  clearOnBoot: boolean;
  /** "never" | "reboot" | "daily" | "weekly" */
  clearInterval: string;
  lastCleanup: number;
  /** Start with Windows / login — tray until hotkey */
  launchAtStartup: boolean;
  themeMode: ThemeMode;
  accentColor: AccentColor;
  /** When true, `themeCustom` overrides preset CSS variables. */
  themeUseCustom: boolean;
  themeCustom: ThemeCustomColors | null;
  themeGlassmorphic: boolean;
  /** 0–100 */
  themeTranslucency: number;
  /** data URL (resolved) or null */
  themeBackgroundImage: string | null;
  /** Process names whose copies are not stored (e.g. WhisperFlow.exe). */
  ignoreList: string[];
}

export const DEFAULT_SETTINGS: AppSettings = {
  hotkeyClipboard: "Control+Shift+V",
  hotkeySnip: "Control+Shift+S",
  clearOnBoot: false,
  clearInterval: "never",
  lastCleanup: 0,
  launchAtStartup: false,
  themeMode: "dark",
  accentColor: "cyan",
  themeUseCustom: false,
  themeCustom: null,
  themeGlassmorphic: false,
  themeTranslucency: 0,
  themeBackgroundImage: null,
  ignoreList: [],
};

export type ClearInterval = "never" | "reboot" | "daily" | "weekly";

export type AnnotateTool =
  | "select"
  | "pen"
  | "arrow"
  | "rect"
  | "circle"
  | "highlight"
  | "blur"
  | "number"
  | "eyedropper";
