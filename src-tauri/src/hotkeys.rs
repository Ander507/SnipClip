use crate::db::AppSettings;
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
    /// Instant-replay save hotkey; None while replay is disabled.
    pub replay: Mutex<Option<String>>,
}

fn replay_hotkey_of(settings: &AppSettings) -> Option<String> {
    settings
        .replay_enabled
        .then(|| settings.replay_hotkey.clone())
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
            replay: Mutex::new(replay_hotkey_of(settings)),
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

/// An accelerator split into modifier flags and its non-modifier key(s).
#[derive(Debug, Default, PartialEq, Eq)]
struct AcceleratorParts {
    ctrl: bool,
    alt: bool,
    shift: bool,
    win: bool,
    keys: Vec<String>,
}

fn split_accelerator(s: &str) -> AcceleratorParts {
    let mut parts = AcceleratorParts::default();
    for part in normalize_accelerator(s).split('+') {
        match part {
            // normalize_accelerator maps Cmd/Super/Meta to CommandOrControl, which the plugin
            // resolves to Control on Windows/Linux, so treat it as Control everywhere.
            "Control" | "CommandOrControl" => parts.ctrl = true,
            "Alt" => parts.alt = true,
            "Shift" => parts.shift = true,
            "Win" | "Windows" => parts.win = true,
            "" => {}
            "Esc" => parts.keys.push("Escape".into()),
            "Return" => parts.keys.push("Enter".into()),
            "Del" => parts.keys.push("Delete".into()),
            other => parts.keys.push(other.to_string()),
        }
    }
    parts
}

/// Case-insensitive, modifier-order-independent form used for every comparison
/// (e.g. "shift+Alt+z" and "Alt+Shift+Z" both become "Alt+Shift+Z").
pub fn canonical_accelerator(s: &str) -> String {
    let p = split_accelerator(s);
    let mut out: Vec<String> = Vec::new();
    if p.ctrl {
        out.push("Control".into());
    }
    if p.alt {
        out.push("Alt".into());
    }
    if p.shift {
        out.push("Shift".into());
    }
    if p.win {
        out.push("Win".into());
    }
    out.extend(p.keys);
    out.join("+")
}

fn display_accelerator(canonical: &str) -> String {
    canonical.replace("Control", "Ctrl")
}

/// Combos that would break the OS or every editor if grabbed globally (canonical form).
const RESERVED_HOTKEYS: &[&str] = &[
    "Control+C",
    "Control+V",
    "Control+X",
    "Control+Z",
    "Control+Y",
    "Control+A",
    "Control+S",
    "Alt+F4",
    "Alt+Tab",
    "Control+Alt+Delete",
    "Alt+Space",
];

/// True for a normalized "F1".."F24" key name.
fn is_function_key(key: &str) -> bool {
    key.strip_prefix('F')
        .and_then(|n| n.parse::<u8>().ok())
        .is_some_and(|n| (1..=24).contains(&n))
}

/// Validates any global hotkey: needs Ctrl/Alt/Win plus one real key, no Print Screen,
/// and not one of the OS/editor-critical combos.
pub fn validate_hotkey(s: &str) -> Result<(), String> {
    let parts = split_accelerator(s);
    if parts.keys.is_empty() {
        return Err("needs a key besides the modifiers, e.g. Ctrl+Shift+V".into());
    }
    if parts.keys.len() > 1 {
        return Err("can only have one non-modifier key".into());
    }
    if is_intercepted_snip_hotkey(s) {
        return Err(
            "Print Screen is often detected by apps like Snapchat. Use an obscure combo such as Ctrl+Alt+Q or Shift+F12.".into(),
        );
    }
    // Shift+F1..F24 is allowed on its own (stealth presets like Shift+F12); every other key
    // needs Ctrl, Alt or Win, and a function key with no modifier at all is still rejected.
    let shift_function_key = parts.shift && is_function_key(&parts.keys[0]);
    if !(parts.ctrl || parts.alt || parts.win || shift_function_key) {
        return Err(
            "must include Ctrl, Alt or Win (Shift alone only works with F1-F24)".into(),
        );
    }
    let canonical = canonical_accelerator(s);
    if RESERVED_HOTKEYS.contains(&canonical.as_str()) {
        return Err(format!(
            "{} is reserved by Windows or your editor and can't be a global hotkey",
            display_accelerator(&canonical)
        ));
    }
    Ok(())
}

/// One global hotkey: the action's user-facing name plus its raw accelerator string.
type Binding = (&'static str, String);

const LABEL_CLIPBOARD: &str = "Toggle UI";
const LABEL_SNIP: &str = "Screenshot snipper";
const LABEL_RECORD: &str = "Screen recorder";
const LABEL_DOCK: &str = "Clipboard popup";
const LABEL_PALETTE: &str = "Command palette";
const LABEL_REPLAY: &str = "Instant replay";

/// Every hotkey that should be live; replay only when enabled (`replay` is None otherwise).
fn build_bindings(
    clipboard: &str,
    snip: &str,
    record: &str,
    dock: &str,
    replay: Option<&str>,
) -> Vec<Binding> {
    let mut v: Vec<Binding> = vec![
        (LABEL_CLIPBOARD, clipboard.to_string()),
        (LABEL_SNIP, snip.to_string()),
        (LABEL_RECORD, record.to_string()),
        (LABEL_DOCK, dock.to_string()),
        (
            LABEL_PALETTE,
            crate::command_palette::palette_hotkey_string().to_string(),
        ),
    ];
    if let Some(r) = replay {
        v.push((LABEL_REPLAY, r.to_string()));
    }
    v
}

fn settings_bindings(settings: &AppSettings) -> Vec<Binding> {
    build_bindings(
        &settings.hotkey_clipboard,
        &settings.hotkey_snip,
        &settings.hotkey_record,
        &settings.hotkey_dock,
        replay_hotkey_of(settings).as_deref(),
    )
}

/// The first two bindings that resolve to the same key, as "A and B both use Alt+R".
fn check_unique(bindings: &[Binding]) -> Result<(), String> {
    for (i, (label_a, a)) in bindings.iter().enumerate() {
        let canon_a = canonical_accelerator(a);
        for (label_b, b) in bindings.iter().skip(i + 1) {
            if canon_a == canonical_accelerator(b) {
                return Err(format!(
                    "{label_a} and {label_b} both use {}",
                    display_accelerator(&canon_a)
                ));
            }
        }
    }
    Ok(())
}

/// Validates every active binding (format, rules, parseability) and uniqueness. Pure: no app needed.
fn validate_bindings(bindings: &[Binding]) -> Result<(), String> {
    for (label, accel) in bindings {
        // The palette key is a fixed built-in, not user input.
        if *label == LABEL_PALETTE {
            continue;
        }
        validate_hotkey(accel).map_err(|e| format!("{label} hotkey: {e}"))?;
        parse_hotkey(accel).map_err(|e| format!("{label} hotkey: {e}"))?;
    }
    check_unique(bindings)
}

type Planned = (&'static str, String, Shortcut);

/// Best-effort plan: keep every binding that is valid and not a duplicate of an earlier one,
/// and describe each one that is dropped. Pure: no app needed.
fn plan_best_effort(bindings: &[Binding]) -> (Vec<Planned>, Vec<String>) {
    let mut planned: Vec<Planned> = Vec::new();
    let mut failures: Vec<String> = Vec::new();
    for (label, accel) in bindings {
        if *label != LABEL_PALETTE {
            if let Err(e) = validate_hotkey(accel) {
                failures.push(format!("{label} hotkey skipped: {e}"));
                continue;
            }
        }
        let shortcut = match parse_hotkey(accel) {
            Ok(s) => s,
            Err(e) => {
                failures.push(format!("{label} hotkey skipped: {e}"));
                continue;
            }
        };
        let canon = canonical_accelerator(accel);
        if let Some((earlier, _, _)) = planned
            .iter()
            .find(|(_, a, _)| canonical_accelerator(a) == canon)
        {
            failures.push(format!(
                "{earlier} and {label} both use {} - {label} was not registered",
                display_accelerator(&canon)
            ));
            continue;
        }
        planned.push((*label, accel.clone(), shortcut));
    }
    (planned, failures)
}

fn registration_error(label: &str, accel: &str, e: impl std::fmt::Display) -> String {
    format!(
        "{label} hotkey {} is unavailable ({e}) - another app may be using it",
        display_accelerator(&canonical_accelerator(accel))
    )
}

/// Registers each planned shortcut, continuing past failures; returns one message per failure.
fn register_planned(app: &AppHandle, planned: &[Planned]) -> Vec<String> {
    let mut failures = Vec::new();
    for (label, accel, shortcut) in planned {
        if let Err(e) = app.global_shortcut().register(*shortcut) {
            eprintln!("{label} hotkey skipped: {e}");
            failures.push(registration_error(label, accel, e));
        }
    }
    failures
}

/// Startup path: registers whatever it can and reports (rather than aborts on) the rest, so one
/// bad or taken key never leaves the user with no hotkeys at all.
pub fn register_hotkeys(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let (planned, mut failures) = plan_best_effort(&settings_bindings(settings));
    failures.extend(register_planned(app, &planned));
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("; "))
    }
}

pub fn unregister_all(app: &AppHandle) -> Result<(), String> {
    app.global_shortcut()
        .unregister_all()
        .map_err(|e| e.to_string())
}

/// Validates the whole set up front, then swaps it in transactionally: if any key cannot be
/// registered, the previous set is restored and the error is returned.
pub fn apply_hotkeys(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let new_bindings = settings_bindings(settings);
    validate_bindings(&new_bindings)?;
    let new_planned: Vec<Planned> = new_bindings
        .iter()
        .map(|(label, accel)| Ok((*label, accel.clone(), parse_hotkey(accel)?)))
        .collect::<Result<_, String>>()?;

    // Snapshot the keys that are live right now so a failed swap can restore them.
    let previous: Vec<Binding> = app
        .try_state::<Arc<HotkeyState>>()
        .map(|state| {
            let (clip, snip, record, dock, replay) = (
                state.clipboard.lock().clone(),
                state.snip.lock().clone(),
                state.record.lock().clone(),
                state.dock.lock().clone(),
                state.replay.lock().clone(),
            );
            build_bindings(&clip, &snip, &record, &dock, replay.as_deref())
        })
        .unwrap_or_default();

    let _ = unregister_all(app);
    for (label, accel, shortcut) in &new_planned {
        if let Err(e) = app.global_shortcut().register(*shortcut) {
            let mut msg = registration_error(label, accel, e);
            let _ = unregister_all(app);
            let (restore, mut skipped) = plan_best_effort(&previous);
            skipped.extend(register_planned(app, &restore));
            if skipped.is_empty() {
                msg.push_str(". Your previous hotkeys are still active.");
            } else {
                msg.push_str(&format!(
                    ". Some previous hotkeys could not be restored: {}",
                    skipped.join("; ")
                ));
            }
            return Err(msg);
        }
    }

    if let Some(state) = app.try_state::<Arc<HotkeyState>>() {
        *state.clipboard.lock() = settings.hotkey_clipboard.clone();
        *state.snip.lock() = settings.hotkey_snip.clone();
        *state.record.lock() = settings.hotkey_record.clone();
        *state.dock.lock() = settings.hotkey_dock.clone();
        *state.snip_delay_enabled.lock() = settings.snip_delay_enabled;
        *state.snip_delay_ms.lock() = settings.snip_delay_ms;
        *state.replay.lock() = replay_hotkey_of(settings);
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

                // A bad stored key only disables its own action, never the others.
                let clip = parse_hotkey(&clip_str).ok();
                let snip = parse_hotkey(&snip_str).ok();
                let record = parse_hotkey(&record_str).ok();
                let dock = parse_hotkey(&dock_str).ok();
                let replay = app
                    .try_state::<Arc<HotkeyState>>()
                    .and_then(|state| state.replay.lock().clone())
                    .and_then(|r| parse_hotkey(&r).ok());
                let Ok(palette) = parse_hotkey(crate::command_palette::palette_hotkey_string())
                else {
                    return;
                };

                if replay.as_ref().is_some_and(|r| *shortcut == *r) {
                    crate::commands::save_replay_in_background(app.clone());
                } else if clip.as_ref().is_some_and(|c| *shortcut == *c) {
                    let _ = crate::commands::toggle_main_window(app.clone());
                    let _ = app.emit("focus-search", ());
                } else if snip.as_ref().is_some_and(|s| *shortcut == *s) {
                    if snip_delay_enabled && snip_delay_ms > 0 {
                        let _ = crate::commands::delayed_snip(app.clone(), snip_delay_ms);
                    } else {
                        let _ = crate::commands::begin_snip(app.clone(), None);
                    }
                } else if record.as_ref().is_some_and(|r| *shortcut == *r) {
                    let _ = crate::commands::begin_snip(app.clone(), Some("record".into()));
                } else if dock.as_ref().is_some_and(|d| *shortcut == *d) {
                    // Same floating Win+V-style clipboard panel as Alt+C
                    let _ = crate::command_palette::toggle_command_palette(app);
                } else if *shortcut == palette {
                    let _ = crate::command_palette::toggle_command_palette(app);
                }
            })
            .build(),
    )?;
    Ok(())
}

/// Install the shortcut plugin immediately, then register bindings on a background path.
pub fn bootstrap_nonblocking(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    install_plugin(app).map_err(|e| e.to_string())?;
    let handle = app.clone();
    let settings = settings.clone();
    std::thread::spawn(move || {
        if let Err(e) = register_hotkeys(&handle, &settings) {
            eprintln!("hotkey registration skipped: {e}");
            let _ = handle.emit(
                "hotkey-conflict",
                &serde_json::json!({ "message": e }),
            );
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn b(label: &'static str, accel: &str) -> Binding {
        (label, accel.to_string())
    }

    #[test]
    fn validator_accepts_normal_combos() {
        for ok in ["Ctrl+Shift+V", "Alt+Z", "Control+Alt+F10", "Alt+Shift+V", "Win+V"] {
            assert!(validate_hotkey(ok).is_ok(), "{ok} should be accepted");
        }
    }

    #[test]
    fn validator_rejects_missing_modifier_or_key() {
        for bad in ["A", "Shift+A", "Ctrl+Shift", "Ctrl", "F5", "Shift+F25", ""] {
            assert!(validate_hotkey(bad).is_err(), "{bad:?} should be rejected");
        }
    }

    #[test]
    fn validator_allows_shift_with_function_keys() {
        for ok in ["Shift+F12", "shift+f1", "Shift+F24"] {
            assert!(validate_hotkey(ok).is_ok(), "{ok} should be accepted");
        }
        assert!(validate_hotkey("Shift+A").is_err());
        assert!(validate_hotkey("F5").is_err());
    }

    #[test]
    fn validator_rejects_reserved_combos_in_any_case_or_order() {
        for bad in [
            "Ctrl+C",
            "ctrl+v",
            "Control+X",
            "ctrl+z",
            "Ctrl+Y",
            "Ctrl+A",
            "Ctrl+S",
            "alt+f4",
            "Alt+Tab",
            "Alt+Control+Delete",
            "alt+space",
        ] {
            assert!(validate_hotkey(bad).is_err(), "{bad} should be rejected");
        }
        // Near misses stay allowed.
        assert!(validate_hotkey("Ctrl+Shift+S").is_ok());
        assert!(validate_hotkey("Ctrl+Alt+C").is_ok());
    }

    #[test]
    fn validator_keeps_print_screen_rule() {
        let e = validate_hotkey("Ctrl+PrintScreen").unwrap_err();
        assert!(e.contains("Print Screen"), "{e}");
    }

    #[test]
    fn canonical_ignores_case_and_modifier_order() {
        assert_eq!(
            canonical_accelerator("shift+Alt+z"),
            canonical_accelerator("ALT+SHIFT+Z")
        );
        assert_eq!(
            canonical_accelerator("Ctrl+Alt+Q"),
            canonical_accelerator("CommandOrControl+alt+q")
        );
    }

    #[test]
    fn uniqueness_names_both_actions_across_case_and_order() {
        let e = check_unique(&[
            b("Screen recorder", "Alt+Shift+Z"),
            b("Toggle UI", "Control+Shift+V"),
            b("Instant replay", "shift+ALT+z"),
        ])
        .unwrap_err();
        assert_eq!(e, "Screen recorder and Instant replay both use Alt+Shift+Z");
        assert!(check_unique(&[b("A", "Alt+Z"), b("B", "Alt+X")]).is_ok());
    }

    #[test]
    fn bindings_include_replay_only_when_enabled() {
        let mut s = AppSettings::default();
        s.replay_enabled = false;
        let labels: Vec<_> = settings_bindings(&s).iter().map(|b| b.0).collect();
        assert!(!labels.contains(&LABEL_REPLAY));
        assert!(labels.contains(&LABEL_DOCK) && labels.contains(&LABEL_PALETTE));

        s.replay_enabled = true;
        let labels: Vec<_> = settings_bindings(&s).iter().map(|b| b.0).collect();
        assert!(labels.contains(&LABEL_REPLAY));
    }

    #[test]
    fn default_settings_validate() {
        let mut s = AppSettings::default();
        s.replay_enabled = true;
        assert_eq!(validate_bindings(&settings_bindings(&s)), Ok(()));
    }

    #[test]
    fn validation_catches_dock_replay_and_palette_conflicts() {
        let mut s = AppSettings::default();
        s.replay_enabled = true;
        s.replay_hotkey = s.hotkey_record.clone();
        let e = validate_bindings(&settings_bindings(&s)).unwrap_err();
        assert!(e.contains("Screen recorder") && e.contains("Instant replay"), "{e}");

        // Same clash is ignored while replay is disabled.
        s.replay_enabled = false;
        assert!(validate_bindings(&settings_bindings(&s)).is_ok());

        let mut s = AppSettings::default();
        s.hotkey_dock = s.hotkey_snip.to_lowercase();
        let e = validate_bindings(&settings_bindings(&s)).unwrap_err();
        assert!(e.contains("Screenshot snipper") && e.contains("Clipboard popup"), "{e}");

        let mut s = AppSettings::default();
        s.hotkey_clipboard = "alt+c".into();
        let e = validate_bindings(&settings_bindings(&s)).unwrap_err();
        assert!(e.contains("Toggle UI") && e.contains("Command palette"), "{e}");
    }

    #[test]
    fn validation_error_names_the_action() {
        let mut s = AppSettings::default();
        s.hotkey_dock = "Shift+D".into();
        let e = validate_bindings(&settings_bindings(&s)).unwrap_err();
        assert!(e.starts_with("Clipboard popup hotkey:"), "{e}");
    }

    #[test]
    fn best_effort_plan_skips_bad_and_duplicate_keys_but_keeps_the_rest() {
        let (planned, failures) = plan_best_effort(&[
            b("Toggle UI", "Control+Shift+V"),
            b("Screenshot snipper", "Alt+Z"),
            b("Screen recorder", "alt+z"),
            b("Clipboard popup", "Shift+D"),
            b("Command palette", "Alt+C"),
        ]);
        let kept: Vec<_> = planned.iter().map(|p| p.0).collect();
        assert_eq!(kept, ["Toggle UI", "Screenshot snipper", "Command palette"]);
        assert_eq!(failures.len(), 2, "{failures:?}");
        assert!(failures[0].contains("Screenshot snipper and Screen recorder"));
        assert!(failures[1].contains("Clipboard popup"));
    }
}
