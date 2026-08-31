import { format } from "date-fns";

// adding regex detection to render color swatches, json trees, and dates so data is instantly readable

const HEX_COLOR_RE = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;
const UNIX_TS_RE = /^\d{10}$/;

export function isHexColor(text: string): boolean {
  return HEX_COLOR_RE.test(text.trim());
}

export function parseJsonPayload(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

export function isJsonPayload(text: string): boolean {
  return parseJsonPayload(text) !== null;
}

export function isUnixTimestamp(text: string): boolean {
  const trimmed = text.trim();
  if (!UNIX_TS_RE.test(trimmed)) return false;
  const seconds = Number(trimmed);
  return seconds >= 1_000_000_000 && seconds <= 4_102_444_800;
}

export function formatUnixTimestamp(text: string): string {
  const seconds = Number(text.trim());
  return format(new Date(seconds * 1000), "PPpp");
}

export type SmartContentKind = "hex" | "json" | "timestamp" | "plain";

export function detectSmartContent(text: string): SmartContentKind {
  const trimmed = text.trim();
  if (!trimmed) return "plain";
  if (isHexColor(trimmed)) return "hex";
  if (isJsonPayload(trimmed)) return "json";
  if (isUnixTimestamp(trimmed)) return "timestamp";
  return "plain";
}
