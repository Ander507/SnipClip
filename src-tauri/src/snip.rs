use base64::{engine::general_purpose::STANDARD as B64, Engine};
use image::{imageops, ImageEncoder};
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use xcap::Monitor;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureResult {
    pub data_url: String,
    pub width: u32,
    pub height: u32,
    pub monitor_name: String,
}

fn encode_rgba(img: &image::RgbaImage) -> Result<String, String> {
    let mut buf = Cursor::new(Vec::new());
    let encoder = image::codecs::png::PngEncoder::new(&mut buf);
    encoder
        .write_image(
            img.as_raw(),
            img.width(),
            img.height(),
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|e| e.to_string())?;
    Ok(format!(
        "data:image/png;base64,{}",
        B64.encode(buf.into_inner())
    ))
}

pub fn capture_primary_monitor() -> Result<CaptureResult, String> {
    let monitors = Monitor::all().map_err(|e| e.to_string())?;
    let monitor = monitors
        .into_iter()
        .next()
        .ok_or_else(|| "no monitors found".to_string())?;

    let name = monitor.name().to_string();
    let img = monitor.capture_image().map_err(|e| e.to_string())?;
    let width = img.width();
    let height = img.height();
    let data_url = encode_rgba(&img)?;

    Ok(CaptureResult {
        data_url,
        width,
        height,
        monitor_name: name,
    })
}

/// Capture a screen region using physical pixel coordinates (absolute desktop space).
pub fn capture_screen_region(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<CaptureResult, String> {
    if width < 2 || height < 2 {
        return Err("selection too small".into());
    }

    let monitors = Monitor::all().map_err(|e| e.to_string())?;
    if monitors.is_empty() {
        return Err("no monitors found".into());
    }

    // Prefer the monitor that contains the selection origin.
    let monitor = monitors
        .iter()
        .find(|m| {
            let mx = m.x();
            let my = m.y();
            let mw = m.width() as i32;
            let mh = m.height() as i32;
            x >= mx && y >= my && x < mx + mw && y < my + mh
        })
        .unwrap_or(&monitors[0]);

    let name = monitor.name().to_string();
    let mx = monitor.x();
    let my = monitor.y();
    let img = monitor.capture_image().map_err(|e| e.to_string())?;

    let local_x = (x - mx).max(0) as u32;
    let local_y = (y - my).max(0) as u32;
    let max_w = img.width().saturating_sub(local_x);
    let max_h = img.height().saturating_sub(local_y);
    let w = width.min(max_w).max(1);
    let h = height.min(max_h).max(1);

    let cropped = imageops::crop_imm(&img, local_x, local_y, w, h).to_image();
    let data_url = encode_rgba(&cropped)?;

    Ok(CaptureResult {
        data_url,
        width: cropped.width(),
        height: cropped.height(),
        monitor_name: name,
    })
}

pub fn save_png_data_url(data_url: &str, path: &str) -> Result<(), String> {
    let b64 = data_url
        .strip_prefix("data:image/png;base64,")
        .or_else(|| data_url.strip_prefix("data:image/jpeg;base64,"))
        .ok_or_else(|| "invalid data url".to_string())?;
    let bytes = B64.decode(b64).map_err(|e| e.to_string())?;
    std::fs::write(path, bytes).map_err(|e| e.to_string())
}
