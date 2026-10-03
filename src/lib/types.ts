export type ContentType = "text" | "image" | "link" | "screenshot";

export type Category =
  | "all"
  | "text"
  | "images"
  | "screenshots"
  | "videos"
  | "math"
  | "links"
  | "pinned";

export interface ClipboardItem {
  id: number;
  contentType: ContentType | string;
  content: string;
  preview: string;
  isPinned: boolean;
  createdAt: string;
  /** Process that owned the clipboard (e.g. "Code.exe"). Null for snips and older rows. */
  sourceApp?: string | null;
  /** Pixel size for image / screenshot items. */
  width?: number | null;
  height?: number | null;
}

export interface CaptureResult {
  dataUrl: string;
  width: number;
  height: number;
  monitorName: string;
  /** Set when auto-saved to the Screenshots vault on snip complete. */
  vaultId?: number;
}

export type { ThemeMode, ThemePreference, ThemeBackdrop, AccentColor, ThemeCustomColors } from "./theme";
import type { ThemePreference, ThemeBackdrop, AccentColor, ThemeCustomColors } from "./theme";
import type { UiPrefs } from "./uiPrefs";
import { DEFAULT_UI_PREFS } from "./uiPrefs";

export interface AppSettings {
  hotkeyClipboard: string;
  hotkeySnip: string;
  hotkeyRecord: string;
  /** Toggle compact dock (default Control+Shift+D). */
  hotkeyDock: string;
  clearOnBoot: boolean;
  /** "never" | "reboot" | "daily" | "weekly" */
  clearInterval: string;
  lastCleanup: number;
  /** Start with Windows / login — tray until hotkey */
  launchAtStartup: boolean;
  /** "system" follows Windows light/dark. */
  themeMode: ThemePreference;
  accentColor: AccentColor;
  /** When true, `themeCustom` overrides preset CSS variables. */
  themeUseCustom: boolean;
  themeCustom: ThemeCustomColors | null;
  themeGlassmorphic: boolean;
  /** 0–100 */
  themeTranslucency: number;
  /** data URL (resolved) or null */
  themeBackgroundImage: string | null;
  /** Native Windows 11 window material behind translucent surfaces. */
  themeBackdrop: ThemeBackdrop;
  /** Process names whose copies are not stored (e.g. WhisperFlow.exe). */
  ignoreList: string[];
  /** When true, Snip waits before opening the overlay (stealth capture). */
  snipDelayEnabled: boolean;
  /** Milliseconds to wait before snip overlay (default 3000). */
  snipDelayMs: number;
  /** Ordered library tab ids that are visible in the sidebar. */
  sidebarTabs: string[];
  /** Argon2id hash of the vault password (never the password itself). null = no lock. */
  vaultPasswordHash: number[] | null;
  /** 16-byte salt for the vault password hash. null = no lock. */
  vaultPasswordSalt: number[] | null;
  /** When true, plain text copies are auto-translated (network). Off by default. */
  autoTranslateEnabled: boolean;
  /** ISO 639-1 target language, e.g. "en". */
  autoTranslateTargetLang: string;
  /** When true, solve arithmetic into a vault badge — never overwrite the clipboard. Off by default. */
  autoEvalMath: boolean;
  /** When true, Enter pastes into the previous app (SendInput). Off by default. */
  directPasteEnabled: boolean;
  /** Slim floating vault (Win+V-style) instead of the full studio layout. */
  compactDock: boolean;
  /** Keep the main vault window above other apps. */
  mainAlwaysOnTop: boolean;
  /** Max unpinned items kept in the vault (50–1000). */
  maxHistory: number;
  /** UI scale percent (90–125). */
  uiScale: number;
  /** Fonts, density, corners, layout and popup options (stored as one JSON blob). */
  uiPrefs: UiPrefs;
  /** KLIPY API key for the popup's GIF tab. Empty = use the key built into the release, if any. */
  klipyApiKey: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  hotkeyClipboard: "Control+Shift+V",
  hotkeySnip: "Control+Shift+S",
  hotkeyRecord: "Control+Shift+R",
  hotkeyDock: "Control+Shift+D",
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
  themeBackdrop: "none",
  ignoreList: [],
  snipDelayEnabled: false,
  snipDelayMs: 3000,
  sidebarTabs: ["all", "text", "images", "screenshots", "videos", "math", "links", "pinned"],
  vaultPasswordHash: null,
  vaultPasswordSalt: null,
  autoTranslateEnabled: false,
  autoTranslateTargetLang: "en",
  autoEvalMath: false,
  directPasteEnabled: false,
  compactDock: false,
  mainAlwaysOnTop: false,
  /** Cap unpinned vault items (50–1000). Pinned are never trimmed by this. */
  maxHistory: 500,
  /** UI zoom percent (90–125). */
  uiScale: 100,
  uiPrefs: DEFAULT_UI_PREFS,
  klipyApiKey: "",
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
  | "redact"
  | "number"
  | "eyedropper";
