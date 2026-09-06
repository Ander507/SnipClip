//! Opt-in clipboard auto-translate via MyMemory (HTTPS).
//!
//! Off by default. Uses Autodetect → target language. Network failures are silent
//! so a flaky connection never blocks the clipboard monitor.

use parking_lot::Mutex;
use serde::Deserialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

static ENABLED: AtomicBool = AtomicBool::new(false);
static TARGET_LANG: Mutex<String> = Mutex::new(String::new());

const MAX_CHARS: usize = 450;
const MIN_CHARS: usize = 2;

#[derive(Deserialize)]
struct MyMemoryResponse {
    #[serde(rename = "responseData")]
    response_data: Option<MyMemoryData>,
    #[serde(rename = "responseStatus")]
    response_status: Option<i64>,
}

#[derive(Deserialize)]
struct MyMemoryData {
    #[serde(rename = "translatedText")]
    translated_text: Option<String>,
}

pub fn configure(enabled: bool, target_lang: &str) {
    ENABLED.store(enabled, Ordering::SeqCst);
    let lang = normalize_lang(target_lang);
    *TARGET_LANG.lock() = lang;
}

pub fn is_enabled() -> bool {
    ENABLED.load(Ordering::SeqCst)
}

pub fn target_lang() -> String {
    let guard = TARGET_LANG.lock();
    if guard.is_empty() {
        "en".into()
    } else {
        guard.clone()
    }
}

fn normalize_lang(raw: &str) -> String {
    let s = raw.trim().to_ascii_lowercase();
    if s.len() == 2 && s.chars().all(|c| c.is_ascii_alphabetic()) {
        s
    } else {
        "en".into()
    }
}

/// True for blobs that are almost certainly not natural language.
pub fn should_skip(text: &str) -> bool {
    let t = text.trim();
    if t.chars().count() < MIN_CHARS {
        return true;
    }
    if t.len() > 8_000 {
        return true;
    }
    // URLs / emails already classified elsewhere; belt-and-suspenders here
    if t.contains("://") || t.starts_with("www.") {
        return true;
    }
    // Code / dumps
    let braces = t.matches('{').count() + t.matches('}').count();
    let semis = t.matches(';').count();
    if braces >= 4 || (semis >= 3 && t.contains('\n')) {
        return true;
    }
    if t.contains("fn ") && t.contains('{') {
        return true;
    }
    if t.contains("def ") && t.contains(':') {
        return true;
    }
    false
}

pub struct Translation {
    pub translated: String,
    pub target_lang: String,
}

/// Translate `text` into the configured target language.
/// Returns None when disabled, skipped, unchanged, or on network/API failure.
pub fn try_translate(text: &str) -> Option<Translation> {
    if !is_enabled() {
        return None;
    }
    if should_skip(text) {
        return None;
    }
    let target = target_lang();
    let trimmed = text.trim();
    let query: String = trimmed.chars().take(MAX_CHARS).collect();
    if query.chars().count() < MIN_CHARS {
        return None;
    }

    let encoded = urlencoding_encode(&query);
    let url = format!(
        "https://api.mymemory.translated.net/get?q={encoded}&langpair=Autodetect|{target}"
    );

    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(2))
        .timeout_read(Duration::from_secs(4))
        .build();

    let parsed: MyMemoryResponse = agent.get(&url).call().ok()?.into_json().ok()?;
    if parsed.response_status != Some(200) {
        return None;
    }
    let translated = parsed.response_data?.translated_text?.trim().to_string();
    if translated.is_empty() {
        return None;
    }
    // Same text → already target language (or failed detection)
    if translated.eq_ignore_ascii_case(trimmed)
        || translated.eq_ignore_ascii_case(&query)
    {
        return None;
    }
    // MyMemory sometimes echoes "INVALID SOURCE LANGUAGE ..." — reject those
    if translated.to_ascii_uppercase().contains("INVALID")
        || translated.to_ascii_uppercase().contains("MYMEMORY WARNING")
    {
        return None;
    }

    Some(Translation {
        translated,
        target_lang: target,
    })
}

/// Minimal URL-encode for query strings (utf-8 safe).
fn urlencoding_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.as_bytes() {
        match *b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*b as char);
            }
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}
