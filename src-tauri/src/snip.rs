use base64::{engine::general_purpose::STANDARD as B64, Engine};
use image::{imageops, ImageBuffer, ImageEncoder, Rgba, RgbaImage};
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VirtualDesktop {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
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

/// Union of all monitor bounds in physical desktop coordinates.
pub fn virtual_desktop_bounds() -> Result<VirtualDesktop, String> {
    let monitors = Monitor::all().map_err(|e| e.to_string())?;
    if monitors.is_empty() {
        return Err("no monitors found".into());
    }

    let mut min_x = i32::MAX;
    let mut min_y = i32::MAX;
    let mut max_x = i32::MIN;
    let mut max_y = i32::MIN;

    for m in &monitors {
        let mx = m.x();
        let my = m.y();
        let mw = m.width() as i32;
        let mh = m.height() as i32;
        min_x = min_x.min(mx);
        min_y = min_y.min(my);
        max_x = max_x.max(mx + mw);
        max_y = max_y.max(my + mh);
    }

    Ok(VirtualDesktop {
        x: min_x,
        y: min_y,
        width: (max_x - min_x).max(1) as u32,
        height: (max_y - min_y).max(1) as u32,
    })
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
/// Supports selections that span multiple monitors by stitching monitor captures.
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

    let sel_r = x.saturating_add(width as i32);
    let sel_b = y.saturating_add(height as i32);

    let mut canvas: RgbaImage = ImageBuffer::from_pixel(width, height, Rgba([0, 0, 0, 255]));
    let mut names: Vec<String> = Vec::new();
    let mut pasted = false;

    for monitor in &monitors {
        let mx = monitor.x();
        let my = monitor.y();
        let mw = monitor.width() as i32;
        let mh = monitor.height() as i32;
        let mr = mx + mw;
        let mb = my + mh;

        let ix1 = x.max(mx);
        let iy1 = y.max(my);
        let ix2 = sel_r.min(mr);
        let iy2 = sel_b.min(mb);
        if ix2 <= ix1 || iy2 <= iy1 {
            continue;
        }

        let img = monitor.capture_image().map_err(|e| e.to_string())?;
        let local_x = (ix1 - mx).max(0) as u32;
        let local_y = (iy1 - my).max(0) as u32;
        let crop_w = ((ix2 - ix1) as u32)
            .min(img.width().saturating_sub(local_x))
            .max(1);
        let crop_h = ((iy2 - iy1) as u32)
            .min(img.height().saturating_sub(local_y))
            .max(1);

        let cropped = imageops::crop_imm(&img, local_x, local_y, crop_w, crop_h).to_image();
        let dest_x = (ix1 - x).max(0) as i64;
        let dest_y = (iy1 - y).max(0) as i64;
        imageops::overlay(&mut canvas, &cropped, dest_x, dest_y);

        names.push(monitor.name().to_string());
        pasted = true;
    }

    if !pasted {
        // Fallback: single-monitor crop from first display (legacy path)
        let monitor = &monitors[0];
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
        return Ok(CaptureResult {
            data_url,
            width: cropped.width(),
            height: cropped.height(),
            monitor_name: name,
        });
    }

    let data_url = encode_rgba(&canvas)?;
    let monitor_name = if names.len() == 1 {
        names[0].clone()
    } else {
        format!("{} monitors", names.len())
    };

    Ok(CaptureResult {
        data_url,
        width: canvas.width(),
        height: canvas.height(),
        monitor_name,
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
