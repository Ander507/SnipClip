/** Strip trailing punctuation often glued to URLs in prose or markdown. */
function stripTrailingUrlPunctuation(raw: string): string {
  let s = raw;
  const trailing = /[.,;:!?)}\]'"]+$/;
  while (trailing.test(s)) {
    s = s.replace(trailing, "");
  }
  return s;
}

/** Pull the first http(s) or www URL out of clipboard text. */
function extractUrlCandidate(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const markdown = trimmed.match(/\[[^\]]*\]\((https?:\/\/[^)\s]+|www\.[^)\s]+)\)/i);
  if (markdown?.[1]) return stripTrailingUrlPunctuation(markdown[1]);

  const http = trimmed.match(/https?:\/\/[^\s<>"']+/i);
  if (http?.[0]) return stripTrailingUrlPunctuation(http[0]);

  const www = trimmed.match(/www\.[^\s<>"']+/i);
  if (www?.[0]) return stripTrailingUrlPunctuation(www[0]);

  if (/^https?:\/\//i.test(trimmed)) {
    return stripTrailingUrlPunctuation(trimmed.split(/\s/)[0] ?? trimmed);
  }
  if (trimmed.startsWith("www.")) {
    return stripTrailingUrlPunctuation(trimmed.split(/\s/)[0] ?? trimmed);
  }

  return null;
}

/** Normalize clipboard text into a browser-ready href, or null if it isn't a link. */
export function linkHrefFromText(text: string): string | null {
  const candidate = extractUrlCandidate(text);
  if (!candidate) return null;

  const href = candidate.startsWith("www.")
    ? `https://${candidate}`
    : candidate;

  try {
    return new URL(href).href;
  } catch {
    return null;
  }
}

export function isLinkItem(contentType: string, content: string): boolean {
  if (contentType === "link") return true;
  return linkHrefFromText(content) != null;
}

export function displayUrl(text: string): string {
  const href = linkHrefFromText(text);
  if (href) {
    try {
      const u = new URL(href);
      const path = u.pathname === "/" ? "" : u.pathname;
      return u.hostname + path;
    } catch {
      return text.trim().slice(0, 120);
    }
  }
  return text.trim().slice(0, 120);
}
