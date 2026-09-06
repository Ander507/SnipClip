import clsx from "clsx";
import {
  LayoutGrid,
  Type,
  Image as ImageIcon,
  Link2,
  Pin,
  Trash2,
  Camera,
  Settings,
  Aperture,
  Timer,
  Film,
  Calculator,
} from "lucide-react";
import type { Category } from "../lib/types";

const NAV: { id: Category; label: string; icon: typeof LayoutGrid }[] = [
  { id: "all", label: "All", icon: LayoutGrid },
  { id: "text", label: "Text", icon: Type },
  { id: "images", label: "Images", icon: ImageIcon },
  { id: "screenshots", label: "Screenshots", icon: Aperture },
  { id: "videos", label: "Videos", icon: Film },
  { id: "math", label: "Math", icon: Calculator },
  { id: "links", label: "Links", icon: Link2 },
  { id: "pinned", label: "Pinned", icon: Pin },
];

interface Props {
  category: Category;
  onCategory: (c: Category) => void;
  onSnip: () => void;
  onDelayedSnip: () => void;
  onClear: () => void;
  onSettings: () => void;
  settingsOpen: boolean;
  count: number;
  counts: Record<string, number>;
  /** Ordered visible tab ids from settings. Empty → show all NAV tabs. */
  sidebarTabs?: string[];
  snipHotkeyLabel: string;
  snipDelayEnabled: boolean;
}

export function Sidebar({
  category,
  onCategory,
  onSnip,
  onDelayedSnip,
  onClear,
  onSettings,
  settingsOpen,
  count,
  counts,
  sidebarTabs,
  snipHotkeyLabel,
  snipDelayEnabled,
}: Props) {
  const order =
    sidebarTabs && sidebarTabs.length > 0
      ? sidebarTabs
      : NAV.map((n) => n.id);

  const tabs = order
    .map((id) => NAV.find((n) => n.id === id))
    .filter((n): n is (typeof NAV)[number] => Boolean(n));

  return (
    <aside className="flex w-52 shrink-0 flex-col justify-between border-r border-line bg-raised p-3">
      <nav className="flex flex-col gap-0.5">
        <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
          Library
        </p>
        {tabs.map(({ id, label, icon: Icon }) => {
          const active = !settingsOpen && category === id;
          const n = counts[id] ?? 0;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onCategory(id)}
              className={clsx(
                "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] transition",
                active
                  ? "bg-hover text-fg"
                  : "text-fg-muted hover:bg-muted hover:text-fg"
              )}
            >
              <Icon size={15} />
              <span>{label}</span>
              {n > 0 && (
                <span
                  className={clsx(
                    "ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                    active ? "bg-accent text-accent-fg" : "bg-muted text-fg-muted"
                  )}
                >
                  {n}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="space-y-0.5 border-t border-line pt-3">
        <button
          type="button"
          onClick={onSnip}
          className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-fg-muted transition hover:bg-muted hover:text-fg"
        >
          <Camera size={15} />
          <span>{snipDelayEnabled ? "Snip (delayed)" : "Snip"}</span>
          <kbd className="ml-auto rounded bg-hover px-1.5 py-0.5 text-[9px] text-fg-muted">
            {snipHotkeyLabel}
          </kbd>
        </button>
        <button
          type="button"
          onClick={onDelayedSnip}
          className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-fg-muted transition hover:bg-muted hover:text-accent"
          title="Wait 3 seconds, then snip — no keyboard near the target app"
        >
          <Timer size={15} />
          <span>Snip in 3s</span>
        </button>
        <button
          type="button"
          onClick={onSettings}
          className={clsx(
            "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition",
            settingsOpen
              ? "bg-hover text-fg"
              : "text-fg-muted hover:bg-muted hover:text-fg"
          )}
        >
          <Settings size={15} />
          <span>Settings</span>
        </button>
        <button
          type="button"
          onClick={onClear}
          className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-fg-muted transition hover:bg-muted hover:text-danger"
        >
          <Trash2 size={15} />
          <span>Clear history</span>
          {count > 0 && (
            <span className="ml-auto text-[10px] text-fg-faint">{count}</span>
          )}
        </button>
      </div>
    </aside>
  );
}
