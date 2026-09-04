use parking_lot::Mutex;
use std::sync::OnceLock;
use tauri::{
    AppHandle, Emitter, Manager, Position, Size, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use tauri::{PhysicalPosition, PhysicalSize};

use crate::video_edit::VideoEditorPayload;

pub const EDITOR_WIDTH: u32 = 980;
pub const EDITOR_HEIGHT: u32 = 720;

static PENDING_EDITOR: OnceLock<Mutex<Option<VideoEditorPayload>>> = OnceLock::new();

fn pending_editor() -> &'static Mutex<Option<VideoEditorPayload>> {
    PENDING_EDITOR.get_or_init(|| Mutex::new(None))
}

pub fn take_pending_editor() -> Option<VideoEditorPayload> {
    pending_editor().lock().take()
}

fn ensure_editor_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(win) = app.get_webview_window("video_editor") {
        return Ok(win);
    }

    WebviewWindowBuilder::new(
        app,
        "video_editor",
        WebviewUrl::App("index.html?view=video-editor".into()),
    )
    .title("SnipClip Video Editor")
    .decorations(false)
    .transparent(false)
    .shadow(true)
    .resizable(true)
    .visible(false)
    .focused(true)
    .inner_size(EDITOR_WIDTH as f64, EDITOR_HEIGHT as f64)
    .build()
    .map_err(|e| e.to_string())
}

fn center_on_primary(app: &AppHandle, width: u32, height: u32) -> (i32, i32) {
    if let Ok(Some(monitor)) = app.primary_monitor() {
        let pos = monitor.position();
        let size = monitor.size();
        let x = pos.x + (size.width as i32 - width as i32) / 2;
        let y = pos.y + (size.height as i32 - height as i32) / 2;
        return (x.max(pos.x), y.max(pos.y));
    }
    (80, 80)
}

pub fn show_video_editor(app: &AppHandle, payload: VideoEditorPayload) -> Result<(), String> {
    *pending_editor().lock() = Some(payload.clone());
    let win = ensure_editor_window(app)?;
    let (x, y) = center_on_primary(app, EDITOR_WIDTH, EDITOR_HEIGHT);
    let _ = win.set_size(Size::Physical(PhysicalSize::new(EDITOR_WIDTH, EDITOR_HEIGHT)));
    let _ = win.set_position(Position::Physical(PhysicalPosition::new(x, y)));
    let _ = win.show();
    let _ = win.unminimize();
    let _ = win.set_focus();
    let _ = win.emit("video-editor-open", &payload);
    Ok(())
}

pub fn hide_video_editor(app: &AppHandle) -> Result<(), String> {
    *pending_editor().lock() = None;
    if let Some(win) = app.get_webview_window("video_editor") {
        let _ = win.hide();
    }
    Ok(())
}
