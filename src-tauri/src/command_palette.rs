use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

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
    let win = ensure_palette_window(app)?;
    let _ = win.set_decorations(false);
    let _ = win.set_skip_taskbar(true);
    let _ = win.set_always_on_top(true);
    let _ = win.set_fullscreen(true);
    let _ = win.show();
    let _ = win.set_focus();
    let _ = win.emit("palette-show", ());
    Ok(())
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
