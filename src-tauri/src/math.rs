//! Detect and evaluate simple arithmetic pasted onto the clipboard.

/// Normalize common unicode operators so `2×3÷4` still evaluates.
fn normalize_expr(raw: &str) -> String {
    raw.trim()
        .chars()
        .map(|c| match c {
            '×' | '⋅' | '·' => '*',
            '÷' => '/',
            '−' => '-',
            '（' => '(',
            '）' => ')',
            _ => c,
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("")
}

/// True when the clipboard looks like a short calculator expression, not prose.
pub fn looks_like_math(raw: &str) -> bool {
    let t = raw.trim();
    if t.len() < 3 || t.len() > 120 || t.contains('\n') || t.contains('\r') {
        return false;
    }
    if !t.chars().any(|c| c.is_ascii_digit()) {
        return false;
    }
    if !t.chars().any(|c| "+-*/^×÷⋅·(".contains(c)) {
        return false;
    }
    let normalized = normalize_expr(t);
    let for_check = normalized
        .to_ascii_lowercase()
        .replace("pi", "")
        .replace("sqrt", "")
        .replace("abs", "");
    for_check
        .chars()
        .all(|c| c.is_ascii_digit() || "+-*/^%().eE".contains(c))
}

fn format_result(value: f64) -> String {
    if !value.is_finite() {
        return value.to_string();
    }
    if (value - value.round()).abs() < 1e-10 && value.abs() < 1e15 {
        return format!("{}", value.round() as i64);
    }
    let s = format!("{:.10}", value);
    let trimmed = s.trim_end_matches('0').trim_end_matches('.');
    if trimmed.is_empty() || trimmed == "-" {
        "0".into()
    } else {
        trimmed.to_string()
    }
}

/// If `raw` is solvable math, returns `(normalized_expression, result_string)`.
pub fn try_solve(raw: &str) -> Option<(String, String)> {
    if !looks_like_math(raw) {
        return None;
    }
    let expr = normalize_expr(raw);
    let value = meval::eval_str(&expr).ok()?;
    let result = format_result(value);
    if result == expr || result == raw.trim() {
        return None;
    }
    Some((expr, result))
}
