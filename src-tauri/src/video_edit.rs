use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::recording::{ffmpeg_binary, recordings_dir, sanitize_even_dimensions};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CropParams {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoEditorPayload {
    pub file_path: String,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub vault_id: Option<i64>,
    #[serde(default)]
    pub is_draft: bool,
}

fn even(n: u32) -> u32 {
    n - (n % 2)
}

fn sanitize_crop(crop: &CropParams) -> Result<(u32, u32, u32, u32), String> {
    let (w, h) = sanitize_even_dimensions(crop.width.max(2), crop.height.max(2))?;
    let x = even(crop.x);
    let y = even(crop.y);
    Ok((x, y, w, h))
}

fn output_path(format: &str) -> Result<PathBuf, String> {
    let dir = recordings_dir()?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let ext = if format.eq_ignore_ascii_case("gif") {
        "gif"
    } else {
        "mp4"
    };
    let name = format!(
        "SnipClip_{}.{}",
        chrono::Local::now().format("%Y%m%d_%H%M%S"),
        ext
    );
    Ok(dir.join(name))
}

fn run_ffmpeg(args: &[String]) -> Result<(), String> {
    let ffmpeg = ffmpeg_binary()?;
    let output = Command::new(&ffmpeg)
        .args(args)
        .output()
        .map_err(|e| format!("failed to run ffmpeg: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let tail = stderr
            .lines()
            .rev()
            .take(12)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join("\n");
        return Err(format!("ffmpeg failed:\n{tail}"));
    }
    Ok(())
}

/// Process a recorded clip: trim, optional crop/mute, and mp4/gif export.
pub fn process_video_clip(
    input_path: &str,
    output_format: &str,
    start_sec: f32,
    end_sec: f32,
    crop: Option<&CropParams>,
    mute_audio: bool,
) -> Result<String, String> {
    let input = Path::new(input_path);
    if !input.is_file() {
        return Err("recording file not found".into());
    }

    let start = start_sec.max(0.0);
    let end = end_sec.max(start + 0.05);
    let duration = (end - start).max(0.05);
    let wants_gif = output_format.eq_ignore_ascii_case("gif");
    let input_is_gif = input
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("gif"))
        .unwrap_or(false);

    let crop_xywh = match crop {
        Some(c) => Some(sanitize_crop(c)?),
        None => None,
    };

    let can_stream_copy = !wants_gif && !input_is_gif && crop_xywh.is_none();

    let out = output_path(if wants_gif { "gif" } else { "mp4" })?;
    let out_str = out.to_string_lossy().replace('\\', "/");
    let in_str = input.to_string_lossy().replace('\\', "/");
    let start_s = format!("{start:.3}");
    let dur_s = format!("{duration:.3}");

    // dynamically constructing ffmpeg args for trim crop and audio stripping
    let mut args: Vec<String> = vec![
        "-y".into(),
        "-hide_banner".into(),
        "-loglevel".into(),
        "error".into(),
    ];

    if can_stream_copy {
        // Fast path: seek + stream copy (mute drops audio without re-encoding video)
        args.extend([
            "-ss".into(),
            start_s,
            "-i".into(),
            in_str,
            "-t".into(),
            dur_s,
        ]);
        if mute_audio {
            args.extend(["-c:v".into(), "copy".into(), "-an".into()]);
        } else {
            args.extend(["-c".into(), "copy".into()]);
        }
        args.push(out_str.clone());
        run_ffmpeg(&args)?;
    } else if wants_gif {
        args.extend([
            "-ss".into(),
            start_s,
            "-i".into(),
            in_str,
            "-t".into(),
            dur_s,
        ]);
        // running two pass palettegen gif encoding so converted clips look crisp
        let filter = if let Some((x, y, w, h)) = crop_xywh {
            format!(
                "[0:v]crop={w}:{h}:{x}:{y},fps=15,scale=flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse"
            )
        } else {
            "[0:v]fps=15,scale=flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse".into()
        };
        args.extend([
            "-filter_complex".into(),
            filter,
            "-an".into(),
            out_str.clone(),
        ]);
        run_ffmpeg(&args)?;
    } else {
        args.extend([
            "-ss".into(),
            start_s,
            "-i".into(),
            in_str,
            "-t".into(),
            dur_s,
        ]);
        if let Some((x, y, w, h)) = crop_xywh {
            args.extend(["-filter:v".into(), format!("crop={w}:{h}:{x}:{y}")]);
        }
        args.extend([
            "-c:v".into(),
            "libx264".into(),
            "-preset".into(),
            "fast".into(),
            "-crf".into(),
            "22".into(),
            "-pix_fmt".into(),
            "yuv420p".into(),
            "-movflags".into(),
            "+faststart".into(),
        ]);
        if mute_audio {
            args.push("-an".into());
        } else {
            args.extend([
                "-map".into(),
                "0:v:0".into(),
                "-map".into(),
                "0:a:0?".into(),
                "-c:a".into(),
                "aac".into(),
                "-b:a".into(),
                "128k".into(),
            ]);
        }
        args.push(out_str.clone());
        run_ffmpeg(&args)?;
    }

    if !out.is_file() || fs::metadata(&out).map(|m| m.len()).unwrap_or(0) == 0 {
        let _ = fs::remove_file(&out);
        return Err("ffmpeg produced an empty output file".into());
    }

    Ok(out.to_string_lossy().into_owned())
}

pub fn delete_recording_file(path: &str) -> Result<(), String> {
    let p = Path::new(path);
    if p.is_file() {
        fs::remove_file(p).map_err(|e| e.to_string())?;
    }
    Ok(())
}
