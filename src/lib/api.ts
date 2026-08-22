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

export function updateVaultImage(
  id: number,
  dataUrl: string,
  width: number,
  height: number
): Promise<ClipboardItem> {
  return invoke("update_vault_image", { id, dataUrl, width, height });
}

export function listThemePacks(): Promise<import("./theme").ThemePack[]> {
  return invoke("list_theme_packs");
}

export function saveThemePack(
  pack: import("./theme").ThemePack
): Promise<import("./theme").ThemePack> {
  return invoke("save_theme_pack", { pack });
}

export function deleteThemePack(id: string): Promise<void> {
  return invoke("delete_theme_pack", { id });
}

export function exportThemePack(id: string): Promise<string> {
  return invoke("export_theme_pack", { id });
}

export function importThemePack(json: string): Promise<import("./theme").ThemePack> {
  return invoke("import_theme_pack", { json });
}

export function readImageAsDataUrl(path: string): Promise<string> {
  return invoke("read_image_as_data_url", { path });
}

export function writeTextFilePath(path: string, contents: string): Promise<void> {
  return invoke("write_text_file", { path, contents });
}

export function readTextFilePath(path: string): Promise<string> {
  return invoke("read_text_file", { path });
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

export function getClipboardPaused(): Promise<boolean> {
  return invoke("get_clipboard_paused");
}

export function toggleClipboardPaused(): Promise<boolean> {
  return invoke("toggle_clipboard_paused");
}

export function getRunningApps(): Promise<string[]> {
  return invoke("get_running_apps");
}

export function copyTextFromImage(id: number): Promise<string> {
  return invoke("copy_text_from_image", { id });
}

export function isOcrAvailable(): Promise<boolean> {
  return invoke("is_ocr_available");
}

export function formatHotkeyShort(accel: string): string {
  return accel
    .replace(/CommandOrControl/gi, "⌃")
    .replace(/Control/gi, "⌃")
    .replace(/Shift/gi, "⇧")
    .replace(/Alt/gi, "⌥")
    .replace(/\+/g, "");
}
