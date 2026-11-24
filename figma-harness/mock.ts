/**
 * Fake Tauri backend for the Figma capture harness.
 *
 * Runs before src/main.tsx (see entry.ts). Every IPC command the pages call is answered here
 * with invented data; nothing touches the real database, file system or windows.
 *
 * A capture scenario is passed in through `window.__SCENARIO__` (set by capture.mjs with
 * addInitScript), e.g. { empty: true }, { noVideos: true }, { paused: true },
 * { settings: { themeMode: "light" } }.
 */
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { DEFAULT_SETTINGS, type AppSettings, type ClipboardItem } from "../src/lib/types";
import { DEFAULT_UI_PREFS } from "../src/lib/uiPrefs";

interface Scenario {
  empty?: boolean;
  noVideos?: boolean;
  paused?: boolean;
  settings?: Partial<AppSettings>;
  uiPrefs?: Record<string, unknown>;
  /** Replay status override (e.g. { saving: true }). */
  replay?: Record<string, unknown>;
}

declare global {
  interface Window {
    __SCENARIO__?: Scenario;
    __fx: {
      emit: typeof emit;
      ready: Promise<void>;
      unknown: string[];
      calls: string[];
      items: () => ClipboardItem[];
    };
  }
}

const scenario: Scenario = window.__SCENARIO__ ?? {};
const params = new URLSearchParams(location.search);
const view = params.get("view");
const label =
  params.get("mode") === "snip"
    ? "snipper"
    : view === "popup"
      ? "screenshot-popup"
      : view === "recorder"
        ? "recorder-bar"
        : view === "palette"
          ? "palette"
          : view === "video-editor"
            ? "video-editor"
            : view === "replay-toast"
              ? "replay-toast"
              : "main";

mockWindows(label, "main");

// ---- fake media files ------------------------------------------------------------------
// Vault paths look like real Windows paths; convertFileSrc maps them to /media/<file> on the
// harness server (same origin, so poster capture can draw them to a canvas).
const VID_DIR = "C:\\Users\\demo\\Videos\\SnipClip\\";
const MEDIA_MAP: Record<string, string> = {
  "SnipClip Replay 2026-11-24 14-02-11.mp4": "clip.mp4",
  "Recording 2026-11-23 16-40-05.mp4": "clip2.mp4",
  "SnipClip Replay 2026-11-21 21-18-44.mp4": "clip3.mp4",
  "Recording 2026-11-24 09-12-30.gif": "loop.gif",
  "Recording 2026-11-10 11-05-52.mp4": "missing-file.mp4",
};
(window as any).__TAURI_INTERNALS__.convertFileSrc = (filePath: string) => {
  const name = filePath.split(/[\\/]/).pop() ?? filePath;
  return `/media/${encodeURIComponent(MEDIA_MAP[name] ?? name)}`;
};

// ---- images ------------------------------------------------------------------------------
function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`load ${src}`));
    img.src = src;
  });
}

function scaled(src: CanvasImageSource, w: number, h: number, maxEdge: number, type = "image/jpeg") {
  const s = Math.min(1, maxEdge / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * s));
  c.height = Math.max(1, Math.round(h * s));
  c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL(type, 0.86);
}

/** Procedural "copied images" so the Images tab has something that isn't a screen grab. */
function drawImage(kind: string, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  if (kind === "palette") {
    const cols = ["#0f172a", "#155e75", "#22d3ee", "#f472b6", "#fde68a"];
    cols.forEach((col, i) => {
      g.fillStyle = col;
      g.fillRect((i * w) / cols.length, 0, w / cols.length + 1, h);
    });
    g.fillStyle = "rgba(255,255,255,0.92)";
    g.font = `600 ${Math.round(h / 14)}px Segoe UI, sans-serif`;
    cols.forEach((col, i) => {
      g.fillStyle = i < 2 ? "#e2e8f0" : "#0f172a";
      g.fillText(col.toUpperCase(), (i * w) / cols.length + 18, h - 28);
    });
  } else if (kind === "chart") {
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "#e5e7eb";
    for (let y = 60; y < h - 40; y += 50) {
      g.beginPath();
      g.moveTo(60, y);
      g.lineTo(w - 30, y);
      g.stroke();
    }
    const bars = [0.42, 0.55, 0.48, 0.7, 0.62, 0.81, 0.74, 0.92];
    const bw = (w - 120) / bars.length;
    bars.forEach((v, i) => {
      g.fillStyle = i === bars.length - 1 ? "#6366f1" : "#a5b4fc";
      const bh = v * (h - 120);
      g.fillRect(70 + i * bw, h - 50 - bh, bw * 0.62, bh);
    });
    g.fillStyle = "#111827";
    g.font = `600 22px Segoe UI, sans-serif`;
    g.fillText("Weekly active users", 60, 38);
  } else if (kind === "photo") {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#fb923c");
    grad.addColorStop(0.55, "#f472b6");
    grad.addColorStop(1, "#312e81");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.fillStyle = "rgba(255,237,213,0.95)";
    g.beginPath();
    g.arc(w * 0.62, h * 0.52, h * 0.16, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#1e1b4b";
    g.beginPath();
    g.moveTo(0, h * 0.78);
    for (let x = 0; x <= w; x += w / 8) g.lineTo(x, h * (0.62 + 0.12 * Math.sin(x / 90)));
    g.lineTo(w, h);
    g.lineTo(0, h);
    g.fill();
  } else {
    // "logo" — rounded mark on a soft background
    g.fillStyle = "#f8fafc";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#0891b2";
    const r = Math.min(w, h) * 0.3;
    g.beginPath();
    g.roundRect(w / 2 - r, h / 2 - r, r * 2, r * 2, r * 0.45);
    g.fill();
    g.fillStyle = "#ffffff";
    g.font = `700 ${Math.round(r)}px Segoe UI, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("SC", w / 2, h / 2 + 4);
  }
  return c;
}

interface MediaEntry {
  full: string;
  w: number;
  h: number;
  source: CanvasImageSource;
}
const media = new Map<number, MediaEntry>();

// ---- items ---------------------------------------------------------------------------------
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const now = Date.now();
const at = (msAgo: number) => new Date(now - msAgo).toISOString();

type Seed = Omit<ClipboardItem, "createdAt" | "isPinned"> & {
  ago: number;
  isPinned?: boolean;
  image?: { file?: string; draw?: string };
};

const SEEDS: Seed[] = [
  {
    id: 101,
    contentType: "text",
    content:
      "Can we move the design review to Thursday at 3? I'll bring the new onboarding flows and the empty-state copy.",
    preview: "",
    sourceApp: "Slack.exe",
    ago: 2 * MIN,
  },
  {
    id: 102,
    contentType: "screenshot",
    content: "",
    preview: "",
    sourceApp: null,
    ago: 7 * MIN,
    width: 1280,
    height: 720,
    image: { file: "big.jpg" },
  },
  {
    id: 103,
    contentType: "text",
    content: `export function debounce<T extends (...args: never[]) => void>(fn: T, ms = 200) {
  let timer: number | undefined;
  return (...args: Parameters<T>) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), ms);
  };
}`,
    preview: "",
    sourceApp: "Code.exe",
    ago: 14 * MIN,
    isPinned: true,
  },
  {
    id: 104,
    contentType: "video",
    content: `${VID_DIR}SnipClip Replay 2026-11-24 14-02-11.mp4`,
    preview: "video: SnipClip Replay 2026-11-24 14-02-11.mp4",
    sourceApp: null,
    ago: 31 * MIN,
    width: 1280,
    height: 720,
  },
  {
    id: 105,
    contentType: "link",
    content: "https://tauri.app/develop/calling-frontend/#event-system",
    preview: "",
    sourceApp: "chrome.exe",
    ago: 48 * MIN,
  },
  {
    id: 106,
    contentType: "math",
    content: "1299 * 0.85 + 49",
    preview: "= 1153.15",
    sourceApp: "Notepad.exe",
    ago: 70 * MIN,
  },
  {
    id: 107,
    contentType: "image",
    content: "",
    preview: "",
    sourceApp: "Figma.exe",
    ago: 95 * MIN,
    width: 1200,
    height: 720,
    image: { draw: "palette" },
  },
  {
    id: 108,
    contentType: "text",
    content: "#22D3EE",
    preview: "",
    sourceApp: "Figma.exe",
    ago: 2 * HOUR + 10 * MIN,
  },
  {
    id: 109,
    contentType: "gif",
    content: `${VID_DIR}Recording 2026-11-24 09-12-30.gif`,
    preview: "gif: Recording 2026-11-24 09-12-30.gif",
    sourceApp: null,
    ago: 3 * HOUR,
    width: 480,
    height: 270,
  },
  {
    id: 110,
    contentType: "text",
    content: `{"id": "ord_8F2K", "status": "shipped", "items": 3, "total": 129.9, "carrier": "DHL"}`,
    preview: "",
    sourceApp: "Postman.exe",
    ago: 4 * HOUR,
  },
  {
    id: 111,
    contentType: "translated",
    content:
      "The shipment arrives on Friday morning, please confirm the address.\n\n——— original ———\nEl envío llega el viernes por la mañana, por favor confirma la dirección.",
    preview: "",
    sourceApp: "Outlook.exe",
    ago: 5 * HOUR,
  },
  // ---- yesterday
  {
    id: 112,
    contentType: "screenshot",
    content: "",
    preview: "",
    sourceApp: null,
    ago: DAY + 2 * HOUR,
    width: 640,
    height: 360,
    image: { file: "f12.jpg" },
    isPinned: true,
  },
  {
    id: 113,
    contentType: "text",
    content: `SELECT u.email, COUNT(o.id) AS orders
FROM users u
JOIN orders o ON o.user_id = u.id
WHERE o.created_at > now() - interval '30 days'
GROUP BY u.email
ORDER BY orders DESC
LIMIT 20;`,
    preview: "",
    sourceApp: "DataGrip.exe",
    ago: DAY + 3 * HOUR,
  },
  {
    id: 114,
    contentType: "link",
    content: "https://www.figma.com/design/q8Lw2/SnipClip-Redesign?node-id=12-408",
    preview: "",
    sourceApp: "Figma.exe",
    ago: DAY + 4 * HOUR,
    isPinned: true,
  },
  {
    id: 115,
    contentType: "video",
    content: `${VID_DIR}Recording 2026-11-23 16-40-05.mp4`,
    preview: "video: Recording 2026-11-23 16-40-05.mp4",
    sourceApp: null,
    ago: DAY + 5 * HOUR,
    width: 1280,
    height: 720,
  },
  {
    id: 116,
    contentType: "image",
    content: "",
    preview: "",
    sourceApp: "chrome.exe",
    ago: DAY + 6 * HOUR,
    width: 960,
    height: 600,
    image: { draw: "chart" },
  },
  {
    id: 117,
    contentType: "math",
    content: "sqrt(2) * 144",
    preview: "= 203.6468",
    sourceApp: "Calculator.exe",
    ago: DAY + 7 * HOUR,
  },
  {
    id: 118,
    contentType: "text",
    content: "anders.demo@example.com",
    preview: "",
    sourceApp: "Outlook.exe",
    ago: DAY + 8 * HOUR,
  },
  // ---- earlier this week
  {
    id: 119,
    contentType: "screenshot",
    content: "",
    preview: "",
    sourceApp: null,
    ago: 3 * DAY + HOUR,
    width: 640,
    height: 360,
    image: { file: "f20.jpg" },
  },
  {
    id: 120,
    contentType: "video",
    content: `${VID_DIR}SnipClip Replay 2026-11-21 21-18-44.mp4`,
    preview: "video: SnipClip Replay 2026-11-21 21-18-44.mp4",
    sourceApp: null,
    ago: 3 * DAY + 2 * HOUR,
    width: 1280,
    height: 720,
  },
  {
    id: 121,
    contentType: "text",
    content: `def chunked(seq, size):
    """Yield successive chunks of size from seq."""
    for i in range(0, len(seq), size):
        yield seq[i:i + size]`,
    preview: "",
    sourceApp: "pycharm64.exe",
    ago: 3 * DAY + 4 * HOUR,
  },
  {
    id: 122,
    contentType: "link",
    content: "https://developer.mozilla.org/en-US/docs/Web/CSS/container-queries",
    preview: "",
    sourceApp: "firefox.exe",
    ago: 4 * DAY,
  },
  {
    id: 123,
    contentType: "image",
    content: "",
    preview: "",
    sourceApp: "Photos.exe",
    ago: 4 * DAY + 3 * HOUR,
    width: 1080,
    height: 720,
    image: { draw: "photo" },
  },
  {
    id: 124,
    contentType: "math",
    content: "(72 - 32) * 5 / 9",
    preview: "= 22.2222",
    sourceApp: "Notepad.exe",
    ago: 5 * DAY,
  },
  // ---- older
  {
    id: 125,
    contentType: "screenshot",
    content: "",
    preview: "",
    sourceApp: null,
    ago: 12 * DAY,
    width: 640,
    height: 360,
    image: { file: "f30.jpg" },
  },
  {
    id: 126,
    contentType: "video",
    content: `${VID_DIR}Recording 2026-11-10 11-05-52.mp4`,
    preview: "video: Recording 2026-11-10 11-05-52.mp4",
    sourceApp: null,
    ago: 14 * DAY,
    width: 1920,
    height: 1080,
  },
  {
    id: 127,
    contentType: "text",
    content: "1764000000",
    preview: "",
    sourceApp: "WindowsTerminal.exe",
    ago: 15 * DAY,
  },
  {
    id: 128,
    contentType: "image",
    content: "",
    preview: "",
    sourceApp: "Figma.exe",
    ago: 16 * DAY,
    width: 512,
    height: 512,
    image: { draw: "logo" },
  },
  {
    id: 129,
    contentType: "screenshot",
    content: "",
    preview: "",
    sourceApp: null,
    ago: 17 * DAY,
    width: 640,
    height: 360,
    image: { file: "f3.jpg" },
  },
  {
    id: 130,
    contentType: "text",
    content:
      "Release notes v1.7.0\n- Popup tabs: emoji, GIFs, kaomoji and symbols\n- Theme fixes and custom accent colours\n- Faster thumbnails for large vaults",
    preview: "",
    sourceApp: "Notion.exe",
    ago: 18 * DAY,
  },
];

let items: ClipboardItem[] = [];
let deleted = new Set<number>();

async function buildItems() {
  const out: ClipboardItem[] = [];
  for (const s of SEEDS) {
    if (scenario.noVideos && (s.contentType === "video" || s.contentType === "gif")) continue;
    const { ago, image, ...rest } = s;
    const item: ClipboardItem = {
      ...rest,
      isPinned: !!s.isPinned,
      createdAt: at(ago),
      preview: s.preview || (s.content ? s.content.trim().slice(0, 120) : ""),
    };
    if (image) {
      let source: CanvasImageSource;
      let w: number;
      let h: number;
      if (image.file) {
        const img = await loadImg(`/media/${image.file}`);
        source = img;
        w = img.naturalWidth;
        h = img.naturalHeight;
      } else {
        source = drawImage(image.draw!, s.width ?? 800, s.height ?? 600);
        w = s.width ?? 800;
        h = s.height ?? 600;
      }
      const full = image.file ? scaled(source, w, h, 4096) : (source as HTMLCanvasElement).toDataURL("image/png");
      media.set(s.id, { full, w, h, source });
      item.preview = scaled(source, w, h, 64);
      item.content = "";
    }
    out.push(item);
  }
  items = scenario.empty ? [] : out;
}

const ready = buildItems();

// ---- settings ------------------------------------------------------------------------------
let settings: AppSettings = {
  ...DEFAULT_SETTINGS,
  replayEnabled: true,
  replayHotkey: "Alt+Z",
  replaySeconds: 60,
  directPasteEnabled: true,
  ignoreList: ["KeePassXC.exe", "1Password.exe"],
  ...(scenario.settings ?? {}),
  uiPrefs: { ...DEFAULT_UI_PREFS, ...((scenario.settings?.uiPrefs as object) ?? {}), ...(scenario.uiPrefs ?? {}) },
} as AppSettings;
let paused = !!scenario.paused;

function visible() {
  return items.filter((i) => !deleted.has(i.id));
}

function sortItems(list: ClipboardItem[]) {
  return [...list].sort(
    (a, b) =>
      Number(b.isPinned) - Number(a.isPinned) ||
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

function matchesCategory(i: ClipboardItem, cat: string | null) {
  switch (cat) {
    case "text":
      return i.contentType === "text" || i.contentType === "translated";
    case "images":
      return i.contentType === "image";
    case "screenshots":
      return i.contentType === "screenshot";
    case "videos":
      return i.contentType === "video" || i.contentType === "gif";
    case "links":
      return i.contentType === "link";
    case "math":
      return i.contentType === "math";
    case "pinned":
      return i.isPinned;
    default:
      return true;
  }
}

function matchesQuery(i: ClipboardItem, q: string | null) {
  if (!q?.trim()) return true;
  const needle = q.trim().toLowerCase();
  const hay = `${i.contentType === "image" || i.contentType === "screenshot" ? "" : i.content} ${
    i.preview.startsWith("data:") ? "" : i.preview
  }`.toLowerCase();
  return hay.includes(needle);
}

/** Mirrors db.rs category_of_content_type: content types → sidebar tab ids. */
const CATEGORY_OF: Record<string, string> = {
  text: "text",
  translated: "text",
  image: "images",
  screenshot: "screenshots",
  video: "videos",
  gif: "videos",
  link: "links",
  math: "math",
};

/** Same shape as db.rs category_counts: one row per sidebar category, then pinned and all. */
function counts(): [string, number][] {
  const v = visible();
  const by = new Map<string, number>();
  for (const i of v) {
    const cat = CATEGORY_OF[i.contentType];
    if (cat) by.set(cat, (by.get(cat) ?? 0) + 1);
  }
  return [
    ...by.entries(),
    ["pinned", v.filter((i) => i.isPinned).length],
    ["all", v.length],
  ];
}

const GIFS = Array.from({ length: 8 }, (_, i) => ({
  id: `g${i + 1}`,
  slug: `reaction-${i + 1}`,
  title: ["Celebrate", "Typing fast", "Ship it", "Mind blown", "Nice", "Loading", "Thumbs up", "Coffee"][i],
  previewUrl: `/media/gif${i + 1}.jpg`,
  previewWidth: 320,
  previewHeight: 180,
  gifUrl: `/media/gif${i + 1}.jpg`,
}));

const replayStatus = () => ({
  enabled: settings.replayEnabled,
  running: settings.replayEnabled,
  saving: false,
  seconds: settings.replaySeconds,
  buffered: settings.replaySeconds,
  encoder: "h264_nvenc",
  source: "Display 1 · 2560×1440",
  error: null,
  ...(scenario.replay ?? {}),
});

const unknown: string[] = [];
const calls: string[] = [];

async function handle(cmd: string, args: any): Promise<unknown> {
  calls.push(cmd);
  await ready;
  switch (cmd) {
    case "list_items": {
      const list = visible().filter(
        (i) => matchesCategory(i, args?.category ?? null) && matchesQuery(i, args?.query ?? null)
      );
      return sortItems(list).slice(0, args?.limit ?? 200);
    }
    case "search_clipboard":
      return sortItems(visible().filter((i) => matchesQuery(i, args?.query ?? null))).slice(
        0,
        Math.max(5, Math.min(100, args?.limit ?? 30))
      );
    case "item_thumbnail": {
      const m = media.get(args.id);
      return m ? scaled(m.source, m.w, m.h, args.maxSize ?? 320) : null;
    }
    case "get_item": {
      const i = items.find((x) => x.id === args.id);
      if (!i) return null;
      const m = media.get(i.id);
      return m ? { ...i, content: m.full } : i;
    }
    case "category_counts":
      return counts();
    case "get_settings":
      return settings;
    case "update_settings":
      settings = { ...settings, ...(args?.settings ?? {}) };
      return settings;
    case "get_clipboard_paused":
      return paused;
    case "toggle_clipboard_paused":
      paused = !paused;
      return paused;
    case "is_vault_locked":
      return false;
    case "is_ocr_available":
      return true;
    case "get_running_apps":
      return ["Code.exe", "chrome.exe", "Slack.exe", "Figma.exe", "Spotify.exe", "explorer.exe"];
    case "list_theme_packs":
      return [];
    case "transform_options":
      return [
        { kind: "plainText", label: "Plain text", suggested: true },
        { kind: "trim", label: "Trim whitespace", suggested: false },
        { kind: "upper", label: "UPPERCASE", suggested: false },
      ];
    case "transform_preview":
      return "preview";
    case "toggle_pin": {
      const i = items.find((x) => x.id === args.id);
      if (i) i.isPinned = !i.isPinned;
      return i ?? null;
    }
    case "delete_item":
      deleted.add(args.id);
      return null;
    case "klipy_gifs":
      return { items: GIFS, page: 1, hasNext: false };
    case "replay_status":
      return replayStatus();
    case "app_status":
      // Mirrors status.rs: replay full (ready), no recording, clipboard paused per scenario.
      return {
        replay: { enabled: true, running: true, bufferedSecs: 60, targetSecs: 60, error: null, encoder: "NVIDIA NVENC" },
        recording: { state: "idle", elapsedMs: 0, format: null },
        clipboard: { paused },
      };
    case "paste_target_info":
      return { title: "Untitled - Notepad", exe: "notepad.exe", name: "Notepad" };
    case "recorder_bar_ready":
      return { region: { physX: 320, physY: 180, physW: 1280, physH: 720 }, format: "mp4", fps: 30 };
    case "start_region_recording":
      return null;
    case "pause_region_recording":
      return true;
    case "stop_region_recording":
      return `${VID_DIR}Recording 2026-11-24 19-00-00.mp4`;
    case "video_editor_ready":
      return {
        filePath: `${VID_DIR}SnipClip Replay 2026-11-24 14-02-11.mp4`,
        width: 1280,
        height: 720,
        vaultId: 104,
        isDraft: false,
      };
    // Side-effect commands the UI fires and ignores the answer of
    case "show_main_window":
    case "hide_main_window":
    case "close_snipper":
    case "hide_snipper":
    case "capture_screen_region":
    case "hide_command_palette":
    case "close_screenshot_popup":
    case "copy_item":
    case "paste_item":
      return null;
    // ---- plugins
    case "plugin:app|version":
      return "1.7.0";
    case "plugin:app|name":
      return "SnipClip";
    case "plugin:updater|check":
      return null;
    case "plugin:autostart|is_enabled":
      return false;
    case "plugin:window|scale_factor":
      return 1;
    case "plugin:window|outer_position":
    case "plugin:window|inner_position":
      return { x: 0, y: 0 };
    case "plugin:window|inner_size":
    case "plugin:window|outer_size":
      return { width: window.innerWidth, height: window.innerHeight };
    case "plugin:window|is_visible":
    case "plugin:window|is_focused":
      return true;
    case "plugin:window|is_maximized":
    case "plugin:window|is_minimized":
    case "plugin:window|is_fullscreen":
      return false;
    default:
      if (
        !cmd.startsWith("plugin:window|") &&
        !cmd.startsWith("plugin:event|") &&
        !cmd.startsWith("plugin:global-shortcut|")
      ) {
        unknown.push(cmd);
      }
      return null;
  }
}

mockIPC(handle, { shouldMockEvents: true });

window.__fx = {
  emit,
  ready,
  unknown,
  calls,
  items: () => visible(),
};
