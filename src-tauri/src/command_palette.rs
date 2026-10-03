use tauri::{
    AppHandle, Emitter, Manager, Position, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

pub const PALETTE_WIDTH: f64 = 600.0;
pub const PALETTE_HEIGHT: f64 = 400.0;

fn ensure_palette_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(win) = app.get_webview_window("command_palette") {
        return Ok(win);
    }

    // registering Alt+C to spawn the centered transparent search window for lightning fast keyboard access
    WebviewWindowBuilder::new(
        app,
        "command_palette",
        WebviewUrl::App("index.html?view=palette".into()),
    )
    .title("SnipClip")
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .shadow(false)
    .resizable(false)
    .visible(false)
    .focused(false)
    .inner_size(PALETTE_WIDTH, PALETTE_HEIGHT)
    .center()
    .build()
    .map_err(|e| e.to_string())
}

pub fn show_command_palette(app: &AppHandle) -> Result<(), String> {
    // snapshot the app you were in before we steal focus
    crate::paste::capture_target_now(app);
    let win = ensure_palette_window(app)?;
    let _ = win.set_decorations(false);
    let _ = win.set_skip_taskbar(true);
    let _ = win.set_always_on_top(true);
    // Fullscreen lands on the window's current monitor — move it under the cursor first
    let cursor = move_to_cursor_monitor(app, &win);
    let _ = win.set_fullscreen(true);
    let _ = win.show();
    let _ = win.set_focus();
    let (cursor_x, cursor_y) = match cursor {
        Some((x, y)) => (Some(x), Some(y)),
        None => (None, None),
    };
    let _ = win.emit(
        "palette-show",
        serde_json::json!({ "cursorX": cursor_x, "cursorY": cursor_y }),
    );
    Ok(())
}

/// Park the palette on the monitor holding the cursor. Returns the cursor position relative
/// to that monitor's top-left in logical px (= CSS px once the palette is fullscreen there).
fn move_to_cursor_monitor(app: &AppHandle, win: &WebviewWindow) -> Option<(f64, f64)> {
    let cursor = app.cursor_position().ok()?;
    let monitor = app.monitor_from_point(cursor.x, cursor.y).ok().flatten()?;
    let origin = *monitor.position();
    // Leave fullscreen first so the move isn't swallowed by the old monitor's fullscreen rect
    if win.is_fullscreen().unwrap_or(false) {
        let _ = win.set_fullscreen(false);
    }
    win.set_position(Position::Physical(origin)).ok()?;
    let scale = monitor.scale_factor();
    if scale <= 0.0 {
        return None;
    }
    Some((
        (cursor.x - origin.x as f64) / scale,
        (cursor.y - origin.y as f64) / scale,
    ))
}

pub fn hide_command_palette(app: &AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("command_palette") {
        let _ = win.set_fullscreen(false);
        let _ = win.hide();
    }
    Ok(())
}

pub fn toggle_command_palette(app: &AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("command_palette") {
        if win.is_visible().unwrap_or(false) {
            return hide_command_palette(app);
        }
    }
    show_command_palette(app)
}

/// Fixed Raycast-style palette accelerator (Alt+C).
pub fn palette_hotkey_string() -> &'static str {
    "Alt+C"
}
