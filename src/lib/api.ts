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

export function searchClipboard(query: string): Promise<ClipboardItem[]> {
  return invoke("search_clipboard", { query });
}

export function paletteCopyItem(id: number): Promise<void> {
  return invoke("palette_copy_item", { id });
}

export function hideCommandPalette(): Promise<void> {
  return invoke("hide_command_palette");
}

export function showCommandPalette(): Promise<void> {
  return invoke("show_command_palette");
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

export function openUrl(url: string): Promise<void> {
  return invoke("open_url", { url });
}

export function updateClipboardItem(id: number, content: string): Promise<ClipboardItem> {
  return invoke("update_clipboard_item", { id, content });
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

export function captureRegionOcr(
  x: number,
  y: number,
  width: number,
  height: number
): Promise<{ text: string; lineCount: number }> {
  return invoke("capture_region_ocr", { x, y, width, height });
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

export function showMainWindow(): Promise<void> {
  return invoke("show_main_window");
}

export function beginSnip(mode?: "snip" | "record"): Promise<void> {
  return invoke("begin_snip", { mode: mode ?? null });
}

export function beginRecord(): Promise<void> {
  return beginSnip("record");
}

export function delayedSnip(delayMs: number): Promise<void> {
  return invoke("delayed_snip", { delayMs });
}

export function hideSnipper(): Promise<void> {
  return invoke("hide_snipper");
}

export function closeSnipper(restoreMain = false): Promise<void> {
  return invoke("close_snipper", { restoreMain });
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

export function getCategoryCounts(): Promise<Record<string, number>> {
  return invoke("category_counts").then((rows) => {
    const out: Record<string, number> = {};
    if (Array.isArray(rows)) {
      for (const [k, v] of rows as [string, number][]) out[k] = v;
    }
    return out;
  });
}

export async function exportVault(path: string): Promise<void> {
  return invoke("export_vault", { path });
}

export async function importVault(path: string): Promise<void> {
  return invoke("import_vault", { path });
}

export async function setVaultPassword(password: string): Promise<void> {
  return invoke("set_vault_password", { password });
}

export async function unlockVault(password: string): Promise<void> {
  return invoke("unlock_vault", { password });
}

export function isVaultLocked(): Promise<boolean> {
  return invoke("is_vault_locked");
}

export function copyTextFromImage(id: number): Promise<string> {
  return invoke("copy_text_from_image", { id });
}

export function extractTextFromImage(imagePath: string): Promise<string> {
  return invoke("extract_text_from_image", { imagePath });
}

export function isOcrAvailable(): Promise<boolean> {
  return invoke("is_ocr_available");
}

export function runOcr(dataUrl: string): Promise<string> {
  return invoke("run_ocr", { dataUrl });
}

export function copyText(text: string): Promise<void> {
  return invoke("copy_text", { text });
}

export interface FinalizeScreenshotResult {
  vaultId: number;
  width: number;
  height: number;
  item: ClipboardItem;
}

export function finalizeScreenshot(
  dataUrl: string,
  width: number,
  height: number
): Promise<FinalizeScreenshotResult> {
  return invoke("finalize_screenshot", { dataUrl, width, height });
}

export function closeScreenshotPopup(): Promise<void> {
  return invoke("close_screenshot_popup");
}

export interface RecordRegion {
  physX: number;
  physY: number;
  physW: number;
  physH: number;
}

export function startRegionRecording(
  x: number,
  y: number,
  width: number,
  height: number,
  fps: number,
  format: string,
  systemAudio = false
): Promise<void> {
  return invoke("start_region_recording", {
    x,
    y,
    width,
    height,
    fps,
    format,
    systemAudio,
  });
}

export function pauseRegionRecording(): Promise<boolean> {
  return invoke("pause_region_recording");
}

export function stopRegionRecording(): Promise<string> {
  return invoke("stop_region_recording");
}

export interface FinalizeRecordingResult {
  vaultId: number;
  filePath: string;
  width: number;
  height: number;
  item: ClipboardItem;
}

export function finalizeRecording(
  filePath: string,
  format: string,
  width: number,
  height: number
): Promise<FinalizeRecordingResult> {
  return invoke("finalize_recording", { filePath, format, width, height });
}

export interface CropParams {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VideoEditorPayload {
  filePath: string;
  width: number;
  height: number;
  vaultId?: number | null;
  isDraft?: boolean;
}

export function processVideoClip(args: {
  inputPath: string;
  outputFormat: string;
  startSec: number;
  endSec: number;
  crop?: CropParams | null;
  muteAudio: boolean;
}): Promise<string> {
  return invoke("process_video_clip", {
    inputPath: args.inputPath,
    outputFormat: args.outputFormat,
    startSec: args.startSec,
    endSec: args.endSec,
    crop: args.crop ?? null,
    muteAudio: args.muteAudio,
  });
}

export function saveProcessedRecording(args: {
  filePath: string;
  outputFormat: string;
  width: number;
  height: number;
  vaultId?: number | null;
  discardInput?: string | null;
}): Promise<FinalizeRecordingResult> {
  return invoke("save_processed_recording", {
    filePath: args.filePath,
    outputFormat: args.outputFormat,
    width: args.width,
    height: args.height,
    vaultId: args.vaultId ?? null,
    discardInput: args.discardInput ?? null,
  });
}

export function discardRecording(filePath: string, vaultId?: number | null): Promise<void> {
  return invoke("discard_recording", { filePath, vaultId: vaultId ?? null });
}

export function openVideoEditor(args: {
  filePath: string;
  width?: number;
  height?: number;
  vaultId?: number | null;
}): Promise<void> {
  return invoke("open_video_editor", {
    filePath: args.filePath,
    width: args.width ?? null,
    height: args.height ?? null,
    vaultId: args.vaultId ?? null,
  });
}

export function videoEditorReady(): Promise<VideoEditorPayload | null> {
  return invoke("video_editor_ready");
}

export function closeVideoEditor(): Promise<void> {
  return invoke("close_video_editor");
}

export function showRecorderBar(args: {
  screenX: number;
  screenY: number;
  region: RecordRegion;
  format?: string;
  fps?: number;
}): Promise<void> {
  return invoke("show_recorder_bar", {
    screenX: args.screenX,
    screenY: args.screenY,
    region: {
      physX: args.region.physX,
      physY: args.region.physY,
      physW: args.region.physW,
      physH: args.region.physH,
    },
    format: args.format ?? "gif",
    fps: args.fps ?? 0,
  });
}

export function hideRecorderBar(): Promise<void> {
  return invoke("hide_recorder_bar");
}

export interface RecorderBarPayload {
  region: RecordRegion;
  format?: string;
  fps?: number;
}

export function recorderBarReady(): Promise<RecorderBarPayload | null> {
  return invoke("recorder_bar_ready");
}

export function formatHotkeyShort(accel: string): string {
  return accel
    .replace(/CommandOrControl/gi, "⌃")
    .replace(/Control/gi, "⌃")
    .replace(/Shift/gi, "⇧")
    .replace(/Alt/gi, "⌥")
    .replace(/\+/g, "");
}
