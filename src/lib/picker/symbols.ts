/** Symbols for the popup's Ω tab. Big blocks come from code-point ranges; unassigned points are dropped. */

const UNASSIGNED = /\p{Cn}|\p{Cs}|\p{Co}|\p{Cf}|\p{Zl}|\p{Zp}/u;

function range(from: number, to: number, skip: number[] = []): string[] {
  const out: string[] = [];
  for (let cp = from; cp <= to; cp++) {
    if (skip.includes(cp)) continue;
    const ch = String.fromCodePoint(cp);
    if (!UNASSIGNED.test(ch)) out.push(ch);
  }
  return out;
}

const chars = (s: string) => Array.from(s.replace(/\s+/g, ""));

export const SYMBOL_GROUPS: { id: string; label: string; items: string[] }[] = [
  {
    id: "popular",
    label: "Popular",
    items: chars(
      "•·…–—‘’“”«»‹›°±×÷≈≠≤≥∞√∑∆µπΩ€£¥¢©®™§¶†‡№←→↑↓↔⇒✓✔✗✘★☆♥♡♪♫☀☁☂❄⚡"
    ),
  },
  {
    id: "punctuation",
    label: "Punctuation",
    items: [...chars("¡¿«»‹›„‚"), ...range(0x2010, 0x2027), ...range(0x2030, 0x205e)],
  },
  {
    id: "currency",
    label: "Currency",
    items: [...chars("$¢£¤¥"), ...range(0x20a0, 0x20c0)],
  },
  {
    id: "math",
    label: "Math",
    items: [
      ...chars("±×÷¬°¹²³⁴⁵⁶⁷⁸⁹⁰⁺⁻⁼⁽⁾ⁿ₀₁₂₃₄₅₆₇₈₉½⅓⅔¼¾⅛⅜⅝⅞"),
      ...range(0x2200, 0x22ff),
    ],
  },
  { id: "arrows", label: "Arrows", items: [...range(0x2190, 0x21ff), ...range(0x27f0, 0x27ff)] },
  {
    id: "greek",
    label: "Greek",
    items: [...range(0x0391, 0x03a9, [0x03a2]), ...range(0x03b1, 0x03c9)],
  },
  {
    id: "latin",
    label: "Latin",
    items: [...range(0x00c0, 0x00ff, [0x00d7, 0x00f7]), ...range(0x0100, 0x017f)],
  },
  { id: "shapes", label: "Shapes", items: [...range(0x25a0, 0x25ff), ...chars("✦✧✩✪✫✬✭✮✯✰")] },
  { id: "box", label: "Box drawing", items: [...range(0x2500, 0x257f), ...range(0x2580, 0x259f)] },
  { id: "misc", label: "Misc", items: [...range(0x2600, 0x266f), ...range(0x2700, 0x27bf)] },
];
