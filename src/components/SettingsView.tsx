import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { RotateCcw, Keyboard, Trash2, Power, Palette, Moon, Sun } from "lucide-react";
import type { AppSettings, ClearInterval } from "../lib/types";
import { DEFAULT_SETTINGS } from "../lib/types";
import { getSettings, updateSettings } from "../lib/api";
import { ACCENTS, applyTheme, type AccentColor, type ThemeMode } from "../lib/theme";

interface Props {
  onClose: () => void;
  onSaved: (settings: AppSettings) => void;
}

type CaptureTarget = "clipboard" | "snip" | null;

function displayHotkey(accel: string) {
  return accel
    .replace(/CommandOrControl/gi, "Ctrl")
    .replace(/Control/gi, "Ctrl")
    .replace(/\+/g, " + ");
}

function eventToAccelerator(e: KeyboardEvent): string | null {
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return null;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("Control");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  let key = e.key;
  if (key === " ") key = "Space";
  else if (key.length === 1) key = key.toUpperCase();
  else if (key.startsWith("Arrow")) key = key.slice(5);
  else if (key === "Escape") key = "Esc";
  if (parts.length === 0) return null;
  parts.push(key);
  return parts.join("+");
}

function isDirty(a: AppSettings, b: AppSettings) {
  return (
    a.hotkeyClipboard !== b.hotkeyClipboard ||
    a.hotkeySnip !== b.hotkeySnip ||
    a.clearOnBoot !== b.clearOnBoot ||
    a.clearInterval !== b.clearInterval ||
    a.launchAtStartup !== b.launchAtStartup ||
    a.themeMode !== b.themeMode ||
    a.accentColor !== b.accentColor
  );
}

export function SettingsView({ onClose, onSaved }: Props) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [capturing, setCapturing] = useState<CaptureTarget>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const captureRef = useRef<CaptureTarget>(null);
  captureRef.current = capturing;

  useEffect(() => {
    void getSettings().then((s) => {
      setSettings(s);
      setDraft(s);
    });
  }, []);

  useEffect(() => {
    if (!draft) return;
    applyTheme(draft.themeMode, draft.accentColor);
  }, [draft]);

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    if (!captureRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      setCapturing(null);
      return;
    }
    const accel = eventToAccelerator(e);
    if (!accel) return;
    setDraft((prev) => {
      if (!prev) return prev;
      if (captureRef.current === "clipboard") {
        return { ...prev, hotkeyClipboard: accel };
      }
      return { ...prev, hotkeySnip: accel };
    });
    setCapturing(null);
    setError(null);
  }, []);

  useEffect(() => {
    if (!capturing) return;
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [capturing, onKeyDown]);

  async function handleSave() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const next = await updateSettings(draft);
      setSettings(next);
      setDraft(next);
      setSavedFlash(true);
      onSaved(next);
      setTimeout(() => setSavedFlash(false), 1400);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  function handleBack() {
    if (settings) applyTheme(settings.themeMode, settings.accentColor);
    onClose();
  }

  const dirty = draft && settings && isDirty(draft, settings);

  if (!draft) {
    return (
      <div className="flex flex-1 items-center justify-center text-[13px] text-fg-muted">
        Loading settings…
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-line px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-fg-secondary">
            <Keyboard size={16} />
          </div>
          <div>
            <h2 className="text-[14px] font-semibold text-fg">Settings</h2>
            <p className="text-[12px] text-fg-muted">
              Appearance, startup, hotkeys, and vault cleanup. Changes apply when you save.
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
        <section className="space-y-3">
          <div>
            <h3 className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
              <Palette size={11} /> Appearance
            </h3>
            <p className="mt-1 text-[12px] text-fg-muted">
              Preview updates instantly. Save to keep the theme across launches.
            </p>
          </div>

          <div className="space-y-0 rounded-lg border border-line bg-raised">
            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <span className="block text-[13px] text-fg-secondary">Theme</span>
                <span className="text-[11px] text-fg-muted">Dark glass or light surfaces.</span>
              </div>
              <div className="flex rounded-md border border-line bg-inset p-0.5">
                {(
                  [
                    { id: "dark" as ThemeMode, label: "Dark", icon: Moon },
                    { id: "light" as ThemeMode, label: "Light", icon: Sun },
                  ] as const
                ).map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() =>
                      setDraft((prev) => (prev ? { ...prev, themeMode: id } : prev))
                    }
                    className={clsx(
                      "inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[12px] font-medium transition",
                      draft.themeMode === id
                        ? "bg-accent text-accent-fg"
                        : "text-fg-muted hover:text-fg"
                    )}
                  >
                    <Icon size={12} />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mx-4 h-px bg-line" />

            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <span className="block text-[13px] text-fg-secondary">Accent color</span>
                <span className="text-[11px] text-fg-muted">
                  Highlights, pins, and primary actions.
                </span>
              </div>
              <div className="flex items-center gap-2">
                {ACCENTS.map((accent) => {
                  const selected = draft.accentColor === accent.id;
                  return (
                    <button
                      key={accent.id}
                      type="button"
                      title={accent.label}
                      aria-label={accent.label}
                      aria-pressed={selected}
                      onClick={() =>
                        setDraft((prev) =>
                          prev ? { ...prev, accentColor: accent.id as AccentColor } : prev
                        )
                      }
                      className={clsx(
                        "h-7 w-7 rounded-full border-2 transition",
                        selected ? "border-fg scale-110" : "border-transparent hover:scale-105"
                      )}
                      style={{ backgroundColor: accent.hex }}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <div>
            <h3 className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
              <Power size={11} /> Startup
            </h3>
            <p className="mt-1 text-[12px] text-fg-muted">
              Run in the background after login. Press your hotkeys to open; close hides to tray.
            </p>
          </div>
          <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-line bg-raised px-4 py-3">
            <div className="min-w-0">
              <span className="block text-[13px] text-fg-secondary">Launch at startup</span>
              <span className="text-[11px] text-fg-muted">
                Starts minimized to the system tray on login.
              </span>
            </div>
            <input
              type="checkbox"
              checked={draft.launchAtStartup}
              onChange={(e) =>
                setDraft((prev) =>
                  prev ? { ...prev, launchAtStartup: e.target.checked } : prev
                )
              }
              className="h-4 w-4 cursor-pointer rounded"
            />
          </label>
        </section>

        <section className="space-y-3">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
            Global hotkeys
          </h3>
          <HotkeyRow
            label="Toggle UI"
            hint="Default Ctrl + Shift + V"
            value={draft.hotkeyClipboard}
            active={capturing === "clipboard"}
            onCapture={() => setCapturing("clipboard")}
          />
          <HotkeyRow
            label="Screenshot snipper"
            hint="Default Ctrl + Shift + S"
            value={draft.hotkeySnip}
            active={capturing === "snip"}
            onCapture={() => setCapturing("snip")}
          />
          {capturing && (
            <p className="text-[12px] text-accent">Listening for a shortcut… Esc to cancel</p>
          )}
        </section>

        <section className="space-y-3">
          <div>
            <h3 className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
              <Trash2 size={11} /> Vault &amp; storage cleanup
            </h3>
            <p className="mt-1 text-[12px] text-fg-muted">
              Automatically purge unpinned history. Pinned items are always kept.
            </p>
          </div>

          <div className="space-y-0 rounded-lg border border-line bg-raised">
            <label className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <span className="block text-[13px] text-fg-secondary">
                  Clear unpinned on system reboot
                </span>
                <span className="text-[11px] text-fg-muted">
                  Wipes temporary history when your PC restarts.
                </span>
              </div>
              <input
                type="checkbox"
                checked={draft.clearOnBoot}
                onChange={(e) =>
                  setDraft((prev) =>
                    prev ? { ...prev, clearOnBoot: e.target.checked } : prev
                  )
                }
                className="h-4 w-4 cursor-pointer rounded"
              />
            </label>

            <div className="mx-4 h-px bg-line" />

            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <span className="block text-[13px] text-fg-secondary">Auto-clear frequency</span>
                <span className="text-[11px] text-fg-muted">
                  Schedule rotation for unpinned clipboard items.
                </span>
              </div>
              <select
                value={draft.clearInterval}
                onChange={(e) =>
                  setDraft((prev) =>
                    prev
                      ? { ...prev, clearInterval: e.target.value as ClearInterval }
                      : prev
                  )
                }
                className="cursor-pointer rounded-md border border-line bg-inset px-3 py-2 text-[12px] text-fg-secondary outline-none focus:border-accent"
              >
                <option value="never">Never (manual only)</option>
                <option value="reboot">Every PC reboot</option>
                <option value="daily">Every 24 hours</option>
                <option value="weekly">Every 7 days</option>
              </select>
            </div>
          </div>
        </section>

        <p className="pt-2 text-center text-[11px] text-fg-faint">
          Made with ❤️ by Ander507 for Stardance — Hack Club
        </p>

        {error && (
          <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">
            {error}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-line px-5 py-3">
        <button
          type="button"
          onClick={() => setDraft({ ...DEFAULT_SETTINGS, lastCleanup: draft.lastCleanup })}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] text-fg-muted hover:bg-hover hover:text-fg"
        >
          <RotateCcw size={12} /> Defaults
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={handleBack}
          className="rounded-md px-3 py-1.5 text-[12px] text-fg-muted hover:bg-hover hover:text-fg"
        >
          Back
        </button>
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() => void handleSave()}
          className={clsx(
            "rounded-md px-3.5 py-1.5 text-[12px] font-semibold transition",
            dirty && !saving
              ? "bg-accent text-accent-fg hover:brightness-110"
              : "bg-hover text-fg-faint"
          )}
        >
          {savedFlash ? "Saved" : saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function HotkeyRow({
  label,
  hint,
  value,
  active,
  onCapture,
}: {
  label: string;
  hint: string;
  value: string;
  active: boolean;
  onCapture: () => void;
}) {
  return (
    <div className="flex items-center gap-4 rounded-lg border border-line bg-raised px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-fg-secondary">{label}</p>
        <p className="text-[11px] text-fg-muted">{hint}</p>
      </div>
      <button
        type="button"
        onClick={onCapture}
        className={clsx(
          "min-w-[150px] rounded-md border px-3 py-2 font-mono text-[12px] transition",
          active
            ? "border-accent bg-accent-soft text-accent"
            : "border-line bg-inset text-fg-secondary hover:border-line-strong"
        )}
      >
        {active ? "Record hotkey…" : displayHotkey(value)}
      </button>
    </div>
  );
}
