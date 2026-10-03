import {
  useEffect,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  type WheelEvent,
} from "react";
import clsx from "clsx";

export interface PickerCell {
  key: string;
  /** What gets typed / pasted. */
  value: string;
  title: string;
  display?: ReactNode;
}

export interface PickerSection {
  id: string;
  label: string;
  cells: PickerCell[];
}

export function flatCells(sections: PickerSection[]): PickerCell[] {
  return sections.flatMap((s) => s.cells);
}

/**
 * Index of the closest cell in the next row up/down, by on-screen position — works across
 * sections whose last rows are only partly filled, where index ± columns would not.
 */
export function neighborIndex(
  container: HTMLElement | null,
  current: number,
  dir: "up" | "down"
): number | null {
  if (!container) return null;
  const nodes = Array.from(container.querySelectorAll<HTMLElement>("[data-pick-index]"));
  const cur = nodes.find((n) => Number(n.dataset.pickIndex) === current);
  if (!cur) return nodes.length ? 0 : null;
  const r = cur.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  let best: { i: number; dy: number; dx: number } | null = null;
  for (const n of nodes) {
    const nr = n.getBoundingClientRect();
    const dy = dir === "down" ? nr.top - r.bottom : r.top - nr.bottom;
    if (dy < -2) continue;
    const dx = Math.abs(nr.left + nr.width / 2 - cx);
    if (!best || dy < best.dy - 2 || (Math.abs(dy - best.dy) <= 2 && dx < best.dx)) {
      best = { i: Number(n.dataset.pickIndex), dy, dx };
    }
  }
  return best?.i ?? null;
}

/** Arrow keys / Home / End over a picker grid. Returns the new index, or null if not handled. */
export function gridKey(
  key: string,
  container: HTMLElement | null,
  current: number,
  count: number
): number | null {
  if (count === 0) return null;
  switch (key) {
    case "ArrowRight":
      return Math.min(current + 1, count - 1);
    case "ArrowLeft":
      return Math.max(current - 1, 0);
    case "ArrowDown":
      return neighborIndex(container, current, "down") ?? current;
    case "ArrowUp":
      return neighborIndex(container, current, "up") ?? current;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={clsx(
        "px-1 text-[10px] font-medium uppercase tracking-wider text-fg-faint",
        className
      )}
    >
      {children}
    </p>
  );
}

interface Props {
  sections: PickerSection[];
  selected: number;
  onSelect: (index: number) => void;
  onPick: (cell: PickerCell, e: MouseEvent) => void;
  /** Minimum cell width in px. */
  minCell: number;
  cellClassName: string;
  scrollRef: RefObject<HTMLDivElement | null>;
  empty?: ReactNode;
}

/** Sectioned grid of pickable cells (emoji, kaomoji, symbols). */
export function PickerGrid({
  sections,
  selected,
  onSelect,
  onPick,
  minCell,
  cellClassName,
  scrollRef,
  empty,
}: Props) {
  useEffect(() => {
    scrollRef.current
      ?.querySelector(`[data-pick-index="${selected}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected, scrollRef]);

  const visible = sections.filter((s) => s.cells.length > 0);
  let index = 0;
  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
      {visible.length === 0 && empty}
      {visible.map((section) => (
        <section key={section.id} data-section={section.id} className="pt-2.5">
          <SectionLabel>{section.label}</SectionLabel>
          <div
            className="mt-1.5 grid gap-1"
            style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${minCell}px, 1fr))` }}
          >
            {section.cells.map((cell) => {
              const i = index++;
              return (
                <button
                  key={`${section.id}:${cell.key}`}
                  type="button"
                  data-pick-index={i}
                  title={cell.title}
                  aria-label={cell.title}
                  onMouseEnter={() => onSelect(i)}
                  onClick={(e) => onPick(cell, e)}
                  className={clsx(
                    "rounded-md border transition",
                    cellClassName,
                    i === selected
                      ? "border-line-strong bg-hover"
                      : "border-transparent hover:bg-hover"
                  )}
                >
                  {cell.display ?? cell.value}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

/** Horizontal row of category shortcuts that scroll the grid to a section. */
export function CategoryBar({
  items,
  scrollRef,
}: {
  items: { id: string; label: string; icon: ReactNode }[];
  scrollRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      className="no-scrollbar flex shrink-0 gap-0.5 overflow-x-auto border-b border-line px-2 py-1"
      onWheel={wheelToHorizontal}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          title={item.label}
          aria-label={item.label}
          onClick={() =>
            scrollRef.current
              ?.querySelector(`[data-section="${item.id}"]`)
              ?.scrollIntoView({ block: "start", behavior: "smooth" })
          }
          className="flex h-7 min-w-7 shrink-0 items-center justify-center rounded-md px-1.5 text-[13px] text-fg-muted transition hover:bg-hover hover:text-fg"
        >
          {item.icon}
        </button>
      ))}
    </div>
  );
}

/**
 * Enter = paste (lands in the previous app *and* stays on the clipboard), Shift+Enter = type it
 * out without touching the clipboard, Ctrl+Enter = copy only.
 */
export function insertModeFor(e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) {
  if (e.ctrlKey || e.metaKey) return "copyOnly" as const;
  if (e.shiftKey) return "typeOut" as const;
  return "paste" as const;
}

/** Vertical mouse wheel scrolls a horizontal strip (category bars, GIF chips). */
export function wheelToHorizontal(e: WheelEvent<HTMLElement>) {
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
}
