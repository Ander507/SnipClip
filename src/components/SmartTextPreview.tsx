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
}

export function SmartTextPreview({ text, compact = false }: Props) {
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

  return (
    <p className="truncate text-xs font-medium text-fg-secondary">{text}</p>
  );
}
