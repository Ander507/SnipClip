import clsx from "clsx";
import { Check } from "lucide-react";
import type { AppSettings } from "../lib/types";
import { THEME_PRESETS, presetColors, resolveThemeMode, type ThemePreset } from "../lib/theme";

interface Props {
  draft: AppSettings;
  onPick: (preset: ThemePreset) => void;
}

function isActive(draft: AppSettings, preset: ThemePreset): boolean {
  if (resolveThemeMode(draft.themeMode) !== preset.mode) return false;
  if (!preset.colors) return !draft.themeUseCustom;
  if (!draft.themeUseCustom || !draft.themeCustom) return false;
  const want = presetColors(preset);
  return (["app", "raised", "fg", "accent"] as const).every(
    (k) => draft.themeCustom?.[k]?.toLowerCase() === want[k].toLowerCase()
  );
}

/** Built-in looks as mini window previews — one click applies to the draft. */
export function ThemeGallery({ draft, onPick }: Props) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-2">
      {THEME_PRESETS.map((preset) => {
        const c = presetColors(preset);
        const active = isActive(draft, preset);
        return (
          <button
            key={preset.id}
            type="button"
            onClick={() => onPick(preset)}
            aria-pressed={active}
            className={clsx(
              "group overflow-hidden rounded-lg border text-left transition",
              active ? "border-accent ring-1 ring-accent" : "border-line hover:border-line-strong"
            )}
          >
            <div className="flex h-16" style={{ backgroundColor: c.app }}>
              <div
                className="w-1/3 space-y-1 p-1.5"
                style={{ backgroundColor: c.raised, borderRight: `1px solid ${c.line}` }}
              >
                <div className="h-1.5 w-3/4 rounded-full" style={{ backgroundColor: c.accent }} />
                <div className="h-1.5 w-1/2 rounded-full" style={{ backgroundColor: c.fgMuted }} />
                <div className="h-1.5 w-2/3 rounded-full" style={{ backgroundColor: c.fgFaint }} />
              </div>
              <div className="flex-1 space-y-1.5 p-1.5">
                <div
                  className="h-4 rounded"
                  style={{ backgroundColor: c.raised, border: `1px solid ${c.line}` }}
                />
                <div className="h-1.5 w-3/4 rounded-full" style={{ backgroundColor: c.fg }} />
                <div className="h-1.5 w-1/2 rounded-full" style={{ backgroundColor: c.fgMuted }} />
              </div>
            </div>
            <div className="flex items-center justify-between gap-1 border-t border-line bg-raised px-2 py-1.5">
              <span className="truncate text-[11px] font-medium text-fg-secondary">{preset.name}</span>
              {active && <Check size={12} className="shrink-0 text-accent" />}
            </div>
          </button>
        );
      })}
    </div>
  );
}
