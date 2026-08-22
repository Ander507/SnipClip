import clsx from "clsx";
import type { Dispatch, SetStateAction } from "react";
import { RotateCcw, SlidersHorizontal } from "lucide-react";
import type { AppSettings } from "../lib/types";
import {
  THEME_TOKEN_GROUPS,
  getPresetThemeColors,
  type AccentColor,
  type ThemeTokenKey,
} from "../lib/theme";

interface Props {
  draft: AppSettings;
  setDraft: Dispatch<SetStateAction<AppSettings | null>>;
}

function ColorRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <span className="block text-[12px] text-fg-secondary">{label}</span>
        {hint && <span className="text-[10px] text-fg-faint">{hint}</span>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-[88px] rounded border border-line bg-inset px-2 py-1 font-mono text-[10px] text-fg-secondary outline-none focus:border-accent"
          spellCheck={false}
        />
        <input
          type="color"
          value={value.startsWith("#") && value.length >= 7 ? value.slice(0, 7) : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 w-7 cursor-pointer rounded border border-line bg-inset p-0.5"
          aria-label={`${label} color`}
        />
      </div>
    </div>
  );
}

export function ThemeEditor({ draft, setDraft }: Props) {
  const colors = draft.themeCustom ?? getPresetThemeColors(draft.themeMode, draft.accentColor);

  function patchColor(key: ThemeTokenKey, value: string) {
    setDraft((prev) => {
      if (!prev) return prev;
      const base =
        prev.themeCustom ?? getPresetThemeColors(prev.themeMode, prev.accentColor);
      return {
        ...prev,
        themeUseCustom: true,
        themeCustom: { ...base, [key]: value },
      };
    });
  }

  function resetFromPreset() {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        themeCustom: getPresetThemeColors(prev.themeMode, prev.accentColor as AccentColor),
      };
    });
  }

  return (
    <div className="space-y-0 rounded-lg border border-line bg-raised">
      <div className="flex items-center justify-between gap-4 px-4 py-3">
        <div className="min-w-0">
          <span className="flex items-center gap-1.5 text-[13px] text-fg-secondary">
            <SlidersHorizontal size={12} /> Custom theme
          </span>
          <span className="text-[11px] text-fg-muted">
            Override every surface, text, and accent color. Save to persist.
          </span>
        </div>
        <input
          type="checkbox"
          checked={draft.themeUseCustom}
          onChange={(e) =>
            setDraft((prev) => {
              if (!prev) return prev;
              const useCustom = e.target.checked;
              return {
                ...prev,
                themeUseCustom: useCustom,
                themeCustom: useCustom
                  ? prev.themeCustom ??
                    getPresetThemeColors(prev.themeMode, prev.accentColor as AccentColor)
                  : prev.themeCustom,
              };
            })
          }
          className="h-4 w-4 cursor-pointer rounded"
        />
      </div>

      {draft.themeUseCustom && (
        <>
          <div className="mx-4 h-px bg-line" />
          <div className="flex items-center justify-end px-4 py-2">
            <button
              type="button"
              onClick={resetFromPreset}
              className={clsx(
                "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-fg-muted transition hover:bg-hover hover:text-fg"
              )}
            >
              <RotateCcw size={11} /> Reset from preset
            </button>
          </div>
          {THEME_TOKEN_GROUPS.map((group, gi) => (
            <div key={group.title}>
              {gi > 0 && <div className="mx-4 h-px bg-line" />}
              <div className="px-4 pb-2 pt-3">
                <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                  {group.title}
                </h4>
                {group.tokens.map((token) => (
                  <ColorRow
                    key={token.key}
                    label={token.label}
                    hint={token.hint}
                    value={colors[token.key] ?? "#000000"}
                    onChange={(v) => patchColor(token.key, v)}
                  />
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
