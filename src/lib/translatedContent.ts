/** Split auto-translate vault content into translation + original. */
export function parseTranslatedContent(content: string): {
  translated: string;
  original: string | null;
} {
  const marker = "\n\n——— original ———\n";
  const idx = content.indexOf(marker);
  if (idx < 0) {
    return { translated: content.trim(), original: null };
  }
  return {
    translated: content.slice(0, idx).trim(),
    original: content.slice(idx + marker.length).trim() || null,
  };
}
