import { invoke } from "@tauri-apps/api/core";
import type { AppSettings, CaptureResult, ClipboardItem } from "./types";

export function listItems(
  category?: string,
  query?: string,
  limit = 200
): Promise<ClipboardItem[]> {
  return invoke("list_items", {
    category: category === "all" ? null : category,
    query: query || null,
    limit,
  });
}

export function togglePin(id: number): Promise<boolean> {
  return invoke("toggle_pin", { id });
}

export function deleteItem(id: number): Promise<void> {
  return invoke("delete_item", { id });
}

export function clearHistory(): Promise<void> {
  return invoke("clear_history");
}

export function copyItem(id: number): Promise<void> {
  return invoke("copy_item", { id });
}

export function getItem(id: number): Promise<ClipboardItem | null> {
  return invoke("get_item", { id });
}

export function captureScreen(): Promise<CaptureResult> {
  return invoke("capture_screen");
}

export function captureScreenRegion(
  x: number,
  y: number,
  width: number,
  height: number
): Promise<CaptureResult> {
  return invoke("capture_screen_region", { x, y, width, height });
}

export function saveSnip(dataUrl: string, path: string): Promise<void> {
  return invoke("save_snip", { dataUrl, path });
}

export function copyImage(dataUrl: string): Promise<void> {
  return invoke("copy_image", { dataUrl });
}

export function saveSnipToVault(
  dataUrl: string,
  width: number,
  height: number
): Promise<ClipboardItem> {
  return invoke("save_snip_to_vault", { dataUrl, width, height });
}

export function hideMainWindow(): Promise<void> {
  return invoke("hide_main_window");
}

export function beginSnip(): Promise<void> {
  return invoke("begin_snip");
}

export function hideSnipper(): Promise<void> {
  return invoke("hide_snipper");
}

export function closeSnipper(): Promise<void> {
  return invoke("close_snipper");
}

export function getSettings(): Promise<AppSettings> {
  return invoke("get_settings");
}

export function updateSettings(settings: AppSettings): Promise<AppSettings> {
  return invoke("update_settings", { settings });
}

export function formatHotkeyShort(accel: string): string {
  return accel
    .replace(/CommandOrControl/gi, "⌃")
    .replace(/Control/gi, "⌃")
    .replace(/Shift/gi, "⇧")
    .replace(/Alt/gi, "⌥")
    .replace(/\+/g, "");
}
