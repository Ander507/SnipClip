use crate::snip;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    AppHandle, Emitter, Manager, Position, Size, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use tauri::{PhysicalPosition, PhysicalSize};
use xcap::Monitor;

static SNIP_OVERLAY_OPEN: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotPopupPayload {
    pub vault_id: i64,
    pub width: u32,
    pub height: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail_data_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media_kind: Option<String>,
}

pub const POPUP_WIDTH: u32 = 220;
pub const POPUP_HEIGHT: u32 = 140;

pub fn pictures_screenshots_dir() -> Result<PathBuf, String> {
    #[cfg(windows)]
    {
        if let Ok(profile) = std::env::var("USERPROFILE") {
            return Ok(PathBuf::from(profile)
                .join("Pictures")
                .join("SnipClip")
                .join("screenshots"));
        }
    }

    if let Ok(home) = std::env::var("HOME") {
        if let Ok(pictures) = std::env::var("XDG_PICTURES_DIR") {
            return Ok(PathBuf::from(pictures).join("SnipClip").join("screenshots"));
        }
        return Ok(PathBuf::from(home)
            .join("Pictures")
            .join("SnipClip")
            .join("screenshots"));
    }

    Err("could not resolve Pictures/SnipClip/screenshots directory".into())
}

// implementing a frameless overlay window and background thread logic for the macOS-style save/copy/popup flow
pub fn save_screenshot_to_pictures(data_url: &str) -> Result<String, String> {
    let dir = pictures_screenshots_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let filename = format!(
        "SnipClip_{}.png",
        chrono::Local::now().format("%Y%m%d_%H%M%S")
    );
    let path = dir.join(&filename);
    let path_str = path.to_string_lossy().into_owned();
    snip::save_png_data_url(data_url, &path_str)?;
    Ok(path_str)
}

fn primary_monitor_bottom_right(
    width: u32,
    height: u32,
    margin: i32,
) -> Result<(i32, i32), String> {
    let monitors = Monitor::all().map_err(|e| e.to_string())?;
    let monitor = monitors
        .into_iter()
        .next()
        .ok_or_else(|| "no monitors found".to_string())?;
    let x = monitor.x() + monitor.width() as i32 - width as i32 - margin;
    let y = monitor.y() + monitor.height() as i32 - height as i32 - margin;
    Ok((x, y))
}

fn ensure_popup_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(win) = app.get_webview_window("screenshot_popup") {
        return Ok(win);
    }

    // stripping OS window decorations and forcing transparency in tauri so it looks like a clean floating overlay
    WebviewWindowBuilder::new(
        app,
        "screenshot_popup",
        WebviewUrl::App("index.html?view=popup".into()),
    )
    .title("SnipClip")
    .decorations(false)
    .transparent(true)
    .skip_taskbar(true)
    .always_on_top(true)
    .shadow(false)
    .resizable(false)
    .visible(false)
    .focused(false)
    .inner_size(POPUP_WIDTH as f64, POPUP_HEIGHT as f64)
    .build()
    .map_err(|e| e.to_string())
}

pub fn park_snipper_window(snipper: &WebviewWindow) {
    let _ = snipper.hide();
    let _ = snipper.set_always_on_top(false);
    let _ = snipper.set_fullscreen(false);
    let _ = snipper.set_focusable(false);
    let _ = snipper.set_size(Size::Physical(PhysicalSize::new(800, 600)));
    let _ = snipper.set_position(Position::Physical(PhysicalPosition::new(-20_000, -20_000)));
}

pub fn is_snipper_label(label: &str) -> bool {
    label == "snipper" || label.starts_with("snipper-")
}

pub fn park_all_snipper_windows(app: &AppHandle) {
    for (label, win) in app.webview_windows() {
        if is_snipper_label(&label) {
            park_snipper_window(&win);
        }
    }
    SNIP_OVERLAY_OPEN.store(false, Ordering::SeqCst);
}

pub fn mark_snip_overlay_open() {
    SNIP_OVERLAY_OPEN.store(true, Ordering::SeqCst);
}

pub fn show_screenshot_popup(
    app: &AppHandle,
    payload: ScreenshotPopupPayload,
) -> Result<(), String> {
    let popup = ensure_popup_window(app)?;

    let (x, y) = primary_monitor_bottom_right(POPUP_WIDTH, POPUP_HEIGHT, 20)?;
    let _ = popup.set_decorations(false);
    let _ = popup.set_skip_taskbar(true);
    let _ = popup.set_always_on_top(true);
    let _ = popup.set_position(Position::Physical(PhysicalPosition::new(x, y)));
    let _ = popup.set_size(Size::Physical(PhysicalSize::new(POPUP_WIDTH, POPUP_HEIGHT)));
    let _ = popup.show();
    let _ = popup.set_focus();
    let _ = popup.emit("screenshot-popup-show", payload);
    Ok(())
}

pub fn hide_screenshot_popup(app: &AppHandle) -> Result<(), String> {
    if let Some(popup) = app.get_webview_window("screenshot_popup") {
        let _ = popup.hide();
    }
    Ok(())
}
