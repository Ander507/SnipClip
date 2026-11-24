//! One cheap snapshot of "what is SnipClip doing right now" for the title-bar status pill.
//!
//! Everything here is read-only: replay, recording and clipboard keep owning their own state.

use serde::Serialize;

use crate::{clipboard, recording, replay};

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ReplayInfo {
    pub enabled: bool,
    pub running: bool,
    pub buffered_secs: u32,
    pub target_secs: u32,
    pub error: Option<String>,
    pub encoder: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardInfo {
    pub paused: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    pub replay: ReplayInfo,
    pub recording: recording::RecordingStatus,
    pub clipboard: ClipboardInfo,
}

fn snapshot() -> AppStatus {
    let r = replay::status();
    AppStatus {
        replay: ReplayInfo {
            enabled: r.enabled,
            running: r.running,
            buffered_secs: r.buffered,
            target_secs: r.seconds,
            error: r.error,
            encoder: r.encoder,
        },
        recording: recording::recording_status(),
        clipboard: ClipboardInfo {
            paused: clipboard::is_paused(),
        },
    }
}

/// Polled about once a second by the main window while it is visible. `replay::status()` takes
/// the replay lock (held while a replay restart joins ffmpeg), so this runs off the main thread
/// rather than as a plain sync command, which Tauri would run on the UI thread.
#[tauri::command]
pub async fn app_status() -> Result<AppStatus, String> {
    tauri::async_runtime::spawn_blocking(snapshot)
        .await
        .map_err(|e| e.to_string())
}
