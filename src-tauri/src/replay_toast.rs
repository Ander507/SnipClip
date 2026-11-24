//! Medal-style "Clip saved" feedback for instant replay: a small corner toast that never
//! takes focus or clicks (so a fullscreen game keeps running), plus a short chime.
//!
//! The toast window is excluded from screen capture, so it never shows up in later clips.

use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Position, Size};

pub const LABEL: &str = "replay_toast";
const TOAST_W: f64 = 300.0;
const TOAST_H: f64 = 64.0;
const MARGIN: f64 = 20.0;
const VISIBLE_MS: u64 = 2600;
const FADE_MS: u64 = 220;

/// Bumped on every show so an older hide timer can't close a newer toast.
static GENERATION: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ToastPayload {
    pub id: u64,
    /// "saving" | "saved" | "error"
    pub state: &'static str,
    pub title: String,
    pub detail: String,
}

/// Show (or update) the toast. `saving` stays up until replaced; the others auto-hide.
pub fn show(app: &AppHandle, state: &'static str, title: impl Into<String>, detail: impl Into<String>) {
    let Some(win) = app.get_webview_window(LABEL) else {
        return;
    };
    let id = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;

    // Top-right of the primary monitor's work area, sized for its DPI.
    if let Ok(Some(mon)) = win.primary_monitor().or_else(|_| win.current_monitor()) {
        let scale = mon.scale_factor();
        let area = mon.work_area();
        let w = (TOAST_W * scale).round() as i32;
        let h = (TOAST_H * scale).round() as i32;
        let margin = (MARGIN * scale).round() as i32;
        let x = area.position.x + area.size.width as i32 - w - margin;
        let y = area.position.y + margin;
        let _ = win.set_size(Size::Physical(PhysicalSize::new(w.max(1) as u32, h.max(1) as u32)));
        let _ = win.set_position(Position::Physical(PhysicalPosition::new(x, y)));
    }
    let _ = win.set_content_protected(true);
    let _ = win.set_ignore_cursor_events(true);
    let _ = win.emit(
        "replay-toast",
        ToastPayload {
            id,
            state,
            title: title.into(),
            detail: detail.into(),
        },
    );
    show_without_activating(&win);

    if state != "saving" {
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(VISIBLE_MS));
            if GENERATION.load(Ordering::SeqCst) != id {
                return;
            }
            if let Some(win) = app.get_webview_window(LABEL) {
                let _ = win.emit("replay-toast-hide", id);
                std::thread::sleep(Duration::from_millis(FADE_MS));
                if GENERATION.load(Ordering::SeqCst) == id {
                    let _ = win.hide();
                }
            }
        });
    }
}

#[cfg(windows)]
fn show_without_activating(win: &tauri::WebviewWindow) {
    // Tauri's show() activates the window, which would minimise an exclusive-fullscreen
    // game. Mark it no-activate + tool window, then show it with SW_SHOWNOACTIVATE.
    #[link(name = "user32")]
    extern "system" {
        fn GetWindowLongPtrW(hwnd: isize, index: i32) -> isize;
        fn SetWindowLongPtrW(hwnd: isize, index: i32, value: isize) -> isize;
        fn SetWindowPos(hwnd: isize, after: isize, x: i32, y: i32, cx: i32, cy: i32, flags: u32) -> i32;
        fn ShowWindow(hwnd: isize, cmd: i32) -> i32;
    }
    const GWL_EXSTYLE: i32 = -20;
    const WS_EX_TOOLWINDOW: isize = 0x0000_0080;
    const WS_EX_NOACTIVATE: isize = 0x0800_0000;
    const HWND_TOPMOST: isize = -1;
    const SWP_NOSIZE: u32 = 0x0001;
    const SWP_NOMOVE: u32 = 0x0002;
    const SWP_NOACTIVATE: u32 = 0x0010;
    const SWP_SHOWWINDOW: u32 = 0x0040;
    const SW_SHOWNOACTIVATE: i32 = 4;

    let Ok(hwnd) = win.hwnd() else {
        let _ = win.show();
        return;
    };
    let hwnd = hwnd.0 as isize;
    unsafe {
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW);
        ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        SetWindowPos(
            hwnd,
            HWND_TOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
        );
    }
}

#[cfg(not(windows))]
fn show_without_activating(win: &tauri::WebviewWindow) {
    let _ = win.show();
}

// ---------------------------------------------------------------- sound

/// Plays a short built-in chime (rising two notes on success, falling on error).
/// Generated in code so it plays even when Windows system sounds are muted.
pub fn play_sound(ok: bool) {
    static SAVED: OnceLock<Vec<u8>> = OnceLock::new();
    static FAILED: OnceLock<Vec<u8>> = OnceLock::new();
    let wav = if ok {
        SAVED.get_or_init(|| chime(&[(880.0, 0.0), (1318.5, 0.085)], 0.42))
    } else {
        FAILED.get_or_init(|| chime(&[(392.0, 0.0), (277.2, 0.11)], 0.5))
    };
    #[cfg(windows)]
    {
        #[link(name = "winmm")]
        extern "system" {
            fn PlaySoundW(sound: *const u8, module: isize, flags: u32) -> i32;
        }
        const SND_ASYNC: u32 = 0x0001;
        const SND_NODEFAULT: u32 = 0x0002;
        const SND_MEMORY: u32 = 0x0004;
        // The bytes live in a static, so they outlive the async playback.
        unsafe {
            PlaySoundW(wav.as_ptr(), 0, SND_MEMORY | SND_ASYNC | SND_NODEFAULT);
        }
    }
    #[cfg(not(windows))]
    let _ = wav;
}

/// Sine notes `(hz, start_seconds)` with a soft attack and exponential decay, as a WAV.
fn chime(notes: &[(f64, f64)], length_s: f64) -> Vec<u8> {
    const RATE: u32 = 44_100;
    let n = (length_s * RATE as f64) as usize;
    let mut samples = vec![0f64; n];
    for &(hz, start) in notes {
        let first = (start * RATE as f64) as usize;
        for (i, s) in samples.iter_mut().enumerate().skip(first) {
            let t = (i - first) as f64 / RATE as f64;
            let attack = (t / 0.006).min(1.0);
            let env = attack * (-t / 0.09).exp();
            let phase = 2.0 * std::f64::consts::PI * hz * t;
            *s += env * (phase.sin() + 0.18 * (2.0 * phase).sin());
        }
    }
    // Fade the tail to zero so the end never clicks.
    let tail = (0.03 * RATE as f64) as usize;
    for i in 0..tail.min(n) {
        samples[n - 1 - i] *= i as f64 / tail as f64;
    }
    let peak = samples.iter().fold(0f64, |m, s| m.max(s.abs())).max(1e-9);
    let gain = 0.32 / peak;

    let data_len = (n * 2) as u32;
    let mut out = Vec::with_capacity(44 + n * 2);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&1u16.to_le_bytes()); // mono
    out.extend_from_slice(&RATE.to_le_bytes());
    out.extend_from_slice(&(RATE * 2).to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for s in samples {
        let v = (s * gain * i16::MAX as f64).round().clamp(i16::MIN as f64, i16::MAX as f64) as i16;
        out.extend_from_slice(&v.to_le_bytes());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chime_is_valid_wav() {
        let wav = chime(&[(880.0, 0.0), (1318.5, 0.085)], 0.42);
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        let data_len = u32::from_le_bytes(wav[40..44].try_into().unwrap()) as usize;
        assert_eq!(wav.len(), 44 + data_len);
        // Starts and ends silent (no clicks).
        assert_eq!(i16::from_le_bytes([wav[44], wav[45]]), 0);
        assert_eq!(i16::from_le_bytes([wav[wav.len() - 2], wav[wav.len() - 1]]), 0);
    }
}
