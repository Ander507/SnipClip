use gif::{DisposalMethod, Encoder, Frame, Repeat};
use image::RgbaImage;
use parking_lot::Mutex;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Hide the console window ffmpeg would otherwise flash on Windows.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub(crate) fn ffmpeg_command(ffmpeg: impl AsRef<Path>) -> Command {
    let mut cmd = Command::new(ffmpeg.as_ref());
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

fn map_encoder_io_error(error: std::io::Error) -> String {
    // Windows ERROR_BROKEN_PIPE (109) — usually the user closed the ffmpeg window.
    let raw = error.raw_os_error();
    let text = error.to_string();
    if raw == Some(109)
        || text.contains("os error 109")
        || text.to_ascii_lowercase().contains("broken pipe")
    {
        return "Recording stopped because the encoder closed. Use Stop in SnipClip — don't close ffmpeg.".into();
    }
    text
}

const MAX_FRAMES: usize = 450;
const MAX_EDGE: u32 = 1280;

#[derive(Clone, Copy, PartialEq, Eq)]
enum RecordFormat {
    Gif,
    Mp4,
}

impl RecordFormat {
    fn parse(s: &str) -> Self {
        if s.eq_ignore_ascii_case("mp4") {
            Self::Mp4
        } else {
            Self::Gif
        }
    }

    fn ext(self) -> &'static str {
        match self {
            Self::Gif => "gif",
            Self::Mp4 => "mp4",
        }
    }
}

struct ActiveRecording {
    stop: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
    join: JoinHandle<Result<PathBuf, String>>,
}

static RECORDING: Mutex<Option<ActiveRecording>> = Mutex::new(None);

pub fn recordings_dir() -> Result<PathBuf, String> {
    let base = crate::screenshot_popup::pictures_screenshots_dir()?;
    Ok(base.parent().unwrap_or(&base).join("recordings"))
}

/// forcing even width and height so libx264 doesn't panic on odd pixel dimensions
pub fn sanitize_even_dimensions(width: u32, height: u32) -> Result<(u32, u32), String> {
    let safe_width = width - (width % 2);
    let safe_height = height - (height % 2);
    if safe_width < 2 || safe_height < 2 {
        return Err("recording region too small (need at least 2×2 even pixels)".into());
    }
    Ok((safe_width, safe_height))
}

fn even_extent(n: u32) -> u32 {
    n - (n % 2)
}

fn scale_down(img: RgbaImage) -> RgbaImage {
    let (w, h) = (img.width(), img.height());
    let edge = w.max(h);
    if edge <= MAX_EDGE {
        return img;
    }
    let scale = MAX_EDGE as f32 / edge as f32;
    let nw = even_extent(((w as f32) * scale).round().max(2.0) as u32);
    let nh = even_extent(((h as f32) * scale).round().max(2.0) as u32);
    image::imageops::resize(&img, nw, nh, image::imageops::FilterType::Triangle)
}

struct Mp4PipeEncoder {
    child: Child,
    stdin: Option<ChildStdin>,
    stderr: Option<std::process::ChildStderr>,
    output: PathBuf,
    width: u32,
    height: u32,
}

/// `auto_download` shells out to `ffmpeg -version` on every call, costing ~750 ms each time.
/// Resolving the binary once per process keeps that off the front of every recording.
pub(crate) fn ffmpeg_binary() -> Result<PathBuf, String> {
    static READY: std::sync::OnceLock<Result<PathBuf, String>> = std::sync::OnceLock::new();
    READY
        .get_or_init(|| {
            ffmpeg_sidecar::download::auto_download().map_err(|e| e.to_string())?;
            Ok(ffmpeg_sidecar::paths::ffmpeg_path())
        })
        .clone()
}

/// Resolves ffmpeg on a background thread at app start so the first recording begins promptly.
pub fn prewarm_encoder() {
    thread::spawn(|| {
        if let Err(error) = ffmpeg_binary() {
            eprintln!("ffmpeg prewarm failed: {error}");
        }
    });
}

impl Mp4PipeEncoder {
    fn spawn(output: &Path, width: u32, height: u32, fps: u32) -> Result<Self, String> {
        let ffmpeg = ffmpeg_binary()?;
        let size = format!("{width}x{height}");
        let fps_s = fps.max(1).min(60).to_string();
        let out = output.to_string_lossy().replace('\\', "/");

        let mut child = ffmpeg_command(&ffmpeg)
            .args([
                "-y",
                "-f",
                "rawvideo",
                "-pixel_format",
                "bgra",
                "-video_size",
                &size,
                "-framerate",
                &fps_s,
                "-i",
                "-",
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-pix_fmt",
                "yuv420p",
                "-movflags",
                "+faststart",
                &out,
            ])
            .stdin(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("ffmpeg failed to start (is it installed?): {e}"))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "ffmpeg stdin unavailable".to_string())?;
        let stderr = child.stderr.take();

        Ok(Self {
            child,
            stdin: Some(stdin),
            stderr,
            output: output.to_path_buf(),
            width,
            height,
        })
    }

    fn write_bgra_frame(&mut self, bgra: &[u8]) -> Result<(), String> {
        let expected = (self.width as usize) * (self.height as usize) * 4;
        if bgra.len() != expected {
            return Err(format!(
                "frame size mismatch: got {} bytes, expected {expected}",
                bgra.len()
            ));
        }
        self.stdin
            .as_mut()
            .ok_or_else(|| "encoder stdin closed".to_string())?
            .write_all(bgra)
            .map_err(map_encoder_io_error)
    }

    fn abort(mut self) {
        drop(self.stdin.take());
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = fs::remove_file(&self.output);
    }

    fn finish(mut self) -> Result<PathBuf, String> {
        // dropping stdin to send EOF and awaiting ffmpeg exit so the mp4 container headers write properly
        drop(self.stdin.take());
        let mut stderr_buf = String::new();
        if let Some(mut stderr) = self.stderr.take() {
            let _ = stderr.read_to_string(&mut stderr_buf);
        }
        let status = self.child.wait().map_err(|e| e.to_string())?;
        if !status.success() {
            let _ = fs::remove_file(&self.output);
            eprintln!("ffmpeg stderr: {}", stderr_buf.trim());
            return Err(format!("ffmpeg exited with {:?}", status.code()));
        }
        let len = fs::metadata(&self.output).map_err(|e| e.to_string())?.len();
        if len == 0 {
            return Err("ffmpeg produced an empty mp4 file".into());
        }
        Ok(self.output)
    }
}

fn mux_system_audio(video: &Path, audio: &Path, output: &Path) -> Result<(), String> {
    let ffmpeg = ffmpeg_binary()?;
    let result = ffmpeg_command(&ffmpeg)
        .args([
            "-y",
            "-i",
            &video.to_string_lossy(),
            "-f",
            "f32le",
            "-ar",
            "48000",
            "-ac",
            "2",
            "-i",
            &audio.to_string_lossy(),
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-af",
            "apad",
            "-shortest",
            "-movflags",
            "+faststart",
            &output.to_string_lossy(),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("ffmpeg audio mux failed to start: {e}"))?;

    if !result.status.success() {
        let stderr = String::from_utf8_lossy(&result.stderr);
        eprintln!("ffmpeg audio mux stderr: {}", stderr.trim());
        let _ = fs::remove_file(output);
        return Err(format!(
            "ffmpeg audio mux exited with {:?}",
            result.status.code()
        ));
    }
    Ok(())
}

fn encode_gif(frames: &[RgbaImage], fps: u32, path: &Path) -> Result<(), String> {
    if frames.is_empty() {
        return Err("no frames captured".into());
    }
    let first = &frames[0];
    let w = first.width() as u16;
    let h = first.height() as u16;
    let file = File::create(path).map_err(|e| e.to_string())?;
    let mut encoder =
        Encoder::new(std::io::BufWriter::new(file), w, h, &[]).map_err(|e| e.to_string())?;
    encoder
        .set_repeat(Repeat::Infinite)
        .map_err(|e| e.to_string())?;
    let delay = (100 / fps.max(1).min(30)) as u16;

    for frame in frames {
        let mut rgba = frame.as_raw().to_vec();
        // speed 1 is the slowest quantiser setting and cost ~275 ms per frame; 10 is the
        // crate's balanced setting and keeps stopping a GIF from hanging for half a minute
        let mut gif_frame = Frame::from_rgba_speed(w, h, &mut rgba, 10);
        gif_frame.delay = delay;
        gif_frame.dispose = DisposalMethod::Background;
        encoder.write_frame(&gif_frame).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn capture_gif_loop(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    fps: u32,
    stop: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
    output: PathBuf,
    ready: &mpsc::Sender<ReadySignal>,
) -> Result<PathBuf, String> {
    let frame_interval = Duration::from_millis((1000 / fps.max(1).min(30)) as u64);
    let mut frames: Vec<RgbaImage> = Vec::new();
    let mut capturer = crate::screen_capture::RegionCapturer::new(x, y, width, height)?;
    let mut scratch = vec![0u8; capturer.frame_bytes()];
    let _ = ready.send(Ok(()));

    while !stop.load(Ordering::SeqCst) && frames.len() < MAX_FRAMES {
        let tick = Instant::now();
        if !paused.load(Ordering::SeqCst) {
            let raw = capturer.capture_rgba(&mut scratch)?;
            frames.push(scale_down(raw));
        }
        let elapsed = tick.elapsed();
        if elapsed < frame_interval {
            thread::sleep(frame_interval - elapsed);
        }
    }

    if frames.is_empty() {
        return Err("no frames captured".into());
    }
    encode_gif(&frames, fps, &output)?;
    Ok(output)
}

/// Handoff point between the capture thread and the encoder thread. `fresh` lets the
/// encoder tell a newly captured frame apart from one it has already written.
struct FrameSlot {
    buffer: Vec<u8>,
    fresh: bool,
}

/// Reports whether the recording actually reached the point of writing frames.
type ReadySignal = Result<(), String>;

fn capture_mp4_loop(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    fps: u32,
    stop: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
    output: PathBuf,
    system_audio: bool,
    ready: &mpsc::Sender<ReadySignal>,
) -> Result<PathBuf, String> {
    let stats = std::env::var_os("SNIPCLIP_RECORD_STATS").is_some();
    let (safe_width, safe_height) = sanitize_even_dimensions(width, height)?;
    let frame_bytes = (safe_width as usize) * (safe_height as usize) * 4;

    let slot = Arc::new(Mutex::new(FrameSlot {
        buffer: vec![0u8; frame_bytes],
        fresh: false,
    }));
    let capture_error = Arc::new(Mutex::new(None::<String>));

    let capture_slot = slot.clone();
    let capture_error_out = capture_error.clone();
    let capture_stop = stop.clone();
    let capture_paused = paused.clone();
    let (startup_tx, startup_rx) = mpsc::sync_channel::<Result<(), String>>(1);

    // the GDI capturer owns raw device contexts and is not Send, so it has to be built here
    let capture_thread = thread::spawn(move || {
        let mut capturer =
            match crate::screen_capture::RegionCapturer::new(x, y, safe_width, safe_height) {
                Ok(capturer) => capturer,
                Err(error) => {
                    let _ = startup_tx.send(Err(error));
                    return;
                }
            };

        let mut local = vec![0u8; frame_bytes];
        let mut announced = false;

        while !capture_stop.load(Ordering::SeqCst) {
            if capture_paused.load(Ordering::SeqCst) {
                thread::sleep(Duration::from_millis(10));
                continue;
            }

            if let Err(error) = capturer.capture_into(&mut local) {
                if !announced {
                    let _ = startup_tx.send(Err(error));
                } else {
                    *capture_error_out.lock() = Some(error);
                    capture_stop.store(true, Ordering::SeqCst);
                }
                return;
            }

            // swapping buffers keeps a multi-megabyte frame copy out of the capture loop
            {
                let mut guard = capture_slot.lock();
                std::mem::swap(&mut local, &mut guard.buffer);
                guard.fresh = true;
            }

            // announcing only after the first real frame guarantees the encoder never
            // writes the initial blank buffer
            if !announced {
                announced = true;
                let _ = startup_tx.send(Ok(()));
            }
        }
    });

    match startup_rx.recv() {
        Ok(Ok(())) => {}
        Ok(Err(error)) => {
            stop.store(true, Ordering::SeqCst);
            let _ = capture_thread.join();
            return Err(error);
        }
        Err(_) => {
            stop.store(true, Ordering::SeqCst);
            let _ = capture_thread.join();
            return Err("screen capture thread stopped unexpectedly".into());
        }
    }

    let silent_output = if system_audio {
        output.with_extension("video.mp4")
    } else {
        output.clone()
    };
    let audio_output = output.with_extension("audio.f32");
    let mut encoder = match Mp4PipeEncoder::spawn(&silent_output, safe_width, safe_height, fps) {
        Ok(encoder) => encoder,
        Err(error) => {
            stop.store(true, Ordering::SeqCst);
            let _ = capture_thread.join();
            return Err(error);
        }
    };
    let audio_capture = if system_audio {
        match crate::system_audio::SystemAudioCapture::start(
            audio_output.clone(),
            stop.clone(),
            paused.clone(),
        ) {
            Ok(capture) => Some(capture),
            Err(error) => {
                stop.store(true, Ordering::SeqCst);
                let _ = capture_thread.join();
                encoder.abort();
                return Err(format!("desktop audio unavailable: {error}"));
            }
        }
    } else {
        None
    };

    // the encoder is live, so the caller's elapsed timer can now track the video timeline
    let _ = ready.send(Ok(()));

    let frame_interval = Duration::from_secs_f64(1.0 / fps.max(1).min(60) as f64);
    let mut scratch = vec![0u8; frame_bytes];
    let mut frame_count = 0usize;
    let mut next_tick = Instant::now();

    let loop_start = Instant::now();
    let mut write_time = Duration::ZERO;
    let mut stale_frames = 0usize;
    let mut resyncs = 0usize;

    // feeding ffmpeg on a strict interval so the video timeline stays 1:1 with real time
    while !stop.load(Ordering::SeqCst) {
        if paused.load(Ordering::SeqCst) {
            thread::sleep(Duration::from_millis(10));
            next_tick = Instant::now() + frame_interval;
            continue;
        }

        let now = Instant::now();
        if now < next_tick {
            thread::sleep(next_tick - now);
        }
        if stop.load(Ordering::SeqCst) {
            break;
        }

        // a stale scratch buffer re-sends the previous frame, so a static screen still
        // advances the timeline at the real-time rate instead of speeding the video up
        {
            let mut guard = slot.lock();
            if guard.fresh {
                std::mem::swap(&mut scratch, &mut guard.buffer);
                guard.fresh = false;
            } else {
                stale_frames += 1;
            }
        }

        let write_started = Instant::now();
        let write_result = encoder.write_bgra_frame(&scratch);
        write_time += write_started.elapsed();
        if let Err(error) = write_result {
            stop.store(true, Ordering::SeqCst);
            let _ = capture_thread.join();
            if let Some(capture) = audio_capture {
                let _ = capture.finish();
            }
            encoder.abort();
            let _ = fs::remove_file(&audio_output);
            return Err(error);
        }
        frame_count += 1;

        next_tick += frame_interval;
        // resyncing after a long stall avoids a burst of catch-up frames
        let now = Instant::now();
        if next_tick + frame_interval * 4 < now {
            next_tick = now;
            resyncs += 1;
        }
    }

    // set SNIPCLIP_RECORD_STATS to check pacing health: a high stale count means capture
    // could not keep up and the video will contain duplicated frames
    if stats {
        let wall = loop_start.elapsed().as_secs_f64();
        eprintln!(
            "[record stats] wall {wall:.2}s  frames {frame_count}  effective {:.1} fps (target {fps})  \
             encode {:.2} ms/frame  duplicated {stale_frames}  resyncs {resyncs}",
            frame_count as f64 / wall,
            write_time.as_secs_f64() * 1000.0 / frame_count.max(1) as f64,
        );
    }

    let _ = capture_thread.join();
    let captured_audio = match audio_capture {
        Some(capture) => match capture.finish() {
            Ok(path) => Some(path),
            Err(error) => {
                encoder.abort();
                let _ = fs::remove_file(&audio_output);
                return Err(format!("desktop audio capture failed: {error}"));
            }
        },
        None => None,
    };
    if let Some(error) = capture_error.lock().take() {
        encoder.abort();
        let _ = fs::remove_file(&audio_output);
        return Err(error);
    }
    if frame_count == 0 {
        encoder.abort();
        let _ = fs::remove_file(&audio_output);
        return Err("no frames captured".into());
    }

    let video = encoder.finish()?;
    let Some(audio) = captured_audio else {
        return Ok(video);
    };

    let audio_len = fs::metadata(&audio).map(|m| m.len()).unwrap_or(0);
    if audio_len == 0 {
        fs::rename(&video, &output).map_err(|e| e.to_string())?;
    } else {
        if let Err(error) = mux_system_audio(&video, &audio, &output) {
            let _ = fs::remove_file(&video);
            let _ = fs::remove_file(&audio);
            return Err(error);
        }
        let _ = fs::remove_file(&video);
    }
    let _ = fs::remove_file(&audio);
    Ok(output)
}

fn capture_loop(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    fps: u32,
    format: RecordFormat,
    stop: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
    system_audio: bool,
    ready: mpsc::Sender<ReadySignal>,
) -> Result<PathBuf, String> {
    let result = (|| -> Result<PathBuf, String> {
        let out_dir = recordings_dir()?;
        fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;
        let stamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
        let output = out_dir.join(format!("SnipClip_{stamp}.{}", format.ext()));

        match format {
            RecordFormat::Gif => {
                capture_gif_loop(x, y, width, height, fps, stop, paused, output, &ready)
            }
            RecordFormat::Mp4 => capture_mp4_loop(
                x,
                y,
                width,
                height,
                fps,
                stop,
                paused,
                output,
                system_audio,
                &ready,
            ),
        }
    })();

    // only reaches the caller when the failure happened before readiness was announced
    if let Err(error) = &result {
        let _ = ready.send(Err(error.clone()));
    }
    result
}

pub fn start_region_recording(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    fps: u32,
    format: String,
    system_audio: bool,
) -> Result<(), String> {
    let mut guard = RECORDING.lock();
    if guard.is_some() {
        return Err("recording already in progress".into());
    }

    let fmt = RecordFormat::parse(&format);
    let (width, height) = if fmt == RecordFormat::Mp4 {
        sanitize_even_dimensions(width, height)?
    } else {
        (width.max(2), height.max(2))
    };

    let stop = Arc::new(AtomicBool::new(false));
    let paused = Arc::new(AtomicBool::new(false));
    let stop_t = stop.clone();
    let paused_t = paused.clone();
    let fps = if fmt == RecordFormat::Mp4 {
        resolve_mp4_fps(x, y, fps)
    } else if fps == 0 {
        // GIF pays for every frame in palette quantisation and file size, so it does not
        // want the display refresh rate that MP4 targets
        15
    } else {
        fps.clamp(1, 30)
    };

    let (ready_tx, ready_rx) = mpsc::channel::<ReadySignal>();
    let join = thread::spawn(move || {
        capture_loop(
            x,
            y,
            width,
            height,
            fps,
            fmt,
            stop_t,
            paused_t,
            system_audio && fmt == RecordFormat::Mp4,
            ready_tx,
        )
    });

    // spawning ffmpeg costs the better part of a second, so wait for frames to actually flow
    // before reporting success; otherwise the caller's elapsed timer outruns the video length
    match ready_rx.recv() {
        Ok(Ok(())) => {}
        Ok(Err(error)) => {
            let _ = join.join();
            return Err(error);
        }
        Err(_) => {
            let _ = join.join();
            return Err("recording failed to start".into());
        }
    }

    *guard = Some(ActiveRecording { stop, paused, join });
    Ok(())
}

fn resolve_mp4_fps(x: i32, y: i32, requested: u32) -> u32 {
    if requested > 0 {
        return requested.clamp(1, 60);
    }

    xcap::Monitor::from_point(x, y)
        .ok()
        .map(|monitor| monitor.frequency().round() as u32)
        .filter(|frequency| *frequency > 0)
        .unwrap_or(60)
        .clamp(30, 60)
}

pub fn pause_region_recording() -> Result<bool, String> {
    let guard = RECORDING.lock();
    let Some(active) = guard.as_ref() else {
        return Err("no active recording".into());
    };
    let next = !active.paused.load(Ordering::SeqCst);
    active.paused.store(next, Ordering::SeqCst);
    Ok(next)
}

pub fn stop_region_recording() -> Result<String, String> {
    let active = {
        let mut guard = RECORDING.lock();
        guard
            .take()
            .ok_or_else(|| "no active recording".to_string())?
    };

    active.stop.store(true, Ordering::SeqCst);
    let path = active
        .join
        .join()
        .map_err(|_| "recording thread panicked".to_string())??;

    let len = fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if path.extension().and_then(|s| s.to_str()) == Some("mp4") && len == 0 {
        return Err("recording produced an empty mp4 file".into());
    }

    Ok(path.to_string_lossy().into_owned())
}

pub fn is_recording() -> bool {
    RECORDING.lock().is_some()
}
