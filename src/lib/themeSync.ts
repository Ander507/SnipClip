import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { getSettings } from "./api";
import type { AppSettings } from "./types";
import {
  applyTheme,
  normalizeAccent,
  normalizeBackdrop,
  normalizeThemeMode,
  type ThemeApplyInput,
} from "./theme";
import { applyUiPrefs, normalizeUiPrefs, type UiPrefs } from "./uiPrefs";

/** Also read by the inline script in index.html — keep the key in sync. */
const CACHE_KEY = "snipclip.theme.v1";

/**
 * Config windows start loading before `setup()` manages the database, so the first IPC can
 * fail with "state not managed". Retry briefly instead of falling back to the default theme.
 */
const RETRY_DELAYS_MS = [100, 250, 500, 1000, 2000, 4000];

export interface ThemeSyncOptions {
  /**
   * Glass, translucency and wallpaper. Off for the floating windows (palette, recorder bar,
   * screenshot popup) — they sit over the desktop with nothing to blur, so translucent
   * surfaces just turn unreadable.
   */
  effects?: boolean;
}

export function themeInputFromSettings(s: AppSettings): ThemeApplyInput {
  return {
    themeMode: normalizeThemeMode(s.themeMode),
    accentColor: normalizeAccent(s.accentColor),
    themeUseCustom: s.themeUseCustom ?? false,
    themeCustom: s.themeCustom ?? null,
    themeGlassmorphic: s.themeGlassmorphic ?? false,
    themeTranslucency: s.themeTranslucency ?? 0,
    themeBackgroundImage: s.themeBackgroundImage ?? null,
    themeBackdrop: normalizeBackdrop(s.themeBackdrop),
  };
}

function withEffects(input: ThemeApplyInput, effects: boolean): ThemeApplyInput {
  if (effects) return input;
  return {
    ...input,
    themeGlassmorphic: false,
    themeTranslucency: 0,
    themeBackgroundImage: null,
    themeBackdrop: "none",
  };
}

/**
 * Apply a saved theme (+ fonts / corners / density) and remember it so the next launch paints
 * it before IPC answers.
 */
export function applySavedTheme(
  input: ThemeApplyInput,
  { effects = true, uiPrefs }: ThemeSyncOptions & { uiPrefs?: UiPrefs } = {}
) {
  applyTheme(withEffects(input, effects));
  if (uiPrefs) applyUiPrefs(uiPrefs);
  try {
    // Wallpapers are multi-MB data URLs — too big for localStorage; they follow once settings load.
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ ...input, themeBackgroundImage: null, uiPrefs: uiPrefs ?? null })
    );
  } catch {
    // Storage full or disabled — the cache is only a head start.
  }
}

/** Paint the last saved theme synchronously. Returns false when nothing is cached yet. */
export function applyCachedTheme({ effects = true }: ThemeSyncOptions = {}): boolean {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return false;
    const cached = JSON.parse(raw) as Partial<ThemeApplyInput> & { uiPrefs?: unknown };
    applyTheme(
      withEffects(
        {
          themeMode: normalizeThemeMode(cached.themeMode),
          accentColor: normalizeAccent(cached.accentColor),
          themeUseCustom: Boolean(cached.themeUseCustom),
          themeCustom: cached.themeCustom ?? null,
          themeGlassmorphic: Boolean(cached.themeGlassmorphic),
          themeTranslucency: Number(cached.themeTranslucency) || 0,
          themeBackgroundImage: null,
          themeBackdrop: normalizeBackdrop(cached.themeBackdrop),
        },
        effects
      )
    );
    if (cached.uiPrefs) applyUiPrefs(normalizeUiPrefs(cached.uiPrefs));
    return true;
  } catch {
    return false;
  }
}

export async function fetchSettingsWithRetry(): Promise<AppSettings> {
  let lastError: unknown;
  for (let attempt = 0; ; attempt++) {
    try {
      return await getSettings();
    } catch (err) {
      lastError = err;
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined) break;
      await new Promise((resolve) => window.setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

/**
 * Secondary windows: load the saved theme, then follow `settings-changed` (emitted after every
 * save and after vault unlock) so they never drift from the main window.
 */
export function useThemeSync(
  options: ThemeSyncOptions & { onSettings?: (settings: AppSettings) => void } = {}
) {
  const effects = options.effects ?? true;
  const onSettingsRef = useRef(options.onSettings);
  onSettingsRef.current = options.onSettings;

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    const load = () =>
      fetchSettingsWithRetry()
        .then((s) => {
          if (cancelled) return;
          applySavedTheme(themeInputFromSettings(s), {
            effects,
            uiPrefs: normalizeUiPrefs(s.uiPrefs),
          });
          onSettingsRef.current?.(s);
        })
        .catch(console.error);

    void load();
    void listen("settings-changed", () => void load()).then((u) => {
      if (cancelled) u();
      else unlisten = u;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [effects]);
}
