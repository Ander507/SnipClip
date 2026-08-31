use crate::apps;
use crate::clipboard;
use crate::db::{AppSettings, ClipboardItem, Database};
use crate::hotkeys::{self, HotkeyState};
use crate::screenshot_popup::{self, ScreenshotPopupPayload};
use crate::snip::{self, CaptureResult};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

fn sync_main_ui_visible(app: &AppHandle) {
    let visible = app
        .get_webview_window("main")
        .map(|w| w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false))
        .unwrap_or(false);
    clipboard::set_main_ui_visible(visible);
}

fn decode_image_data_url(data_url: &str) -> Result<Vec<u8>, String> {
    let b64 = data_url
        .strip_prefix("data:image/png;base64,")
        .or_else(|| data_url.strip_prefix("data:image/jpeg;base64,"))
        .or_else(|| data_url.strip_prefix("data:image/webp;base64,"))
        .unwrap_or(data_url);
    B64.decode(b64).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_items(
    db: State<'_, Arc<Database>>,
    category: Option<String>,
    query: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<ClipboardItem>, String> {
    db.list(category.as_deref(), query.as_deref(), limit.unwrap_or(200))
}

#[tauri::command]
pub fn search_clipboard(
    db: State<'_, Arc<Database>>,
    query: String,
) -> Result<Vec<ClipboardItem>, String> {
    db.search_clipboard(&query)
}

#[tauri::command]
pub fn show_command_palette(app: AppHandle) -> Result<(), String> {
    crate::command_palette::show_command_palette(&app)
}

#[tauri::command]
pub fn hide_command_palette(app: AppHandle) -> Result<(), String> {
    crate::command_palette::hide_command_palette(&app)
}

#[tauri::command]
pub fn palette_copy_item(
    app: AppHandle,
    db: State<'_, Arc<Database>>,
    id: i64,
) -> Result<(), String> {
    let item = db.get(id)?.ok_or_else(|| "item not found".to_string())?;
    copy_item_to_clipboard(&item)?;
    crate::command_palette::hide_command_palette(&app)
}

#[tauri::command]
pub fn get_item(db: State<'_, Arc<Database>>, id: i64) -> Result<Option<ClipboardItem>, String> {
    db.get(id)
}

#[tauri::command]
pub fn toggle_pin(db: State<'_, Arc<Database>>, id: i64) -> Result<bool, String> {
    db.toggle_pin(id)
}

#[tauri::command]
pub fn delete_item(db: State<'_, Arc<Database>>, id: i64) -> Result<(), String> {
    db.delete(id)
}

#[tauri::command]
pub fn clear_history(db: State<'_, Arc<Database>>) -> Result<(), String> {
    db.clear_unpinned()?;
    // So the next distinct copy is stored (monitor no longer treats OS clipboard as "already saved").
    clipboard::resync_seen_clipboard();
    Ok(())
}

fn copy_item_to_clipboard(item: &ClipboardItem) -> Result<(), String> {
    match item.content_type.as_str() {
        "image" | "screenshot" => {
            if item.content.is_empty() {
                return Err("image data not available — try again from the vault".into());
            }
            clipboard::write_image_to_clipboard(&item.content)
        }
        _ => clipboard::write_text_to_clipboard(&item.content),
    }
}

#[tauri::command]
pub fn copy_item(db: State<'_, Arc<Database>>, id: i64) -> Result<(), String> {
    let item = db.get(id)?.ok_or_else(|| "item not found".to_string())?;
    copy_item_to_clipboard(&item)
}

// adding the open crate to rust so users can click links directly from their clipboard history
fn normalize_open_url(raw: &str) -> Result<String, String> {
    let mut s = raw.trim();
    if s.is_empty() {
        return Err("url is empty".into());
    }
    const TRAILING: &[char] = &['.', ',', ';', ':', '!', '?', ')', '}', ']', '\'', '"'];
    while s.ends_with(TRAILING) {
        s = &s[..s.len() - s.chars().last().unwrap().len_utf8()];
    }
    if s.starts_with("www.") {
        return Ok(format!("https://{s}"));
    }
    if s.starts_with("http://") || s.starts_with("https://") {
        return Ok(s.to_string());
    }
    Err("invalid url".into())
}

#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    let href = normalize_open_url(&url)?;
    open::that(&href).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_clipboard_item(
    db: State<'_, Arc<Database>>,
    id: i64,
    content: String,
) -> Result<ClipboardItem, String> {
    db.update_text_content(id, &content)
}

#[tauri::command]
pub fn capture_screen() -> Result<CaptureResult, String> {
    snip::capture_primary_monitor()
}

/// Hide overlay windows and wait for DWM to drop them from the desktop buffer.
fn prepare_desktop_capture(app: &AppHandle) {
    if let Some(snipper) = app.get_webview_window("snipper") {
        let _ = snipper.hide();
        screenshot_popup::park_snipper_window(&snipper);
    }
    // hiding the tauri overlay and sleeping 150ms so windows DWM clears it from the gpu buffer before we capture
    std::thread::sleep(std::time::Duration::from_millis(150));
}

#[tauri::command]
pub fn capture_screen_region(
    app: AppHandle,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<CaptureResult, String> {
    prepare_desktop_capture(&app);
    snip::capture_screen_region(x, y, width, height)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WaylandCaptureResult {
    pub data_url: String,
    pub width: u32,
    pub height: u32,
    pub monitor_name: String,
    pub geometry: String,
    pub vault_id: i64,
    pub file_path: String,
    pub item: ClipboardItem,
}

#[tauri::command]
pub fn capture_region_wayland(
    db: State<'_, Arc<Database>>,
) -> Result<WaylandCaptureResult, String> {
    let (capture, png_bytes, geometry) = crate::wayland::capture_region_wayland()?;
    let preview = build_thumb_preview(&capture.data_url)
        .unwrap_or_else(|_| format!("{}×{} snip", capture.width, capture.height));
    let item = db
        .insert("screenshot", &capture.data_url, &preview)
        .map(|item| item.for_event())?;

    let file_path = {
        #[cfg(target_os = "linux")]
        {
            crate::wayland::save_png_to_pictures(&png_bytes)?
        }
        #[cfg(not(target_os = "linux"))]
        {
            let _ = png_bytes;
            String::new()
        }
    };

    Ok(WaylandCaptureResult {
        data_url: capture.data_url,
        width: capture.width,
        height: capture.height,
        monitor_name: capture.monitor_name,
        geometry,
        vault_id: item.id,
        file_path,
        item,
    })
}

#[tauri::command]
pub fn save_snip(data_url: String, path: String) -> Result<(), String> {
    snip::save_png_data_url(&data_url, &path)
}

#[tauri::command]
pub fn copy_image(data_url: String) -> Result<(), String> {
    clipboard::write_image_to_clipboard(&data_url)
}

#[tauri::command]
pub fn save_snip_to_vault(
    db: State<'_, Arc<Database>>,
    data_url: String,
    width: u32,
    height: u32,
) -> Result<ClipboardItem, String> {
    // Build a tiny preview thumbnail so list stays light
    let preview =
        build_thumb_preview(&data_url).unwrap_or_else(|_| format!("{width}×{height} snip"));
    db.insert("screenshot", &data_url, &preview)
        .map(|item| item.for_event())
}

#[tauri::command]
pub fn update_vault_image(
    db: State<'_, Arc<Database>>,
    id: i64,
    data_url: String,
    width: u32,
    height: u32,
) -> Result<ClipboardItem, String> {
    let preview =
        build_thumb_preview(&data_url).unwrap_or_else(|_| format!("{width}×{height} snip"));
    db.update_image_content(id, &data_url, &preview)
        .map(|item| item.for_event())
}

fn build_thumb_preview(data_url: &str) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD as B64, Engine};
    use image::imageops;
    use std::io::Cursor;

    let b64 = data_url
        .strip_prefix("data:image/png;base64,")
        .or_else(|| data_url.strip_prefix("data:image/jpeg;base64,"))
        .ok_or_else(|| "invalid data url".to_string())?;
    let bytes = B64.decode(b64).map_err(|e| e.to_string())?;
    let img = image::load_from_memory(&bytes).map_err(|e| e.to_string())?;
    let thumb = imageops::thumbnail(&img.to_rgba8(), 64, 64);
    let mut buf = Cursor::new(Vec::new());
    thumb
        .write_to(&mut buf, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(format!(
        "data:image/png;base64,{}",
        B64.encode(buf.into_inner())
    ))
}

#[tauri::command]
pub fn toggle_main_window(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
            let _ = win.show();
            let _ = win.unminimize();
            let _ = win.set_focus();
        }
    }
    sync_main_ui_visible(&app);
    Ok(())
}

#[tauri::command]
pub fn show_main_window(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
    sync_main_ui_visible(&app);
    Ok(())
}

#[tauri::command]
pub fn hide_main_window(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }
    sync_main_ui_visible(&app);
    Ok(())
}

/// Tear down the fullscreen snipper so it cannot block the desktop.
pub fn end_snip_session(app: &AppHandle, restore_main: bool) -> Result<(), String> {
    if let Some(snipper) = app.get_webview_window("snipper") {
        screenshot_popup::park_snipper_window(&snipper);
    }
    if restore_main {
        show_main_window(app.clone())?;
    } else {
        hide_main_window(app.clone())?;
    }
    Ok(())
}

/// Instant show/focus of the preloaded translucent snipper — covers all monitors.
#[tauri::command]
pub fn begin_snip(app: AppHandle, mode: Option<String>) -> Result<(), String> {
    // Recover from a stuck overlay before starting again
    let _ = end_snip_session(&app, false);
    show_snipper_overlay(&app, overlay_mode(mode))
}

fn overlay_mode(mode: Option<String>) -> &'static str {
    match mode.as_deref() {
        Some("record") => "record",
        _ => "snip",
    }
}

/// Wait silently, then open the snipper — no extra keystrokes near the target app.
#[tauri::command]
pub fn delayed_snip(app: AppHandle, delay_ms: u32) -> Result<(), String> {
    // adding a 3-second delay function so the user can grab the buffer without touching the keyboard
    let delay = delay_ms.clamp(500, 30_000);
    if delay == 0 {
        return begin_snip(app, None);
    }

    if let Some(main) = app.get_webview_window("main") {
        let _ = main.hide();
    }
    sync_main_ui_visible(&app);

    let app_handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(delay as u64));
        let inner = app_handle.clone();
        let _ = app_handle.run_on_main_thread(move || {
            let _ = show_snipper_overlay(&inner, "snip");
        });
    });
    Ok(())
}

fn show_snipper_overlay(app: &AppHandle, mode: &str) -> Result<(), String> {
    use tauri::{Emitter, Position, Size};
    use tauri::{PhysicalPosition, PhysicalSize};

    // Hide vault so it doesn't sit under the translucent overlay
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.hide();
    }
    sync_main_ui_visible(app);

    let snipper = match app.get_webview_window("snipper") {
        Some(w) => w,
        None => {
            let _ = show_main_window(app.clone());
            return Err("snipper window missing".into());
        }
    };

    let desktop = match snip::virtual_desktop_bounds() {
        Ok(d) => d,
        Err(e) => {
            let _ = show_main_window(app.clone());
            return Err(e);
        }
    };

    let _ = snipper.set_focusable(true);
    let _ = snipper.set_fullscreen(false);
    let _ = snipper.set_always_on_top(true);
    let _ = snipper.set_position(Position::Physical(PhysicalPosition::new(
        desktop.x, desktop.y,
    )));
    let _ = snipper.set_size(Size::Physical(PhysicalSize::new(
        desktop.width,
        desktop.height,
    )));
    let _ = snipper.show();
    let _ = snipper.set_focus();
    let _ = snipper.emit("snip-ready", serde_json::json!({ "mode": mode }));
    screenshot_popup::mark_snip_overlay_open();
    Ok(())
}

/// Hide snipper during capture (keeps it off-screen afterward).
#[tauri::command]
pub fn hide_snipper(app: AppHandle) -> Result<(), String> {
    if let Some(snipper) = app.get_webview_window("snipper") {
        screenshot_popup::park_snipper_window(&snipper);
    }
    Ok(())
}

/// Hide the snipper overlay and optionally restore the main vault.
#[tauri::command]
pub fn close_snipper(app: AppHandle, restore_main: Option<bool>) -> Result<(), String> {
    end_snip_session(&app, restore_main.unwrap_or(true))
}

#[tauri::command]
pub fn get_settings(app: AppHandle, db: State<'_, Arc<Database>>) -> Result<AppSettings, String> {
    let mut settings = db.get_settings()?;
    #[cfg(desktop)]
    {
        use tauri_plugin_autostart::ManagerExt;
        if let Ok(enabled) = app.autolaunch().is_enabled() {
            settings.launch_at_startup = enabled;
        }
    }
    if let Some(ref bg) = settings.theme_background_image {
        if !bg.starts_with("data:") {
            if let Ok(resolved) = crate::themes::resolve_background_url(&app, bg) {
                settings.theme_background_image = Some(resolved);
            }
        }
    }
    Ok(settings)
}

#[tauri::command]
pub fn update_settings(
    app: AppHandle,
    db: State<'_, Arc<Database>>,
    _hotkeys: State<'_, Arc<HotkeyState>>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    hotkeys::apply_hotkeys(&app, &settings)?;
    let mut settings = settings;
    if let Some(ref bg) = settings.theme_background_image {
        if bg.starts_with("data:image/") {
            settings.theme_background_image =
                Some(crate::themes::store_active_background(&app, bg)?);
        }
    }
    db.save_settings(&settings)?;
    clipboard::set_ignore_list(settings.ignore_list.clone());

    #[cfg(desktop)]
    {
        use tauri_plugin_autostart::ManagerExt;
        let autolaunch = app.autolaunch();
        if settings.launch_at_startup {
            autolaunch
                .enable()
                .map_err(|e| format!("Failed to enable launch at startup: {e}"))?;
        } else {
            let _ = autolaunch.disable();
        }
    }

    // Return settings with resolved background for live UI
    if let Some(ref bg) = settings.theme_background_image {
        if !bg.starts_with("data:") {
            if let Ok(resolved) = crate::themes::resolve_background_url(&app, bg) {
                settings.theme_background_image = Some(resolved);
            }
        }
    }

    Ok(settings)
}

/// Spec alias — same as `update_settings`.
#[tauri::command]
pub fn update_hotkeys(
    app: AppHandle,
    db: State<'_, Arc<Database>>,
    hotkeys_state: State<'_, Arc<HotkeyState>>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    update_settings(app, db, hotkeys_state, settings)
}

#[tauri::command]
pub fn get_clipboard_paused() -> bool {
    clipboard::is_paused()
}

#[tauri::command]
pub fn set_clipboard_paused(app: AppHandle, paused: bool) -> bool {
    let state = clipboard::set_paused(paused);
    let _ = app.emit("clipboard-paused", state);
    state
}

#[tauri::command]
pub fn toggle_clipboard_paused(app: AppHandle) -> bool {
    let state = clipboard::toggle_paused();
    let _ = app.emit("clipboard-paused", state);
    state
}

#[tauri::command]
pub fn get_running_apps() -> Vec<String> {
    apps::list_running_apps()
}

/// OCR text from a vault image and copy it to the system clipboard.
#[tauri::command]
pub fn copy_text_from_image(db: State<'_, Arc<Database>>, id: i64) -> Result<String, String> {
    let item = db.get(id)?.ok_or_else(|| "item not found".to_string())?;
    if item.content_type != "image" && item.content_type != "screenshot" {
        return Err("item is not an image".into());
    }
    let bytes = decode_image_data_url(&item.content)?;
    let text = crate::ocr::ocr_png_bytes(&bytes)?.trim().to_string();
    if text.is_empty() {
        return Err("No text found in image".into());
    }
    clipboard::write_text_to_clipboard(&text)?;
    Ok(text)
}

#[tauri::command]
pub fn run_ocr(data_url: String) -> Result<String, String> {
    let bytes = decode_image_data_url(&data_url)?;
    crate::ocr::ocr_png_bytes(&bytes)
}

#[tauri::command]
pub fn copy_text(text: String) -> Result<(), String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("text is empty".into());
    }
    clipboard::write_text_to_clipboard(trimmed)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinalizeScreenshotResult {
    pub vault_id: i64,
    pub width: u32,
    pub height: u32,
    pub item: ClipboardItem,
}

#[tauri::command]
pub fn finalize_screenshot(
    app: AppHandle,
    db: State<'_, Arc<Database>>,
    data_url: String,
    width: u32,
    height: u32,
) -> Result<FinalizeScreenshotResult, String> {
    let preview =
        build_thumb_preview(&data_url).unwrap_or_else(|_| format!("{width}×{height} snip"));
    let item = db
        .insert("screenshot", &data_url, &preview)
        .map(|item| item.for_event())?;

    let payload = ScreenshotPopupPayload {
        vault_id: item.id,
        width,
        height,
        thumbnail_data_url: Some(preview),
        media_path: None,
        media_kind: None,
    };
    if let Err(e) = screenshot_popup::show_screenshot_popup(&app, payload) {
        eprintln!("screenshot popup failed: {e}");
    }

    let _ = app.emit("clipboard-item", &item);
    let _ = hide_main_window(app.clone());

    // Copy immediately so paste works right after the snip (disk save can lag).
    clipboard::write_image_to_clipboard(&data_url)?;

    let data_for_bg = data_url;
    std::thread::spawn(move || {
        if let Err(e) = screenshot_popup::save_screenshot_to_pictures(&data_for_bg) {
            eprintln!("screenshot save failed: {e}");
        }
    });

    Ok(FinalizeScreenshotResult {
        vault_id: item.id,
        width,
        height,
        item,
    })
}

#[tauri::command]
pub fn close_screenshot_popup(app: AppHandle) -> Result<(), String> {
    screenshot_popup::hide_screenshot_popup(&app)
}

#[tauri::command]
pub fn start_region_recording(
    app: AppHandle,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    fps: u32,
    format: String,
    system_audio: Option<bool>,
) -> Result<(), String> {
    prepare_desktop_capture(&app);
    crate::recording::start_region_recording(
        x,
        y,
        width as u32,
        height as u32,
        fps,
        format,
        system_audio.unwrap_or(false),
    )
}

#[tauri::command]
pub fn pause_region_recording() -> Result<bool, String> {
    crate::recording::pause_region_recording()
}

#[tauri::command]
pub async fn stop_region_recording() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(crate::recording::stop_region_recording)
        .await
        .map_err(|e| e.to_string())?
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinalizeRecordingResult {
    pub vault_id: i64,
    pub file_path: String,
    pub width: u32,
    pub height: u32,
    pub item: ClipboardItem,
}

#[tauri::command]
pub fn finalize_recording(
    app: AppHandle,
    db: State<'_, Arc<Database>>,
    file_path: String,
    format: String,
    width: u32,
    height: u32,
) -> Result<FinalizeRecordingResult, String> {
    let content_type = if format.eq_ignore_ascii_case("mp4") {
        "video"
    } else {
        "gif"
    };
    let file_name = std::path::Path::new(&file_path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("recording");
    let preview = format!("{content_type}: {file_name}");
    // writing final mp4/gif recording metadata to sqlite and copying file path to clipboard
    let item = db
        .insert(content_type, &file_path, &preview)
        .map(|item| item.for_event())?;

    clipboard::write_text_to_clipboard(&file_path)?;

    let payload = ScreenshotPopupPayload {
        vault_id: item.id,
        width,
        height,
        thumbnail_data_url: None,
        media_path: Some(file_path.clone()),
        media_kind: Some(content_type.to_string()),
    };
    if let Err(e) = screenshot_popup::show_screenshot_popup(&app, payload) {
        eprintln!("recording popup failed: {e}");
    }

    let _ = app.emit("clipboard-item", &item);
    let _ = hide_main_window(app.clone());

    Ok(FinalizeRecordingResult {
        vault_id: item.id,
        file_path,
        width,
        height,
        item,
    })
}

#[tauri::command]
pub async fn show_recorder_bar(
    app: AppHandle,
    screen_x: i32,
    screen_y: i32,
    region: crate::recorder_bar::RecordRegionPayload,
    format: Option<String>,
    fps: Option<u32>,
) -> Result<(), String> {
    crate::recorder_bar::show_recorder_bar(
        &app,
        screen_x,
        screen_y,
        region,
        format.unwrap_or_else(|| "gif".into()),
        fps.unwrap_or(0),
    )
}

#[tauri::command]
pub fn recorder_bar_ready() -> Result<Option<crate::recorder_bar::RecorderBarShowPayload>, String> {
    Ok(crate::recorder_bar::take_pending_show())
}

#[tauri::command]
pub fn hide_recorder_bar(app: AppHandle) -> Result<(), String> {
    crate::recorder_bar::hide_recorder_bar(&app)
}

#[tauri::command]
pub fn is_ocr_available() -> bool {
    crate::ocr::is_available()
}

#[tauri::command]
pub fn list_theme_packs(app: AppHandle) -> Result<Vec<crate::themes::ThemePack>, String> {
    crate::themes::list_theme_packs(&app)
}

#[tauri::command]
pub fn save_theme_pack(
    app: AppHandle,
    pack: crate::themes::ThemePack,
) -> Result<crate::themes::ThemePack, String> {
    crate::themes::save_theme_pack(&app, pack)
}

#[tauri::command]
pub fn delete_theme_pack(app: AppHandle, id: String) -> Result<(), String> {
    crate::themes::delete_theme_pack(&app, &id)
}

#[tauri::command]
pub fn export_theme_pack(app: AppHandle, id: String) -> Result<String, String> {
    crate::themes::export_theme_pack_json(&app, &id)
}

#[tauri::command]
pub fn import_theme_pack(app: AppHandle, json: String) -> Result<crate::themes::ThemePack, String> {
    crate::themes::import_theme_pack_json(&app, &json)
}

#[tauri::command]
pub fn read_image_as_data_url(path: String) -> Result<String, String> {
    crate::themes::read_image_path_as_data_url(&path)
}

#[tauri::command]
pub fn write_text_file(path: String, contents: String) -> Result<(), String> {
    crate::themes::write_text_file(&path, &contents)
}

#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    crate::themes::read_text_file(&path)
}
