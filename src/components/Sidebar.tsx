import clsx from "clsx";
import {
  LayoutGrid,
  Type,
  Image as ImageIcon,
  Link2,
  Pin,
  Camera,
  Settings,
  Aperture,
  Timer,
  Film,
  Calculator,
  PanelLeftClose,
  PanelLeftOpen,
  Star,
  Heart,
  Bookmark,
  Folder,
  Code2,
  FileText,
  Hash,
  Inbox,
  Sparkles,
  Zap,
} from "lucide-react";
import type { Category } from "../lib/types";

type IconType = typeof LayoutGrid;

const NAV: { id: Category; label: string; icon: IconType }[] = [
  { id: "all", label: "All", icon: LayoutGrid },
  { id: "text", label: "Text", icon: Type },
  { id: "images", label: "Images", icon: ImageIcon },
  { id: "screenshots", label: "Screenshots", icon: Aperture },
  { id: "videos", label: "Videos", icon: Film },
  { id: "math", label: "Math", icon: Calculator },
  { id: "links", label: "Links", icon: Link2 },
  { id: "pinned", label: "Pinned", icon: Pin },
];

/** Icons a library tab can be switched to (Settings → Library tabs). Keys are persisted. */
export const TAB_ICON_CHOICES: { key: string; icon: IconType }[] = [
  { key: "grid", icon: LayoutGrid },
  { key: "type", icon: Type },
  { key: "image", icon: ImageIcon },
  { key: "aperture", icon: Aperture },
  { key: "film", icon: Film },
  { key: "calculator", icon: Calculator },
  { key: "link", icon: Link2 },
  { key: "pin", icon: Pin },
  { key: "star", icon: Star },
  { key: "heart", icon: Heart },
  { key: "bookmark", icon: Bookmark },
  { key: "folder", icon: Folder },
  { key: "code", icon: Code2 },
  { key: "file", icon: FileText },
  { key: "hash", icon: Hash },
  { key: "inbox", icon: Inbox },
  { key: "sparkles", icon: Sparkles },
  { key: "zap", icon: Zap },
];

export const LIBRARY_TABS = NAV;

export function tabIcon(id: string, iconKey: string | undefined): IconType {
  const custom = iconKey ? TAB_ICON_CHOICES.find((c) => c.key === iconKey)?.icon : undefined;
  return custom ?? NAV.find((n) => n.id === id)?.icon ?? LayoutGrid;
}

interface Props {
  category: Category;
  onCategory: (c: Category) => void;
  onSnip: () => void;
  onDelayedSnip: () => void;
  onSettings: () => void;
  settingsOpen: boolean;
  counts: Record<string, number>;
  /** Ordered visible tab ids from settings. Empty → show all NAV tabs. */
  sidebarTabs?: string[];
  snipHotkeyLabel: string;
  snipDelayEnabled: boolean;
  position: "left" | "right";
  collapsed: boolean;
  onToggleCollapsed: () => void;
  tabColors: Record<string, string>;
  tabIcons: Record<string, string>;
}

export function Sidebar({
  category,
  onCategory,
  onSnip,
  onDelayedSnip,
  onSettings,
  settingsOpen,
  counts,
  sidebarTabs,
  snipHotkeyLabel,
  snipDelayEnabled,
  position,
  collapsed,
  onToggleCollapsed,
  tabColors,
  tabIcons,
}: Props) {
  const order =
    sidebarTabs && sidebarTabs.length > 0
      ? sidebarTabs
      : NAV.map((n) => n.id);
  const tabs = order
    .map((id) => NAV.find((n) => n.id === id))
    .filter((n): n is (typeof NAV)[number] => Boolean(n));

  const itemClass = (active: boolean, hoverAccent = false) =>
    clsx(
      "flex w-full items-center rounded-md text-[13px] transition",
      collapsed ? "justify-center px-0 py-2" : "gap-2.5 px-2.5 py-2 text-left",
      active
        ? "bg-hover text-fg"
        : clsx("text-fg-muted hover:bg-muted", hoverAccent ? "hover:text-accent" : "hover:text-fg")
    );

  // Mirrored below when the sidebar sits on the right
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <aside
      className={clsx(
        "flex shrink-0 flex-col justify-between border-line bg-raised p-3 transition-[width]",
        collapsed ? "w-[60px]" : "w-52",
        position === "left" ? "border-r" : "border-l"
      )}
    >
      <nav className="flex flex-col gap-0.5">
        <div className={clsx("mb-2 flex items-center", collapsed ? "justify-center" : "justify-between px-2")}>
          {!collapsed && (
            <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">Library</p>
          )}
          <button
            type="button"
            onClick={onToggleCollapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="rounded p-1 text-fg-faint transition hover:bg-muted hover:text-fg"
          >
            <ToggleIcon size={13} className={position === "right" ? "-scale-x-100" : undefined} />
          </button>
        </div>
        {tabs.map(({ id, label }) => {
          const active = !settingsOpen && category === id;
          const n = counts[id] ?? 0;
          const Icon = tabIcon(id, tabIcons[id]);
          const color = tabColors[id];
          return (
            <button
              key={id}
              type="button"
              onClick={() => onCategory(id)}
              title={collapsed ? `${label}${n > 0 ? ` · ${n}` : ""}` : undefined}
              aria-label={collapsed ? label : undefined}
              className={clsx(itemClass(active), "relative")}
            >
              <Icon size={15} style={color ? { color } : undefined} />
              {!collapsed && <span>{label}</span>}
              {n > 0 &&
                (collapsed ? (
                  active && (
                    <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-accent" />
                  )
                ) : (
                  <span
                    className={clsx(
                      "ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                      active ? "bg-accent text-accent-fg" : "bg-muted text-fg-muted"
                    )}
                  >
                    {n}
                  </span>
                ))}
            </button>
          );
        })}
      </nav>

      <div className="space-y-0.5 border-t border-line pt-3">
        <button
          type="button"
          onClick={onSnip}
          title={collapsed ? `Snip (${snipHotkeyLabel})` : undefined}
          aria-label={collapsed ? "Snip" : undefined}
          className={itemClass(false)}
        >
          <Camera size={15} />
          {!collapsed && (
            <>
              <span>{snipDelayEnabled ? "Snip (delayed)" : "Snip"}</span>
              <kbd className="ml-auto rounded bg-hover px-1.5 py-0.5 text-[9px] text-fg-muted">
                {snipHotkeyLabel}
              </kbd>
            </>
          )}
        </button>
        <button
          type="button"
          onClick={onDelayedSnip}
          className={itemClass(false, true)}
          aria-label={collapsed ? "Snip in 3 seconds" : undefined}
          title="Wait 3 seconds, then snip — no keyboard near the target app"
        >
          <Timer size={15} />
          {!collapsed && <span>Snip in 3s</span>}
        </button>
        <button
          type="button"
          onClick={onSettings}
          title={collapsed ? "Settings" : undefined}
          aria-label={collapsed ? "Settings" : undefined}
          className={itemClass(settingsOpen)}
        >
          <Settings size={15} />
          {!collapsed && <span>Settings</span>}
        </button>
      </div>
    </aside>
  );
}
