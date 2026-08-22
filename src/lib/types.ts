export type ContentType = "text" | "image" | "link";

export type Category = "all" | "text" | "images" | "links" | "pinned";

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
