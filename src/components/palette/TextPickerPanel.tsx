import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Clock3 } from "lucide-react";
import type { PasteMode } from "../../lib/api";
import { loadRecents, pushRecent } from "../../lib/picker/recents";
import {
  CategoryBar,
  PickerGrid,
  flatCells,
  gridKey,
  insertModeFor,
  type PickerCell,
  type PickerSection,
} from "./PickerGrid";
import type { PanelKeyHandler } from "./EmojiPanel";

interface Props {
  /** Recents bucket + labels. */
  kind: "kaomoji" | "symbols";
  groups: { id: string; label: string; items: string[] }[];
  query: string;
  keyRef: MutableRefObject<PanelKeyHandler | null>;
  onInsert: (text: string, mode: PasteMode) => void;
}

/** ;-) and Ω tabs — kaomoji / symbol grids with category shortcuts and recents. */
export function TextPickerPanel({ kind, groups, query, keyRef, onInsert }: Props) {
  const [recents, setRecents] = useState(() => loadRecents<string>(kind));
  const [selected, setSelected] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const wide = kind === "kaomoji";

  const sections = useMemo<PickerSection[]>(() => {
    const toCells = (items: string[], prefix: string): PickerCell[] =>
      items.map((v) => ({ key: `${prefix}${v}`, value: v, title: v }));
    const q = query.trim().toLowerCase();
    if (q) {
      return groups
        .map((g) => ({
          id: g.id,
          label: g.label,
          cells: toCells(
            g.label.toLowerCase().includes(q) ? g.items : g.items.filter((v) => v.toLowerCase().includes(q)),
            g.id
          ),
        }))
        .filter((s) => s.cells.length > 0);
    }
    return [
      { id: "recent", label: "Recently used", cells: toCells(recents, "r") },
      ...groups.map((g) => ({ id: g.id, label: g.label, cells: toCells(g.items, g.id) })),
    ];
  }, [groups, query, recents]);

  const cells = useMemo(() => flatCells(sections), [sections]);

  useEffect(() => {
    setSelected(0);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [query]);

  function pick(cell: PickerCell | undefined, mode: PasteMode) {
    if (!cell) return;
    setRecents(pushRecent(kind, cell.value));
    onInsert(cell.value, mode);
  }

  keyRef.current = (e) => {
    const next = gridKey(e.key, scrollRef.current, selected, cells.length);
    if (next !== null) {
      setSelected(next);
      return true;
    }
    if (e.key === "Enter") {
      pick(cells[selected], insertModeFor(e));
      return true;
    }
    return false;
  };

  return (
    <>
      {!query.trim() && (
        <CategoryBar
          scrollRef={scrollRef}
          items={[
            { id: "recent", label: "Recently used", icon: <Clock3 size={14} /> },
            ...groups.map((g) => ({
              id: g.id,
              label: g.label,
              icon: <span className="whitespace-nowrap text-[11px]">{g.label}</span>,
            })),
          ]}
        />
      )}
      <PickerGrid
        sections={sections}
        selected={selected}
        onSelect={setSelected}
        onPick={(cell, e) => pick(cell, insertModeFor(e))}
        minCell={wide ? 104 : 34}
        cellClassName={
          wide
            ? "h-9 truncate px-1.5 text-[12.5px] text-fg-secondary"
            : "flex h-9 items-center justify-center text-[17px] text-fg-secondary"
        }
        scrollRef={scrollRef}
        empty={<p className="px-1 py-6 text-center text-[12px] text-fg-muted">Nothing matches.</p>}
      />
    </>
  );
}
