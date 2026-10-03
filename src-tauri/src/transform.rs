//! Clipboard text transforms applied on the way out to the target app.
//!
//! The point is to stop the copy → paste → fix-it-by-hand loop: paste minified
//! JSON as pretty JSON, paste a base64 blob as the decoded text, paste a title
//! as a slug, without round-tripping through an editor.

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TransformKind {
    PlainText,
    Trim,
    SingleLine,
    StripIndent,
    DedupeLines,
    SortLines,
    Lower,
    Upper,
    Title,
    Sentence,
    Snake,
    Kebab,
    Camel,
    Slugify,
    JsonPretty,
    JsonMinify,
    Base64Encode,
    Base64Decode,
    UrlEncode,
    UrlDecode,
    StripHtml,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransformOption {
    pub kind: TransformKind,
    pub label: String,
    /// Content-aware hit — these float to the front of the transform bar.
    pub suggested: bool,
}

impl TransformKind {
    pub fn label(self) -> &'static str {
        match self {
            TransformKind::PlainText => "Plain text",
            TransformKind::Trim => "Trim",
            TransformKind::SingleLine => "One line",
            TransformKind::StripIndent => "Unindent",
            TransformKind::DedupeLines => "Dedupe lines",
            TransformKind::SortLines => "Sort lines",
            TransformKind::Lower => "lowercase",
            TransformKind::Upper => "UPPERCASE",
            TransformKind::Title => "Title Case",
            TransformKind::Sentence => "Sentence case",
            TransformKind::Snake => "snake_case",
            TransformKind::Kebab => "kebab-case",
            TransformKind::Camel => "camelCase",
            TransformKind::Slugify => "Slug",
            TransformKind::JsonPretty => "Format JSON",
            TransformKind::JsonMinify => "Minify JSON",
            TransformKind::Base64Encode => "Base64 encode",
            TransformKind::Base64Decode => "Base64 decode",
            TransformKind::UrlEncode => "URL encode",
            TransformKind::UrlDecode => "URL decode",
            TransformKind::StripHtml => "Strip HTML",
        }
    }
}

pub fn apply(kind: TransformKind, text: &str) -> Result<String, String> {
    let out = match kind {
        TransformKind::PlainText => plain_text(text),
        TransformKind::Trim => text
            .lines()
            .map(|l| l.trim_end())
            .collect::<Vec<_>>()
            .join("\n")
            .trim()
            .to_string(),
        TransformKind::SingleLine => text.split_whitespace().collect::<Vec<_>>().join(" "),
        TransformKind::StripIndent => strip_indent(text),
        TransformKind::DedupeLines => {
            let mut seen = std::collections::HashSet::new();
            text.lines()
                .filter(|l| seen.insert(l.trim().to_string()))
                .collect::<Vec<_>>()
                .join("\n")
        }
        TransformKind::SortLines => {
            let mut lines: Vec<&str> = text.lines().collect();
            lines.sort_by_key(|l| l.trim().to_lowercase());
            lines.join("\n")
        }
        TransformKind::Lower => text.to_lowercase(),
        TransformKind::Upper => text.to_uppercase(),
        TransformKind::Title => title_case(text),
        TransformKind::Sentence => sentence_case(text),
        TransformKind::Snake => words(text).join("_").to_lowercase(),
        TransformKind::Kebab => words(text).join("-").to_lowercase(),
        TransformKind::Camel => camel_case(text),
        TransformKind::Slugify => slugify(text),
        TransformKind::JsonPretty => json_reformat(text, true)?,
        TransformKind::JsonMinify => json_reformat(text, false)?,
        TransformKind::Base64Encode => B64.encode(text.as_bytes()),
        TransformKind::Base64Decode => {
            let bytes = B64
                .decode(text.trim().as_bytes())
                .map_err(|_| "Not valid base64".to_string())?;
            String::from_utf8(bytes).map_err(|_| "Base64 decoded to binary, not text".to_string())?
        }
        TransformKind::UrlEncode => url_encode(text),
        TransformKind::UrlDecode => url_decode(text)?,
        TransformKind::StripHtml => strip_html(text),
    };
    Ok(out)
}

/// Content sniffing so the bar leads with the transform you actually wanted.
pub fn options_for(text: &str) -> Vec<TransformOption> {
    let trimmed = text.trim();
    let mut suggested: Vec<TransformKind> = Vec::new();

    if looks_like_json(trimmed) {
        if trimmed.contains('\n') {
            suggested.push(TransformKind::JsonMinify);
            suggested.push(TransformKind::JsonPretty);
        } else {
            suggested.push(TransformKind::JsonPretty);
        }
    }
    if looks_like_base64(trimmed) {
        suggested.push(TransformKind::Base64Decode);
    }
    if trimmed.contains('%') && url_decode(trimmed).map_or(false, |d| d != trimmed) {
        suggested.push(TransformKind::UrlDecode);
    }
    if looks_like_html(trimmed) {
        suggested.push(TransformKind::StripHtml);
    }
    if has_duplicate_lines(trimmed) {
        suggested.push(TransformKind::DedupeLines);
    }
    if trimmed.lines().count() > 1 {
        suggested.push(TransformKind::SingleLine);
        if has_common_indent(trimmed) {
            suggested.push(TransformKind::StripIndent);
        }
    }
    if trimmed.len() != text.len() {
        suggested.push(TransformKind::Trim);
    }
    if is_headline(trimmed) {
        suggested.push(TransformKind::Slugify);
    }

    const ALL: [TransformKind; 21] = [
        TransformKind::PlainText,
        TransformKind::Trim,
        TransformKind::SingleLine,
        TransformKind::StripIndent,
        TransformKind::DedupeLines,
        TransformKind::SortLines,
        TransformKind::Lower,
        TransformKind::Upper,
        TransformKind::Title,
        TransformKind::Sentence,
        TransformKind::Snake,
        TransformKind::Kebab,
        TransformKind::Camel,
        TransformKind::Slugify,
        TransformKind::JsonPretty,
        TransformKind::JsonMinify,
        TransformKind::Base64Encode,
        TransformKind::Base64Decode,
        TransformKind::UrlEncode,
        TransformKind::UrlDecode,
        TransformKind::StripHtml,
    ];

    let mut out: Vec<TransformOption> = suggested
        .iter()
        .map(|k| TransformOption {
            kind: *k,
            label: k.label().to_string(),
            suggested: true,
        })
        .collect();
    for kind in ALL {
        if suggested.contains(&kind) {
            continue;
        }
        out.push(TransformOption {
            kind,
            label: kind.label().to_string(),
            suggested: false,
        });
    }
    out
}

fn plain_text(text: &str) -> String {
    text.replace("\r\n", "\n")
        .chars()
        .filter(|c| !matches!(c, '\u{200b}'..='\u{200f}' | '\u{feff}' | '\u{00ad}'))
        .filter(|c| !c.is_control() || matches!(c, '\n' | '\t'))
        .collect()
}

fn strip_indent(text: &str) -> String {
    let indent = text
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| l.len() - l.trim_start().len())
        .min()
        .unwrap_or(0);
    if indent == 0 {
        return text.to_string();
    }
    text.lines()
        .map(|l| if l.len() >= indent { &l[indent..] } else { l.trim_start() })
        .collect::<Vec<_>>()
        .join("\n")
}

fn words(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut prev_soft = false;
    for ch in s.chars() {
        if ch.is_alphanumeric() {
            if ch.is_uppercase() && prev_soft && !cur.is_empty() {
                out.push(std::mem::take(&mut cur));
            }
            cur.push(ch);
            prev_soft = ch.is_lowercase() || ch.is_numeric();
        } else {
            if !cur.is_empty() {
                out.push(std::mem::take(&mut cur));
            }
            prev_soft = false;
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

fn capitalize(word: &str) -> String {
    let mut chars = word.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + &chars.as_str().to_lowercase(),
        None => String::new(),
    }
}

fn title_case(text: &str) -> String {
    text.split_inclusive(char::is_whitespace)
        .map(|chunk| {
            let ws: String = chunk
                .chars()
                .rev()
                .take_while(|c| c.is_whitespace())
                .collect();
            let word = &chunk[..chunk.len() - ws.len()];
            format!("{}{}", capitalize(word), ws.chars().rev().collect::<String>())
        })
        .collect()
}

fn sentence_case(text: &str) -> String {
    let lower = text.to_lowercase();
    let mut out = String::with_capacity(lower.len());
    let mut start_of_sentence = true;
    for ch in lower.chars() {
        if start_of_sentence && ch.is_alphabetic() {
            out.extend(ch.to_uppercase());
            start_of_sentence = false;
        } else {
            out.push(ch);
            if matches!(ch, '.' | '!' | '?' | '\n') {
                start_of_sentence = true;
            }
        }
    }
    out
}

fn camel_case(text: &str) -> String {
    let parts = words(text);
    let mut out = String::new();
    for (i, w) in parts.iter().enumerate() {
        if i == 0 {
            out.push_str(&w.to_lowercase());
        } else {
            out.push_str(&capitalize(w));
        }
    }
    out
}

fn slugify(text: &str) -> String {
    words(text).join("-").to_lowercase()
}

fn json_reformat(text: &str, pretty: bool) -> Result<String, String> {
    let value: serde_json::Value =
        serde_json::from_str(text.trim()).map_err(|e| format!("Not valid JSON: {e}"))?;
    if pretty {
        serde_json::to_string_pretty(&value).map_err(|e| e.to_string())
    } else {
        serde_json::to_string(&value).map_err(|e| e.to_string())
    }
}

fn url_encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for byte in text.as_bytes() {
        let ch = *byte as char;
        if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | '~') {
            out.push(ch);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

fn url_decode(text: &str) -> Result<String, String> {
    let bytes = text.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3])
                    .map_err(|_| "Not URL-encoded".to_string())?;
                let val =
                    u8::from_str_radix(hex, 16).map_err(|_| "Not URL-encoded".to_string())?;
                out.push(val);
                i += 3;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            other => {
                out.push(other);
                i += 1;
            }
        }
    }
    String::from_utf8(out).map_err(|_| "URL decode produced invalid UTF-8".to_string())
}

fn strip_html(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_tag = false;
    for ch in text.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            c if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn looks_like_json(text: &str) -> bool {
    let t = text.trim();
    ((t.starts_with('{') && t.ends_with('}')) || (t.starts_with('[') && t.ends_with(']')))
        && serde_json::from_str::<serde_json::Value>(t).is_ok()
}

fn looks_like_base64(text: &str) -> bool {
    let t = text.trim();
    if t.len() < 12 || t.len() % 4 != 0 || t.contains(char::is_whitespace) {
        return false;
    }
    if !t
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '/' | '='))
    {
        return false;
    }
    B64.decode(t.as_bytes())
        .ok()
        .and_then(|b| String::from_utf8(b).ok())
        .is_some_and(|s| s.chars().filter(|c| c.is_control() && *c != '\n').count() == 0)
}

fn looks_like_html(text: &str) -> bool {
    let t = text.trim();
    t.contains('<') && t.contains('>') && t.contains("</")
}

fn has_duplicate_lines(text: &str) -> bool {
    let mut seen = std::collections::HashSet::new();
    text.lines()
        .filter(|l| !l.trim().is_empty())
        .any(|l| !seen.insert(l.trim()))
}

fn has_common_indent(text: &str) -> bool {
    text.lines()
        .filter(|l| !l.trim().is_empty())
        .all(|l| l.starts_with(' ') || l.starts_with('\t'))
}

fn is_headline(text: &str) -> bool {
    !text.is_empty()
        && text.len() <= 120
        && !text.contains('\n')
        && text.split_whitespace().count() >= 2
        && text.chars().any(|c| c.is_uppercase() || c == ' ')
}
