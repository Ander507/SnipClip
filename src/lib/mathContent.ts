/** Parse vault math rows — new `preview = "= result"` or legacy `"expr = result"` content. */
export function parseMathContent(
  content: string,
  preview: string
): { expression: string; result: string | null } {
  const body = (content || "").trim();
  const prev = (preview || "").trim();
  const fromPreview = prev.match(/^=\s*(.+)$/);
  if (fromPreview) {
    return {
      expression: body || prev,
      result: fromPreview[1].trim() || null,
    };
  }
  const legacy = body.match(/^(.+?)\s*=\s*(.+)$/);
  if (legacy) {
    return { expression: legacy[1].trim(), result: legacy[2].trim() };
  }
  return { expression: body || prev, result: null };
}
