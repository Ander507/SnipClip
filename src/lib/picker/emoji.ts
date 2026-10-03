/** Emoji catalogue for the popup's 😊 tab, from emojibase-data (loaded on first use). */

export interface EmojiEntry {
  emoji: string;
  label: string;
  /** Lower-cased label + tags, for search. */
  search: string;
  group: number;
  /** Skin-tone variants, index = tone − 1 (light … dark). */
  skins?: string[];
}

export const EMOJI_GROUPS: { id: number; label: string; icon: string }[] = [
  { id: 0, label: "Smileys & emotion", icon: "😀" },
  { id: 1, label: "People & body", icon: "👋" },
  { id: 3, label: "Animals & nature", icon: "🐻" },
  { id: 4, label: "Food & drink", icon: "🍔" },
  { id: 5, label: "Travel & places", icon: "🚗" },
  { id: 6, label: "Activities", icon: "⚽" },
  { id: 7, label: "Objects", icon: "💡" },
  { id: 8, label: "Symbols", icon: "❤️" },
  { id: 9, label: "Flags", icon: "🏁" },
];

export const SKIN_TONES = ["", "🏻", "🏼", "🏽", "🏾", "🏿"] as const;

interface RawEmoji {
  emoji: string;
  label: string;
  tags?: string[];
  group?: number;
  order?: number;
  version: number;
  skins?: { emoji: string; tone?: number | number[] }[];
}

// Segoe UI Emoji on current Windows 11 draws up to Emoji 15.0 — newer ones would show as boxes
const MAX_VERSION = 15;

let catalogue: Promise<EmojiEntry[]> | null = null;

export function loadEmoji(): Promise<EmojiEntry[]> {
  catalogue ??= import("emojibase-data/en/data.json").then((mod) => {
    const raw = (mod.default ?? mod) as unknown as RawEmoji[];
    return raw
      .filter((e) => e.group !== undefined && e.group !== 2 && e.version <= MAX_VERSION)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((e) => {
        const skins = e.skins
          ?.filter((s) => typeof s.tone === "number")
          .sort((a, b) => (a.tone as number) - (b.tone as number))
          .map((s) => s.emoji);
        return {
          emoji: e.emoji,
          label: e.label,
          search: [e.label, ...(e.tags ?? [])].join(" ").toLowerCase(),
          group: e.group as number,
          skins: skins && skins.length === 5 ? skins : undefined,
        };
      });
  });
  return catalogue;
}

export function withSkin(entry: EmojiEntry, tone: number): string {
  return tone > 0 && entry.skins ? entry.skins[tone - 1] : entry.emoji;
}
