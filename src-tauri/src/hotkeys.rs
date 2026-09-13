use crate::db::{AppSettings, Database};
use parking_lot::Mutex;
use std::str::FromStr;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub struct HotkeyState {
    pub clipboard: Mutex<String>,
    pub snip: Mutex<String>,
    pub record: Mutex<String>,
    pub dock: Mutex<String>,
    pub snip_delay_enabled: Mutex<bool>,
    pub snip_delay_ms: Mutex<u32>,
}

impl HotkeyState {
    pub fn from_settings(settings: &AppSettings) -> Self {
        Self {
            clipboard: Mutex::new(settings.hotkey_clipboard.clone()),
            snip: Mutex::new(settings.hotkey_snip.clone()),
            record: Mutex::new(settings.hotkey_record.clone()),
            dock: Mutex::new(settings.hotkey_dock.clone()),
            snip_delay_enabled: Mutex::new(settings.snip_delay_enabled),
            snip_delay_ms: Mutex::new(settings.snip_delay_ms),
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

// allowing custom obscure hotkeys so web apps don't intercept our printscreen presses
pub fn is_intercepted_snip_hotkey(s: &str) -> bool {
    let n = normalize_accelerator(s).to_ascii_lowercase();
    n.contains("printscreen")
        || n.contains("print screen")
        || n.contains("snapshot")
        || n.contains("prtsc")
        || n == "f13"
}

pub fn validate_snip_hotkey(s: &str) -> Result<(), String> {
    if is_intercepted_snip_hotkey(s) {
        return Err(
            "Print Screen is often detected by apps like Snapchat. Use an obscure combo such as Ctrl+Alt+Q or Shift+F12.".into(),
        );
    }
    Ok(())
}

fn assert_unique(keys: &[&Shortcut]) -> Result<(), String> {
    for (i, a) in keys.iter().enumerate() {
        for b in keys.iter().skip(i + 1) {
            if a == b {
                return Err(
                    "Clipboard, Snip, Record, Dock, and Command Palette hotkeys must all be different"
                        .into(),
                );
            }
        }
    }
    Ok(())
}

pub fn register_hotkeys(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let clip = parse_hotkey(&settings.hotkey_clipboard)?;
    validate_snip_hotkey(&settings.hotkey_snip)?;
    validate_snip_hotkey(&settings.hotkey_record)?;
    validate_snip_hotkey(&settings.hotkey_dock)?;
    let snip = parse_hotkey(&settings.hotkey_snip)?;
    let record = parse_hotkey(&settings.hotkey_record)?;
    let dock = parse_hotkey(&settings.hotkey_dock)?;
    let palette = parse_hotkey(crate::command_palette::palette_hotkey_string())?;

    assert_unique(&[&clip, &snip, &record, &dock, &palette])?;

    app.global_shortcut()
        .register(clip)
        .map_err(|e| e.to_string())?;
    app.global_shortcut().register(snip).map_err(|e| {
        let _ = app.global_shortcut().unregister_all();
        e.to_string()
    })?;
    app.global_shortcut().register(record).map_err(|e| {
        let _ = app.global_shortcut().unregister_all();
        e.to_string()
    })?;
    app.global_shortcut().register(dock).map_err(|e| {
        let _ = app.global_shortcut().unregister_all();
        e.to_string()
    })?;
    app.global_shortcut().register(palette).map_err(|e| {
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
    validate_snip_hotkey(&settings.hotkey_snip)?;
    validate_snip_hotkey(&settings.hotkey_record)?;
    validate_snip_hotkey(&settings.hotkey_dock)?;
    let _ = parse_hotkey(&settings.hotkey_snip)?;
    let _ = parse_hotkey(&settings.hotkey_record)?;
    let _ = parse_hotkey(&settings.hotkey_dock)?;

    let clip = normalize_accelerator(&settings.hotkey_clipboard);
    let snip = normalize_accelerator(&settings.hotkey_snip);
    let record = normalize_accelerator(&settings.hotkey_record);
    let dock = normalize_accelerator(&settings.hotkey_dock);
    let palette_norm = normalize_accelerator(crate::command_palette::palette_hotkey_string());

    let keys = [&clip, &snip, &record, &dock, &palette_norm];
    for (i, a) in keys.iter().enumerate() {
        for b in keys.iter().skip(i + 1) {
            if a == b {
                return Err("Hotkeys must be unique (including Alt+C command palette)".into());
            }
        }
    }

    let _ = unregister_all(app);
    register_hotkeys(app, settings)?;

    if let Some(state) = app.try_state::<Arc<HotkeyState>>() {
        *state.clipboard.lock() = settings.hotkey_clipboard.clone();
        *state.snip.lock() = settings.hotkey_snip.clone();
        *state.record.lock() = settings.hotkey_record.clone();
        *state.dock.lock() = settings.hotkey_dock.clone();
        *state.snip_delay_enabled.lock() = settings.snip_delay_enabled;
        *state.snip_delay_ms.lock() = settings.snip_delay_ms;
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

                let (clip_str, snip_str, record_str, dock_str, snip_delay_enabled, snip_delay_ms) =
                    if let Some(state) = app.try_state::<Arc<HotkeyState>>() {
                        (
                            state.clipboard.lock().clone(),
                            state.snip.lock().clone(),
                            state.record.lock().clone(),
                            state.dock.lock().clone(),
                            *state.snip_delay_enabled.lock(),
                            *state.snip_delay_ms.lock(),
                        )
                    } else {
                        let defaults = AppSettings::default();
                        (
                            defaults.hotkey_clipboard,
                            defaults.hotkey_snip,
                            defaults.hotkey_record,
                            defaults.hotkey_dock,
                            defaults.snip_delay_enabled,
                            defaults.snip_delay_ms,
                        )
                    };

                let Ok(clip) = parse_hotkey(&clip_str) else {
                    return;
                };
                let Ok(snip) = parse_hotkey(&snip_str) else {
                    return;
                };
                let Ok(record) = parse_hotkey(&record_str) else {
                    return;
                };
                let Ok(dock) = parse_hotkey(&dock_str) else {
                    return;
                };
                let Ok(palette) = parse_hotkey(crate::command_palette::palette_hotkey_string())
                else {
                    return;
                };

                if *shortcut == clip {
                    let _ = crate::commands::toggle_main_window(app.clone());
                    let _ = app.emit("focus-search", ());
                } else if *shortcut == snip {
                    if snip_delay_enabled && snip_delay_ms > 0 {
                        let _ = crate::commands::delayed_snip(app.clone(), snip_delay_ms);
                    } else {
                        let _ = crate::commands::begin_snip(app.clone(), None);
                    }
                } else if *shortcut == record {
                    let _ = crate::commands::begin_snip(app.clone(), Some("record".into()));
                } else if *shortcut == dock {
                    // Show vault then flip compact dock from the React side
                    let _ = crate::commands::show_main_window(app.clone());
                    let _ = app.emit("toggle-compact-dock", ());
                } else if *shortcut == palette {
                    let _ = crate::command_palette::toggle_command_palette(app);
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

/// Install the shortcut plugin immediately, then register bindings on a background path.
pub fn bootstrap_nonblocking(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    install_plugin(app).map_err(|e| e.to_string())?;
    let handle = app.clone();
    let settings = settings.clone();
    std::thread::spawn(move || {
        if let Err(e) = register_hotkeys(&handle, &settings) {
            eprintln!("hotkey registration skipped: {e}");
        }
    });
    Ok(())
}
