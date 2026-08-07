import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { RotateCcw, Keyboard, Trash2 } from "lucide-react";
import type { AppSettings, ClearInterval } from "../lib/types";
import { getSettings, updateSettings } from "../lib/api";

interface Props {
  onClose: () => void;
  onSaved: (settings: AppSettings) => void;
}

type CaptureTarget = "clipboard" | "snip" | null;

const DEFAULTS: AppSettings = {
  hotkeyClipboard: "Control+Shift+V",
  hotkeySnip: "Control+Shift+S",
  clearOnBoot: false,
  clearInterval: "never",
  lastCleanup: 0,
};

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
    a.clearInterval !== b.clearInterval
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

  const dirty = draft && settings && isDirty(draft, settings);

  if (!draft) {
    return (
      <div className="flex flex-1 items-center justify-center text-[13px] text-[#777777]">
        Loading settings…
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-[#2d2d2d] px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-[#252525] text-[#cccccc]">
            <Keyboard size={16} />
          </div>
          <div>
            <h2 className="text-[14px] font-semibold text-white">Settings</h2>
            <p className="text-[12px] text-[#777777]">
              Hotkeys and vault cleanup. Saved bindings apply immediately.
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
        <section className="space-y-3">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[#777777]">
            Global hotkeys
          </h3>
          <HotkeyRow
            label="Clipboard toggle"
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
            <p className="text-[12px] text-[#60cdff]">Listening for a shortcut… Esc to cancel</p>
          )}
        </section>

        <section className="space-y-3">
          <div>
            <h3 className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-[#777777]">
              <Trash2 size={11} /> Vault &amp; storage cleanup
            </h3>
            <p className="mt-1 text-[12px] text-[#777777]">
              Automatically purge unpinned history. Pinned items are always kept.
            </p>
          </div>

          <div className="space-y-0 rounded-lg border border-[#2d2d2d] bg-[#191919]">
            <label className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <span className="block text-[13px] text-[#eeeeee]">
                  Clear unpinned on system reboot
                </span>
                <span className="text-[11px] text-[#777777]">
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
                className="h-4 w-4 cursor-pointer rounded border-[#555] bg-[#222] accent-[#60cdff]"
              />
            </label>

            <div className="mx-4 h-px bg-[#262626]" />

            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <span className="block text-[13px] text-[#eeeeee]">Auto-clear frequency</span>
                <span className="text-[11px] text-[#777777]">
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
                className="cursor-pointer rounded-md border border-[#333] bg-[#222] px-3 py-2 text-[12px] text-[#eeeeee] outline-none focus:border-[#60cdff]"
              >
                <option value="never">Never (manual only)</option>
                <option value="reboot">Every PC reboot</option>
                <option value="daily">Every 24 hours</option>
                <option value="weekly">Every 7 days</option>
              </select>
            </div>
          </div>
        </section>

        {error && (
          <p className="rounded-md border border-[#5a1d1d] bg-[#2a1515] px-3 py-2 text-[12px] text-[#ff8a8a]">
            {error}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-[#2d2d2d] px-5 py-3">
        <button
          type="button"
          onClick={() => setDraft({ ...DEFAULTS, lastCleanup: draft.lastCleanup })}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] text-[#aaaaaa] hover:bg-[#2d2d2d] hover:text-white"
        >
          <RotateCcw size={12} /> Defaults
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-3 py-1.5 text-[12px] text-[#aaaaaa] hover:bg-[#2d2d2d] hover:text-white"
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
              ? "bg-[#60cdff] text-[#000000] hover:brightness-110"
              : "bg-[#2d2d2d] text-[#666666]"
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
    <div className="flex items-center gap-4 rounded-lg border border-[#2d2d2d] bg-[#191919] px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-[#eeeeee]">{label}</p>
        <p className="text-[11px] text-[#777777]">{hint}</p>
      </div>
      <button
        type="button"
        onClick={onCapture}
        className={clsx(
          "min-w-[150px] rounded-md border px-3 py-2 font-mono text-[12px] transition",
          active
            ? "border-[#60cdff] bg-[#1a2a33] text-[#60cdff]"
            : "border-[#2d2d2d] bg-[#121212] text-[#cccccc] hover:border-[#3d3d3d]"
        )}
      >
        {active ? "Record hotkey…" : displayHotkey(value)}
      </button>
    </div>
  );
}
