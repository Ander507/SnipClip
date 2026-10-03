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
  };
}
