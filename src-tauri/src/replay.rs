//! Instant replay ("clip the last N seconds"), Medal / ShadowPlay style.
//!
//! One long-running ffmpeg process captures the desktop (DXGI Desktop Duplication via
//! `ddagrab`, falling back to `gdigrab`), encodes on the GPU when possible, and writes
//! 1-second MPEG-TS segments into a temp folder. A supervisor thread restarts ffmpeg if
//! it dies (e.g. a display mode change) and deletes segments older than the buffer.
//!
//! Desktop audio comes from WASAPI loopback and is piped into the same ffmpeg process.
//! Video and audio share one wall clock: video pts = `RTCTIME - T0`, and the audio pump
//! writes exactly one sample per 1/48000 s since T0 (zero-filling silence and dropping
//! overrun), so segments stay in sync without per-segment timestamp resets.
//!
//! Saving a clip waits for the in-progress segment to close, then losslessly concatenates
//! the last N segments (`concat:` protocol + `-c copy`) into an mp4.

use crate::db::AppSettings;
use crate::recording::{ffmpeg_binary, ffmpeg_command, recordings_dir, spawn_stderr_drain};
use parking_lot::Mutex;
use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub const MIN_SECONDS: u32 = 5;
pub const MAX_SECONDS: u32 = 600;
const SEGMENT_SECONDS: u32 = 1;
/// Extra segments kept beyond the buffer so a save in progress never races the janitor.
const KEEP_MARGIN: u64 = 4;
const SAMPLE_RATE: u64 = 48_000;
const FRAME_BYTES: usize = 8; // f32 stereo

#[derive(Clone, Debug, PartialEq)]
pub struct ReplayConfig {
    pub seconds: u32,
    pub fps: u32,
    pub quality: String,
    pub resolution: String,
    pub monitor: u32,
    pub audio: bool,
}

impl ReplayConfig {
    pub fn from_settings(s: &AppSettings) -> Self {
        Self {
            seconds: s.replay_seconds.clamp(MIN_SECONDS, MAX_SECONDS),
            fps: if s.replay_fps >= 60 { 60 } else { 30 },
            quality: s.replay_quality.clone(),
            resolution: s.replay_resolution.clone(),
            monitor: s.replay_monitor.min(15),
            audio: s.replay_audio,
        }
    }

    fn bitrate_mbps(&self) -> u32 {
        match self.quality.as_str() {
            "low" => 8,
            "high" => 30,
            _ => 16,
        }
    }

    fn target_height(&self) -> Option<u32> {
        match self.resolution.as_str() {
            "1080p" => Some(1080),
            "720p" => Some(720),
            _ => None,
        }
    }
}

#[derive(Serialize, Clone, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ReplayStatus {
    pub enabled: bool,
    pub running: bool,
    pub saving: bool,
    pub seconds: u32,
    /// Seconds of footage currently buffered (≤ `seconds`).
    pub buffered: u32,
    pub encoder: Option<String>,
    pub source: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
enum Source {
    DdaGrab,
    GdiGrab,
}

#[derive(Clone, Debug)]
struct Pipeline {
    source: Source,
    encoder: &'static str,
    /// Encoder takes the D3D11 frames from ddagrab directly (no download to RAM).
    gpu_frames: bool,
}

impl Pipeline {
    fn label(&self) -> String {
        let enc = match self.encoder {
            "h264_nvenc" => "NVIDIA NVENC",
            "h264_amf" => "AMD AMF",
            "h264_qsv" => "Intel Quick Sync",
            _ => "CPU (x264)",
        };
        enc.to_string()
    }
}

struct Shared {
    stop: AtomicBool,
    saving: AtomicBool,
    /// First segment index written by the current ffmpeg run; older ones use another clock.
    run_first: AtomicU64,
    status: Mutex<ReplayStatus>,
}

struct Replay {
    config: ReplayConfig,
    dir: PathBuf,
    shared: Arc<Shared>,
    supervisor: Option<JoinHandle<()>>,
}

static REPLAY: Mutex<Option<Replay>> = Mutex::new(None);

pub fn replay_dir() -> PathBuf {
    std::env::temp_dir().join("snipclip-replay")
}

// ---------------------------------------------------------------- lifecycle

/// Start, restart or stop the buffer to match settings. Cheap when nothing changed.
pub fn apply_settings(settings: &AppSettings) {
    let want = settings.replay_enabled.then(|| ReplayConfig::from_settings(settings));
    let mut guard = REPLAY.lock();
    if let (Some(cur), Some(next)) = (guard.as_ref(), want.as_ref()) {
        if cur.config == *next {
            return;
        }
    }
    if let Some(old) = guard.take() {
        shutdown(old);
    }
    if let Some(config) = want {
        *guard = Some(start(config));
    }
}

pub fn stop() {
    if let Some(old) = REPLAY.lock().take() {
        shutdown(old);
    }
}

pub fn is_saving() -> bool {
    REPLAY
        .lock()
        .as_ref()
        .is_some_and(|r| r.shared.saving.load(Ordering::SeqCst))
}

pub fn status() -> ReplayStatus {
    match REPLAY.lock().as_ref() {
        Some(r) => {
            let mut s = r.shared.status.lock().clone();
            s.saving = r.shared.saving.load(Ordering::SeqCst);
            if s.running {
                let first = r.shared.run_first.load(Ordering::SeqCst);
                let have = list_segments(&r.dir)
                    .into_iter()
                    .filter(|i| *i >= first)
                    .count()
                    .saturating_sub(1) as u32;
                s.buffered = (have * SEGMENT_SECONDS).min(s.seconds);
            }
            s
        }
        None => ReplayStatus::default(),
    }
}

fn start(config: ReplayConfig) -> Replay {
    let dir = replay_dir();
    let _ = fs::create_dir_all(&dir);
    clear_segments(&dir);
    let shared = Arc::new(Shared {
        stop: AtomicBool::new(false),
        saving: AtomicBool::new(false),
        run_first: AtomicU64::new(0),
        status: Mutex::new(ReplayStatus {
            enabled: true,
            seconds: config.seconds,
            ..Default::default()
        }),
    });
    let supervisor = {
        let (config, dir, shared) = (config.clone(), dir.clone(), shared.clone());
        thread::Builder::new()
            .name("replay-supervisor".into())
            .spawn(move || supervise(config, dir, shared))
            .ok()
    };
    Replay {
        config,
        dir,
        shared,
        supervisor,
    }
}

fn shutdown(mut replay: Replay) {
    replay.shared.stop.store(true, Ordering::SeqCst);
    if let Some(join) = replay.supervisor.take() {
        let _ = join.join();
    }
    // A save may still be reading segments; it removes nothing, so only skip if busy.
    if !replay.shared.saving.load(Ordering::SeqCst) {
        clear_segments(&replay.dir);
    }
}

fn set_status(shared: &Shared, f: impl FnOnce(&mut ReplayStatus)) {
    f(&mut shared.status.lock());
}

// ---------------------------------------------------------------- supervisor

struct Run {
    child: Child,
    stderr: Option<JoinHandle<String>>,
    audio_stop: Arc<AtomicBool>,
    audio: Option<JoinHandle<()>>,
}

impl Run {
    fn kill(mut self) -> String {
        self.audio_stop.store(true, Ordering::SeqCst);
        let _ = self.child.kill();
        let _ = self.child.wait();
        if let Some(a) = self.audio.take() {
            let _ = a.join();
        }
        self.stderr
            .take()
            .and_then(|h| h.join().ok())
            .unwrap_or_default()
    }
}

fn supervise(config: ReplayConfig, dir: PathBuf, shared: Arc<Shared>) {
    let ffmpeg = match ffmpeg_binary() {
        Ok(p) => p,
        Err(e) => {
            set_status(&shared, |s| s.error = Some(format!("ffmpeg unavailable: {e}")));
            return;
        }
    };

    // Probed lazily and again after repeated crashes: a probe that ran while the desktop was
    // unavailable (lock screen, UAC prompt, exclusive fullscreen) must not pin the whole
    // session to the slow fallback, or leave replay dead until the app restarts.
    let mut chosen: Option<Pipeline> = None;
    let mut failures = 0u32;
    while !shared.stop.load(Ordering::SeqCst) {
        let pipeline = match chosen.clone() {
            Some(p) => p,
            None => match probe_pipeline(&ffmpeg, &config, &shared.stop) {
                Some(p) => {
                    set_status(&shared, |s| {
                        s.encoder = Some(p.label());
                        s.source = Some(match p.source {
                            Source::DdaGrab => "Desktop Duplication".into(),
                            Source::GdiGrab => "GDI (fallback)".into(),
                        });
                    });
                    chosen = Some(p.clone());
                    p
                }
                None => {
                    set_status(&shared, |s| {
                        s.running = false;
                        s.error =
                            Some("No working screen capture + encoder found — retrying".into())
                    });
                    failures += 1;
                    if sleep_unless_stopped(&shared.stop, backoff(failures)) {
                        break;
                    }
                    continue;
                }
            },
        };
        let start_index = list_segments(&dir).last().map(|i| i + 1).unwrap_or(0);
        shared.run_first.store(start_index, Ordering::SeqCst);
        let mut run = match spawn_run(&ffmpeg, &config, &pipeline, &dir, start_index) {
            Ok(r) => r,
            Err(e) => {
                set_status(&shared, |s| {
                    s.running = false;
                    s.error = Some(e);
                });
                failures += 1;
                if sleep_unless_stopped(&shared.stop, backoff(failures)) {
                    break;
                }
                continue;
            }
        };
        set_status(&shared, |s| {
            s.running = true;
            s.error = None;
        });
        let started = Instant::now();

        let mut last_janitor = Instant::now();
        let exited = loop {
            if shared.stop.load(Ordering::SeqCst) {
                break false;
            }
            if let Ok(Some(_)) = run.child.try_wait() {
                break true;
            }
            if last_janitor.elapsed() >= Duration::from_secs(2) {
                last_janitor = Instant::now();
                if !shared.saving.load(Ordering::SeqCst) {
                    prune(&dir, config.seconds as u64 + KEEP_MARGIN);
                }
            }
            thread::sleep(Duration::from_millis(200));
        };

        let log = run.kill();
        if !exited {
            break;
        }
        // ffmpeg died on its own (lost the duplication output on a mode switch, GPU reset…)
        let tail: String = log.lines().rev().take(3).collect::<Vec<_>>().join(" | ");
        eprintln!("replay ffmpeg exited: {tail}");
        failures = if started.elapsed() > Duration::from_secs(30) { 1 } else { failures + 1 };
        if failures >= 2 {
            chosen = None;
        }
        set_status(&shared, |s| {
            s.running = false;
            s.error = Some(if tail.is_empty() {
                "capture stopped unexpectedly — restarting".into()
            } else {
                format!("capture restarting: {tail}")
            });
        });
        if sleep_unless_stopped(&shared.stop, backoff(failures)) {
            break;
        }
    }
    set_status(&shared, |s| s.running = false);
}

fn backoff(failures: u32) -> Duration {
    Duration::from_millis((500u64 << failures.min(5)).min(15_000))
}

/// Returns true if stop was requested while waiting.
fn sleep_unless_stopped(stop: &AtomicBool, total: Duration) -> bool {
    let end = Instant::now() + total;
    while Instant::now() < end {
        if stop.load(Ordering::SeqCst) {
            return true;
        }
        thread::sleep(Duration::from_millis(100));
    }
    stop.load(Ordering::SeqCst)
}

// ---------------------------------------------------------------- ffmpeg args

/// Returns (input args, output-side video filter args). `-vf` is an output option, so it must
/// come after every `-i`; placed right after the gdigrab input it would be applied to the
/// audio pipe and ffmpeg would refuse to start.
fn video_input_args(
    config: &ReplayConfig,
    pipeline: &Pipeline,
    t0_us: Option<u128>,
) -> (Vec<String>, Vec<String>) {
    // Wall-clock timestamps so the separately piped audio lines up (see module docs).
    let clock = match t0_us {
        Some(t0) => format!("settb=1/1000000,setpts=RTCTIME-{t0}"),
        None => "null".to_string(),
    };
    let mut cpu_chain = Vec::new();
    if !pipeline.gpu_frames {
        if pipeline.source == Source::DdaGrab {
            cpu_chain.push("hwdownload,format=bgra".to_string());
        }
        if let Some(h) = config.target_height() {
            cpu_chain.push(format!("scale=-2:{h}:flags=fast_bilinear"));
        }
        cpu_chain.push("format=nv12".to_string());
    }
    let fps = config.fps;
    match pipeline.source {
        Source::DdaGrab => {
            let mut graph = format!(
                "ddagrab=output_idx={}:framerate={fps}:draw_mouse=1,{clock}",
                config.monitor
            );
            for f in &cpu_chain {
                graph.push(',');
                graph.push_str(f);
            }
            (vec!["-f".into(), "lavfi".into(), "-i".into(), graph], Vec::new())
        }
        Source::GdiGrab => {
            let mut vf = vec![clock];
            vf.extend(cpu_chain);
            (
                vec![
                    "-f".into(),
                    "gdigrab".into(),
                    "-framerate".into(),
                    fps.to_string(),
                    "-draw_mouse".into(),
                    "1".into(),
                    "-i".into(),
                    "desktop".into(),
                ],
                vec!["-vf".into(), vf.join(",")],
            )
        }
    }
}

fn encoder_args(config: &ReplayConfig, encoder: &str) -> Vec<String> {
    let b = config.bitrate_mbps();
    let rate = [
        "-b:v".to_string(),
        format!("{b}M"),
        "-maxrate".into(),
        format!("{}M", b * 3 / 2),
        "-bufsize".into(),
        format!("{}M", b * 2),
    ];
    let mut args: Vec<String> = vec!["-c:v".into(), encoder.into()];
    let extra: &[&str] = match encoder {
        "h264_nvenc" => &["-preset", "p4", "-rc", "vbr", "-forced-idr", "1"],
        "h264_amf" => &["-quality", "speed", "-rc", "vbr_peak"],
        "h264_qsv" => &["-preset", "veryfast"],
        _ => &["-preset", "ultrafast"],
    };
    args.extend(extra.iter().map(|s| s.to_string()));
    args.extend(rate);
    // A keyframe every second so every segment starts cleanly and clips cut on the second.
    args.extend([
        "-g".into(),
        (config.fps * SEGMENT_SECONDS).to_string(),
        "-force_key_frames".into(),
        format!("expr:gte(t,n_forced*{SEGMENT_SECONDS})"),
    ]);
    args
}

fn probe_pipeline(ffmpeg: &Path, config: &ReplayConfig, stop: &AtomicBool) -> Option<Pipeline> {
    let native = config.target_height().is_none();
    let mut candidates = Vec::new();
    for source in [Source::DdaGrab, Source::GdiGrab] {
        for encoder in ["h264_nvenc", "h264_amf", "h264_qsv", "libx264"] {
            let gpu_frames = source == Source::DdaGrab
                && native
                && matches!(encoder, "h264_nvenc" | "h264_amf");
            candidates.push(Pipeline {
                source: source.clone(),
                encoder,
                gpu_frames,
            });
        }
    }
    for p in candidates {
        if stop.load(Ordering::SeqCst) {
            return None;
        }
        let mut args: Vec<String> = vec!["-hide_banner".into(), "-loglevel".into(), "error".into(), "-nostdin".into()];
        let (input, filter) = video_input_args(config, &p, None);
        args.extend(input);
        args.extend(filter);
        args.extend(["-frames:v".into(), "3".into()]);
        args.extend(encoder_args(config, p.encoder));
        args.extend(["-f".into(), "null".into(), "-".into()]);
        let ok = ffmpeg_command(ffmpeg)
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if ok {
            return Some(p);
        }
    }
    None
}

fn spawn_run(
    ffmpeg: &Path,
    config: &ReplayConfig,
    pipeline: &Pipeline,
    dir: &Path,
    start_index: u64,
) -> Result<Run, String> {
    let t0_wall = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_micros();
    let mut args: Vec<String> = vec!["-hide_banner".into(), "-loglevel".into(), "error".into()];
    let (input, filter) = video_input_args(config, pipeline, Some(t0_wall));
    args.extend(input);
    if config.audio {
        args.extend(
            [
                "-thread_queue_size", "1024", "-f", "f32le", "-ar", "48000", "-ac", "2", "-i",
                "pipe:0", "-map", "0:v", "-map", "1:a",
            ]
            .iter()
            .map(|s| s.to_string()),
        );
    } else {
        args.insert(0, "-nostdin".into());
    }
    // Without -copyts ffmpeg shifts each input to start at 0 on its own. The first video
    // frame arrives a capture start-up delay after T0 while audio starts at T0, so that
    // shift would make the sound lag the picture by exactly that delay.
    args.push("-copyts".into());
    args.extend(filter);
    args.extend(encoder_args(config, pipeline.encoder));
    if config.audio {
        args.extend(["-c:a", "aac", "-b:a", "160k"].iter().map(|s| s.to_string()));
    }
    args.extend([
        "-f".into(),
        "segment".into(),
        "-segment_time".into(),
        SEGMENT_SECONDS.to_string(),
        "-segment_format".into(),
        "mpegts".into(),
        "-segment_start_number".into(),
        start_index.to_string(),
        "s_%08d.ts".into(),
    ]);

    let mut child = ffmpeg_command(ffmpeg)
        .args(&args)
        .current_dir(dir)
        .stdin(if config.audio { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("ffmpeg failed to start: {e}"))?;
    let stderr = child.stderr.take().map(spawn_stderr_drain);

    let audio_stop = Arc::new(AtomicBool::new(false));
    let audio = match child.stdin.take() {
        Some(stdin) => {
            let stop = audio_stop.clone();
            thread::Builder::new()
                .name("replay-audio".into())
                .spawn(move || audio_pump(stdin, t0_wall, stop))
                .ok()
        }
        None => None,
    };
    Ok(Run {
        child,
        stderr,
        audio_stop,
        audio,
    })
}

// ---------------------------------------------------------------- audio

/// Feeds ffmpeg a continuous 48 kHz stereo f32 stream locked to the wall clock since `t0_us`
/// (unix µs — the same clock ffmpeg's `RTCTIME` uses for the video, so they can't drift).
/// Loopback delivers nothing while the system is silent, so gaps are zero-filled; if the
/// device fails (unplugged, default changed) we keep writing silence and retry.
fn audio_pump(mut stdin: ChildStdin, t0_us: u128, stop: Arc<AtomicBool>) {
    let mut written: u64 = 0; // frames
    let mut source = AudioSource::open();
    let mut last_retry = Instant::now();
    let mut buf: Vec<u8> = Vec::new();

    while !stop.load(Ordering::SeqCst) {
        let now_us = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_micros())
            .unwrap_or(t0_us);
        let expected = (now_us.saturating_sub(t0_us) as u64) * SAMPLE_RATE / 1_000_000;

        buf.clear();
        if let Some(src) = source.as_mut() {
            if src.read(&mut buf).is_err() {
                source = None;
                last_retry = Instant::now();
            }
        } else if last_retry.elapsed() >= Duration::from_secs(2) {
            last_retry = Instant::now();
            source = AudioSource::open();
        }

        let mut got = (buf.len() / FRAME_BYTES) as u64;
        // Far ahead of the clock (device clock drift) → drop the excess.
        let ceiling = expected + SAMPLE_RATE / 10;
        if written + got > ceiling {
            let keep = ceiling.saturating_sub(written);
            buf.truncate((keep as usize) * FRAME_BYTES);
            got = keep;
        }
        // Behind the clock with nothing (or too little) arriving → pad silence, leaving
        // ~20 ms of slack for packets that are merely late.
        let floor = expected.saturating_sub(SAMPLE_RATE / 50);
        let pad = if written + got + SAMPLE_RATE * 3 / 100 < expected {
            floor.saturating_sub(written + got)
        } else {
            0
        };

        if pad > 0 {
            let zeros = vec![0u8; pad as usize * FRAME_BYTES];
            if stdin.write_all(&zeros).is_err() {
                return;
            }
            written += pad;
        }
        if got > 0 {
            if stdin.write_all(&buf).is_err() {
                return;
            }
            written += got;
        }
        thread::sleep(Duration::from_millis(5));
    }
}

#[cfg(windows)]
struct AudioSource {
    client: wasapi::AudioClient,
    capture: wasapi::AudioCaptureClient,
}

#[cfg(windows)]
impl AudioSource {
    fn open() -> Option<Self> {
        use wasapi::{initialize_mta, DeviceEnumerator, Direction, SampleType, StreamMode, WaveFormat};
        let r = (|| -> Result<Self, String> {
            let _ = initialize_mta();
            let enumerator = DeviceEnumerator::new().map_err(|e| e.to_string())?;
            let device = enumerator
                .get_default_device(&Direction::Render)
                .map_err(|e| e.to_string())?;
            let mut client = device.get_iaudioclient().map_err(|e| e.to_string())?;
            let format = WaveFormat::new(32, 32, &SampleType::Float, 48_000, 2, None);
            let (_, min_period) = client.get_device_period().map_err(|e| e.to_string())?;
            client
                .initialize_client(
                    &format,
                    &Direction::Capture,
                    &StreamMode::PollingShared {
                        autoconvert: true,
                        buffer_duration_hns: min_period.max(200_000),
                    },
                )
                .map_err(|e| e.to_string())?;
            let capture = client.get_audiocaptureclient().map_err(|e| e.to_string())?;
            client.start_stream().map_err(|e| e.to_string())?;
            Ok(Self { client, capture })
        })();
        match r {
            Ok(s) => Some(s),
            Err(e) => {
                eprintln!("replay audio unavailable: {e}");
                None
            }
        }
    }

    fn read(&mut self, out: &mut Vec<u8>) -> Result<(), String> {
        let mut deque = std::collections::VecDeque::new();
        while self
            .capture
            .get_next_packet_size()
            .map_err(|e| e.to_string())?
            .unwrap_or(0)
            > 0
        {
            self.capture
                .read_from_device_to_deque(&mut deque)
                .map_err(|e| e.to_string())?;
        }
        out.extend(deque);
        Ok(())
    }
}

#[cfg(windows)]
impl Drop for AudioSource {
    fn drop(&mut self) {
        let _ = self.client.stop_stream();
    }
}

#[cfg(not(windows))]
struct AudioSource;

#[cfg(not(windows))]
impl AudioSource {
    fn open() -> Option<Self> {
        None
    }
    fn read(&mut self, _out: &mut Vec<u8>) -> Result<(), String> {
        Ok(())
    }
}

// ---------------------------------------------------------------- segments

fn segment_index(name: &str) -> Option<u64> {
    name.strip_prefix("s_")?.strip_suffix(".ts")?.parse().ok()
}

fn segment_name(i: u64) -> String {
    format!("s_{i:08}.ts")
}

/// Sorted ascending.
fn list_segments(dir: &Path) -> Vec<u64> {
    let mut v: Vec<u64> = fs::read_dir(dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter_map(|e| segment_index(e.file_name().to_str()?))
                .collect()
        })
        .unwrap_or_default();
    v.sort_unstable();
    v
}

fn prune(dir: &Path, keep: u64) {
    let segs = list_segments(dir);
    if let Some(&newest) = segs.last() {
        for i in segs.into_iter().filter(|i| *i + keep < newest) {
            let _ = fs::remove_file(dir.join(segment_name(i)));
        }
    }
}

fn clear_segments(dir: &Path) {
    for i in list_segments(dir) {
        let _ = fs::remove_file(dir.join(segment_name(i)));
    }
}

// ---------------------------------------------------------------- save

pub struct SavedClip {
    pub path: PathBuf,
    pub width: u32,
    pub height: u32,
    pub seconds: u32,
}

struct SavingGuard(Arc<Shared>);
impl Drop for SavingGuard {
    fn drop(&mut self) {
        self.0.saving.store(false, Ordering::SeqCst);
    }
}

/// Blocking: waits up to ~2.5 s for the current segment to close, then writes the mp4.
pub fn save_clip() -> Result<SavedClip, String> {
    let (dir, shared, seconds) = {
        let guard = REPLAY.lock();
        let r = guard
            .as_ref()
            .ok_or_else(|| "Instant replay is off — enable it in Settings".to_string())?;
        (r.dir.clone(), r.shared.clone(), r.config.seconds)
    };
    if !shared.status.lock().running {
        return Err("Instant replay isn't running yet".into());
    }
    if shared.saving.swap(true, Ordering::SeqCst) {
        return Err("Already saving a clip".into());
    }
    let _saving = SavingGuard(shared.clone());

    let run_first = shared.run_first.load(Ordering::SeqCst);
    let in_progress = *list_segments(&dir)
        .last()
        .filter(|i| **i >= run_first)
        .ok_or_else(|| "Nothing buffered yet".to_string())?;

    // Include the moment the hotkey was pressed: wait for the open segment to finish.
    let deadline = Instant::now() + Duration::from_millis(2500);
    let mut last = in_progress.checked_sub(1);
    while Instant::now() < deadline {
        if list_segments(&dir).last().is_some_and(|n| *n > in_progress) {
            last = Some(in_progress);
            break;
        }
        thread::sleep(Duration::from_millis(50));
    }
    let last = last
        .filter(|l| *l >= run_first)
        .ok_or_else(|| "Nothing buffered yet".to_string())?;
    let first = last
        .saturating_add(1)
        .saturating_sub(seconds as u64 / SEGMENT_SECONDS as u64)
        .max(run_first);
    let parts: Vec<String> = (first..=last)
        .map(segment_name)
        .filter(|n| dir.join(n).exists())
        .collect();
    if parts.is_empty() {
        return Err("Nothing buffered yet".into());
    }

    let out_dir = recordings_dir()?;
    fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;
    let stamp = chrono::Local::now().format("%Y-%m-%d %H-%M-%S");
    let mut output = out_dir.join(format!("SnipClip Replay {stamp}.mp4"));
    let mut n = 2;
    while output.exists() {
        output = out_dir.join(format!("SnipClip Replay {stamp} ({n}).mp4"));
        n += 1;
    }

    let ffmpeg = ffmpeg_binary()?;
    // Relative names + current_dir keeps the command line short even for 600 segments.
    let result = ffmpeg_command(&ffmpeg)
        .current_dir(&dir)
        .args(["-hide_banner", "-loglevel", "error", "-nostdin", "-i"])
        .arg(format!("concat:{}", parts.join("|")))
        .args(["-map", "0", "-c", "copy", "-movflags", "+faststart", "-y"])
        .arg(&output)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .output()
        .map_err(|e| e.to_string())?;
    if !result.status.success() {
        let _ = fs::remove_file(&output);
        let err = String::from_utf8_lossy(&result.stderr);
        return Err(format!(
            "Saving clip failed: {}",
            err.lines().last().unwrap_or("ffmpeg error")
        ));
    }
    let (width, height) = probe_dimensions(&ffmpeg, &output).unwrap_or((0, 0));
    Ok(SavedClip {
        path: output,
        width,
        height,
        seconds: parts.len() as u32 * SEGMENT_SECONDS,
    })
}

/// Reads "1920x1080" from `ffmpeg -i` stream info.
fn probe_dimensions(ffmpeg: &Path, file: &Path) -> Option<(u32, u32)> {
    let out = ffmpeg_command(ffmpeg)
        .args(["-hide_banner", "-nostdin", "-i"])
        .arg(file)
        .stdin(Stdio::null())
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stderr);
    let line = text.lines().find(|l| l.contains("Video:"))?;
    line.split([',', ' '])
        .filter_map(|tok| {
            let (w, h) = tok.split_once('x')?;
            Some((w.parse().ok()?, h.parse().ok()?))
        })
        .find(|(w, h): &(u32, u32)| *w > 0 && *h > 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn segment_names_roundtrip() {
        assert_eq!(segment_index(&segment_name(42)), Some(42));
        assert_eq!(segment_index("list.csv"), None);
        assert_eq!(segment_index("s_abc.ts"), None);
    }

    #[test]
    fn config_clamps() {
        let mut s = AppSettings::default();
        s.replay_seconds = 1;
        s.replay_fps = 144;
        assert_eq!(ReplayConfig::from_settings(&s).seconds, MIN_SECONDS);
        assert_eq!(ReplayConfig::from_settings(&s).fps, 60);
        s.replay_seconds = 10_000;
        assert_eq!(ReplayConfig::from_settings(&s).seconds, MAX_SECONDS);
    }
}
