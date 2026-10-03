import { JsonView, collapseAllNested } from "react-json-view-lite";
import "react-json-view-lite/dist/index.css";
import {
  detectSmartContent,
  formatUnixTimestamp,
  parseJsonPayload,
} from "../lib/contentDetect";

interface Props {
  text: string;
  compact?: boolean;
  /** Plain text wraps onto up to this many lines (keeping line breaks); 1 = single truncated line. */
  lines?: 1 | 2 | 3;
}

const LINE_CLAMP = { 2: "line-clamp-2", 3: "line-clamp-3" } as const;

export function SmartTextPreview({ text, compact = false, lines = 1 }: Props) {
  const trimmed = text.trim();
  const kind = detectSmartContent(trimmed);

  if (kind === "hex") {
    return (
      <div className="flex items-center gap-2">
        <span
          className="h-6 w-6 shrink-0 rounded-md border border-line shadow-inner"
          style={{ backgroundColor: trimmed }}
          title={trimmed}
        />
        <span className="truncate font-mono text-xs font-medium text-fg-secondary">{trimmed}</span>
      </div>
    );
  }

  if (kind === "json") {
    const data = parseJsonPayload(trimmed);
    if (data === null || typeof data !== "object") {
      return (
        <p className="truncate text-xs font-medium text-fg-secondary">{text}</p>
      );
    }
    return (
      <div
        className={`max-w-full overflow-hidden rounded-md border border-line bg-inset text-[11px] text-fg-secondary ${
          compact ? "max-h-28" : "max-h-40"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <JsonView
          data={data as Record<string, unknown> | unknown[]}
          shouldExpandNode={collapseAllNested}
        />
      </div>
    );
  }

  if (kind === "timestamp") {
    return (
      <div>
        <p className="truncate font-mono text-xs font-medium text-fg-secondary">{trimmed}</p>
        <p className="mt-0.5 text-[11px] text-fg-muted">{formatUnixTimestamp(trimmed)}</p>
      </div>
    );
  }

  if (lines !== 1) {
    return (
      <p
        className={`whitespace-pre-wrap break-words text-xs font-medium text-fg-secondary ${
          LINE_CLAMP[lines]
        }`}
      >
        {trimmed}
      </p>
    );
  }

  return (
    <p className="truncate text-xs font-medium text-fg-secondary">{text}</p>
  );
}
