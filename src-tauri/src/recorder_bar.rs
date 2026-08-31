use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter, Manager, Position, Size, WebviewWindow};
use tauri::{PhysicalPosition, PhysicalSize};

pub const RECORDER_BAR_WIDTH: u32 = 360;
pub const RECORDER_BAR_HEIGHT: u32 = 52;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordRegionPayload {
    pub phys_x: i32,
    pub phys_y: i32,
    pub phys_w: i32,
    pub phys_h: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecorderBarShowPayload {
    pub region: RecordRegionPayload,
    pub format: String,
    pub fps: u32,
}

static PENDING_SHOW: OnceLock<Mutex<Option<RecorderBarShowPayload>>> = OnceLock::new();

fn pending_show() -> &'static Mutex<Option<RecorderBarShowPayload>> {
    PENDING_SHOW.get_or_init(|| Mutex::new(None))
}

fn recorder_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window("recorder_bar")
        .ok_or_else(|| "recorder_bar window missing".to_string())
}

/// Last show payload for the recorder webview if it mounted after the event fired.
pub fn take_pending_show() -> Option<RecorderBarShowPayload> {
    pending_show().lock().take()
}

pub fn show_recorder_bar(
    app: &AppHandle,
    screen_x: i32,
    screen_y: i32,
    region: RecordRegionPayload,
    format: String,
    fps: u32,
) -> Result<(), String> {
    if let Some(snipper) = app.get_webview_window("snipper") {
        let _ = snipper.hide();
        crate::screenshot_popup::park_snipper_window(&snipper);
    }
    // hiding the tauri overlay and sleeping 150ms so windows DWM clears it from the gpu buffer before we capture
    std::thread::sleep(std::time::Duration::from_millis(150));

    let bar = recorder_window(app)?;
    let payload = RecorderBarShowPayload {
        region,
        format,
        fps,
    };
    *pending_show().lock() = Some(payload.clone());

    let _ = bar.set_decorations(false);
    let _ = bar.set_skip_taskbar(true);
    let _ = bar.set_always_on_top(true);
    let _ = bar.set_position(Position::Physical(PhysicalPosition::new(
        screen_x, screen_y,
    )));
    let _ = bar.set_size(Size::Physical(PhysicalSize::new(
        RECORDER_BAR_WIDTH,
        RECORDER_BAR_HEIGHT,
    )));
    let _ = bar.show();
    let _ = bar.set_focus();
    let _ = bar.emit("recorder-bar-show", payload);
    Ok(())
}

pub fn hide_recorder_bar(app: &AppHandle) -> Result<(), String> {
    pending_show().lock().take();
    if let Some(bar) = app.get_webview_window("recorder_bar") {
        let _ = bar.hide();
    }
    Ok(())
}
