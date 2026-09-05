use crate::db::Database;
use arboard::{Clipboard, ImageData};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use image::{imageops, ImageBuffer, Rgba};
use parking_lot::Mutex;
use std::io::Cursor;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

static MONITORING: AtomicBool = AtomicBool::new(false);
static PAUSED: AtomicBool = AtomicBool::new(false);
static MAIN_UI_VISIBLE: AtomicBool = AtomicBool::new(true);
static SUPPRESS_UNTIL_MS: AtomicU64 = AtomicU64::new(0);
/// Set after history clear — monitor should resync seen clipboard without re-inserting.
static RESYNC_SEEN: AtomicBool = AtomicBool::new(false);
static CLIPBOARD_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static IGNORE_LIST: OnceLock<Mutex<Vec<String>>> = OnceLock::new();

const RETRIES: u32 = 5;
const RETRY_DELAY_MS: u64 = 20;

fn clipboard_lock() -> &'static Mutex<()> {
    CLIPBOARD_LOCK.get_or_init(|| Mutex::new(()))
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn suppress_monitor(ms: u64) {
    SUPPRESS_UNTIL_MS.store(now_ms().saturating_add(ms), Ordering::SeqCst);
}

fn is_suppressed() -> bool {
    now_ms() < SUPPRESS_UNTIL_MS.load(Ordering::SeqCst)
}

fn ignore_list() -> &'static Mutex<Vec<String>> {
    IGNORE_LIST.get_or_init(|| Mutex::new(Vec::new()))
}

pub fn set_paused(paused: bool) -> bool {
    PAUSED.store(paused, Ordering::SeqCst);
    paused
}

pub fn toggle_paused() -> bool {
    let next = !PAUSED.load(Ordering::SeqCst);
    PAUSED.store(next, Ordering::SeqCst);
    next
}

pub fn is_paused() -> bool {
    PAUSED.load(Ordering::SeqCst)
}

/// After clearing the vault, forget “already seen” clipboard so future copies are stored again.
/// The next poll only resyncs seen hashes (no re-insert of whatever is currently on the clipboard).
pub fn resync_seen_clipboard() {
    RESYNC_SEEN.store(true, Ordering::SeqCst);
}

pub fn set_main_ui_visible(visible: bool) {
    MAIN_UI_VISIBLE.store(visible, Ordering::SeqCst);
}

fn poll_interval_ms() -> u64 {
    if is_paused() || !MAIN_UI_VISIBLE.load(Ordering::SeqCst) {
        1500
    } else {
        400
    }
}

pub fn set_ignore_list(names: Vec<String>) {
    *ignore_list().lock() = crate::db::normalize_ignore_list(names);
}

fn process_is_ignored(process: &str, list: &[String]) -> bool {
    let proc = process.to_lowercase();
    let stem = std::path::Path::new(&proc)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(proc.as_str());
    list.iter().any(|entry| {
        let e = entry.trim().to_lowercase();
        if e.is_empty() {
            return false;
        }
        let e_stem = std::path::Path::new(&e)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(e.as_str());
        proc == e || stem == e || stem == e_stem || proc == e_stem
    })
}

/// Skip vault insert when paused, or when the clipboard owner is on the ignore list.
fn should_skip_insert() -> bool {
    if is_paused() {
        return true;
    }
    let list = ignore_list().lock();
    if list.is_empty() {
        return false;
    }
    match clipboard_source_process() {
        Some(name) if process_is_ignored(&name, &list) => true,
        _ => false,
    }
}

fn image_content_hash(img: &ImageData<'_>) -> u64 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    img.width.hash(&mut h);
    img.height.hash(&mut h);
    img.bytes.len().hash(&mut h);
    for chunk in img.bytes.chunks(4096) {
        chunk.hash(&mut h);
    }
    h.finish()
}

fn with_clipboard_retry<T, F>(mut op: F) -> Result<T, String>
where
    F: FnMut(&mut Clipboard) -> Result<T, arboard::Error>,
{
    let _guard = clipboard_lock().lock();
    let mut last_err = String::new();

    // Prefer one Clipboard context across retries (Win32 open/close is expensive / racy).
    let mut clipboard = match Clipboard::new() {
        Ok(c) => c,
        Err(e) => {
            // Cold-open can also hit 1418 — retry acquiring the context itself.
            last_err = e.to_string();
            let mut acquired = None;
            for attempt in 1..RETRIES {
                thread::sleep(Duration::from_millis(RETRY_DELAY_MS * attempt as u64));
                match Clipboard::new() {
                    Ok(c) => {
                        acquired = Some(c);
                        break;
                    }
                    Err(e2) => last_err = e2.to_string(),
                }
            }
            match acquired {
                Some(c) => c,
                None => {
                    return Err(format!(
                        "Failed to acquire clipboard after retries: {last_err}"
                    ));
                }
            }
        }
    };

    for attempt in 0..RETRIES {
        match op(&mut clipboard) {
            Ok(v) => return Ok(v),
            Err(e) => {
                last_err = e.to_string();
                thread::sleep(Duration::from_millis(15 + RETRY_DELAY_MS * attempt as u64));
                // Re-open between failed writes — another process may have stolen the lock.
                if let Ok(c) = Clipboard::new() {
                    clipboard = c;
                }
            }
        }
    }
    Err(format!(
        "Failed to acquire clipboard after retries: {last_err}"
    ))
}

fn classify_text(text: &str) -> (&'static str, String) {
    let trimmed = text.trim();
    let preview: String = trimmed.chars().take(120).collect();
    if trimmed.starts_with("http://")
        || trimmed.starts_with("https://")
        || trimmed.starts_with("www.")
    {
        ("link", preview)
    } else {
        ("text", preview)
    }
}

fn image_to_png_b64(img: &ImageData<'_>) -> Result<(String, String), String> {
    let width = img.width as u32;
    let height = img.height as u32;
    let rgba: ImageBuffer<Rgba<u8>, Vec<u8>> =
        ImageBuffer::from_raw(width, height, img.bytes.to_vec())
            .ok_or_else(|| "invalid clipboard image buffer".to_string())?;

    let mut full_buf = Cursor::new(Vec::new());
    rgba.write_to(&mut full_buf, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    let full_b64 = B64.encode(full_buf.into_inner());

    let thumb = imageops::thumbnail(&rgba, 64, 64);
    let mut thumb_buf = Cursor::new(Vec::new());
    thumb
        .write_to(&mut thumb_buf, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    let thumb_preview = format!(
        "data:image/png;base64,{}",
        B64.encode(thumb_buf.into_inner())
    );

    Ok((full_b64, thumb_preview))
}

/// One clipboard open/read for both text and image payloads.
fn read_clipboard_snapshot() -> Result<(Option<String>, Option<ImageData<'static>>), String> {
    if crate::wayland::is_wayland() {
        #[cfg(target_os = "linux")]
        {
            let text = read_clipboard_text().ok().filter(|t| !t.is_empty());
            let image = read_clipboard_image().ok();
            return Ok((text, image));
        }
    }

    with_clipboard_retry(|c| {
        let text = c.get_text().ok().filter(|t| !t.is_empty());
        let image = c.get_image().ok().map(|img| ImageData {
            width: img.width,
            height: img.height,
            bytes: std::borrow::Cow::Owned(img.bytes.into_owned()),
        });
        Ok((text, image))
    })
}

fn process_clipboard_snapshot(
    app: &AppHandle,
    db: &Arc<Database>,
    text: Option<String>,
    image: Option<ImageData<'static>>,
    last_text: &mut Option<String>,
    last_image_hash: &mut Option<u64>,
    skip_insert: bool,
) {
    if let Some(text) = text {
        if Some(&text) != last_text.as_ref() {
            *last_text = Some(text.clone());
            if !skip_insert {
                // solving copied arithmetic and swapping the clipboard to the answer
                if let Some((expr, result)) = crate::math::try_solve(&text) {
                    let content = format!("{expr} = {result}");
                    let preview: String = content.chars().take(120).collect();
                    if let Ok(item) = db.insert("math", &content, &preview) {
                        let _ = app.emit("clipboard-item", &item.for_event());
                        let _ = app.emit(
                            "math-solved",
                            serde_json::json!({ "expression": expr, "result": result }),
                        );
                        let _ = write_text_to_clipboard(&result);
                        *last_text = Some(result);
                    }
                } else {
                    let (ctype, preview) = classify_text(&text);
                    if let Ok(item) = db.insert(ctype, &text, &preview) {
                        let _ = app.emit("clipboard-item", &item.for_event());
                    }
                }
            }
        }
    }

    if let Some(img) = image {
        let hash = image_content_hash(&img);
        if Some(hash) != *last_image_hash {
            *last_image_hash = Some(hash);
            if !skip_insert {
                if let Ok((b64, thumb)) = image_to_png_b64(&img) {
                    let content = format!("data:image/png;base64,{b64}");
                    if let Ok(item) = db.insert("image", &content, &thumb) {
                        let _ = app.emit("clipboard-item", &item.for_event());
                    }
                }
            }
        }
    }
}

#[cfg(windows)]
mod clipboard_seq {
    use std::sync::atomic::{AtomicU32, Ordering};

    static LAST_SEQ: AtomicU32 = AtomicU32::new(0);

    #[link(name = "user32")]
    extern "system" {
        fn GetClipboardSequenceNumber() -> u32;
    }

    fn current() -> u32 {
        unsafe { GetClipboardSequenceNumber() }
    }

    /// Returns true when the OS clipboard changed since the last acknowledged read.
    pub fn changed() -> bool {
        let now = current();
        let prev = LAST_SEQ.load(Ordering::Relaxed);
        if now == prev {
            return false;
        }
        LAST_SEQ.store(now, Ordering::Relaxed);
        true
    }

    pub fn acknowledge_current() {
        LAST_SEQ.store(current(), Ordering::Relaxed);
    }
}

#[cfg(not(windows))]
mod clipboard_seq {
    pub fn changed() -> bool {
        true
    }

    pub fn acknowledge_current() {}
}

pub fn start_monitor(app: AppHandle) {
    if MONITORING.swap(true, Ordering::SeqCst) {
        return;
    }

    if let Some(db) = app.try_state::<Arc<Database>>() {
        if let Ok(settings) = db.get_settings() {
            set_ignore_list(settings.ignore_list);
        }
    }

    thread::spawn(move || {
        let mut last_text: Option<String> = None;
        let mut last_image_hash: Option<u64> = None;

        loop {
            if !MONITORING.load(Ordering::SeqCst) {
                break;
            }

            if RESYNC_SEEN.swap(false, Ordering::SeqCst) {
                // Align with OS clipboard without writing into the vault again.
                if let Ok((text, image)) = read_clipboard_snapshot() {
                    if let Some(text) = text {
                        last_text = Some(text);
                    }
                    if let Some(img) = image {
                        last_image_hash = Some(image_content_hash(&img));
                    }
                }
                clipboard_seq::acknowledge_current();
            }

            if is_suppressed() {
                thread::sleep(Duration::from_millis(100));
                continue;
            }

            let db = match app.try_state::<Arc<Database>>() {
                Some(d) => d.clone(),
                None => {
                    thread::sleep(Duration::from_millis(poll_interval_ms()));
                    continue;
                }
            };

            if !clipboard_seq::changed() {
                thread::sleep(Duration::from_millis(poll_interval_ms()));
                continue;
            }

            let Ok((text, image)) = read_clipboard_snapshot() else {
                thread::sleep(Duration::from_millis(poll_interval_ms()));
                continue;
            };

            let skip_insert = should_skip_insert();
            process_clipboard_snapshot(
                &app,
                &db,
                text,
                image,
                &mut last_text,
                &mut last_image_hash,
                skip_insert || is_paused(),
            );

            thread::sleep(Duration::from_millis(poll_interval_ms()));
        }
    });
}

pub fn stop_monitor() {
    MONITORING.store(false, Ordering::SeqCst);
}

pub fn write_text_to_clipboard(text: &str) -> Result<(), String> {
    suppress_monitor(800);
    if crate::wayland::is_wayland() {
        #[cfg(target_os = "linux")]
        {
            return crate::wayland::copy_text(text);
        }
    }
    let owned = text.to_string();
    with_clipboard_retry(move |c| c.set_text(owned.clone()))
}

/// Put real file objects on the clipboard (CF_HDROP on Windows) so Discord/Explorer paste the file.
pub fn write_files_to_clipboard(paths: &[std::path::PathBuf]) -> Result<(), String> {
    if paths.is_empty() {
        return Err("no files to copy".into());
    }
    for path in paths {
        if !path.is_file() {
            return Err(format!("file not found: {}", path.display()));
        }
    }

    suppress_monitor(1200);

    #[cfg(windows)]
    {
        return write_hdrop_files(paths);
    }

    #[cfg(not(windows))]
    {
        let joined = paths
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join("\n");
        write_text_to_clipboard(&joined)
    }
}

#[cfg(windows)]
fn write_hdrop_files(paths: &[std::path::PathBuf]) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::Win32::Foundation::{HANDLE, HWND};
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
    };
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
    use windows::Win32::System::Ole::{CF_HDROP, CF_UNICODETEXT};
    use windows::Win32::UI::Shell::DROPFILES;

    let mut file_blob: Vec<u16> = Vec::new();
    for path in paths {
        let absolute = path
            .canonicalize()
            .unwrap_or_else(|_| path.to_path_buf());
        // canonicalize on Windows prefixes \\?\ — strip for apps that dislike it
        let display = absolute.to_string_lossy();
        let cleaned = display
            .strip_prefix(r"\\?\")
            .unwrap_or(display.as_ref())
            .to_string();
        file_blob.extend(std::ffi::OsString::from(cleaned).encode_wide());
        file_blob.push(0);
    }
    file_blob.push(0); // double-null terminator

    let dropfiles_size = std::mem::size_of::<DROPFILES>();
    let total = dropfiles_size + file_blob.len() * 2;

    // building a DROPFILES + wide path list so CF_HDROP paste attaches the real media file
    unsafe {
        let hdrop = GlobalAlloc(GMEM_MOVEABLE, total)
            .map_err(|e| format!("GlobalAlloc CF_HDROP failed: {e}"))?;
        if hdrop.0.is_null() {
            return Err("GlobalAlloc returned null for CF_HDROP".into());
        }
        let ptr = GlobalLock(hdrop) as *mut u8;
        if ptr.is_null() {
            return Err("GlobalLock failed for CF_HDROP".into());
        }

        let header = DROPFILES {
            pFiles: dropfiles_size as u32,
            pt: windows::Win32::Foundation::POINT { x: 0, y: 0 },
            fNC: windows::Win32::Foundation::FALSE,
            fWide: windows::Win32::Foundation::TRUE,
        };
        std::ptr::write(ptr as *mut DROPFILES, header);
        std::ptr::copy_nonoverlapping(
            file_blob.as_ptr() as *const u8,
            ptr.add(dropfiles_size),
            file_blob.len() * 2,
        );
        let _ = GlobalUnlock(hdrop);

        // Also offer Unicode text path for editors that only accept text
        let text = paths[0]
            .canonicalize()
            .unwrap_or_else(|_| paths[0].to_path_buf());
        let text_s = text.to_string_lossy();
        let text_clean = text_s
            .strip_prefix(r"\\?\")
            .unwrap_or(text_s.as_ref());
        let text_wide: Vec<u16> = std::ffi::OsString::from(text_clean)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let text_bytes = text_wide.len() * 2;
        let htext = GlobalAlloc(GMEM_MOVEABLE, text_bytes)
            .map_err(|e| format!("GlobalAlloc CF_UNICODETEXT failed: {e}"))?;
        let tptr = GlobalLock(htext) as *mut u16;
        if tptr.is_null() {
            return Err("GlobalLock failed for CF_UNICODETEXT".into());
        }
        std::ptr::copy_nonoverlapping(text_wide.as_ptr(), tptr, text_wide.len());
        let _ = GlobalUnlock(htext);

        let _guard = clipboard_lock().lock();
        let mut last_err = String::new();
        for _ in 0..RETRIES {
            match OpenClipboard(Some(HWND::default())) {
                Ok(()) => {
                    let _ = EmptyClipboard();
                    if SetClipboardData(CF_HDROP.0 as u32, Some(HANDLE(hdrop.0))).is_err() {
                        let _ = CloseClipboard();
                        last_err = "SetClipboardData(CF_HDROP) failed".into();
                        thread::sleep(Duration::from_millis(RETRY_DELAY_MS));
                        continue;
                    }
                    // Ownership of hdrop transferred to the clipboard on success
                    let _ = SetClipboardData(CF_UNICODETEXT.0 as u32, Some(HANDLE(htext.0)));
                    let _ = CloseClipboard();
                    return Ok(());
                }
                Err(e) => {
                    last_err = e.to_string();
                    thread::sleep(Duration::from_millis(RETRY_DELAY_MS));
                }
            }
        }
        Err(format!("OpenClipboard failed after retries: {last_err}"))
    }
}

pub fn write_image_to_clipboard(data_url: &str) -> Result<(), String> {
    let b64 = data_url
        .strip_prefix("data:image/png;base64,")
        .or_else(|| data_url.strip_prefix("data:image/jpeg;base64,"))
        .unwrap_or(data_url);
    let bytes = B64.decode(b64).map_err(|e| e.to_string())?;

    suppress_monitor(800);
    if crate::wayland::is_wayland() {
        #[cfg(target_os = "linux")]
        {
            return crate::wayland::copy_image_png(&bytes);
        }
    }

    let img = image::load_from_memory(&bytes).map_err(|e| e.to_string())?;
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    let raw = rgba.into_raw();

    suppress_monitor(800);
    with_clipboard_retry(move |c| {
        c.set_image(ImageData {
            width: w as usize,
            height: h as usize,
            bytes: std::borrow::Cow::Owned(raw.clone()),
        })
    })
}

#[cfg(target_os = "linux")]
fn read_clipboard_text() -> Result<String, String> {
    if crate::wayland::is_wayland() {
        #[cfg(target_os = "linux")]
        {
            return crate::wayland::paste_text();
        }
    }
    with_clipboard_retry(|c| c.get_text())
}

#[cfg(target_os = "linux")]
fn read_clipboard_image() -> Result<ImageData<'static>, String> {
    if crate::wayland::is_wayland() {
        #[cfg(target_os = "linux")]
        {
            let png = crate::wayland::paste_image_png()?;
            let img = image::load_from_memory(&png).map_err(|e| e.to_string())?;
            let rgba = img.to_rgba8();
            let (w, h) = rgba.dimensions();
            return Ok(ImageData {
                width: w as usize,
                height: h as usize,
                bytes: std::borrow::Cow::Owned(rgba.into_raw()),
            });
        }
    }
    with_clipboard_retry(|c| {
        c.get_image().map(|img| ImageData {
            width: img.width,
            height: img.height,
            bytes: std::borrow::Cow::Owned(img.bytes.into_owned()),
        })
    })
}

#[allow(dead_code)]
pub fn encode_rgba_png_b64(width: u32, height: u32, pixels: &[u8]) -> Result<String, String> {
    let img: ImageBuffer<image::Rgba<u8>, _> =
        ImageBuffer::from_raw(width, height, pixels.to_vec())
            .ok_or_else(|| "invalid image buffer".to_string())?;
    let mut buf = Cursor::new(Vec::new());
    img.write_to(&mut buf, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(B64.encode(buf.into_inner()))
}

/// Executable name of the process that currently owns the clipboard (Windows).
/// Wayland/X11 do not expose a reliable clipboard owner, so this is `None` elsewhere.
fn clipboard_source_process() -> Option<String> {
    #[cfg(windows)]
    {
        win_clip_owner::process_name()
    }
    #[cfg(not(windows))]
    {
        None
    }
}

#[cfg(windows)]
mod win_clip_owner {
    use std::os::windows::ffi::OsStringExt;

    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;

    #[link(name = "user32")]
    extern "system" {
        fn GetClipboardOwner() -> isize;
        fn GetForegroundWindow() -> isize;
        fn GetWindowThreadProcessId(hwnd: isize, lpdw_process_id: *mut u32) -> u32;
    }

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

    pub fn process_name() -> Option<String> {
        unsafe {
            let mut hwnd = GetClipboardOwner();
            if hwnd == 0 {
                hwnd = GetForegroundWindow();
            }
            if hwnd == 0 {
                return None;
            }
            let mut pid: u32 = 0;
            GetWindowThreadProcessId(hwnd, &mut pid);
            if pid == 0 {
                return None;
            }
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if handle == 0 {
                return None;
            }
            let mut buf = [0u16; 260];
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
}
