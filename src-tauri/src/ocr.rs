use ocrs::{ImageSource, OcrEngine, OcrEngineParams};
use parking_lot::Mutex;
use rten::Model;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::thread;

const DETECTION_URL: &str = "https://ocrs-models.s3-accelerate.amazonaws.com/text-detection.rten";
const RECOGNITION_URL: &str =
    "https://ocrs-models.s3-accelerate.amazonaws.com/text-recognition.rten";

static ENGINE: OnceLock<Mutex<Option<OcrEngine>>> = OnceLock::new();
static OCIRS_READY: AtomicBool = AtomicBool::new(false);

fn engine_slot() -> &'static Mutex<Option<OcrEngine>> {
    ENGINE.get_or_init(|| Mutex::new(None))
}

fn ocrs_cache_dir() -> PathBuf {
    if let Ok(home) = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")) {
        return PathBuf::from(home).join(".cache").join("ocrs");
    }
    std::env::temp_dir().join("ocrs")
}

fn download_model(url: &str, dest: &Path) -> Result<(), String> {
    let response = ureq::get(url)
        .call()
        .map_err(|e| format!("failed to download OCR model: {e}"))?;
    let mut reader = response.into_reader();
    let mut file = std::fs::File::create(dest).map_err(|e| e.to_string())?;
    std::io::copy(&mut reader, &mut file).map_err(|e| e.to_string())?;
    Ok(())
}

fn ensure_model_files() -> Result<(PathBuf, PathBuf), String> {
    let dir = ocrs_cache_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let detection = dir.join("text-detection.rten");
    let recognition = dir.join("text-recognition.rten");
    if !detection.exists() {
        download_model(DETECTION_URL, &detection)?;
    }
    if !recognition.exists() {
        download_model(RECOGNITION_URL, &recognition)?;
    }
    Ok((detection, recognition))
}

// integrating ocrs into rust backend for direct local image-to-text conversion
fn init_ocrs_engine() -> Result<OcrEngine, String> {
    let (detection_path, recognition_path) = ensure_model_files()?;
    let detection = Model::load_file(detection_path).map_err(|e| e.to_string())?;
    let recognition = Model::load_file(recognition_path).map_err(|e| e.to_string())?;
    OcrEngine::new(OcrEngineParams {
        detection_model: Some(detection),
        recognition_model: Some(recognition),
        ..Default::default()
    })
    .map_err(|e| e.to_string())
}

fn with_engine<F, R>(f: F) -> Result<R, String>
where
    F: FnOnce(&OcrEngine) -> Result<R, String>,
{
    let slot = engine_slot();
    let mut guard = slot.lock();
    if guard.is_none() {
        *guard = Some(init_ocrs_engine()?);
        OCIRS_READY.store(true, Ordering::Release);
    }
    f(guard.as_ref().expect("engine initialized"))
}

/// Load OCR models on a background thread so startup and IPC stay responsive.
pub fn prewarm() {
    thread::spawn(|| match init_ocrs_engine() {
        Ok(engine) => {
            *engine_slot().lock() = Some(engine);
            OCIRS_READY.store(true, Ordering::Release);
        }
        Err(e) => eprintln!("ocr prewarm skipped: {e}"),
    });
}

#[cfg(windows)]
fn winrt_map_err(err: windows::core::Error) -> String {
    err.to_string()
}

/// Native Windows.Media.Ocr from a file path (PNG/JPEG/etc.).
#[cfg(windows)]
pub fn extract_text_from_image_path(image_path: &str) -> Result<String, String> {
    use windows::{
        core::HSTRING,
        Graphics::Imaging::BitmapDecoder,
        Media::Ocr::OcrEngine,
        Storage::{FileAccessMode, StorageFile},
    };

    let path = std::fs::canonicalize(image_path)
        .map_err(|e| format!("Could not open image: {e}"))?
        .to_string_lossy()
        .replace("\\\\?\\", "");

    // decoding software bitmap to pass into winrt ocr engine without pulling heavy tesseract binaries
    let file = StorageFile::GetFileFromPathAsync(&HSTRING::from(path.as_str()))
        .map_err(winrt_map_err)?
        .join()
        .map_err(winrt_map_err)?;
    let stream = file
        .OpenAsync(FileAccessMode::Read)
        .map_err(winrt_map_err)?
        .join()
        .map_err(winrt_map_err)?;
    let decoder = BitmapDecoder::CreateAsync(&stream)
        .map_err(winrt_map_err)?
        .join()
        .map_err(winrt_map_err)?;
    let bitmap = decoder
        .GetSoftwareBitmapAsync()
        .map_err(winrt_map_err)?
        .join()
        .map_err(winrt_map_err)?;

    let engine = match OcrEngine::TryCreateFromUserProfileLanguages() {
        Ok(engine) => engine,
        Err(_) => {
            let langs = OcrEngine::AvailableRecognizerLanguages().map_err(winrt_map_err)?;
            let count = langs.Size().map_err(winrt_map_err)?;
            if count == 0 {
                return Err("No OCR languages installed on this system".into());
            }
            let lang = langs.GetAt(0).map_err(winrt_map_err)?;
            OcrEngine::TryCreateFromLanguage(&lang).map_err(winrt_map_err)?
        }
    };

    let result = engine
        .RecognizeAsync(&bitmap)
        .map_err(winrt_map_err)?
        .join()
        .map_err(winrt_map_err)?;

    // iterating recognized lines to join clean multiline text into the clipboard
    let lines = result.Lines().map_err(winrt_map_err)?;
    let size = lines.Size().map_err(winrt_map_err)?;
    let mut out = String::new();
    for i in 0..size {
        let line = lines.GetAt(i).map_err(winrt_map_err)?;
        let text = line.Text().map_err(winrt_map_err)?.to_string();
        if text.is_empty() {
            continue;
        }
        if !out.is_empty() {
            out.push('\n');
        }
        out.push_str(&text);
    }

    if out.trim().is_empty() {
        // Prefer the engine's flattened Text() when line iteration is empty
        let flat = result.Text().map_err(winrt_map_err)?.to_string();
        if flat.trim().is_empty() {
            return Err("No text found in image".into());
        }
        return Ok(flat.trim().to_string());
    }

    Ok(out)
}

#[cfg(not(windows))]
pub fn extract_text_from_image_path(_image_path: &str) -> Result<String, String> {
    Err("Native Windows OCR is only available on Windows".into())
}

#[cfg(windows)]
fn win_ocr_png_bytes(bytes: &[u8]) -> Result<String, String> {
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let path = std::env::temp_dir().join(format!("snipclip-ocr-{stamp}.png"));
    fs::write(&path, bytes).map_err(|e| e.to_string())?;
    let path_str = path.to_string_lossy().into_owned();
    let result = extract_text_from_image_path(&path_str);
    let _ = fs::remove_file(&path);
    result
}

pub fn ocr_png_bytes(bytes: &[u8]) -> Result<String, String> {
    // Prefer Windows.Media.Ocr first (offline, no bundled models) then fall back to ocrs
    #[cfg(windows)]
    {
        if let Ok(text) = win_ocr_png_bytes(bytes) {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return Ok(trimmed.to_string());
            }
        }
    }

    if let Ok(text) = with_engine(|engine| ocr_with_engine(engine, bytes)) {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }

    Err("No text found in image".into())
}

fn ocr_with_engine(engine: &OcrEngine, bytes: &[u8]) -> Result<String, String> {
    let img = image::load_from_memory(bytes).map_err(|e| e.to_string())?;
    let rgb = img.into_rgb8();
    let (width, height) = rgb.dimensions();
    let source =
        ImageSource::from_bytes(rgb.as_raw(), (width, height)).map_err(|e| e.to_string())?;
    let input = engine.prepare_input(source).map_err(|e| e.to_string())?;
    engine.get_text(&input).map_err(|e| e.to_string())
}

pub fn is_available() -> bool {
    if OCIRS_READY.load(Ordering::Acquire) {
        return true;
    }
    #[cfg(windows)]
    {
        return true;
    }
    #[cfg(not(windows))]
    {
        false
    }
}