import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useState } from "react";
import {
  Download,
  FolderOpen,
  ImagePlus,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Trash2,
  Upload,
} from "lucide-react";
import { save, open } from "@tauri-apps/plugin-dialog";
import type { AppSettings } from "../lib/types";
import {
  THEME_CSS_VARS,
  THEME_TOKEN_GROUPS,
  getPresetThemeColors,
  settingsToThemePack,
  type AccentColor,
  type ThemeCustomColors,
  type ThemePack,
  type ThemeTokenKey,
} from "../lib/theme";
import {
  deleteThemePack,
  exportThemePack,
  importThemePack,
  listThemePacks,
  readImageAsDataUrl,
  readTextFilePath,
  saveThemePack,
  writeTextFilePath,
} from "../lib/api";
import { ColorPicker } from "./ColorPicker";

interface Props {
  draft: AppSettings;
  setDraft: Dispatch<SetStateAction<AppSettings | null>>;
}

function ColorRow({
  label,
  hint,
  tokenKey,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  tokenKey: ThemeTokenKey;
  value: string;
  onChange: (hex: string) => void;
}) {
  const [text, setText] = useState(value);

  useEffect(() => {
    setText(value);
  }, [value]);

  function previewCss(hex: string) {
    const cssVar = THEME_CSS_VARS[tokenKey];
    if (cssVar && /^#[0-9a-fA-F]{6}$/.test(hex)) {
      document.documentElement.style.setProperty(cssVar, hex);
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <span className="block text-[12px] text-fg-secondary">{label}</span>
        {hint && <span className="text-[10px] text-fg-faint">{hint}</span>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => {
            const raw = e.target.value;
            setText(raw);
            if (/^#[0-9a-fA-F]{6}$/.test(raw)) {
              previewCss(raw);
              onChange(raw);
            }
          }}
          onBlur={() => setText(value)}
          className="w-[88px] rounded border border-line bg-inset px-2 py-1 font-mono text-[10px] text-fg-secondary outline-none focus:border-accent"
          spellCheck={false}
        />
        <ColorPicker
          label={label}
          value={value.startsWith("#") && value.length >= 7 ? value.slice(0, 7) : "#000000"}
          onPreview={previewCss}
          onChange={onChange}
        />
      </div>
    </div>
  );
}

export function ThemeEditor({ draft, setDraft }: Props) {
  const colors = draft.themeCustom ?? getPresetThemeColors(draft.themeMode, draft.accentColor);
  const [packs, setPacks] = useState<ThemePack[]>([]);
  const [packName, setPackName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refreshPacks = useCallback(async () => {
    try {
      const list = await listThemePacks();
      setPacks(Array.isArray(list) ? list : []);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    void refreshPacks();
  }, [refreshPacks]);

  function patchDraft(partial: Partial<AppSettings>) {
    setDraft((prev) => (prev ? { ...prev, ...partial } : prev));
  }

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
        themeGlassmorphic: false,
        themeTranslucency: 0,
        themeBackgroundImage: null,
      };
    });
  }

  function applyPack(pack: ThemePack) {
    const custom = (pack.colors ?? null) as ThemeCustomColors | null;
    patchDraft({
      themeMode: pack.themeMode === "light" ? "light" : "dark",
      accentColor: (["cyan", "purple", "green", "orange"].includes(pack.accentColor)
        ? pack.accentColor
        : "cyan") as AccentColor,
      themeUseCustom: Boolean(custom),
      themeCustom: custom,
      themeGlassmorphic: Boolean(pack.glassmorphic),
      themeTranslucency: pack.translucency ?? 0,
      themeBackgroundImage: pack.backgroundImage ?? null,
    });
    setMessage(`Applied “${pack.name}” — Save settings to keep it.`);
  }

  async function handleSavePack() {
    const name = packName.trim() || "Untitled theme";
    setBusy("save");
    setMessage(null);
    try {
      const pack = settingsToThemePack(name, draft);
      await saveThemePack(pack);
      setPackName("");
      await refreshPacks();
      setMessage(`Saved “${name}” to themes.json`);
    } catch (err) {
      setMessage(String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleDeletePack(id: string) {
    setBusy(id);
    try {
      await deleteThemePack(id);
      await refreshPacks();
    } catch (err) {
      setMessage(String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleExport(id: string, name: string) {
    setBusy(`export-${id}`);
    try {
      const json = await exportThemePack(id);
      const path = await save({
        defaultPath: `${name.replace(/[^\w\-]+/g, "_") || "snipclip-theme"}.json`,
        filters: [{ name: "Theme", extensions: ["json"] }],
      });
      if (path) {
        await writeTextFilePath(path, json);
        setMessage("Theme exported");
      }
    } catch (err) {
      setMessage(String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleImport() {
    setBusy("import");
    setMessage(null);
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: "Theme", extensions: ["json"] }],
      });
      if (!path || typeof path !== "string") return;
      const json = await readTextFilePath(path);
      const pack = await importThemePack(json);
      await refreshPacks();
      applyPack(pack);
      setMessage(`Imported “${pack.name}”`);
    } catch (err) {
      setMessage(String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handlePickBackground() {
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
      });
      if (!path || typeof path !== "string") return;
      const dataUrl = await readImageAsDataUrl(path);
      patchDraft({ themeBackgroundImage: dataUrl });
    } catch (err) {
      setMessage(String(err));
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-0 rounded-lg border border-line bg-raised">
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <span className="flex items-center gap-1.5 text-[13px] text-fg-secondary">
              <SlidersHorizontal size={12} /> Custom theme
            </span>
            <span className="text-[11px] text-fg-muted">
              Colors, glass, translucency, background. Save packs to themes.json.
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

        <div className="mx-4 h-px bg-line" />

        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <span className="block text-[13px] text-fg-secondary">Glassmorphic</span>
            <span className="text-[11px] text-fg-muted">Blurred translucent panels</span>
          </div>
          <input
            type="checkbox"
            checked={draft.themeGlassmorphic}
            onChange={(e) => patchDraft({ themeGlassmorphic: e.target.checked })}
            className="h-4 w-4 cursor-pointer rounded"
          />
        </div>

        <div className="mx-4 h-px bg-line" />

        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <span className="block text-[13px] text-fg-secondary">Translucency</span>
            <span className="text-[11px] text-fg-muted">
              Soften surfaces over the background ({draft.themeTranslucency}%)
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={draft.themeTranslucency}
            onChange={(e) => patchDraft({ themeTranslucency: Number(e.target.value) })}
            className="h-1 w-28 cursor-pointer accent-accent"
          />
        </div>

        <div className="mx-4 h-px bg-line" />

        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <span className="block text-[13px] text-fg-secondary">Background image</span>
            <span className="text-[11px] text-fg-muted">
              {draft.themeBackgroundImage ? "Custom image set" : "None — solid color only"}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {draft.themeBackgroundImage && (
              <button
                type="button"
                onClick={() => patchDraft({ themeBackgroundImage: null })}
                className="rounded-md px-2 py-1 text-[11px] text-fg-muted hover:bg-hover hover:text-fg"
              >
                Clear
              </button>
            )}
            <button
              type="button"
              onClick={() => void handlePickBackground()}
              className="inline-flex items-center gap-1 rounded-md border border-line bg-hover px-2.5 py-1.5 text-[11px] text-fg-secondary hover:bg-muted"
            >
              <ImagePlus size={12} /> Pick
            </button>
          </div>
        </div>

        {draft.themeUseCustom && (
          <>
            <div className="mx-4 h-px bg-line" />
            <div className="flex items-center justify-end px-4 py-2">
              <button
                type="button"
                onClick={resetFromPreset}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-fg-muted transition hover:bg-hover hover:text-fg"
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
                      tokenKey={token.key}
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

      <div className="space-y-3 rounded-lg border border-line bg-raised px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h4 className="text-[13px] text-fg-secondary">Saved themes</h4>
            <p className="text-[11px] text-fg-muted">Stored in app data as themes.json</p>
          </div>
          <button
            type="button"
            onClick={() => void handleImport()}
            disabled={busy != null}
            className="inline-flex items-center gap-1 rounded-md border border-line bg-hover px-2.5 py-1.5 text-[11px] text-fg-secondary hover:bg-muted disabled:opacity-50"
          >
            <Upload size={12} /> Import
          </button>
        </div>

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSavePack();
          }}
        >
          <input
            type="text"
            value={packName}
            onChange={(e) => setPackName(e.target.value)}
            placeholder="Theme name"
            className="min-w-0 flex-1 rounded-md border border-line bg-inset px-3 py-2 text-[12px] text-fg-secondary outline-none placeholder:text-fg-faint focus:border-accent"
          />
          <button
            type="submit"
            disabled={busy != null}
            className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-2 text-[12px] font-semibold text-accent-fg hover:brightness-110 disabled:opacity-50"
          >
            <Save size={12} /> Save pack
          </button>
        </form>

        <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
          {packs.length === 0 && (
            <p className="py-2 text-[11px] text-fg-faint">No saved themes yet.</p>
          )}
          {packs.map((pack) => (
            <div
              key={pack.id}
              className="flex items-center gap-2 rounded-md border border-line bg-inset px-2.5 py-2"
            >
              <button
                type="button"
                onClick={() => applyPack(pack)}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block truncate text-[12px] text-fg-secondary">{pack.name}</span>
                <span className="text-[10px] text-fg-faint">
                  {pack.themeMode}
                  {pack.glassmorphic ? " · glass" : ""}
                  {pack.translucency ? ` · ${pack.translucency}%` : ""}
                </span>
              </button>
              <button
                type="button"
                title="Export"
                onClick={() => void handleExport(pack.id, pack.name)}
                className="rounded p-1.5 text-fg-muted hover:bg-hover hover:text-fg"
              >
                <Download size={12} />
              </button>
              <button
                type="button"
                title="Delete"
                onClick={() => void handleDeletePack(pack.id)}
                className="rounded p-1.5 text-fg-muted hover:bg-hover hover:text-danger"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>

        {message && (
          <p className="flex items-start gap-1.5 text-[11px] text-fg-muted">
            <FolderOpen size={11} className="mt-0.5 shrink-0" />
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
