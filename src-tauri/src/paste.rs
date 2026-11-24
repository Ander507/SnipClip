//! Direct auto-paste into the previously focused app (Raycast / Maccy style).
//!
//! Tracks the last non-SnipClip foreground HWND, restores it with the usual
//! AttachThreadInput / SetForegroundWindow dance, then either synthesizes
//! Ctrl+V (clipboard path) or Unicode keystrokes (type-out for sticky fields).

use crate::clipboard;
use crate::db::ClipboardItem;
use crate::transform::{self, TransformKind};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
#[cfg(windows)]
use std::sync::atomic::{AtomicIsize, Ordering};
use std::sync::OnceLock;
use std::thread;
use std::time::Duration;
#[cfg(windows)]
use tauri::Emitter;
use tauri::{AppHandle, Manager};

#[cfg(windows)]
static LAST_TARGET: AtomicIsize = AtomicIsize::new(0);
static TRACKER_STARTED: OnceLock<()> = OnceLock::new();
static LAST_TITLE: OnceLock<Mutex<String>> = OnceLock::new();

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PasteMode {
    /// Stage clipboard, hide SnipClip, focus previous app, SendInput Ctrl+V.
    #[default]
    Paste,
    /// Unicode keystroke injection (apps that block Ctrl+V / password fields).
    TypeOut,
    /// Stage clipboard and hide only — no synthetic paste.
    CopyOnly,
}

/// Key sent between clips when pasting several at once (form filling).
#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FieldKey {
    /// Join everything into one paste instead of walking fields.
    #[default]
    None,
    Tab,
    Enter,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PasteResult {
    pub mode: PasteMode,
    pub target_title: String,
    pub typed: bool,
    pub count: usize,
    pub transform: Option<String>,
    /// A paste was requested but there was no safe app to paste into, so the clip was only
    /// copied and no window was hidden. The UI should say so instead of claiming a paste.
    pub fallback_copy: bool,
}

/// The app a paste would land in, as shown in the "Enter paste into <app>" hint.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PasteTargetInfo {
    pub title: String,
    pub exe: Option<String>,
    /// Short display name derived from the title / exe (e.g. "Visual Studio Code").
    pub name: String,
}

fn last_title_slot() -> &'static Mutex<String> {
    LAST_TITLE.get_or_init(|| Mutex::new(String::new()))
}

/// Poll foreground HWND so vault paste still knows the previous app.
pub fn start_foreground_tracker(app: AppHandle) {
    if TRACKER_STARTED.set(()).is_err() {
        return;
    }
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(175));
        #[cfg(windows)]
        remember_foreign_foreground(&app);
        #[cfg(not(windows))]
        {
            let _ = &app;
        }
    });
}

/// Snapshot the current foreground window if it isn't one of ours (call before focus steal).
pub fn capture_target_now(app: &AppHandle) {
    #[cfg(windows)]
    remember_foreign_foreground(app);
    #[cfg(not(windows))]
    {
        let _ = app;
    }
}

#[cfg(windows)]
fn remember_foreign_foreground(app: &AppHandle) {
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

    let fg = unsafe { GetForegroundWindow() };
    if fg.0.is_null() {
        return;
    }
    // The taskbar, desktop and our own windows never replace the remembered app
    if !is_pastable_target(app, fg) {
        return;
    }
    LAST_TARGET.store(fg.0 as isize, Ordering::SeqCst);
    *last_title_slot().lock() = window_title(fg);
}

/// A window we may paste into: it exists, is visible, is not one of ours and is not the
/// desktop / taskbar / shell flyouts.
#[cfg(windows)]
fn is_pastable_target(app: &AppHandle, hwnd: windows::Win32::Foundation::HWND) -> bool {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowThreadProcessId, IsWindow, IsWindowVisible,
    };

    if hwnd.0.is_null() || !unsafe { IsWindow(Some(hwnd)) }.as_bool() {
        return false;
    }
    if !unsafe { IsWindowVisible(hwnd) }.as_bool() {
        return false;
    }
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    // Any window of this process (file dialogs, toasts, ...) is ours, not just the labelled ones
    if pid == std::process::id() || is_snipclip_hwnd(app, hwnd) {
        return false;
    }
    !is_shell_window_class(&window_class(hwnd))
}

#[cfg(windows)]
fn window_class(hwnd: windows::Win32::Foundation::HWND) -> String {
    use windows::Win32::UI::WindowsAndMessaging::GetClassNameW;
    let mut buf = [0u16; 256];
    let n = unsafe { GetClassNameW(hwnd, &mut buf) };
    if n <= 0 {
        return String::new();
    }
    String::from_utf16_lossy(&buf[..n as usize])
}

/// Executable file name (e.g. `Code.exe`) of the process owning `hwnd`.
#[cfg(windows)]
fn window_exe_name(hwnd: windows::Win32::Foundation::HWND) -> Option<String> {
    use std::os::windows::ffi::OsStringExt;
    use windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;

    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    #[link(name = "kernel32")]
    extern "system" {
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> isize;
        fn CloseHandle(handle: isize) -> i32;
        fn QueryFullProcessImageNameW(
            handle: isize,
            flags: u32,
            exe_name: *mut u16,
            size: *mut u32,
        ) -> i32;
    }

    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    if pid == 0 {
        return None;
    }
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle == 0 {
            return None;
        }
        let mut buf = [0u16; 520];
        let mut size = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(handle, 0, buf.as_mut_ptr(), &mut size);
        CloseHandle(handle);
        if ok == 0 || size == 0 {
            return None;
        }
        let path = std::ffi::OsString::from_wide(&buf[..size as usize]);
        std::path::Path::new(&path)
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
    }
}

/// Window classes of the desktop, taskbar and shell flyouts: never a place to paste.
fn is_shell_window_class(class: &str) -> bool {
    matches!(
        class,
        "Progman"
            | "WorkerW"
            | "Shell_TrayWnd"
            | "Shell_SecondaryTrayWnd"
            | "NotifyIconOverflowWindow"
            | "TopLevelWindowForOverflowXamlIsland"
            | "XamlExplorerHostIslandWindow"
            | "Windows.UI.Core.CoreWindow"
    )
}

/// "Visual Studio Code" from "paste.rs - SnipClip - Visual Studio Code"; falls back to the
/// executable name, then the raw title, so the hint always has something short to show.
fn friendly_app_name(title: &str, exe: Option<&str>) -> String {
    const MAX: usize = 30;
    let title = title.trim();
    if let Some(suffix) = title_suffix(title).filter(|s| s.chars().count() <= MAX) {
        return suffix.to_string();
    }
    if let Some(name) = exe.map(exe_display_name).filter(|s| !s.is_empty()) {
        return name;
    }
    if !title.is_empty() {
        return title.chars().take(MAX).collect();
    }
    "previous app".to_string()
}

/// Final " - " / en / em dash segment of a window title, when it looks like an app name
/// (not a path or a file name).
fn title_suffix(title: &str) -> Option<&str> {
    // The app name is the last segment, so take the shortest tail over all separators
    let tail = [" - ", " \u{2013} ", " \u{2014} "]
        .iter()
        .filter_map(|sep| title.rsplit_once(sep).map(|(_, tail)| tail.trim()))
        .min_by_key(|t| t.len())?;
    let looks_like_file = !tail.contains(' ') && tail.contains('.');
    if tail.is_empty() || tail.contains(['\\', '/']) || looks_like_file {
        return None;
    }
    Some(tail)
}

/// `WindowsTerminal.exe` -> "Windows Terminal", `chrome.exe` -> "Chrome".
fn exe_display_name(exe: &str) -> String {
    let stem = match exe.len().checked_sub(4).and_then(|at| exe.get(at..)) {
        Some(ext) if ext.eq_ignore_ascii_case(".exe") => &exe[..exe.len() - 4],
        _ => exe,
    };
    let mut out = String::with_capacity(stem.len() + 2);
    let mut prev: Option<char> = None;
    for ch in stem.chars() {
        let ch = if ch == '_' || ch == '-' { ' ' } else { ch };
        if ch.is_uppercase() && prev.is_some_and(|p| p.is_lowercase()) {
            out.push(' ');
        }
        out.push(ch);
        prev = Some(ch);
    }
    let out = out.trim().to_string();
    // all-lowercase exe names ("chrome") read better capitalised
    if !out.is_empty() && out.chars().all(|c| !c.is_uppercase()) {
        let mut chars = out.chars();
        let first: String = chars.next().into_iter().flat_map(char::to_uppercase).collect();
        return first + chars.as_str();
    }
    out
}

/// The app a paste would go to right now, or None when there is nothing safe to paste into
/// (no remembered app, it closed, it is hidden, or it is the desktop / taskbar / us).
pub fn paste_target_info(app: &AppHandle) -> Option<PasteTargetInfo> {
    #[cfg(windows)]
    {
        let hwnd = valid_target_hwnd(app)?;
        let title = window_title(hwnd);
        let exe = window_exe_name(hwnd);
        let name = friendly_app_name(&title, exe.as_deref());
        Some(PasteTargetInfo { title, exe, name })
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        None
    }
}

#[cfg(windows)]
fn is_snipclip_hwnd(app: &AppHandle, hwnd: windows::Win32::Foundation::HWND) -> bool {
    for label in [
        "main",
        "command_palette",
        "snipper",
        "screenshot_popup",
        "video_editor",
        "recorder_bar",
    ] {
        if let Some(win) = app.get_webview_window(label) {
            if let Ok(ours) = win.hwnd() {
                if ours.0 == hwnd.0 {
                    return true;
                }
            }
        }
    }
    false
}

#[cfg(windows)]
fn window_title(hwnd: windows::Win32::Foundation::HWND) -> String {
    use windows::Win32::UI::WindowsAndMessaging::GetWindowTextW;
    let mut buf = [0u16; 256];
    let n = unsafe { GetWindowTextW(hwnd, &mut buf) };
    if n <= 0 {
        return String::new();
    }
    String::from_utf16_lossy(&buf[..n as usize])
}

#[cfg(windows)]
fn valid_target_hwnd(app: &AppHandle) -> Option<windows::Win32::Foundation::HWND> {
    use windows::Win32::Foundation::HWND;

    let raw = LAST_TARGET.load(Ordering::SeqCst);
    if raw == 0 {
        return None;
    }
    let hwnd = HWND(raw as *mut _);
    is_pastable_target(app, hwnd).then_some(hwnd)
}

/// One clipboard staging step: either a stored item as-is, or transformed text.
enum Payload<'a> {
    Item(&'a ClipboardItem),
    Text(String),
}

impl Payload<'_> {
    fn stage(&self) -> Result<(), String> {
        match self {
            Payload::Item(item) => stage_item(item),
            Payload::Text(text) => clipboard::write_text_to_clipboard(text),
        }
    }

    #[cfg(windows)]
    fn as_text(&self) -> Option<&str> {
        match self {
            Payload::Item(item) if item_is_textual(item) => Some(clipboard_text_for_item(item)),
            Payload::Text(text) => Some(text.as_str()),
            _ => None,
        }
    }
}

fn build_payloads<'a>(
    items: &'a [ClipboardItem],
    transform: Option<TransformKind>,
    field_key: FieldKey,
) -> Result<Vec<Payload<'a>>, String> {
    let make = |item: &'a ClipboardItem| -> Result<Payload<'a>, String> {
        match transform {
            Some(kind) if item_is_textual(item) => Ok(Payload::Text(transform::apply(
                kind,
                clipboard_text_for_item(item),
            )?)),
            _ => Ok(Payload::Item(item)),
        }
    };

    if field_key != FieldKey::None && items.len() > 1 {
        return items.iter().map(make).collect();
    }

    if items.len() == 1 {
        return Ok(vec![make(&items[0])?]);
    }

    // Several clips, one paste: stitch the text together
    let mut parts: Vec<String> = Vec::with_capacity(items.len());
    for item in items {
        if !item_is_textual(item) {
            continue;
        }
        let text = clipboard_text_for_item(item);
        parts.push(match transform {
            Some(kind) => transform::apply(kind, text)?,
            None => text.to_string(),
        });
    }
    if parts.is_empty() {
        return Err("Select at least one text clip to merge".into());
    }
    Ok(vec![Payload::Text(parts.join("\n"))])
}

/// Stage clips → hide SnipClip → restore previous app → paste / type / tab through fields.
pub fn paste_into_previous(
    app: &AppHandle,
    items: &[ClipboardItem],
    mode: PasteMode,
    transform: Option<TransformKind>,
    field_key: FieldKey,
) -> Result<PasteResult, String> {
    if items.is_empty() {
        return Err("Nothing selected to paste".into());
    }
    let payloads = build_payloads(items, transform, field_key)?;
    let transform_label = transform.map(|k| k.label().to_string());

    if mode == PasteMode::CopyOnly {
        payloads
            .first()
            .ok_or_else(|| "Nothing to copy".to_string())?
            .stage()?;
        hide_snipclip_surfaces(app);
        return Ok(PasteResult {
            mode,
            target_title: last_title_slot().lock().clone(),
            typed: false,
            count: payloads.len(),
            transform: transform_label,
            fallback_copy: false,
        });
    }

    #[cfg(not(windows))]
    {
        payloads
            .first()
            .ok_or_else(|| "Nothing to copy".to_string())?
            .stage()?;
        hide_snipclip_surfaces(app);
        return Ok(PasteResult {
            mode: PasteMode::CopyOnly,
            target_title: String::new(),
            typed: false,
            count: payloads.len(),
            transform: transform_label,
            fallback_copy: true,
        });
    }

    #[cfg(windows)]
    {
        // Only ever paste into a verified app. Without one, leave the clip on the clipboard
        // and keep SnipClip open so the UI can say "Copied — no app to paste into".
        let Some(target) = valid_target_hwnd(app) else {
            payloads
                .first()
                .ok_or_else(|| "Nothing to copy".to_string())?
                .stage()?;
            return Ok(PasteResult {
                mode: PasteMode::CopyOnly,
                target_title: String::new(),
                typed: false,
                count: payloads.len(),
                transform: transform_label,
                fallback_copy: true,
            });
        };

        hide_snipclip_surfaces(app);
        // let the OS hand focus back before we force the stored HWND
        thread::sleep(Duration::from_millis(45));

        focus_hwnd(target)?;
        thread::sleep(Duration::from_millis(35));
        release_stuck_modifiers();

        let mut typed_any = false;
        let last = payloads.len().saturating_sub(1);
        for (index, payload) in payloads.iter().enumerate() {
            let type_out = mode == PasteMode::TypeOut && payload.as_text().is_some();
            if type_out {
                type_unicode(payload.as_text().unwrap_or_default())?;
                typed_any = true;
            } else {
                payload.stage()?;
                // clipboard owner change needs a beat before the target reads it
                thread::sleep(Duration::from_millis(25));
                send_ctrl_v()?;
            }
            if index < last {
                thread::sleep(Duration::from_millis(60));
                match field_key {
                    FieldKey::Tab => send_vk(0x09)?,
                    FieldKey::Enter => send_vk(0x0D)?,
                    FieldKey::None => {}
                }
                thread::sleep(Duration::from_millis(40));
            }
        }

        let title = window_title(target);
        if !title.is_empty() {
            *last_title_slot().lock() = title.clone();
        }

        let result = PasteResult {
            mode: if typed_any {
                PasteMode::TypeOut
            } else {
                PasteMode::Paste
            },
            target_title: title,
            typed: typed_any,
            count: payloads.len(),
            transform: transform_label,
            fallback_copy: false,
        };
        let _ = app.emit("paste-done", &result);
        Ok(result)
    }
}

fn item_is_textual(item: &ClipboardItem) -> bool {
    !matches!(
        item.content_type.as_str(),
        "image" | "screenshot" | "video" | "gif"
    )
}

fn clipboard_text_for_item(item: &ClipboardItem) -> &str {
    if item.content_type == "math" {
        if let Some((expr, _)) = item.content.split_once('\n') {
            return expr;
        }
    }
    item.content.as_str()
}

fn stage_item(item: &ClipboardItem) -> Result<(), String> {
    match item.content_type.as_str() {
        "image" | "screenshot" => {
            if item.content.is_empty() {
                return Err("image data not available — try again from the vault".into());
            }
            clipboard::write_image_to_clipboard(&item.content)
        }
        "video" | "gif" => {
            let path = std::path::PathBuf::from(&item.content);
            clipboard::write_files_to_clipboard(&[path])
        }
        _ => clipboard::write_text_to_clipboard(clipboard_text_for_item(item)),
    }
}

fn hide_snipclip_surfaces(app: &AppHandle) {
    let _ = crate::command_palette::hide_command_palette(app);
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }
    clipboard::set_main_ui_visible(false);
}

#[cfg(windows)]
fn focus_hwnd(hwnd: windows::Win32::Foundation::HWND) -> Result<(), String> {
    use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use windows::Win32::UI::WindowsAndMessaging::{
        AllowSetForegroundWindow, BringWindowToTop, GetForegroundWindow, GetWindowThreadProcessId,
        IsIconic, SetForegroundWindow, ShowWindow, ASFW_ANY, SW_RESTORE,
    };

    unsafe {
        let _ = AllowSetForegroundWindow(ASFW_ANY);

        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        }

        let mut target_pid = 0u32;
        let target_tid = GetWindowThreadProcessId(hwnd, Some(&mut target_pid));
        let fg = GetForegroundWindow();
        let mut fg_pid = 0u32;
        let fg_tid = if !fg.0.is_null() {
            GetWindowThreadProcessId(fg, Some(&mut fg_pid))
        } else {
            0
        };
        let our_tid = GetCurrentThreadId();

        let attached_fg = fg_tid != 0 && fg_tid != our_tid && AttachThreadInput(our_tid, fg_tid, true).as_bool();
        let attached_target =
            target_tid != 0 && target_tid != our_tid && AttachThreadInput(our_tid, target_tid, true).as_bool();

        let _ = BringWindowToTop(hwnd);
        let ok = SetForegroundWindow(hwnd).as_bool();

        if attached_target {
            let _ = AttachThreadInput(our_tid, target_tid, false);
        }
        if attached_fg {
            let _ = AttachThreadInput(our_tid, fg_tid, false);
        }

        if !ok {
            // one more try after a short yield — Windows focus rules are hostile
            thread::sleep(Duration::from_millis(20));
            let _ = AllowSetForegroundWindow(ASFW_ANY);
            if !SetForegroundWindow(hwnd).as_bool() {
                return Err("Could not focus the previous window (Windows blocked it)".into());
            }
        }
    }
    Ok(())
}

#[cfg(windows)]
fn release_stuck_modifiers() {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
        VIRTUAL_KEY, VK_CONTROL, VK_LCONTROL, VK_LMENU, VK_LSHIFT, VK_LWIN, VK_MENU, VK_RCONTROL,
        VK_RMENU, VK_RSHIFT, VK_RWIN, VK_SHIFT,
    };

    const KEYS: [VIRTUAL_KEY; 11] = [
        VK_SHIFT,
        VK_LSHIFT,
        VK_RSHIFT,
        VK_CONTROL,
        VK_LCONTROL,
        VK_RCONTROL,
        VK_MENU,
        VK_LMENU,
        VK_RMENU,
        VK_LWIN,
        VK_RWIN,
    ];

    let mut inputs: Vec<INPUT> = Vec::new();
    for vk in KEYS {
        let down = unsafe { GetAsyncKeyState(vk.0 as i32) } as u16 & 0x8000 != 0;
        if down {
            inputs.push(INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: vk,
                        wScan: 0,
                        dwFlags: KEYEVENTF_KEYUP,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            });
        }
    }
    if !inputs.is_empty() {
        unsafe {
            let _ = SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
        }
    }
}

#[cfg(windows)]
fn send_ctrl_v() -> Result<(), String> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        MapVirtualKeyW, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
        KEYEVENTF_SCANCODE, MAPVK_VK_TO_VSC, VIRTUAL_KEY, VK_CONTROL,
    };

    // scan-code path survives more apps than virtual-key-only injection
    let vk_v = VIRTUAL_KEY(0x56); // 'V'
    let scan_ctrl = unsafe { MapVirtualKeyW(VK_CONTROL.0 as u32, MAPVK_VK_TO_VSC) } as u16;
    let scan_v = unsafe { MapVirtualKeyW(vk_v.0 as u32, MAPVK_VK_TO_VSC) } as u16;

    let key = |vk: VIRTUAL_KEY, scan: u16, up: bool| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: scan,
                dwFlags: if up {
                    KEYEVENTF_KEYUP | KEYEVENTF_SCANCODE
                } else {
                    KEYEVENTF_SCANCODE
                },
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };

    let inputs = [
        key(VK_CONTROL, scan_ctrl, false),
        key(vk_v, scan_v, false),
        key(vk_v, scan_v, true),
        key(VK_CONTROL, scan_ctrl, true),
    ];

    let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
    if sent != inputs.len() as u32 {
        return Err(format!(
            "SendInput Ctrl+V incomplete ({sent}/{})",
            inputs.len()
        ));
    }
    Ok(())
}

/// Single virtual-key tap — moves between fields when pasting a batch.
#[cfg(windows)]
fn send_vk(vk: u16) -> Result<(), String> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        MapVirtualKeyW, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
        KEYEVENTF_SCANCODE, MAPVK_VK_TO_VSC, VIRTUAL_KEY,
    };

    let key = VIRTUAL_KEY(vk);
    let scan = unsafe { MapVirtualKeyW(vk as u32, MAPVK_VK_TO_VSC) } as u16;
    let make = |up: bool| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: key,
                wScan: scan,
                dwFlags: if up {
                    KEYEVENTF_KEYUP | KEYEVENTF_SCANCODE
                } else {
                    KEYEVENTF_SCANCODE
                },
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    let inputs = [make(false), make(true)];
    let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
    if sent != inputs.len() as u32 {
        return Err("SendInput field key failed".into());
    }
    Ok(())
}

#[cfg(windows)]
fn type_unicode(text: &str) -> Result<(), String> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE,
        VIRTUAL_KEY,
    };

    // hard cap so we don't brick the UI typing a novel
    const MAX_CHARS: usize = 8_000;
    let mut inputs: Vec<INPUT> = Vec::with_capacity(text.len().min(MAX_CHARS) * 2);

    for ch in text.chars().take(MAX_CHARS) {
        if ch == '\n' || ch == '\r' {
            // Enter
            let vk = VIRTUAL_KEY(0x0D);
            inputs.push(INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: vk,
                        wScan: 0,
                        dwFlags: Default::default(),
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            });
            inputs.push(INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: vk,
                        wScan: 0,
                        dwFlags: KEYEVENTF_KEYUP,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            });
            continue;
        }
        if ch == '\t' {
            let vk = VIRTUAL_KEY(0x09);
            inputs.push(INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: vk,
                        wScan: 0,
                        dwFlags: Default::default(),
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            });
            inputs.push(INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: vk,
                        wScan: 0,
                        dwFlags: KEYEVENTF_KEYUP,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            });
            continue;
        }

        let mut utf16 = [0u16; 2];
        for unit in ch.encode_utf16(&mut utf16) {
            let scan = *unit;
            inputs.push(INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VIRTUAL_KEY(0),
                        wScan: scan,
                        dwFlags: KEYEVENTF_UNICODE,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            });
            inputs.push(INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VIRTUAL_KEY(0),
                        wScan: scan,
                        dwFlags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            });
        }
    }

    // chunked SendInput — some hosts drop huge batches
    const CHUNK: usize = 64;
    for chunk in inputs.chunks(CHUNK) {
        let sent = unsafe { SendInput(chunk, std::mem::size_of::<INPUT>() as i32) };
        if sent != chunk.len() as u32 {
            return Err(format!(
                "SendInput type-out incomplete ({sent}/{})",
                chunk.len()
            ));
        }
        thread::sleep(Duration::from_millis(2));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_classes_are_rejected() {
        for class in [
            "Progman",
            "WorkerW",
            "Shell_TrayWnd",
            "Shell_SecondaryTrayWnd",
            "Windows.UI.Core.CoreWindow",
        ] {
            assert!(is_shell_window_class(class), "{class}");
        }
        for class in ["Chrome_WidgetWin_1", "Notepad", "CabinetWClass", "ApplicationFrameWindow", ""] {
            assert!(!is_shell_window_class(class), "{class}");
        }
    }

    #[test]
    fn app_name_comes_from_the_last_title_segment() {
        assert_eq!(
            friendly_app_name("paste.rs - SnipClip - Visual Studio Code", Some("Code.exe")),
            "Visual Studio Code"
        );
        assert_eq!(
            friendly_app_name("Inbox \u{2014} Google Chrome", Some("chrome.exe")),
            "Google Chrome"
        );
        assert_eq!(friendly_app_name("Untitled - Notepad", None), "Notepad");
    }

    #[test]
    fn app_name_falls_back_to_exe_then_title() {
        // a title ending in a file name is not an app name
        assert_eq!(friendly_app_name("Editing - notes.txt", Some("notepad.exe")), "Notepad");
        assert_eq!(friendly_app_name("", Some("WindowsTerminal.exe")), "Windows Terminal");
        assert_eq!(friendly_app_name("Calculator", None), "Calculator");
        assert_eq!(friendly_app_name("   ", None), "previous app");
        // overly long tail is not shown
        let long = format!("a - {}", "x".repeat(60));
        assert_eq!(friendly_app_name(&long, Some("foo.exe")), "Foo");
    }

    #[test]
    fn exe_names_are_prettified() {
        assert_eq!(exe_display_name("chrome.exe"), "Chrome");
        assert_eq!(exe_display_name("WindowsTerminal.EXE"), "Windows Terminal");
        assert_eq!(exe_display_name("notepad++"), "Notepad++");
        assert_eq!(exe_display_name("Discord.exe"), "Discord");
        assert_eq!(exe_display_name(".exe"), "");
    }
}
