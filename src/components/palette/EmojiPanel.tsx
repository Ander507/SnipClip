import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MutableRefObject } from "react";
import clsx from "clsx";
import { Clock3 } from "lucide-react";
import type { PasteMode } from "../../lib/api";
import { EMOJI_GROUPS, SKIN_TONES, loadEmoji, withSkin, type EmojiEntry } from "../../lib/picker/emoji";
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

export type PanelKeyHandler = (e: KeyboardEvent) => boolean;

const TONE_KEY = "snipclip.picker.skinTone";
const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';

function loadTone(): number {
  try {
    const n = Number(localStorage.getItem(TONE_KEY));
    return n >= 0 && n <= 5 ? n : 0;
  } catch {
    return 0;
  }
}

interface Props {
  query: string;
  keyRef: MutableRefObject<PanelKeyHandler | null>;
  onInsert: (text: string, mode: PasteMode) => void;
}

/** 😊 tab — Windows-panel-style emoji grid with search, recents and skin tones. */
export function EmojiPanel({ query, keyRef, onInsert }: Props) {
  const [all, setAll] = useState<EmojiEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [tone, setTone] = useState(loadTone);
  const [toneOpen, setToneOpen] = useState(false);
  const [recents, setRecents] = useState(() => loadRecents<string>("emoji"));
  const [selected, setSelected] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadEmoji()
      .then(setAll)
      .catch((err) => {
        console.error(err);
        setFailed(true);
      });
  }, []);

  // Recents store the exact string (with tone), so map it back to a name for tooltips
  const labels = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of all ?? []) {
      map.set(e.emoji, e.label);
      e.skins?.forEach((s) => map.set(s, e.label));
    }
    return map;
  }, [all]);

  const sections = useMemo<PickerSection[]>(() => {
    if (!all) return [];
    const cell = (e: EmojiEntry): PickerCell => {
      const value = withSkin(e, tone);
      return { key: e.emoji, value, title: e.label };
    };
    const q = query.trim().toLowerCase();
    if (q) {
      const tokens = q.split(/\s+/);
      return [
        {
          id: "results",
          label: "Results",
          cells: all.filter((e) => tokens.every((t) => e.search.includes(t))).slice(0, 400).map(cell),
        },
      ];
    }
    return [
      {
        id: "recent",
        label: "Recently used",
        cells: recents.map((v) => ({ key: v, value: v, title: labels.get(v) ?? v })),
      },
      ...EMOJI_GROUPS.map((g) => ({
        id: `g${g.id}`,
        label: g.label,
        cells: all.filter((e) => e.group === g.id).map(cell),
      })),
    ];
  }, [all, query, tone, recents, labels]);

  const cells = useMemo(() => flatCells(sections), [sections]);

  useEffect(() => {
    setSelected(0);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [query]);

  function pick(cell: PickerCell | undefined, mode: PasteMode) {
    if (!cell) return;
    setRecents(pushRecent("emoji", cell.value));
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

  function chooseTone(n: number) {
    setTone(n);
    setToneOpen(false);
    try {
      localStorage.setItem(TONE_KEY, String(n));
    } catch {
      // ignore
    }
  }

  const current = cells[selected];

  return (
    <>
      {!query.trim() && (
        <CategoryBar
          scrollRef={scrollRef}
          items={[
            { id: "recent", label: "Recently used", icon: <Clock3 size={14} /> },
            ...EMOJI_GROUPS.map((g) => ({
              id: `g${g.id}`,
              label: g.label,
              icon: <span style={{ fontFamily: EMOJI_FONT }}>{g.icon}</span>,
            })),
          ]}
        />
      )}
      {failed ? (
        <p className="px-4 py-6 text-center text-[12px] text-danger">Couldn't load the emoji list.</p>
      ) : !all ? (
        <p className="px-4 py-6 text-center text-[12px] text-fg-muted">Loading emoji…</p>
      ) : (
        <PickerGrid
          sections={sections}
          selected={selected}
          onSelect={setSelected}
          onPick={(cell, e) => pick(cell, insertModeFor(e))}
          minCell={36}
          cellClassName="flex h-9 items-center justify-center text-[22px] leading-none"
          scrollRef={scrollRef}
          empty={<p className="px-1 py-6 text-center text-[12px] text-fg-muted">No emoji match.</p>}
        />
      )}
      <div className="relative flex shrink-0 items-center justify-between gap-2 border-t border-line px-3 py-1.5">
        <span className="min-w-0 truncate text-[11px] text-fg-muted">
          {current ? (
            <>
              <span style={{ fontFamily: EMOJI_FONT }}>{current.value}</span> {current.title}
            </>
          ) : (
            " "
          )}
        </span>
        <button
          type="button"
          onClick={() => setToneOpen((o) => !o)}
          title="Skin tone"
          aria-label="Skin tone"
          aria-expanded={toneOpen}
          className="rounded-md px-1.5 py-0.5 text-[16px] transition hover:bg-hover"
          style={{ fontFamily: EMOJI_FONT }}
        >
          {"✋" + SKIN_TONES[tone]}
        </button>
        {toneOpen && (
          <div className="absolute bottom-full right-2 mb-1 flex gap-0.5 rounded-lg border border-line-strong bg-raised p-1 shadow-xl">
            {SKIN_TONES.map((mod, n) => (
              <button
                key={n}
                type="button"
                onClick={() => chooseTone(n)}
                aria-label={n === 0 ? "Default skin tone" : `Skin tone ${n}`}
                className={clsx(
                  "rounded-md px-1 py-0.5 text-[18px] transition",
                  n === tone ? "bg-accent-soft ring-1 ring-accent" : "hover:bg-hover"
                )}
                style={{ fontFamily: EMOJI_FONT }}
              >
                {"✋" + mod}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export { EMOJI_FONT };
