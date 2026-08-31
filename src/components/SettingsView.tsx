import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { RotateCcw, Keyboard, Trash2, Power, Palette, Moon, Sun, Ban, Download, RefreshCw } from "lucide-react";
import type { AppSettings, ClearInterval } from "../lib/types";
import { DEFAULT_SETTINGS } from "../lib/types";
import { getSettings, updateSettings, getRunningApps } from "../lib/api";
import { ACCENTS, applyTheme, type AccentColor, type ThemeMode } from "../lib/theme";
import { ThemeEditor } from "./ThemeEditor";
import { getVersion } from "@tauri-apps/api/app";
import { checkForAppUpdate, formatUpdateError, installAppUpdate } from "../lib/updates";
import type { Update } from "@tauri-apps/plugin-updater";

interface Props {
  onClose: () => void;
  onSaved: (settings: AppSettings) => void;
}

type CaptureTarget = "clipboard" | "snip" | "record" | null;

const STEALTH_SNIP_PRESETS = [
  { label: "Ctrl + Alt + Q", value: "Control+Alt+Q" },
  { label: "Shift + F12", value: "Shift+F12" },
  { label: "Ctrl + Alt + F9", value: "Control+Alt+F9" },
] as const;

function displayHotkey(accel: string) {
  return accel
    .replace(/CommandOrControl/gi, "Ctrl")
    .replace(/Control/gi, "Ctrl")
    .replace(/\+/g, " + ");
}

const RECORD_HOTKEY_PRESETS = [
  { label: "Ctrl + Alt + R", value: "Control+Alt+R" },
  { label: "Ctrl + Shift + R", value: "Control+Shift+R" },
  { label: "Ctrl + Alt + F10", value: "Control+Alt+F10" },
] as const;

function keyFromEvent(e: KeyboardEvent): string | null {
  // Prefer e.code — on Windows Ctrl+Alt+letter often yields a symbol in e.key (AltGr / menu mnemonics).
  if (e.code.startsWith("Key") && e.code.length === 4) {
    return e.code.slice(3);
  }
  if (e.code.startsWith("Digit") && e.code.length === 6) {
    return e.code.slice(5);
  }
  if (/^F\d{1,2}$/.test(e.code)) {
    return e.code;
  }
  if (e.code === "Space") return "Space";

  let key = e.key;
  if (key === " ") key = "Space";
  else if (key.length === 1) key = key.toUpperCase();
  else if (key.startsWith("Arrow")) key = key.slice(5);
  else if (key === "Escape") key = "Esc";
  else return null;
  return key;
}

function eventToAccelerator(e: KeyboardEvent): string | null {
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return null;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("Control");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  const key = keyFromEvent(e);
  if (!key || parts.length === 0) return null;
  parts.push(key);
  return parts.join("+");
}

function isDirty(a: AppSettings, b: AppSettings) {
  return (
    a.hotkeyClipboard !== b.hotkeyClipboard ||
    a.hotkeySnip !== b.hotkeySnip ||
    a.hotkeyRecord !== b.hotkeyRecord ||
    a.clearOnBoot !== b.clearOnBoot ||
    a.clearInterval !== b.clearInterval ||
    a.launchAtStartup !== b.launchAtStartup ||
    a.themeMode !== b.themeMode ||
    a.accentColor !== b.accentColor ||
    a.themeUseCustom !== b.themeUseCustom ||
    JSON.stringify(a.themeCustom) !== JSON.stringify(b.themeCustom) ||
    a.themeGlassmorphic !== b.themeGlassmorphic ||
    a.themeTranslucency !== b.themeTranslucency ||
    a.themeBackgroundImage !== b.themeBackgroundImage ||
    a.ignoreList.join("\0") !== b.ignoreList.join("\0") ||
    a.snipDelayEnabled !== b.snipDelayEnabled ||
    a.snipDelayMs !== b.snipDelayMs
  );
}

function normalizeSettings(s: AppSettings): AppSettings {
  return {
    ...s,
    ignoreList: s.ignoreList ?? [],
    themeUseCustom: s.themeUseCustom ?? false,
    themeCustom: s.themeCustom ?? null,
    themeGlassmorphic: s.themeGlassmorphic ?? false,
    themeTranslucency: s.themeTranslucency ?? 0,
    themeBackgroundImage: s.themeBackgroundImage ?? null,
    snipDelayEnabled: s.snipDelayEnabled ?? false,
    snipDelayMs: s.snipDelayMs ?? 3000,
    hotkeyRecord: s.hotkeyRecord ?? DEFAULT_SETTINGS.hotkeyRecord,
  };
}

export function SettingsView({ onClose, onSaved }: Props) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [capturing, setCapturing] = useState<CaptureTarget>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [ignoreDraft, setIgnoreDraft] = useState("");
  const [runningApps, setRunningApps] = useState<string[]>([]);
  const [loadingApps, setLoadingApps] = useState(false);
  const [currentVersion, setCurrentVersion] = useState("…");
  const [updateStatus, setUpdateStatus] = useState("");
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);
  const pendingUpdate = useRef<Update | null>(null);
  const captureRef = useRef<CaptureTarget>(null);
  captureRef.current = capturing;

  useEffect(() => {
    void getSettings().then((s) => {
      const next = normalizeSettings(s);
      setSettings(next);
      setDraft(next);
    });
    void getVersion().then(setCurrentVersion).catch(console.error);
    void refreshRunningApps();
  }, []);

  async function refreshRunningApps() {
    setLoadingApps(true);
    try {
      const apps = await getRunningApps();
      setRunningApps(Array.isArray(apps) ? apps : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingApps(false);
    }
  }

  function addIgnoreName(raw: string) {
    const name = raw.trim();
    if (!name) return;
    setDraft((prev) => {
      if (!prev) return prev;
      if (prev.ignoreList.some((n) => n.toLowerCase() === name.toLowerCase())) {
        return prev;
      }
      return { ...prev, ignoreList: [...prev.ignoreList, name] };
    });
    setIgnoreDraft("");
  }

  useEffect(() => {
    if (!draft) return;
    const handle = window.setTimeout(() => applyTheme(draft), 50);
    return () => window.clearTimeout(handle);
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
      if (captureRef.current === "record") {
        return { ...prev, hotkeyRecord: accel };
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
    if (settings) applyTheme(settings);
    onClose();
  }

  async function checkForUpdates() {
    if (checkingUpdate || installingUpdate) return;
    setCheckingUpdate(true);
    setUpdateStatus("Checking for updates…");
    setAvailableVersion(null);
    pendingUpdate.current = null;
    try {
      const update = await checkForAppUpdate();
      if (update) {
        pendingUpdate.current = update;
        setAvailableVersion(update.version);
        setUpdateStatus(`Version v${update.version} is available.`);
      } else {
        setUpdateStatus("You are on the latest version.");
      }
    } catch (err) {
      console.error(err);
      setUpdateStatus(formatUpdateError(err));
    } finally {
      setCheckingUpdate(false);
    }
  }

  async function downloadAndInstall() {
    const update = pendingUpdate.current;
    if (!update || installingUpdate) return;
    setInstallingUpdate(true);
    setUpdateStatus("Starting download…");
    try {
      await installAppUpdate(update, ({ downloaded, total, status }) => {
        if (status === "finished") {
          setUpdateStatus("Download complete. Installing…");
          return;
        }
        if (total && total > 0) {
          const pct = Math.min(100, Math.round((downloaded / total) * 100));
          setUpdateStatus(`Downloading update… ${pct}%`);
        } else {
          setUpdateStatus("Downloading update…");
        }
      });
      setUpdateStatus("Update installed. Restarting…");
    } catch (err) {
      console.error(err);
      setUpdateStatus(formatUpdateError(err));
      setInstallingUpdate(false);
    }
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
              Appearance, clipboard ignore list, startup, hotkeys, and vault cleanup. Changes apply when you save.
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

          <ThemeEditor draft={draft} setDraft={setDraft} />
        </section>

        <section className="space-y-3">
          <div>
            <h3 className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
              <Ban size={11} /> Clipboard ignore list
            </h3>
            <p className="mt-1 text-[12px] text-fg-muted">
              Skip copies from dictation apps (and anything else that floods the vault). Click a
              running app or type the process name. Pause in the title bar to stop all capture
              temporarily.
            </p>
          </div>
          <div className="space-y-3 rounded-lg border border-line bg-raised px-4 py-3">
            {draft.ignoreList.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {draft.ignoreList.map((name) => (
                  <span
                    key={name}
                    className="inline-flex items-center gap-1 rounded-md border border-danger/30 bg-danger/10 px-2 py-1 font-mono text-[11px] text-danger"
                  >
                    {name}
                    <button
                      type="button"
                      aria-label={`Remove ${name}`}
                      className="rounded p-0.5 hover:text-fg"
                      onClick={() =>
                        setDraft((prev) =>
                          prev
                            ? {
                                ...prev,
                                ignoreList: prev.ignoreList.filter((n) => n !== name),
                              }
                            : prev
                        )
                      }
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                addIgnoreName(ignoreDraft);
              }}
            >
              <input
                type="text"
                value={ignoreDraft}
                onChange={(e) => setIgnoreDraft(e.target.value)}
                placeholder="WhisperFlow.exe"
                className="min-w-0 flex-1 rounded-md border border-line bg-inset px-3 py-2 font-mono text-[12px] text-fg-secondary outline-none placeholder:text-fg-faint focus:border-accent"
              />
              <button
                type="submit"
                className="rounded-md bg-hover px-3 py-2 text-[12px] font-medium text-fg-secondary hover:bg-muted"
              >
                Add
              </button>
            </form>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-fg-muted">
                Currently running (click to add)
              </span>
              <button
                type="button"
                title="Refresh open applications"
                onClick={() => void refreshRunningApps()}
                className="inline-flex items-center gap-1 text-[11px] text-fg-muted hover:text-fg"
              >
                <RefreshCw size={11} className={loadingApps ? "animate-spin" : ""} />
                Refresh
              </button>
            </div>
            <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto pr-1">
              {runningApps
                .filter(
                  (app) =>
                    !draft.ignoreList.some((n) => n.toLowerCase() === app.toLowerCase())
                )
                .map((app) => (
                  <button
                    key={app}
                    type="button"
                    onClick={() => addIgnoreName(app)}
                    className="inline-flex items-center gap-1 rounded-md border border-line bg-inset px-2 py-0.5 font-mono text-[10px] text-fg-muted transition hover:border-accent hover:text-accent"
                  >
                    <span className="text-accent">+</span>
                    {app}
                  </button>
                ))}
              {["WhisperFlow.exe", "wisprflow.exe"]
                .filter(
                  (hint) =>
                    !draft.ignoreList.some((n) => n.toLowerCase() === hint.toLowerCase()) &&
                    !runningApps.some((app) => app.toLowerCase() === hint.toLowerCase())
                )
                .map((hint) => (
                  <button
                    key={hint}
                    type="button"
                    onClick={() => addIgnoreName(hint)}
                    className="rounded-md border border-dashed border-line px-2 py-0.5 font-mono text-[10px] text-fg-faint hover:border-accent hover:text-accent"
                  >
                    + {hint}
                  </button>
                ))}
              {!loadingApps && runningApps.length === 0 && (
                <span className="text-[11px] text-fg-faint">No visible apps found.</span>
              )}
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
            hint="Default Ctrl + Shift + S — use stealth presets below to avoid app detectors"
            value={draft.hotkeySnip}
            active={capturing === "snip"}
            onCapture={() => setCapturing("snip")}
          />
          <HotkeyRow
            label="Screen recorder"
            hint="Default Ctrl + Shift + R — opens region picker in record mode"
            value={draft.hotkeyRecord}
            active={capturing === "record"}
            onCapture={() => setCapturing("record")}
          />
          <div className="flex flex-wrap gap-2 px-1">
            {RECORD_HOTKEY_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                onClick={() =>
                  setDraft((prev) => (prev ? { ...prev, hotkeyRecord: preset.value } : prev))
                }
                className={clsx(
                  "rounded-md border px-2.5 py-1 font-mono text-[11px] transition",
                  draft.hotkeyRecord === preset.value
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-line bg-raised text-fg-muted hover:border-line-strong hover:text-fg"
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 px-1">
            {STEALTH_SNIP_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                onClick={() =>
                  setDraft((prev) => (prev ? { ...prev, hotkeySnip: preset.value } : prev))
                }
                className={clsx(
                  "rounded-md border px-2.5 py-1 font-mono text-[11px] transition",
                  draft.hotkeySnip === preset.value
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-line bg-raised text-fg-muted hover:border-line-strong hover:text-fg"
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>
          {capturing && (
            <p className="text-[12px] text-accent">Listening for a shortcut… Esc to cancel</p>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
            Stealth snip delay
          </h3>
          <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-line bg-raised px-4 py-3">
            <div className="min-w-0">
              <span className="block text-[13px] text-fg-secondary">Snipping delay</span>
              <span className="text-[11px] text-fg-muted">
                Wait before the overlay opens so you can switch apps without pressing keys.
              </span>
            </div>
            <input
              type="checkbox"
              checked={draft.snipDelayEnabled}
              onChange={(e) =>
                setDraft((prev) =>
                  prev ? { ...prev, snipDelayEnabled: e.target.checked } : prev
                )
              }
              className="h-4 w-4 cursor-pointer rounded"
            />
          </label>
          {draft.snipDelayEnabled && (
            <div className="flex items-center justify-between gap-4 rounded-lg border border-line bg-raised px-4 py-3">
              <span className="text-[13px] text-fg-secondary">Delay before snip</span>
              <select
                value={draft.snipDelayMs}
                onChange={(e) =>
                  setDraft((prev) =>
                    prev ? { ...prev, snipDelayMs: Number(e.target.value) } : prev
                  )
                }
                className="rounded-md border border-line bg-inset px-2 py-1.5 text-[12px] text-fg-secondary outline-none"
              >
                <option value={3000}>3 seconds</option>
                <option value={5000}>5 seconds</option>
                <option value={10000}>10 seconds</option>
              </select>
            </div>
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

        <section className="space-y-3">
          <div>
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
              App updates
            </h3>
            <p className="mt-1 text-[12px] text-fg-muted">
              Checks GitHub Releases for a signed build, then downloads and restarts to apply it.
              Works in packaged installs after a v1.1+ release is published.
            </p>
          </div>
          <div className="space-y-3 rounded-lg border border-line bg-raised px-4 py-3">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <span className="block text-[13px] text-fg-secondary">Current version</span>
                <span className="font-mono text-[11px] text-fg-muted">v{currentVersion}</span>
              </div>
              {availableVersion ? (
                <button
                  type="button"
                  disabled={installingUpdate}
                  onClick={() => void downloadAndInstall()}
                  className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-[12px] font-semibold text-accent-fg hover:brightness-110 disabled:opacity-50"
                >
                  <Download size={12} />
                  {installingUpdate ? "Installing…" : "Install update"}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={checkingUpdate || installingUpdate}
                  onClick={() => void checkForUpdates()}
                  className="rounded-md border border-line bg-hover px-3 py-2 text-[12px] font-medium text-fg-secondary transition hover:bg-muted disabled:opacity-50"
                >
                  {checkingUpdate ? "Checking…" : "Check for updates"}
                </button>
              )}
            </div>
            {updateStatus && (
              <>
                <div className="h-px bg-line" />
                <span
                  className={clsx(
                    "block text-[12px] leading-relaxed",
                    availableVersion
                      ? "font-medium text-accent"
                      : updateStatus.toLowerCase().includes("fail") ||
                          updateStatus.toLowerCase().includes("could not") ||
                          updateStatus.toLowerCase().includes("no update feed") ||
                          updateStatus.toLowerCase().includes("signature")
                        ? "text-danger"
                        : "text-fg-muted"
                  )}
                >
                  {updateStatus}
                </span>
              </>
            )}
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
        {active ? "Press keys…" : displayHotkey(value)}
      </button>
    </div>
  );
}