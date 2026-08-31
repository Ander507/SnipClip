use crate::snip::CaptureResult;

#[cfg(target_os = "linux")]
use std::io::Write;
#[cfg(target_os = "linux")]
use std::process::{Command, Stdio};

// checking xdg session to route around x11 crates and prevent wayland crashes
pub fn is_wayland() -> bool {
    #[cfg(not(target_os = "linux"))]
    {
        return false;
    }
    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("WAYLAND_DISPLAY").is_some() {
            return true;
        }
        std::env::var("XDG_SESSION_TYPE")
            .map(|s| s.eq_ignore_ascii_case("wayland"))
            .unwrap_or(false)
    }
}

#[cfg(target_os = "linux")]
fn tool_missing(name: &str, err: &std::io::Error) -> String {
    if err.kind() == std::io::ErrorKind::NotFound {
        format!(
            "{name} not found — install it for Wayland support (e.g. {name} from your distro packages)"
        )
    } else {
        format!("failed to run {name}: {err}")
    }
}

#[cfg(target_os = "linux")]
pub fn copy_text(text: &str) -> Result<(), String> {
    let mut child = Command::new("wl-copy")
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|e| tool_missing("wl-copy", &e))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(text.as_bytes())
            .map_err(|e| e.to_string())?;
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("wl-copy exited with {status}"))
    }
}

#[cfg(target_os = "linux")]
pub fn paste_text() -> Result<String, String> {
    let output = Command::new("wl-paste")
        .output()
        .map_err(|e| tool_missing("wl-paste", &e))?;
    if !output.status.success() {
        return Err(format!(
            "wl-paste failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

#[cfg(target_os = "linux")]
pub fn copy_image_png(png_bytes: &[u8]) -> Result<(), String> {
    let mut child = Command::new("wl-copy")
        .args(["--type", "image/png"])
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|e| tool_missing("wl-copy", &e))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(png_bytes).map_err(|e| e.to_string())?;
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("wl-copy exited with {status}"))
    }
}

#[cfg(target_os = "linux")]
pub fn paste_image_png() -> Result<Vec<u8>, String> {
    let output = Command::new("wl-paste")
        .args(["--type", "image/png"])
        .output()
        .map_err(|e| tool_missing("wl-paste", &e))?;
    if !output.status.success() {
        return Err(format!(
            "wl-paste image failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    if output.stdout.is_empty() {
        return Err("clipboard has no image/png data".into());
    }
    Ok(output.stdout)
}

// piping slurp coordinates directly into grim to grab the local buffer securely
#[cfg(target_os = "linux")]
pub fn capture_region_via_grim() -> Result<(Vec<u8>, String), String> {
    let slurp = Command::new("slurp")
        .output()
        .map_err(|e| tool_missing("slurp", &e))?;
    if !slurp.status.success() {
        return Err("region selection cancelled".into());
    }
    let geometry = String::from_utf8_lossy(&slurp.stdout).trim().to_string();
    if geometry.is_empty() {
        return Err("slurp returned empty geometry".into());
    }

    let grim = Command::new("grim")
        .arg("-g")
        .arg(&geometry)
        .arg("-")
        .output()
        .map_err(|e| tool_missing("grim", &e))?;
    if !grim.status.success() {
        return Err(format!(
            "grim failed: {}",
            String::from_utf8_lossy(&grim.stderr)
        ));
    }
    if grim.stdout.is_empty() {
        return Err("grim returned empty image".into());
    }

    Ok((grim.stdout, geometry))
}

#[cfg(target_os = "linux")]
pub fn save_png_to_pictures(png_bytes: &[u8]) -> Result<String, String> {
    let dir = crate::screenshot_popup::pictures_screenshots_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let filename = format!(
        "SnipClip_{}.png",
        chrono::Local::now().format("%Y%m%d_%H%M%S")
    );
    let path = dir.join(&filename);
    std::fs::write(&path, png_bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(target_os = "linux")]
pub fn capture_region_wayland() -> Result<(CaptureResult, Vec<u8>, String), String> {
    if !is_wayland() {
        return Err("not running on a Wayland session".into());
    }
    let (png_bytes, geometry) = capture_region_via_grim()?;
    let capture = crate::snip::capture_result_from_png_bytes(&png_bytes, "wayland")?;
    Ok((capture, png_bytes, geometry))
}

#[cfg(not(target_os = "linux"))]
pub fn capture_region_wayland() -> Result<(CaptureResult, Vec<u8>, String), String> {
    Err("Wayland capture is only available on Linux".into())
}
