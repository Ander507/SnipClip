import type { AppSettings } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { normalizeAccent, normalizeBackdrop, normalizeThemeMode } from "./theme";
import { normalizeUiPrefs } from "./uiPrefs";

/** Fill gaps from older saves (missing / null fields) and clamp ranges. */
export function normalizeAppSettings(s: AppSettings): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    hotkeyRecord: s.hotkeyRecord ?? DEFAULT_SETTINGS.hotkeyRecord,
    hotkeyDock: s.hotkeyDock ?? DEFAULT_SETTINGS.hotkeyDock,
    ignoreList: s.ignoreList ?? [],
    themeMode: normalizeThemeMode(s.themeMode),
    accentColor: normalizeAccent(s.accentColor),
    themeUseCustom: s.themeUseCustom ?? false,
    themeCustom: s.themeCustom ?? null,
    themeGlassmorphic: s.themeGlassmorphic ?? false,
    themeTranslucency: s.themeTranslucency ?? 0,
    themeBackgroundImage: s.themeBackgroundImage ?? null,
    themeBackdrop: normalizeBackdrop(s.themeBackdrop),
    snipDelayEnabled: s.snipDelayEnabled ?? false,
    snipDelayMs: s.snipDelayMs ?? 3000,
    sidebarTabs: s.sidebarTabs ?? DEFAULT_SETTINGS.sidebarTabs,
    vaultPasswordHash: s.vaultPasswordHash ?? null,
    vaultPasswordSalt: s.vaultPasswordSalt ?? null,
    autoTranslateEnabled: s.autoTranslateEnabled ?? false,
    autoTranslateTargetLang: s.autoTranslateTargetLang ?? "en",
    autoEvalMath: s.autoEvalMath ?? false,
    directPasteEnabled: s.directPasteEnabled ?? false,
    compactDock: s.compactDock ?? false,
    mainAlwaysOnTop: s.mainAlwaysOnTop ?? false,
    maxHistory: Math.min(1000, Math.max(50, s.maxHistory ?? 500)),
    uiScale: Math.min(125, Math.max(90, s.uiScale ?? 100)),
    uiPrefs: normalizeUiPrefs(s.uiPrefs),
    klipyApiKey: (s.klipyApiKey ?? "").trim(),
    replayEnabled: s.replayEnabled ?? false,
    replaySeconds: Math.min(600, Math.max(5, Math.round(s.replaySeconds ?? 30))),
    replayHotkey: s.replayHotkey || DEFAULT_SETTINGS.replayHotkey,
    replayFps: (s.replayFps ?? 60) >= 60 ? 60 : 30,
    replayQuality:
      s.replayQuality === "low" || s.replayQuality === "high" ? s.replayQuality : "medium",
    replayResolution:
      s.replayResolution === "1080p" || s.replayResolution === "720p"
        ? s.replayResolution
        : "native",
    replayAudio: s.replayAudio ?? true,
    replayMonitor: Math.min(15, Math.max(0, Math.round(s.replayMonitor ?? 0))),
    replayNotifyPopup: s.replayNotifyPopup ?? true,
    replayNotifySound: s.replayNotifySound ?? true,
  };
}
