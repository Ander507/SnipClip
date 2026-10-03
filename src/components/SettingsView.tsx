import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  RotateCcw,
  Keyboard,
  Trash2,
  Power,
  Palette,
  Moon,
  Sun,
  Ban,
  Download,
  RefreshCw,
  ArrowUp,
  ArrowDown,
  Eye,
  EyeOff,
  LayoutGrid,
  Lock,
  Unlock,
  Search,
  X,
  Monitor,
  Type,
  AppWindow,
  Timer,
  Sparkles,
  PanelBottom,
  ExternalLink,
} from "lucide-react";
import type { AppSettings, ClearInterval, Category } from "../lib/types";
import { DEFAULT_SETTINGS } from "../lib/types";
import { normalizeAppSettings } from "../lib/settings";
import {
  MONO_FONT_CHOICES,
  UI_FONT_CHOICES,
  applyUiPrefs,
  type UiPrefs,
} from "../lib/uiPrefs";
import { Switch } from "./Switch";
import { Segmented } from "./Segmented";
import { ThemeGallery } from "./ThemeGallery";
import { ColorPicker } from "./ColorPicker";
import { TAB_ICON_CHOICES, tabIcon } from "./Sidebar";
import {
  getSettings,
  updateSettings,
  getRunningApps,
  exportVault,
  importVault,
  setVaultPassword as setVaultPasswordCmd,
  openUrl,
} from "../lib/api";
import {
  ACCENTS,
  accentHex,
  applyTheme,
  isHexColor,
  withAccent,
  withThemeMode,
  withThemePreset,
  type AccentColor,
  type ThemeBackdrop,
  type ThemePreference,
} from "../lib/theme";
import { ThemeEditor } from "./ThemeEditor";
import { SelectDropdown } from "./SelectDropdown";
import { save, open } from "@tauri-apps/plugin-dialog";
import { getVersion } from "@tauri-apps/api/app";
import { checkForAppUpdate, formatUpdateError, installAppUpdate } from "../lib/updates";
import type { Update } from "@tauri-apps/plugin-updater";

interface Props {
  onClose: () => void;
  onSaved: (settings: AppSettings) => void;
  /** Items in the vault, for the "Clear history" danger zone. */
  historyCount: number;
  onClearHistory: () => Promise<void> | void;
  /** Live preview of layout prefs (sidebar side, tab icons…) in the main window; null = saved. */
  onPreviewUiPrefs?: (prefs: UiPrefs | null) => void;
  /** Section to scroll to once settings load (e.g. "popup" from the GIF tab's setup card). */
  initialSection?: string | null;
}

type CaptureTarget = "clipboard" | "snip" | "record" | "dock" | null;

const TAB_ORDER: { id: Category; label: string }[] = [
  { id: "all", label: "All" },
  { id: "text", label: "Text" },
  { id: "images", label: "Images" },
  { id: "screenshots", label: "Screenshots" },
  { id: "videos", label: "Videos" },
  { id: "math", label: "Math" },
  { id: "links", label: "Links" },
  { id: "pinned", label: "Pinned" },
];

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

const DOCK_HOTKEY_PRESETS = [
  { label: "Ctrl + Shift + D", value: "Control+Shift+D" },
  { label: "Alt + Shift + V", value: "Alt+Shift+V" },
  { label: "Ctrl + Alt + D", value: "Control+Alt+D" },
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

function matchesSettingsQuery(query: string, keywords: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = keywords.toLowerCase();
  return q.split(/\s+/).every((token) => hay.includes(token));
}

function SettingsSection({
  id,
  query,
  children,
}: {
  id: SectionId;
  query: string;
  children: React.ReactNode;
}) {
  const keywords = SETTINGS_SECTIONS.find((sec) => sec.id === id)?.keywords ?? "";
  if (!matchesSettingsQuery(query, keywords)) return null;
  return (
    <section id={`settings-${id}`} data-settings-section={id} className="scroll-mt-4 space-y-3">
      {children}
    </section>
  );
}

/** Small uppercase section heading with an optional description. */
function SectionHeading({
  icon: Icon,
  title,
  children,
}: {
  icon?: typeof Palette;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
        {Icon && <Icon size={11} />} {title}
      </h3>
      {children && <p className="mt-1 text-[12px] text-fg-muted">{children}</p>}
    </div>
  );
}

/** Label + hint on the left, control on the right. */
function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1">
        <span className="block text-[13px] text-fg-secondary">{label}</span>
        {hint && <span className="text-[11px] text-fg-muted">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

const RowDivider = () => <div className="mx-4 h-px bg-line" />;

const SETTINGS_SECTIONS = [
  {
    id: "appearance",
    label: "Appearance",
    icon: Palette,
    keywords:
      "appearance theme dark light system windows accent color colour hex custom cyan blue indigo purple pink red orange yellow green glassmorphic glass translucency backdrop mica acrylic gallery preset oled nord dracula catppuccin rose pine solarized wallpaper background theme pack",
  },
  {
    id: "layout",
    label: "Layout & text",
    icon: Type,
    keywords:
      "layout font typography code font monospace density compact comfortable spacious corner radius roundness border strength sidebar left right position collapse icon grid list thumbnail size images ui scale zoom",
  },
  {
    id: "tabs",
    label: "Library tabs",
    icon: LayoutGrid,
    keywords:
      "library tabs sidebar categories reorder hide icon color colour all text images screenshots videos math links pinned",
  },
  {
    id: "ignore",
    label: "Ignore list",
    icon: Ban,
    keywords:
      "clipboard ignore list skip apps process whisperflow 1password password manager ban exclude",
  },
  {
    id: "startup",
    label: "Startup",
    icon: Power,
    keywords: "startup launch login autostart tray minimized boot",
  },
  {
    id: "hotkeys",
    label: "Hotkeys",
    icon: Keyboard,
    keywords:
      "global hotkeys shortcuts keyboard toggle ui snip record clipboard popup dock alt+c ctrl+shift",
  },
  {
    id: "dock",
    label: "Window",
    icon: AppWindow,
    keywords:
      "window compact dock always on top floating vault win+v pins history max unpinned items",
  },
  {
    id: "popup",
    label: "Clipboard popup",
    icon: PanelBottom,
    keywords:
      "clipboard popup win+v alt+c position anchor cursor mouse center bottom width items count images thumbnails gif gifs klipy api key emoji kaomoji symbols drag",
  },
  {
    id: "snip-delay",
    label: "Snip delay",
    icon: Timer,
    keywords: "stealth snip delay wait overlay switch apps capture seconds",
  },
  {
    id: "clipboard-extras",
    label: "Clipboard extras",
    icon: Sparkles,
    keywords:
      "clipboard extras direct paste previous app sendinput type-out auto-evaluate math equations translate language mymemory",
  },
  {
    id: "backup",
    label: "Backup",
    icon: Download,
    keywords: "vault backup export import sqlite restore file",
  },
  {
    id: "password",
    label: "Vault password",
    icon: Lock,
    keywords: "vault password lock unlock encrypt decrypt encryption argon2 security",
  },
  {
    id: "cleanup",
    label: "Storage",
    icon: Trash2,
    keywords:
      "vault storage cleanup clear history delete all unpinned reboot auto-clear frequency daily weekly never purge danger",
  },
  {
    id: "updates",
    label: "Updates",
    icon: RefreshCw,
    keywords: "app updates version github releases download install check update",
  },
] as const;

type SectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

const POPUP_ANCHOR_OPTIONS = [
  { value: "bottom-right", label: "Bottom right (like Win+V)" },
  { value: "bottom-center", label: "Bottom center" },
  { value: "center", label: "Center of screen" },
  { value: "cursor", label: "Next to the mouse" },
] as const;

function isDirty(a: AppSettings, b: AppSettings) {
  return (
    a.hotkeyClipboard !== b.hotkeyClipboard ||
    a.hotkeySnip !== b.hotkeySnip ||
    a.hotkeyRecord !== b.hotkeyRecord ||
    a.hotkeyDock !== b.hotkeyDock ||
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
    a.snipDelayMs !== b.snipDelayMs ||
    JSON.stringify(a.sidebarTabs ?? []) !== JSON.stringify(b.sidebarTabs ?? []) ||
    JSON.stringify(a.vaultPasswordHash ?? []) !==
      JSON.stringify(b.vaultPasswordHash ?? []) ||
    JSON.stringify(a.vaultPasswordSalt ?? []) !==
      JSON.stringify(b.vaultPasswordSalt ?? []) ||
    a.autoTranslateEnabled !== b.autoTranslateEnabled ||
    a.autoTranslateTargetLang !== b.autoTranslateTargetLang ||
    a.autoEvalMath !== b.autoEvalMath ||
    a.directPasteEnabled !== b.directPasteEnabled ||
    a.compactDock !== b.compactDock ||
    a.mainAlwaysOnTop !== b.mainAlwaysOnTop ||
    a.maxHistory !== b.maxHistory ||
    a.uiScale !== b.uiScale ||
    a.themeBackdrop !== b.themeBackdrop ||
    a.klipyApiKey !== b.klipyApiKey ||
    JSON.stringify(a.uiPrefs) !== JSON.stringify(b.uiPrefs)
  );
}

function normalizeSettings(s: AppSettings): AppSettings {
  return normalizeAppSettings(s);
}

export function SettingsView({
  onClose,
  onSaved,
  historyCount,
  onClearHistory,
  onPreviewUiPrefs,
  initialSection,
}: Props) {
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
  const [vaultPassword, setVaultPassword] = useState("");
  const [vaultBusy, setVaultBusy] = useState(false);
  const [vaultMessage, setVaultMessage] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeSection, setActiveSection] = useState<SectionId>("appearance");
  const [editingTab, setEditingTab] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [customUiFont, setCustomUiFont] = useState("");
  const [customMonoFont, setCustomMonoFont] = useState("");
  const pendingUpdate = useRef<Update | null>(null);
  const previewUiRef = useRef(onPreviewUiPrefs);
  previewUiRef.current = onPreviewUiPrefs;
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
    const handle = window.setTimeout(() => {
      applyTheme(draft);
      applyUiPrefs(draft.uiPrefs);
      previewUiRef.current?.(draft.uiPrefs);
    }, 50);
    return () => window.clearTimeout(handle);
  }, [draft]);

  // Leaving Settings without saving (sidebar tab, Back, Discard) drops the unsaved preview —
  // otherwise it lingered until restart and looked like a saved theme that "sometimes" sticks.
  const savedRef = useRef<AppSettings | null>(null);
  savedRef.current = settings;
  useEffect(
    () => () => {
      if (savedRef.current) {
        applyTheme(savedRef.current);
        applyUiPrefs(savedRef.current.uiPrefs);
      }
      previewUiRef.current?.(null);
    },
    []
  );

  function patchUi(patch: Partial<UiPrefs>) {
    setDraft((prev) => (prev ? { ...prev, uiPrefs: { ...prev.uiPrefs, ...patch } } : prev));
  }

  // A clicked section stays highlighted while smooth scrolling passes (or can't reach) it
  const navLockUntil = useRef(0);

  function scrollToSection(id: SectionId) {
    navLockUntil.current = Date.now() + 900;
    setActiveSection(id);
    scrollRef.current
      ?.querySelector(`#settings-${id}`)
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  function syncActiveSection() {
    const el = scrollRef.current;
    if (!el || Date.now() < navLockUntil.current) return;
    const sections = Array.from(el.querySelectorAll<HTMLElement>("[data-settings-section]"));
    if (sections.length === 0) return;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
    let current = sections[0];
    for (const sec of sections) {
      if (sec.offsetTop - el.scrollTop <= 48) current = sec;
    }
    if (atBottom) current = sections[sections.length - 1];
    setActiveSection(current.dataset.settingsSection as SectionId);
  }

  const loaded = draft !== null;
  useEffect(() => {
    const target = SETTINGS_SECTIONS.find((sec) => sec.id === initialSection);
    if (!loaded || !target) return;
    const handle = window.setTimeout(() => scrollToSection(target.id), 80);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, initialSection]);

  async function handleClearHistory() {
    if (!confirmClear) {
      setConfirmClear(true);
      window.setTimeout(() => setConfirmClear(false), 3000);
      return;
    }
    setConfirmClear(false);
    setClearing(true);
    try {
      await onClearHistory();
    } finally {
      setClearing(false);
    }
  }

  const [confirmDiscard, setConfirmDiscard] = useState(false);
  useEffect(() => {
    setConfirmDiscard(false);
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
      if (captureRef.current === "dock") {
        return { ...prev, hotkeyDock: accel };
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
    if (dirty && !confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    if (settings) {
      applyTheme(settings);
      applyUiPrefs(settings.uiPrefs);
    }
    onClose();
  }

  function handleResetDefaults() {
    if (!draft) return;
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    setConfirmReset(false);
    // Defaults is a draft like any other edit — and never touches the vault password
    setDraft({
      ...DEFAULT_SETTINGS,
      lastCleanup: draft.lastCleanup,
      vaultPasswordHash: draft.vaultPasswordHash,
      vaultPasswordSalt: draft.vaultPasswordSalt,
    });
  }

  const saveRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    function onSaveKey(e: KeyboardEvent) {
      if (captureRef.current) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveRef.current();
      }
    }
    window.addEventListener("keydown", onSaveKey);
    return () => window.removeEventListener("keydown", onSaveKey);
  }, []);

  async function handleLockVault() {
    if (!vaultPassword || vaultBusy) return;
    setVaultBusy(true);
    setVaultMessage(null);
    try {
      await setVaultPasswordCmd(vaultPassword);
      setVaultPassword("");
      setSavedFlash(true);
      setVaultMessage(
        "Password saved. The vault encrypts when you quit SnipClip — keep the password safe."
      );
      // Refresh settings so vaultPasswordHash is visible to the rest of the UI
      const next = await getSettings();
      const normalized = normalizeSettings(next);
      setSettings(normalized);
      setDraft(normalized);
      onSaved(normalized);
      setTimeout(() => setSavedFlash(false), 2000);
      setTimeout(() => setVaultMessage(null), 6000);
    } catch (err) {
      setVaultMessage(String(err));
    } finally {
      setVaultBusy(false);
    }
  }

  async function handleUnlockVault() {
    if (vaultBusy) return;
    setVaultBusy(true);
    setVaultMessage(null);
    try {
      await setVaultPasswordCmd("");
      setVaultPassword("");
      setSavedFlash(true);
      setVaultMessage("Vault password removed.");
      const next = await getSettings();
      const normalized = normalizeSettings(next);
      setSettings(normalized);
      setDraft(normalized);
      onSaved(normalized);
      setTimeout(() => setSavedFlash(false), 2000);
      setTimeout(() => setVaultMessage(null), 4000);
    } catch (err) {
      setVaultMessage(String(err));
    } finally {
      setVaultBusy(false);
    }
  }

  async function applySidebarTabs(nextTabs: string[]) {
    if (!draft || !settings) return;
    // Always keep All — hiding it empties the library chrome
    const tabs = nextTabs.includes("all") ? nextTabs : ["all", ...nextTabs];
    const previous = draft;
    setDraft({ ...draft, sidebarTabs: tabs });
    setError(null);
    try {
      // Save only the tab change — a theme preview or hotkey edit in the draft stays unsaved
      // until Save instead of being committed behind the user's back.
      const saved = await updateSettings({ ...settings, sidebarTabs: tabs });
      const normalized = normalizeSettings(saved);
      setSettings(normalized);
      setDraft((prev) => (prev ? { ...prev, sidebarTabs: normalized.sidebarTabs } : normalized));
      onSaved(normalized);
    } catch (err) {
      setDraft(previous);
      setError(String(err));
    }
  }

  async function handleExportVault() {
    try {
      const path = await save({
        defaultPath: `snipclip-vault-${new Date().toISOString().slice(0, 10)}.db`,
        filters: [{ name: "SQLite vault", extensions: ["db"] }],
      });
      if (!path || typeof path !== "string") return;
      await exportVault(path);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1400);
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleImportVault() {
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: "SQLite vault", extensions: ["db"] }],
      });
      if (!path || typeof path !== "string") return;
      await importVault(path);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1400);
    } catch (err) {
      setError(String(err));
    }
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
  saveRef.current = () => {
    if (dirty && !saving) void handleSave();
  };

  const visibleSections = useMemo(
    () => SETTINGS_SECTIONS.filter((sec) => matchesSettingsQuery(search, sec.keywords)),
    [search]
  );
  const visibleSectionCount = visibleSections.length;

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
          <div className="min-w-0 flex-1">
            <h2 className="text-[14px] font-semibold text-fg">Settings</h2>
            <p className="text-[12px] text-fg-muted">
              Changes preview live — Save (Ctrl+S) keeps them. Showing, hiding and reordering
              library tabs saves right away.
            </p>
          </div>
        </div>
        <div className="relative mt-3">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint"
          />
          <input
            ref={searchRef}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && search) {
                e.preventDefault();
                setSearch("");
              }
            }}
            placeholder="Search settings…"
            spellCheck={false}
            autoComplete="off"
            className="w-full rounded-lg border border-line bg-inset py-2 pl-9 pr-9 text-[13px] text-fg outline-none placeholder:text-fg-faint focus:border-accent"
          />
          {search && (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                searchRef.current?.focus();
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-fg-faint transition hover:bg-hover hover:text-fg"
              title="Clear search"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Settings sections"
          className="hidden w-44 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line px-2 py-4 md:flex"
        >
          {visibleSections.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => scrollToSection(id)}
              aria-current={activeSection === id ? "true" : undefined}
              className={clsx(
                "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] transition",
                activeSection === id
                  ? "bg-hover text-fg"
                  : "text-fg-muted hover:bg-muted hover:text-fg"
              )}
            >
              <Icon size={13} className={activeSection === id ? "text-accent" : undefined} />
              <span className="truncate">{label}</span>
            </button>
          ))}
        </nav>
      <div
        ref={scrollRef}
        onScroll={syncActiveSection}
        className="relative min-w-0 flex-1 space-y-6 overflow-y-auto px-5 py-5"
      >
        {visibleSectionCount === 0 && (
          <p className="rounded-lg border border-line bg-raised px-4 py-8 text-center text-[13px] text-fg-muted">
            No settings match “{search.trim()}”.
          </p>
        )}

        <SettingsSection id="appearance" query={search}>
          <div>
            <h3 className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
              <Palette size={11} /> Appearance
            </h3>
            <p className="mt-1 text-[12px] text-fg-muted">
              Pick a look from the gallery or tune it below. Previews live; Save keeps it.
            </p>
          </div>

          <ThemeGallery
            draft={draft}
            onPick={(preset) =>
              setDraft((prev) => (prev ? withThemePreset(prev, preset) : prev))
            }
          />

          <div className="space-y-0 rounded-lg border border-line bg-raised">
            <SettingRow label="Theme" hint="Dark, light, or follow Windows.">
              <Segmented<ThemePreference>
                aria-label="Theme"
                value={draft.themeMode}
                options={[
                  { value: "dark", label: "Dark", icon: Moon },
                  { value: "light", label: "Light", icon: Sun },
                  { value: "system", label: "System", icon: Monitor },
                ]}
                onChange={(mode) =>
                  setDraft((prev) => (prev ? withThemeMode(prev, mode) : prev))
                }
              />
            </SettingRow>

            <RowDivider />

            <SettingRow label="Accent color" hint="Highlights, pins, and primary actions — or any color.">
              <div className="flex flex-wrap items-center justify-end gap-1.5">
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
                          prev ? withAccent(prev, accent.id as AccentColor) : prev
                        )
                      }
                      className={clsx(
                        "h-6 w-6 rounded-full border-2 transition",
                        selected ? "scale-110 border-fg" : "border-transparent hover:scale-105"
                      )}
                      style={{ backgroundColor: accent.hex }}
                    />
                  );
                })}
                <span
                  className={clsx(
                    "ml-1 rounded-md border p-0.5",
                    isHexColor(draft.accentColor) ? "border-fg" : "border-transparent"
                  )}
                  title="Custom accent"
                >
                  <ColorPicker
                    label="Custom accent"
                    value={accentHex(draft.accentColor)}
                    onChange={(hex) =>
                      setDraft((prev) =>
                        prev ? withAccent(prev, hex.toLowerCase() as AccentColor) : prev
                      )
                    }
                  />
                </span>
              </div>
            </SettingRow>

            <RowDivider />

            <SettingRow
              label="Window material"
              hint="Windows 11 Mica or Acrylic behind translucent panels. Applies when you save."
            >
              <Segmented<ThemeBackdrop>
                aria-label="Window material"
                value={draft.themeBackdrop}
                options={[
                  { value: "none", label: "None" },
                  { value: "mica", label: "Mica" },
                  { value: "acrylic", label: "Acrylic" },
                ]}
                onChange={(themeBackdrop) =>
                  setDraft((prev) => (prev ? { ...prev, themeBackdrop } : prev))
                }
              />
            </SettingRow>
          </div>

          <ThemeEditor draft={draft} setDraft={setDraft} />
        </SettingsSection>

        <SettingsSection id="layout" query={search}>
          <SectionHeading icon={Type} title="Layout & text">
            Fonts, spacing, corners and where things sit. Previews live; Save keeps it.
          </SectionHeading>
          <div className="rounded-lg border border-line bg-raised">
            <SettingRow label="UI font" hint="Any font installed on this PC.">
              <FontPicker
                value={draft.uiPrefs.fontFamily}
                choices={UI_FONT_CHOICES}
                custom={customUiFont}
                onCustomChange={setCustomUiFont}
                onChange={(fontFamily) => patchUi({ fontFamily })}
                ariaLabel="UI font"
              />
            </SettingRow>
            <RowDivider />
            <SettingRow label="Code font" hint="Snippets, hotkeys and the code preview.">
              <FontPicker
                value={draft.uiPrefs.monoFont}
                choices={MONO_FONT_CHOICES}
                custom={customMonoFont}
                onCustomChange={setCustomMonoFont}
                onChange={(monoFont) => patchUi({ monoFont })}
                ariaLabel="Code font"
              />
            </SettingRow>
            <RowDivider />
            <div className="px-4 py-3">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <span className="block text-[13px] text-fg-secondary">UI scale</span>
                  <span className="text-[11px] text-fg-muted">
                    Text and controls together (90–125%).
                  </span>
                </div>
                <span className="shrink-0 font-mono text-[12px] text-fg-muted">{draft.uiScale}%</span>
              </div>
              <input
                type="range"
                min={90}
                max={125}
                step={5}
                value={draft.uiScale}
                onChange={(e) =>
                  setDraft((prev) => (prev ? { ...prev, uiScale: Number(e.target.value) } : prev))
                }
                className="mt-3 h-1.5 w-full cursor-pointer accent-accent"
              />
            </div>
            <RowDivider />
            <SettingRow label="Density" hint="How much room each clip gets in the list.">
              <Segmented
                aria-label="Density"
                value={draft.uiPrefs.density}
                options={[
                  { value: "compact", label: "Compact" },
                  { value: "comfortable", label: "Comfortable" },
                  { value: "spacious", label: "Spacious" },
                ]}
                onChange={(density) => patchUi({ density })}
              />
            </SettingRow>
            <RowDivider />
            <div className="px-4 py-3">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <span className="block text-[13px] text-fg-secondary">Corner roundness</span>
                  <span className="text-[11px] text-fg-muted">Square (0%) to extra round (200%).</span>
                </div>
                <span className="shrink-0 font-mono text-[12px] text-fg-muted">
                  {draft.uiPrefs.radius}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={200}
                step={10}
                value={draft.uiPrefs.radius}
                onChange={(e) => patchUi({ radius: Number(e.target.value) })}
                className="mt-3 h-1.5 w-full cursor-pointer accent-accent"
              />
            </div>
            <RowDivider />
            <SettingRow label="Borders">
              <Segmented
                aria-label="Border strength"
                value={draft.uiPrefs.borderStrength}
                options={[
                  { value: "subtle", label: "Subtle" },
                  { value: "normal", label: "Normal" },
                  { value: "strong", label: "Strong" },
                ]}
                onChange={(borderStrength) => patchUi({ borderStrength })}
              />
            </SettingRow>
            <RowDivider />
            <SettingRow label="Sidebar side">
              <Segmented
                aria-label="Sidebar side"
                value={draft.uiPrefs.sidebarPosition}
                options={[
                  { value: "left", label: "Left" },
                  { value: "right", label: "Right" },
                ]}
                onChange={(sidebarPosition) => patchUi({ sidebarPosition })}
              />
            </SettingRow>
            <RowDivider />
            <label className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <span className="block text-[13px] text-fg-secondary">Icon-only sidebar</span>
                <span className="text-[11px] text-fg-muted">
                  Collapse the library to icons (also from the sidebar's own button).
                </span>
              </div>
              <Switch
                checked={draft.uiPrefs.sidebarCollapsed}
                onChange={(sidebarCollapsed) => patchUi({ sidebarCollapsed })}
              />
            </label>
            <RowDivider />
            <SettingRow label="Images & Screenshots tabs" hint="Rows or a thumbnail grid.">
              <Segmented
                aria-label="Image view"
                value={draft.uiPrefs.imageView}
                options={[
                  { value: "list", label: "List" },
                  { value: "grid", label: "Grid" },
                ]}
                onChange={(imageView) => patchUi({ imageView })}
              />
            </SettingRow>
            {draft.uiPrefs.imageView === "grid" && (
              <>
                <RowDivider />
                <SettingRow label="Thumbnail size">
                  <Segmented
                    aria-label="Thumbnail size"
                    value={draft.uiPrefs.thumbSize}
                    options={[
                      { value: "small", label: "Small" },
                      { value: "medium", label: "Medium" },
                      { value: "large", label: "Large" },
                    ]}
                    onChange={(thumbSize) => patchUi({ thumbSize })}
                  />
                </SettingRow>
              </>
            )}
          </div>
        </SettingsSection>

        <SettingsSection id="tabs" query={search}>
          <div>
            <h3 className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
              <LayoutGrid size={11} /> Library tabs
            </h3>
            <p className="mt-1 text-[12px] text-fg-muted">
              Show, hide and reorder save right away ("All" stays visible). Click a tab's icon to
              change its icon and color — Save keeps those.
            </p>
          </div>
          <div className="space-y-1 rounded-lg border border-line bg-raised px-4 py-3">
            {(() => {
              const enabledRows = draft.sidebarTabs
                .map((id) => TAB_ORDER.find((t) => t.id === id))
                .filter((t): t is (typeof TAB_ORDER)[number] => Boolean(t));
              const hiddenRows = TAB_ORDER.filter((t) => !draft.sidebarTabs.includes(t.id));
              const rows = [...enabledRows, ...hiddenRows];
              return rows.map((tab) => {
                const enabled = draft.sidebarTabs.includes(tab.id);
                const visibleIndex = draft.sidebarTabs.indexOf(tab.id);
                const canMoveUp = visibleIndex > 0;
                const canMoveDown =
                  visibleIndex >= 0 && visibleIndex < draft.sidebarTabs.length - 1;
                const isAll = tab.id === "all";
                const TabIcon = tabIcon(tab.id, draft.uiPrefs.tabIcons[tab.id]);
                const tabColor = draft.uiPrefs.tabColors[tab.id];
                return (
                  <div key={tab.id} className="py-1">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <button
                        type="button"
                        aria-label={`Toggle ${tab.label}`}
                        title={
                          isAll
                            ? "All stays visible"
                            : enabled
                              ? "Hide tab"
                              : "Show tab"
                        }
                        disabled={isAll}
                        onClick={() => {
                          if (isAll) return;
                          if (enabled) {
                            void applySidebarTabs(
                              draft.sidebarTabs.filter((t) => t !== tab.id)
                            );
                          } else {
                            void applySidebarTabs([...draft.sidebarTabs, tab.id]);
                          }
                        }}
                        className={clsx(
                          "rounded p-1 transition",
                          isAll
                            ? "cursor-default text-accent opacity-60"
                            : enabled
                              ? "text-accent hover:bg-hover"
                              : "text-fg-faint hover:text-fg"
                        )}
                      >
                        {enabled ? <Eye size={13} /> : <EyeOff size={13} />}
                      </button>
                      <button
                        type="button"
                        aria-label={`Change ${tab.label} icon and color`}
                        aria-expanded={editingTab === tab.id}
                        title="Icon & color"
                        onClick={() => setEditingTab((cur) => (cur === tab.id ? null : tab.id))}
                        className={clsx(
                          "rounded border p-1 transition",
                          editingTab === tab.id
                            ? "border-accent bg-accent-soft"
                            : "border-line hover:border-line-strong"
                        )}
                      >
                        <TabIcon
                          size={13}
                          className={tabColor ? undefined : "text-fg-secondary"}
                          style={tabColor ? { color: tabColor } : undefined}
                        />
                      </button>
                      <span
                        className={clsx(
                          "min-w-0 flex-1 text-[13px]",
                          enabled ? "text-fg-secondary" : "text-fg-faint line-through"
                        )}
                      >
                        {tab.label}
                      </span>
                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          aria-label={`Move ${tab.label} up`}
                          disabled={!canMoveUp}
                          onClick={() => {
                            const tabs = [...draft.sidebarTabs];
                            const i = visibleIndex;
                            if (i < 0 || i >= tabs.length) return;
                            [tabs[i], tabs[i - 1]] = [tabs[i - 1], tabs[i]];
                            void applySidebarTabs(tabs);
                          }}
                          className="rounded p-1 text-fg-muted transition hover:bg-hover hover:text-fg disabled:opacity-30"
                        >
                          <ArrowUp size={12} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Move ${tab.label} down`}
                          disabled={!canMoveDown}
                          onClick={() => {
                            const tabs = [...draft.sidebarTabs];
                            const i = visibleIndex;
                            if (i < 0 || i >= tabs.length - 1) return;
                            [tabs[i], tabs[i + 1]] = [tabs[i + 1], tabs[i]];
                            void applySidebarTabs(tabs);
                          }}
                          className="rounded p-1 text-fg-muted transition hover:bg-hover hover:text-fg disabled:opacity-30"
                        >
                          <ArrowDown size={12} />
                        </button>
                      </div>
                    </div>
                    {editingTab === tab.id && (
                      <div className="mt-2 space-y-2 rounded-md border border-line bg-inset p-2">
                        <div className="flex flex-wrap gap-1">
                          {TAB_ICON_CHOICES.map(({ key, icon: Choice }) => {
                            const current =
                              (draft.uiPrefs.tabIcons[tab.id] ?? "") === key ||
                              (!draft.uiPrefs.tabIcons[tab.id] &&
                                tabIcon(tab.id, undefined) === Choice);
                            return (
                              <button
                                key={key}
                                type="button"
                                aria-label={`${key} icon`}
                                aria-pressed={current}
                                onClick={() =>
                                  patchUi({
                                    tabIcons: { ...draft.uiPrefs.tabIcons, [tab.id]: key },
                                  })
                                }
                                className={clsx(
                                  "rounded p-1.5 transition",
                                  current
                                    ? "bg-accent text-accent-fg"
                                    : "text-fg-muted hover:bg-hover hover:text-fg"
                                )}
                              >
                                <Choice size={13} />
                              </button>
                            );
                          })}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              const { [tab.id]: _color, ...colors } = draft.uiPrefs.tabColors;
                              const { [tab.id]: _icon, ...icons } = draft.uiPrefs.tabIcons;
                              patchUi({ tabColors: colors, tabIcons: icons });
                            }}
                            className="rounded-md border border-line px-2 py-0.5 text-[11px] text-fg-muted hover:bg-hover hover:text-fg"
                          >
                            Reset
                          </button>
                          {ACCENTS.map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              title={c.label}
                              aria-label={`${c.label} icon color`}
                              aria-pressed={tabColor === c.hex}
                              onClick={() =>
                                patchUi({
                                  tabColors: { ...draft.uiPrefs.tabColors, [tab.id]: c.hex },
                                })
                              }
                              className={clsx(
                                "h-5 w-5 rounded-full border-2 transition",
                                tabColor === c.hex ? "border-fg" : "border-transparent hover:scale-110"
                              )}
                              style={{ backgroundColor: c.hex }}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              });
            })()}
          </div>
        </SettingsSection>

        <SettingsSection id="ignore" query={search}>
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
        </SettingsSection>

        <SettingsSection id="startup" query={search}>
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
            <Switch
              checked={draft.launchAtStartup}
              onChange={(v) => setDraft((prev) => (prev ? { ...prev, launchAtStartup: v } : prev))}
            />
          </label>
        </SettingsSection>

        <SettingsSection id="hotkeys" query={search}>
          <SectionHeading icon={Keyboard} title="Global hotkeys" />
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
          <HotkeyRow
            label="Clipboard popup (Win+V style)"
            hint="Default Ctrl + Shift + D — floating history over any app (same panel as Alt+C)"
            value={draft.hotkeyDock}
            active={capturing === "dock"}
            onCapture={() => setCapturing("dock")}
          />
          <div className="flex flex-wrap gap-2 px-1">
            {DOCK_HOTKEY_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                onClick={() =>
                  setDraft((prev) => (prev ? { ...prev, hotkeyDock: preset.value } : prev))
                }
                className={clsx(
                  "rounded-md border px-2.5 py-1 font-mono text-[11px] transition",
                  draft.hotkeyDock === preset.value
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
        </SettingsSection>

        <SettingsSection id="dock" query={search}>
          <SectionHeading icon={AppWindow} title="Window" />
          <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-line bg-raised px-4 py-3">
            <div className="min-w-0">
              <span className="block text-[13px] text-fg-secondary">Start in compact dock</span>
              <span className="text-[11px] text-fg-muted">
                Slim vault window (pins + last 10). For a floating Win+V popup over other apps, use{" "}
                <span className="font-mono">Ctrl+Shift+D</span> or <span className="font-mono">Alt+C</span>.
              </span>
            </div>
            <Switch
              checked={draft.compactDock}
              onChange={(v) => setDraft((prev) => (prev ? { ...prev, compactDock: v } : prev))}
            />
          </label>
          <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-line bg-raised px-4 py-3">
            <div className="min-w-0">
              <span className="block text-[13px] text-fg-secondary">Always on top</span>
              <span className="text-[11px] text-fg-muted">
                Keep the vault floating above other windows while you work.
              </span>
            </div>
            <Switch
              checked={draft.mainAlwaysOnTop}
              onChange={(v) => setDraft((prev) => (prev ? { ...prev, mainAlwaysOnTop: v } : prev))}
            />
          </label>
          <div className="rounded-lg border border-line bg-raised px-4 py-3">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <span className="block text-[13px] text-fg-secondary">Max clipboard history</span>
                <span className="text-[11px] text-fg-muted">
                  Unpinned items only (50–1000). Pins are never auto-trimmed.
                </span>
              </div>
              <span className="shrink-0 font-mono text-[12px] text-fg-muted">
                {draft.maxHistory}
              </span>
            </div>
            <input
              type="range"
              min={50}
              max={1000}
              step={50}
              value={draft.maxHistory}
              onChange={(e) =>
                setDraft((prev) =>
                  prev ? { ...prev, maxHistory: Number(e.target.value) } : prev
                )
              }
              className="mt-3 h-1.5 w-full cursor-pointer accent-accent"
            />
          </div>
        </SettingsSection>

        <SettingsSection id="popup" query={search}>
          <SectionHeading icon={PanelBottom} title="Clipboard popup">
            The floating history from Alt+C / {displayHotkey(draft.hotkeyDock)}. Applies when you
            save.
          </SectionHeading>
          <div className="rounded-lg border border-line bg-raised">
            <SettingRow label="Opens at">
              <SelectDropdown
                aria-label="Popup position"
                wide
                value={draft.uiPrefs.paletteAnchor}
                options={POPUP_ANCHOR_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                onChange={(paletteAnchor) =>
                  patchUi({ paletteAnchor: paletteAnchor as UiPrefs["paletteAnchor"] })
                }
              />
            </SettingRow>
            <RowDivider />
            <div className="px-4 py-3">
              <div className="flex items-center justify-between gap-4">
                <span className="text-[13px] text-fg-secondary">Width</span>
                <span className="font-mono text-[12px] text-fg-muted">
                  {draft.uiPrefs.paletteWidth}px
                </span>
              </div>
              <input
                type="range"
                min={320}
                max={560}
                step={20}
                value={draft.uiPrefs.paletteWidth}
                onChange={(e) => patchUi({ paletteWidth: Number(e.target.value) })}
                className="mt-3 h-1.5 w-full cursor-pointer accent-accent"
              />
            </div>
            <RowDivider />
            <div className="px-4 py-3">
              <div className="flex items-center justify-between gap-4">
                <span className="text-[13px] text-fg-secondary">Clips shown</span>
                <span className="font-mono text-[12px] text-fg-muted">
                  {draft.uiPrefs.paletteMaxItems}
                </span>
              </div>
              <input
                type="range"
                min={10}
                max={50}
                step={5}
                value={draft.uiPrefs.paletteMaxItems}
                onChange={(e) => patchUi({ paletteMaxItems: Number(e.target.value) })}
                className="mt-3 h-1.5 w-full cursor-pointer accent-accent"
              />
            </div>
            <RowDivider />
            <label className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <span className="block text-[13px] text-fg-secondary">Show image previews</span>
                <span className="text-[11px] text-fg-muted">
                  Off shows images as compact rows so more clips fit.
                </span>
              </div>
              <Switch
                checked={draft.uiPrefs.paletteShowImages}
                onChange={(paletteShowImages) => patchUi({ paletteShowImages })}
              />
            </label>
            <RowDivider />
            <div className="space-y-2 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <div className="min-w-0 flex-1">
                  <span className="block text-[13px] text-fg-secondary">KLIPY API key (GIFs)</span>
                  <span className="text-[11px] text-fg-muted">
                    Free from KLIPY. GIF searches go to KLIPY only while the GIF tab is open.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void openUrl("https://klipy.com/developers")}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-line px-2.5 py-1.5 text-[11px] text-fg-secondary transition hover:bg-hover"
                >
                  Get a free key <ExternalLink size={11} />
                </button>
              </div>
              <input
                type="password"
                value={draft.klipyApiKey}
                onChange={(e) =>
                  setDraft((prev) => (prev ? { ...prev, klipyApiKey: e.target.value } : prev))
                }
                placeholder="Paste your KLIPY API key"
                autoComplete="off"
                spellCheck={false}
                aria-label="KLIPY API key"
                className="w-full rounded-md border border-line bg-inset px-3 py-2 font-mono text-[12px] text-fg outline-none placeholder:text-fg-faint focus:border-accent"
              />
            </div>
          </div>
        </SettingsSection>

        <SettingsSection id="snip-delay" query={search}>
          <SectionHeading icon={Timer} title="Stealth snip delay" />
          <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-line bg-raised px-4 py-3">
            <div className="min-w-0">
              <span className="block text-[13px] text-fg-secondary">Snipping delay</span>
              <span className="text-[11px] text-fg-muted">
                Wait before the overlay opens so you can switch apps without pressing keys.
              </span>
            </div>
            <Switch
              checked={draft.snipDelayEnabled}
              onChange={(v) => setDraft((prev) => (prev ? { ...prev, snipDelayEnabled: v } : prev))}
            />
          </label>
          {draft.snipDelayEnabled && (
            <div className="flex items-center justify-between gap-4 rounded-lg border border-line bg-raised px-4 py-3">
              <span className="text-[13px] text-fg-secondary">Delay before snip</span>
              <SelectDropdown
                aria-label="Delay before snip"
                value={String(draft.snipDelayMs)}
                options={[
                  { value: "3000", label: "3 seconds" },
                  { value: "5000", label: "5 seconds" },
                  { value: "10000", label: "10 seconds" },
                ]}
                onChange={(v) =>
                  setDraft((prev) =>
                    prev ? { ...prev, snipDelayMs: Number(v) } : prev
                  )
                }
              />
            </div>
          )}
        </SettingsSection>

        <SettingsSection id="clipboard-extras" query={search}>
          <SectionHeading icon={Sparkles} title="Clipboard extras" />
          <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-line bg-raised px-4 py-3">
            <div className="min-w-0">
              <span className="block text-[13px] text-fg-secondary">
                Direct paste into previous app
              </span>
              <span className="text-[11px] text-fg-muted">
                Off by default. When on, Enter in the clipboard popup or compact dock hides
                SnipClip and pastes into the app you were using (Ctrl+V / type-out). Without it,
                Enter only copies.
              </span>
            </div>
            <Switch
              checked={draft.directPasteEnabled}
              onChange={(v) => setDraft((prev) => (prev ? { ...prev, directPasteEnabled: v } : prev))}
            />
          </label>
          <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-line bg-raised px-4 py-3">
            <div className="min-w-0">
              <span className="block text-[13px] text-fg-secondary">
                Auto-evaluate math equations
              </span>
              <span className="text-[11px] text-fg-muted">
                Off by default. Keeps the raw equation on your clipboard and shows the answer as a
                copyable badge in the vault.
              </span>
            </div>
            <Switch
              checked={draft.autoEvalMath}
              onChange={(v) => setDraft((prev) => (prev ? { ...prev, autoEvalMath: v } : prev))}
            />
          </label>
          <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-line bg-raised px-4 py-3">
            <div className="min-w-0">
              <span className="block text-[13px] text-fg-secondary">Translate copied text</span>
              <span className="text-[11px] text-fg-muted">
                Off by default. Uses an online translator (MyMemory). Skips links, code-like
                text, and text already in the target language. Needs network.
              </span>
            </div>
            <Switch
              checked={draft.autoTranslateEnabled}
              onChange={(v) => setDraft((prev) => (prev ? { ...prev, autoTranslateEnabled: v } : prev))}
            />
          </label>
          {draft.autoTranslateEnabled && (
            <div className="flex items-center justify-between gap-4 rounded-lg border border-line bg-raised px-4 py-3">
              <span className="text-[13px] text-fg-secondary">Target language</span>
              <SelectDropdown
                aria-label="Target language"
                value={draft.autoTranslateTargetLang}
                options={[
                  { value: "en", label: "English" },
                  { value: "da", label: "Danish" },
                  { value: "de", label: "German" },
                  { value: "es", label: "Spanish" },
                  { value: "fr", label: "French" },
                  { value: "it", label: "Italian" },
                  { value: "nl", label: "Dutch" },
                  { value: "no", label: "Norwegian" },
                  { value: "pl", label: "Polish" },
                  { value: "pt", label: "Portuguese" },
                  { value: "sv", label: "Swedish" },
                  { value: "uk", label: "Ukrainian" },
                  { value: "zh", label: "Chinese" },
                ]}
                onChange={(v) =>
                  setDraft((prev) =>
                    prev ? { ...prev, autoTranslateTargetLang: v } : prev
                  )
                }
              />
            </div>
          )}
        </SettingsSection>

        <SettingsSection id="backup" query={search}>
          <div>
            <h3 className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
              <Download size={11} /> Vault backup
            </h3>
            <p className="mt-1 text-[12px] text-fg-muted">
              Back up the local SQLite vault to a file, or restore one. Restore applies on next launch.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 rounded-lg border border-line bg-raised px-4 py-3">
            <button
              type="button"
              onClick={() => void handleExportVault()}
              className="inline-flex items-center gap-1.5 rounded-md border border-line bg-hover px-3 py-2 text-[12px] font-medium text-fg-secondary transition hover:bg-muted"
            >
              <Download size={12} /> Export vault…
            </button>
            <button
              type="button"
              onClick={() => void handleImportVault()}
              className="inline-flex items-center gap-1.5 rounded-md border border-line bg-hover px-3 py-2 text-[12px] font-medium text-fg-secondary transition hover:bg-muted"
            >
              <RotateCcw size={12} /> Import vault…
            </button>
          </div>
        </SettingsSection>

        <SettingsSection id="password" query={search}>
          <div>
            <h3 className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
              <Lock size={11} /> Vault password
            </h3>
            <p className="mt-1 text-[12px] text-fg-muted">
              Protects your whole clipboard library (All / Text / Images / …) — there is no separate
              Vault tab. With a password set, the library encrypts when you quit SnipClip. Keep it
              safe; there is no recovery.
            </p>
          </div>
          <div className="space-y-3 rounded-lg border border-line bg-raised px-4 py-3">
            {Boolean(draft.vaultPasswordHash?.length) ? (
              <button
                type="button"
                onClick={() => void handleUnlockVault()}
                disabled={vaultBusy}
                className="inline-flex items-center gap-1.5 rounded-md border border-line bg-hover px-3 py-2 text-[12px] font-medium text-fg-secondary transition hover:bg-muted disabled:opacity-50"
              >
                <Unlock size={12} /> Remove vault password
              </button>
            ) : (
              <>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={vaultPassword}
                  onChange={(e) => setVaultPassword(e.target.value)}
                  disabled={vaultBusy}
                  placeholder="New password"
                  className="w-full rounded-md border border-line bg-inset px-3 py-2 text-[13px] text-fg outline-none placeholder:text-fg-faint focus:border-accent"
                />
                <button
                  type="button"
                  onClick={() => void handleLockVault()}
                  disabled={vaultBusy || !vaultPassword}
                  className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-[12px] font-semibold text-accent-fg hover:brightness-110 disabled:opacity-50"
                >
                  <Lock size={12} /> Set vault password
                </button>
              </>
            )}
            {vaultMessage && (
              <p
                className={clsx(
                  "text-[12px] leading-relaxed",
                  vaultMessage.toLowerCase().includes("safe") ||
                    vaultMessage.toLowerCase().includes("saved") ||
                    vaultMessage.toLowerCase().includes("removed")
                    ? "font-medium text-accent"
                    : "text-danger"
                )}
              >
                {vaultMessage}
              </p>
            )}
          </div>
        </SettingsSection>

        <SettingsSection id="cleanup" query={search}>
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
              <Switch
              checked={draft.clearOnBoot}
              onChange={(v) => setDraft((prev) => (prev ? { ...prev, clearOnBoot: v } : prev))}
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
              <SelectDropdown
                aria-label="Auto-clear frequency"
                wide
                value={draft.clearInterval}
                options={[
                  { value: "never", label: "Never (manual only)" },
                  { value: "reboot", label: "Every PC reboot" },
                  { value: "daily", label: "Every 24 hours" },
                  { value: "weekly", label: "Every 7 days" },
                ]}
                onChange={(v) =>
                  setDraft((prev) =>
                    prev ? { ...prev, clearInterval: v as ClearInterval } : prev
                  )
                }
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-danger/30 bg-danger/5 px-4 py-3">
            <div className="min-w-0">
              <span className="block text-[13px] text-fg-secondary">Clear history now</span>
              <span className="text-[11px] text-fg-muted">
                Deletes every unpinned clip ({historyCount} in the vault). Pins stay. Can't be
                undone.
              </span>
            </div>
            <button
              type="button"
              disabled={clearing || historyCount === 0}
              onClick={() => void handleClearHistory()}
              className={clsx(
                "inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-2 text-[12px] font-semibold transition disabled:opacity-50",
                confirmClear
                  ? "bg-danger text-white hover:brightness-110"
                  : "border border-danger/40 text-danger hover:bg-danger/10"
              )}
            >
              <Trash2 size={12} />
              {clearing ? "Clearing…" : confirmClear ? "Click again to clear" : "Clear history"}
            </button>
          </div>
        </SettingsSection>

        <SettingsSection id="updates" query={search}>
          <div>
            <h3 className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
              <RefreshCw size={11} /> App updates
            </h3>
            <p className="mt-1 text-[12px] text-fg-muted">
              Checks GitHub Releases for a signed build, then downloads and restarts to apply it.
              Works in installed builds (not dev).
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
        </SettingsSection>

        <p className="pt-2 text-center text-[11px] text-fg-faint">
          Made with ❤️ by Ander507 for Stardance — Hack Club
        </p>

        {error && (
          <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">
            {error}
          </p>
        )}
      </div>
      </div>

      <div className="flex items-center gap-2 border-t border-line px-5 py-3">
        {confirmDiscard ? (
          <>
            <span className="text-[12px] text-fg-secondary">Discard unsaved changes?</span>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => setConfirmDiscard(false)}
              className="rounded-md px-3 py-1.5 text-[12px] text-fg-muted hover:bg-hover hover:text-fg"
            >
              Keep editing
            </button>
            <button
              type="button"
              onClick={handleBack}
              className="rounded-md px-3 py-1.5 text-[12px] font-medium text-danger hover:bg-danger/10"
            >
              Discard
            </button>
          </>
        ) : confirmReset ? (
          <>
            <span className="text-[12px] text-fg-secondary">
              Reset every setting to its default? Your vault password is kept.
            </span>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => setConfirmReset(false)}
              className="rounded-md px-3 py-1.5 text-[12px] text-fg-muted hover:bg-hover hover:text-fg"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleResetDefaults}
              className="rounded-md px-3 py-1.5 text-[12px] font-medium text-danger hover:bg-danger/10"
            >
              Reset
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={handleResetDefaults}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] text-fg-muted hover:bg-hover hover:text-fg"
            >
              <RotateCcw size={12} /> Defaults
            </button>
            {dirty && (
              <span className="inline-flex items-center gap-1.5 text-[12px] text-fg-secondary">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                Unsaved changes
              </span>
            )}
            <div className="flex-1" />
            <button
              type="button"
              onClick={handleBack}
              className="rounded-md px-3 py-1.5 text-[12px] text-fg-muted hover:bg-hover hover:text-fg"
            >
              Back
            </button>
          </>
        )}
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

/** Preset font list plus a free-text field for any other installed font. */
function FontPicker({
  value,
  choices,
  custom,
  onCustomChange,
  onChange,
  ariaLabel,
}: {
  value: string;
  choices: { value: string; label: string }[];
  custom: string;
  onCustomChange: (v: string) => void;
  onChange: (v: string) => void;
  ariaLabel: string;
}) {
  const options = choices.some((c) => c.value === value)
    ? choices
    : [...choices, { value, label: `${value} (custom)` }];
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <SelectDropdown aria-label={ariaLabel} wide value={value} options={options} onChange={onChange} />
      <form
        className="flex"
        onSubmit={(e) => {
          e.preventDefault();
          const name = custom.trim();
          if (name) onChange(name);
          onCustomChange("");
        }}
      >
        <input
          type="text"
          value={custom}
          onChange={(e) => onCustomChange(e.target.value)}
          placeholder="Other font…"
          spellCheck={false}
          className="w-28 rounded-md border border-line bg-inset px-2 py-1.5 text-[12px] text-fg outline-none placeholder:text-fg-faint focus:border-accent"
        />
      </form>
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