#[cfg(windows)]
pub fn ocr_png_bytes(bytes: &[u8]) -> Result<String, String> {
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let path = std::env::temp_dir().join(format!("snipclip-ocr-{stamp}.png"));
    fs::write(&path, bytes).map_err(|e| e.to_string())?;
    let path_str = path.to_string_lossy().into_owned();

    let result = win_ocr::ocr(&path_str).map_err(|e| e.to_string());
    let _ = fs::remove_file(&path);
    result
}

#[cfg(not(windows))]
pub fn ocr_png_bytes(_bytes: &[u8]) -> Result<String, String> {
    Err("Text extraction from images is only supported on Windows".into())
}
