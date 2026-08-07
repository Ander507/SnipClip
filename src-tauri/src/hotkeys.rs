use crate::db::{AppSettings, Database};
use parking_lot::Mutex;
use std::str::FromStr;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub struct HotkeyState {
    pub clipboard: Mutex<String>,
    pub snip: Mutex<String>,
}

impl HotkeyState {
    pub fn from_settings(settings: &AppSettings) -> Self {
        Self {
            clipboard: Mutex::new(settings.hotkey_clipboard.clone()),
            snip: Mutex::new(settings.hotkey_snip.clone()),
        }
    }
}

pub fn parse_hotkey(s: &str) -> Result<Shortcut, String> {
    let normalized = normalize_accelerator(s);
    Shortcut::from_str(&normalized).map_err(|e| format!("invalid hotkey '{s}': {e}"))
}

/// Normalize UI / stored accelerators into a form the plugin accepts.
pub fn normalize_accelerator(s: &str) -> String {
    s.split('+')
        .map(|part| {
            let p = part.trim();
            match p.to_ascii_lowercase().as_str() {
                "ctrl" | "control" | "controlleft" | "controlright" => "Control".to_string(),
                "cmd" | "command" | "meta" | "super" | "cmdorctrl" | "commandorcontrol" => {
                    "CommandOrControl".to_string()
                }
                "alt" | "option" | "altleft" | "altright" => "Alt".to_string(),
                "shift" | "shiftleft" | "shiftright" => "Shift".to_string(),
                other => {
                    if other.len() == 1 {
                        other.to_ascii_uppercase()
                    } else if other.starts_with('f')
                        && other.len() > 1
                        && other[1..].chars().all(|c| c.is_ascii_digit())
                    {
                        let mut chars = other.chars();
                        let first = chars.next().unwrap().to_ascii_uppercase();
                        format!("{first}{}", chars.as_str())
                    } else {
                        let mut c = other.chars();
                        match c.next() {
                            Some(f) => format!("{}{}", f.to_ascii_uppercase(), c.as_str()),
                            None => String::new(),
                        }
                    }
                }
            }
        })
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("+")
}

pub fn register_hotkeys(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let clip = parse_hotkey(&settings.hotkey_clipboard)?;
    let snip = parse_hotkey(&settings.hotkey_snip)?;

    if clip == snip {
        return Err("Clipboard and Snip hotkeys must be different".into());
    }

    app.global_shortcut()
        .register(clip)
        .map_err(|e| e.to_string())?;
    app.global_shortcut().register(snip).map_err(|e| {
        let _ = app.global_shortcut().unregister_all();
        e.to_string()
    })?;
    Ok(())
}

pub fn unregister_all(app: &AppHandle) -> Result<(), String> {
    app.global_shortcut()
        .unregister_all()
        .map_err(|e| e.to_string())
}

pub fn apply_hotkeys(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let _ = parse_hotkey(&settings.hotkey_clipboard)?;
    let _ = parse_hotkey(&settings.hotkey_snip)?;
    if normalize_accelerator(&settings.hotkey_clipboard)
        == normalize_accelerator(&settings.hotkey_snip)
    {
        return Err("Clipboard and Snip hotkeys must be different".into());
    }

    let _ = unregister_all(app);
    register_hotkeys(app, settings)?;

    if let Some(state) = app.try_state::<Arc<HotkeyState>>() {
        *state.clipboard.lock() = settings.hotkey_clipboard.clone();
        *state.snip.lock() = settings.hotkey_snip.clone();
    }
    Ok(())
}

pub fn install_plugin(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    app.plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |app, shortcut, event| {
                if event.state() != ShortcutState::Pressed {
                    return;
                }

                let (clip_str, snip_str) =
                    if let Some(state) = app.try_state::<Arc<HotkeyState>>() {
                        (state.clipboard.lock().clone(), state.snip.lock().clone())
                    } else {
                        (
                            AppSettings::default().hotkey_clipboard,
                            AppSettings::default().hotkey_snip,
                        )
                    };

                let Ok(clip) = parse_hotkey(&clip_str) else {
                    return;
                };
                let Ok(snip) = parse_hotkey(&snip_str) else {
                    return;
                };

                if *shortcut == clip {
                    let _ = crate::commands::toggle_main_window(app.clone());
                    let _ = app.emit("focus-search", ());
                } else if *shortcut == snip {
                    // Directly warm-show the preloaded snipper — no round-trip through React
                    let _ = crate::commands::begin_snip(app.clone());
                }
            })
            .build(),
    )?;
    Ok(())
}

pub fn bootstrap(app: &AppHandle, db: &Database) -> Result<AppSettings, String> {
    let settings = db.get_settings()?;
    install_plugin(app).map_err(|e| e.to_string())?;
    register_hotkeys(app, &settings)?;
    Ok(settings)
}
