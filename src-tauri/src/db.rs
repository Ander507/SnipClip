use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const DEFAULT_HOTKEY_CLIPBOARD: &str = "Control+Shift+V";
pub const DEFAULT_HOTKEY_SNIP: &str = "Control+Shift+S";
pub const DEFAULT_HOTKEY_RECORD: &str = "Control+Shift+R";
pub const DEFAULT_HOTKEY_DOCK: &str = "Control+Shift+D";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardItem {
    pub id: i64,
    pub content_type: String,
    pub content: String,
    pub preview: String,
    pub is_pinned: bool,
    pub created_at: String,
    /// Process that owned the clipboard (e.g. "Code.exe"). None for snips and older rows.
    #[serde(default)]
    pub source_app: Option<String>,
    /// Pixel size for image / screenshot items.
    #[serde(default)]
    pub width: Option<u32>,
    #[serde(default)]
    pub height: Option<u32>,
}

/// Optional capture metadata stored alongside a new item.
#[derive(Debug, Clone, Default)]
pub struct ItemMeta {
    pub source_app: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

/// Shared row mapper — every ClipboardItem SELECT returns these columns in this order:
/// `id, content_type, content, preview, is_pinned, created_at, source_app, width, height`.
fn item_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ClipboardItem> {
    Ok(ClipboardItem {
        id: row.get(0)?,
        content_type: row.get(1)?,
        content: row.get(2)?,
        preview: row.get(3)?,
        is_pinned: row.get::<_, i64>(4)? != 0,
        created_at: row.get(5)?,
        source_app: row.get(6)?,
        width: row.get::<_, Option<i64>>(7)?.and_then(|v| u32::try_from(v).ok()),
        height: row.get::<_, Option<i64>>(8)?.and_then(|v| u32::try_from(v).ok()),
    })
}

impl ClipboardItem {
    /// Strip heavy image payloads before emitting to the frontend.
    pub fn for_event(&self) -> Self {
        let mut clone = self.clone();
        if clone.content_type == "image" || clone.content_type == "screenshot" {
            clone.content = String::new();
        }
        clone
    }
}

pub const CLEAR_INTERVAL_NEVER: &str = "never";
pub const CLEAR_INTERVAL_REBOOT: &str = "reboot";
pub const CLEAR_INTERVAL_DAILY: &str = "daily";
pub const CLEAR_INTERVAL_WEEKLY: &str = "weekly";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub hotkey_clipboard: String,
    pub hotkey_snip: String,
    #[serde(default = "default_hotkey_record")]
    pub hotkey_record: String,
    /// Floating Win+V-style clipboard popup. Default Control+Shift+D.
    #[serde(default = "default_hotkey_dock")]
    pub hotkey_dock: String,
    /// Wipe unpinned items when a new OS boot is detected.
    pub clear_on_boot: bool,
    /// "never" | "reboot" | "daily" | "weekly"
    pub clear_interval: String,
    /// Unix timestamp of last auto-clear run (internal bookkeeping).
    pub last_cleanup: i64,
    /// Launch SnipClip at login (tray / --minimized).
    pub launch_at_startup: bool,
    /// "dark" | "light" | "system"
    pub theme_mode: String,
    /// Preset id ("cyan", "blue", … see ACCENT_PRESETS) or a lowercase "#rrggbb" hex.
    pub accent_color: String,
    #[serde(default)]
    pub theme_use_custom: bool,
    #[serde(default)]
    pub theme_custom: Option<serde_json::Value>,
    #[serde(default)]
    pub theme_glassmorphic: bool,
    /// 0–100 surface translucency
    #[serde(default)]
    pub theme_translucency: u8,
    /// data URL or theme-bg relative filename
    #[serde(default)]
    pub theme_background_image: Option<String>,
    /// Process names whose clipboard writes are not stored (e.g. "WhisperFlow.exe").
    #[serde(default)]
    pub ignore_list: Vec<String>,
    /// When true, the snip button waits before opening the overlay (stealth capture).
    #[serde(default)]
    pub snip_delay_enabled: bool,
    /// Milliseconds to wait before snip overlay (e.g. 3000).
    #[serde(default = "default_snip_delay_ms")]
    pub snip_delay_ms: u32,
    /// Ordered library tab ids that are visible in the sidebar.
    #[serde(default = "default_sidebar_tabs")]
    pub sidebar_tabs: Vec<String>,
    /// Argon2id hash of the vault password (never the password itself). Empty = no lock.
    #[serde(default)]
    pub vault_password_hash: Option<Vec<u8>>,
    /// 16-byte salt for the vault password hash. Empty = no lock.
    #[serde(default)]
    pub vault_password_salt: Option<Vec<u8>>,
    /// When true, plain text copies are auto-translated into `auto_translate_target_lang`.
    #[serde(default)]
    pub auto_translate_enabled: bool,
    /// ISO 639-1 target language (e.g. "en", "da"). Default English.
    #[serde(default = "default_auto_translate_target_lang")]
    pub auto_translate_target_lang: String,
    /// When true, solvable arithmetic is stored as math with a result badge (clipboard stays raw).
    #[serde(default)]
    pub auto_eval_math: bool,
    /// When true, Enter in the popup/dock pastes into the previous app (SendInput). Off by default.
    #[serde(default)]
    pub direct_paste_enabled: bool,
    /// Slim Win+V-style vault layout (narrow floating card).
    #[serde(default)]
    pub compact_dock: bool,
    /// Keep the main vault window above other apps.
    #[serde(default)]
    pub main_always_on_top: bool,
    /// Max unpinned items retained (50–1000). Pinned items are never trimmed by this.
    #[serde(default = "default_max_history")]
    pub max_history: u32,
    /// UI scale percent (90–125).
    #[serde(default = "default_ui_scale")]
    pub ui_scale: u32,
    /// Native window material behind the main window: "none" | "mica" | "acrylic".
    #[serde(default = "default_theme_backdrop")]
    pub theme_backdrop: String,
    /// Frontend-owned UI preferences blob — stored verbatim, schema lives in the UI.
    #[serde(default)]
    pub ui_prefs: Option<serde_json::Value>,
    /// User's own KLIPY GIF API key. Empty = fall back to the key baked in at build time.
    #[serde(default)]
    pub klipy_api_key: String,
    /// Instant replay: keep the last N seconds of the screen in a rolling buffer.
    #[serde(default)]
    pub replay_enabled: bool,
    #[serde(default = "default_replay_seconds")]
    pub replay_seconds: u32,
    #[serde(default = "default_replay_hotkey")]
    pub replay_hotkey: String,
    #[serde(default = "default_replay_fps")]
    pub replay_fps: u32,
    /// "low" | "medium" | "high"
    #[serde(default = "default_replay_quality")]
    pub replay_quality: String,
    /// "native" | "1080p" | "720p"
    #[serde(default = "default_replay_resolution")]
    pub replay_resolution: String,
    #[serde(default = "default_true")]
    pub replay_audio: bool,
    /// DXGI output index (0 = primary on most setups).
    #[serde(default)]
    pub replay_monitor: u32,
    /// Corner "Clip saved" toast (never takes focus).
    #[serde(default = "default_true")]
    pub replay_notify_popup: bool,
    /// Save chime. Note: desktop audio capture records it into later clips.
    #[serde(default = "default_true")]
    pub replay_notify_sound: bool,
}

pub const DEFAULT_HOTKEY_REPLAY: &str = "Alt+F10";

fn default_replay_seconds() -> u32 {
    30
}

fn default_replay_hotkey() -> String {
    DEFAULT_HOTKEY_REPLAY.to_string()
}

fn default_replay_fps() -> u32 {
    60
}

fn default_replay_quality() -> String {
    "medium".to_string()
}

fn default_replay_resolution() -> String {
    "native".to_string()
}

fn default_true() -> bool {
    true
}

fn normalize_replay_quality(v: &str) -> String {
    match v {
        "low" | "medium" | "high" => v.to_string(),
        _ => default_replay_quality(),
    }
}

fn normalize_replay_resolution(v: &str) -> String {
    match v {
        "native" | "1080p" | "720p" => v.to_string(),
        _ => default_replay_resolution(),
    }
}

fn default_snip_delay_ms() -> u32 {
    3000
}

fn default_auto_translate_target_lang() -> String {
    "en".into()
}

fn default_max_history() -> u32 {
    500
}

fn default_ui_scale() -> u32 {
    100
}

fn clamp_max_history(n: u32) -> u32 {
    n.clamp(50, 1000)
}

fn clamp_ui_scale(n: u32) -> u32 {
    n.clamp(90, 125)
}

fn default_theme_backdrop() -> String {
    "none".into()
}

const ACCENT_PRESETS: &[&str] = &[
    "cyan", "blue", "indigo", "purple", "pink", "red", "orange", "yellow", "green",
];

fn normalize_theme_mode(raw: &str) -> String {
    match raw {
        "light" | "system" => raw.to_string(),
        _ => "dark".to_string(),
    }
}

/// Preset accent id, or a custom `#rrggbb` (stored lowercase). Anything else → cyan.
fn normalize_accent_color(raw: &str) -> String {
    if ACCENT_PRESETS.contains(&raw) {
        return raw.to_string();
    }
    let is_hex = raw.len() == 7
        && raw.starts_with('#')
        && raw[1..].chars().all(|c| c.is_ascii_hexdigit());
    if is_hex {
        raw.to_ascii_lowercase()
    } else {
        "cyan".to_string()
    }
}

fn normalize_theme_backdrop(raw: &str) -> String {
    match raw {
        "mica" | "acrylic" => raw.to_string(),
        _ => default_theme_backdrop(),
    }
}

fn default_hotkey_record() -> String {
    DEFAULT_HOTKEY_RECORD.to_string()
}

fn default_hotkey_dock() -> String {
    DEFAULT_HOTKEY_DOCK.to_string()
}

pub fn default_sidebar_tabs() -> Vec<String> {
    vec![
        "all".into(),
        "text".into(),
        "images".into(),
        "screenshots".into(),
        "videos".into(),
        "math".into(),
        "links".into(),
        "pinned".into(),
    ]
}

/// The sidebar category that lists an item of this content type. Must match the
/// filters in `Database::list`; `category_counts_match_list` enforces that.
fn category_of_content_type(content_type: &str) -> Option<&'static str> {
    match content_type {
        "text" | "translated" => Some("text"),
        "image" => Some("images"),
        "screenshot" => Some("screenshots"),
        "video" | "gif" => Some("videos"),
        "link" => Some("links"),
        "math" => Some("math"),
        _ => None,
    }
}

const SIDEBAR_TAB_IDS: &[&str] = &[
    "all",
    "text",
    "images",
    "screenshots",
    "videos",
    "math",
    "links",
    "pinned",
];

pub fn normalize_sidebar_tabs(tabs: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for raw in tabs {
        let id = raw.trim().to_ascii_lowercase();
        if !SIDEBAR_TAB_IDS.contains(&id.as_str()) {
            continue;
        }
        if out.iter().any(|e| e == &id) {
            continue;
        }
        out.push(id);
    }
    if out.is_empty() {
        return default_sidebar_tabs();
    }
    // Always keep "all" available — prepend if user hid everything else oddly
    if !out.iter().any(|t| t == "all") {
        out.insert(0, "all".into());
    }
    out
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            hotkey_clipboard: DEFAULT_HOTKEY_CLIPBOARD.to_string(),
            hotkey_snip: DEFAULT_HOTKEY_SNIP.to_string(),
            hotkey_record: DEFAULT_HOTKEY_RECORD.to_string(),
            hotkey_dock: DEFAULT_HOTKEY_DOCK.to_string(),
            clear_on_boot: false,
            clear_interval: CLEAR_INTERVAL_NEVER.to_string(),
            last_cleanup: 0,
            launch_at_startup: false,
            theme_mode: "dark".to_string(),
            accent_color: "cyan".to_string(),
            theme_use_custom: false,
            theme_custom: None,
            theme_glassmorphic: false,
            theme_translucency: 0,
            theme_background_image: None,
            ignore_list: Vec::new(),
            snip_delay_enabled: false,
            snip_delay_ms: default_snip_delay_ms(),
            sidebar_tabs: default_sidebar_tabs(),
            vault_password_hash: None,
            vault_password_salt: None,
            auto_translate_enabled: false,
            auto_translate_target_lang: default_auto_translate_target_lang(),
            auto_eval_math: false,
            direct_paste_enabled: false,
            compact_dock: false,
            main_always_on_top: false,
            max_history: default_max_history(),
            ui_scale: default_ui_scale(),
            theme_backdrop: default_theme_backdrop(),
            ui_prefs: None,
            klipy_api_key: String::new(),
            replay_enabled: false,
            replay_seconds: default_replay_seconds(),
            replay_hotkey: default_replay_hotkey(),
            replay_fps: default_replay_fps(),
            replay_quality: default_replay_quality(),
            replay_resolution: default_replay_resolution(),
            replay_audio: true,
            replay_monitor: 0,
            replay_notify_popup: true,
            replay_notify_sound: true,
        }
    }
}

pub fn normalize_ignore_list(names: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for raw in names {
        let name = raw.trim();
        if name.is_empty() || name.len() > 64 {
            continue;
        }
        if out
            .iter()
            .any(|existing| existing.eq_ignore_ascii_case(name))
        {
            continue;
        }
        out.push(name.to_string());
        if out.len() >= 32 {
            break;
        }
    }
    out
}

fn parse_ignore_list(raw: String) -> Vec<String> {
    if let Ok(list) = serde_json::from_str::<Vec<String>>(&raw) {
        return normalize_ignore_list(list);
    }
    normalize_ignore_list(raw.split(',').map(|s| s.trim().to_string()).collect())
}

fn escape_like(input: &str) -> String {
    input
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

pub struct Database {
    conn: Mutex<Connection>,
}

/// Created after `move_content_last`, because rebuilding the table drops its indexes.
/// `idx_items_pinned` is gone on purpose: the composite index covers it and also serves the
/// list ordering without a sort.
const ITEM_INDEXES: &str = "
    DROP INDEX IF EXISTS idx_items_pinned;
    CREATE INDEX IF NOT EXISTS idx_items_created ON items(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_items_type ON items(content_type);
    CREATE INDEX IF NOT EXISTS idx_items_pinned_created ON items(is_pinned DESC, created_at DESC);
";

impl Database {
    pub fn open(path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let conn = Connection::open(&path).map_err(|e| e.to_string())?;
        conn.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        Self::apply_schema(&conn)?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.ensure_default_settings()?;
        db.ensure_fts_populated()?;
        Ok(db)
    }

    /// Swap the live connection to a newly decrypted DB file (after unlock).
    pub fn reopen(&self, path: &Path) -> Result<(), String> {
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        conn.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        Self::apply_schema(&conn)?;
        *self.conn.lock().map_err(|e| e.to_string())? = conn;
        self.ensure_default_settings()?;
        self.ensure_fts_populated()?;
        Ok(())
    }

    pub fn checkpoint(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .map_err(|e| e.to_string())
    }

    fn apply_schema(conn: &Connection) -> Result<(), String> {
        conn.execute_batch(
            "
            PRAGMA journal_mode = WAL;
            -- With WAL, NORMAL stays crash-safe and skips an fsync on every single copy.
            PRAGMA synchronous = NORMAL;
            -- `content` is declared last on purpose, see `move_content_last`.
            CREATE TABLE IF NOT EXISTS items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content_type TEXT NOT NULL,
                preview TEXT NOT NULL,
                is_pinned INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                use_count INTEGER NOT NULL DEFAULT 0,
                last_used_at TEXT,
                source_app TEXT,
                width INTEGER,
                height INTEGER,
                content TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY NOT NULL,
                value TEXT NOT NULL
            );
            CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
                body,
                content_type UNINDEXED,
                tokenize = 'porter unicode61'
            );
            ",
        )
        .map_err(|e| e.to_string())?;

        // Frecency columns — older vaults predate them, so ignore duplicates.
        let _ = conn.execute(
            "ALTER TABLE items ADD COLUMN use_count INTEGER NOT NULL DEFAULT 0",
            [],
        );
        let _ = conn.execute("ALTER TABLE items ADD COLUMN last_used_at TEXT", []);
        // Item metadata — source process and image pixel size (nullable for older rows).
        let _ = conn.execute("ALTER TABLE items ADD COLUMN source_app TEXT", []);
        let _ = conn.execute("ALTER TABLE items ADD COLUMN width INTEGER", []);
        let _ = conn.execute("ALTER TABLE items ADD COLUMN height INTEGER", []);
        Self::move_content_last(conn)?;
        conn.execute_batch(ITEM_INDEXES).map_err(|e| e.to_string())?;
        Ok(())
    }

    /// One-time rebuild for vaults created before `content` was the last column.
    ///
    /// SQLite stores a row's columns in declaration order, and a large value spills into a
    /// chain of overflow pages that has to be walked to reach anything stored behind it. With
    /// `content` (often a multi-MB base64 image) sitting third, every list, search, sort and
    /// history trim read every image in the vault just to get at `preview`, `is_pinned` and
    /// `created_at`: 60 ms instead of 0.2 ms on a 280 MB vault, and far worse on a cold cache.
    fn move_content_last(conn: &Connection) -> Result<(), String> {
        let columns: Vec<String> = {
            let mut stmt = conn
                .prepare("SELECT name FROM pragma_table_info('items')")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            rows.filter_map(Result::ok).collect()
        };
        if columns.last().map(String::as_str) == Some("content") {
            return Ok(());
        }

        let rebuilt = conn.execute_batch(
            "
            BEGIN IMMEDIATE;
            DROP TABLE IF EXISTS items_reordered;
            CREATE TABLE items_reordered (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content_type TEXT NOT NULL,
                preview TEXT NOT NULL,
                is_pinned INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                use_count INTEGER NOT NULL DEFAULT 0,
                last_used_at TEXT,
                source_app TEXT,
                width INTEGER,
                height INTEGER,
                content TEXT NOT NULL
            );
            INSERT INTO items_reordered
                (id, content_type, preview, is_pinned, created_at, use_count, last_used_at,
                 source_app, width, height, content)
            SELECT id, content_type, preview, is_pinned, created_at, use_count, last_used_at,
                   source_app, width, height, content
            FROM items;
            -- Carry the id counter over, so ids of deleted rows are never handed out again.
            DELETE FROM sqlite_sequence WHERE name = 'items_reordered';
            INSERT INTO sqlite_sequence (name, seq)
                SELECT 'items_reordered', seq FROM sqlite_sequence WHERE name = 'items';
            DROP TABLE items;
            ALTER TABLE items_reordered RENAME TO items;
            COMMIT;
            ",
        );
        if let Err(e) = rebuilt {
            let _ = conn.execute_batch("ROLLBACK;");
            return Err(format!("vault upgrade failed: {e}"));
        }
        // Hand the old table's pages back to the disk; otherwise the file stays twice as big.
        if let Err(e) = conn.execute_batch("VACUUM;") {
            eprintln!("vacuum after vault upgrade skipped: {e}");
        }
        Ok(())
    }

    /// Bump a clip's frecency after it is pasted so it climbs search results.
    pub fn record_use(&self, id: i64) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE items SET use_count = use_count + 1, last_used_at = ?2 WHERE id = ?1",
            params![id, Utc::now().to_rfc3339()],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Indexable body for FTS — skip huge image data-URLs; keep text/link/previews searchable.
    fn fts_body(content_type: &str, content: &str, preview: &str) -> Option<String> {
        match content_type {
            "image" | "screenshot" => None,
            "video" | "gif" => {
                let p = preview.trim();
                if p.is_empty() {
                    None
                } else {
                    Some(p.to_string())
                }
            }
            _ => {
                let mut body = String::new();
                let p = preview.trim();
                if !p.is_empty() && !p.starts_with("data:") {
                    body.push_str(p);
                }
                let c = content.trim();
                if !c.is_empty() && !c.starts_with("data:") {
                    if !body.is_empty() {
                        body.push(' ');
                    }
                    // Cap so a giant paste cannot balloon the FTS index
                    let take = c.chars().take(12_000).collect::<String>();
                    body.push_str(&take);
                }
                if body.trim().is_empty() {
                    None
                } else {
                    Some(body)
                }
            }
        }
    }

    fn fts_upsert_conn(
        conn: &Connection,
        id: i64,
        content_type: &str,
        content: &str,
        preview: &str,
    ) -> Result<(), String> {
        let _ = conn.execute("DELETE FROM items_fts WHERE rowid = ?1", params![id]);
        if let Some(body) = Self::fts_body(content_type, content, preview) {
            conn.execute(
                "INSERT INTO items_fts(rowid, body, content_type) VALUES (?1, ?2, ?3)",
                params![id, body, content_type],
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    fn fts_delete_conn(conn: &Connection, id: i64) -> Result<(), String> {
        conn.execute("DELETE FROM items_fts WHERE rowid = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn ensure_fts_populated(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM items_fts", [], |row| row.get(0))
            .unwrap_or(0);
        if count > 0 {
            return Ok(());
        }
        let items: Vec<(i64, String, String, String)> = conn
            .prepare("SELECT id, content_type, content, preview FROM items")
            .map_err(|e| e.to_string())?
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        // One transaction instead of one fsync per row.
        let _ = conn.execute_batch("BEGIN");
        for (id, ctype, content, preview) in items {
            let _ = Self::fts_upsert_conn(&conn, id, &ctype, &content, &preview);
        }
        let _ = conn.execute_batch("COMMIT");
        Ok(())
    }

    /// Turn free text into a safe FTS5 prefix query (`foo* bar*`).
    fn fts_match_query(raw: &str) -> Option<String> {
        let terms: Vec<String> = raw
            .split_whitespace()
            .filter_map(|w| {
                let cleaned: String = w
                    .chars()
                    .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-' || *c == '.')
                    .collect();
                if cleaned.is_empty() {
                    None
                } else {
                    Some(format!("\"{cleaned}\"*"))
                }
            })
            .collect();
        if terms.is_empty() {
            None
        } else {
            Some(terms.join(" "))
        }
    }

    fn ensure_default_settings(&self) -> Result<(), String> {
        let defaults = AppSettings::default();
        if self.get_setting("hotkey_clipboard")?.is_none() {
            self.set_setting("hotkey_clipboard", &defaults.hotkey_clipboard)?;
        }
        if self.get_setting("hotkey_snip")?.is_none() {
            self.set_setting("hotkey_snip", &defaults.hotkey_snip)?;
        }
        if self.get_setting("hotkey_record")?.is_none() {
            self.set_setting("hotkey_record", &defaults.hotkey_record)?;
        }
        if self.get_setting("hotkey_dock")?.is_none() {
            self.set_setting("hotkey_dock", &defaults.hotkey_dock)?;
        }
        if self.get_setting("clear_on_boot")?.is_none() {
            self.set_setting("clear_on_boot", "0")?;
        }
        if self.get_setting("clear_interval")?.is_none() {
            self.set_setting("clear_interval", CLEAR_INTERVAL_NEVER)?;
        }
        if self.get_setting("last_cleanup")?.is_none() {
            self.set_setting("last_cleanup", "0")?;
        }
        if self.get_setting("launch_at_startup")?.is_none() {
            self.set_setting("launch_at_startup", "0")?;
        }
        if self.get_setting("theme_mode")?.is_none() {
            self.set_setting("theme_mode", "dark")?;
        }
        if self.get_setting("accent_color")?.is_none() {
            self.set_setting("accent_color", "cyan")?;
        }
        if self.get_setting("ignore_list")?.is_none() {
            self.set_setting("ignore_list", "[]")?;
        }
        if self.get_setting("sidebar_tabs")?.is_none() {
            let tabs_json =
                serde_json::to_string(&default_sidebar_tabs()).unwrap_or_else(|_| "[]".into());
            self.set_setting("sidebar_tabs", &tabs_json)?;
        }
        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_settings(&self) -> Result<AppSettings, String> {
        let clear_on_boot = self
            .get_setting("clear_on_boot")?
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false);
        let clear_interval = self
            .get_setting("clear_interval")?
            .unwrap_or_else(|| CLEAR_INTERVAL_NEVER.to_string());
        let last_cleanup = self
            .get_setting("last_cleanup")?
            .and_then(|v| v.parse::<i64>().ok())
            .unwrap_or(0);
        let launch_at_startup = self
            .get_setting("launch_at_startup")?
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false);
        let theme_mode = normalize_theme_mode(
            self.get_setting("theme_mode")?
                .as_deref()
                .unwrap_or("dark"),
        );
        let accent_color = normalize_accent_color(
            self.get_setting("accent_color")?
                .as_deref()
                .unwrap_or("cyan"),
        );
        let theme_backdrop = normalize_theme_backdrop(
            self.get_setting("theme_backdrop")?
                .as_deref()
                .unwrap_or("none"),
        );
        let ui_prefs = self
            .get_setting("ui_prefs")?
            .and_then(|raw| serde_json::from_str(&raw).ok());
        let theme_use_custom = self
            .get_setting("theme_use_custom")?
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false);
        let theme_custom = self
            .get_setting("theme_custom")?
            .and_then(|raw| serde_json::from_str(&raw).ok());
        let theme_glassmorphic = self
            .get_setting("theme_glassmorphic")?
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false);
        let theme_translucency = self
            .get_setting("theme_translucency")?
            .and_then(|v| v.parse::<u8>().ok())
            .unwrap_or(0)
            .min(100);
        let theme_background_image = self
            .get_setting("theme_background_image")?
            .filter(|s| !s.is_empty());
        let ignore_list = self
            .get_setting("ignore_list")?
            .map(parse_ignore_list)
            .unwrap_or_default();
        let snip_delay_enabled = self
            .get_setting("snip_delay_enabled")?
            .map(|v| v == "1")
            .unwrap_or(false);
        let snip_delay_ms = self
            .get_setting("snip_delay_ms")?
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or_else(default_snip_delay_ms)
            .clamp(500, 30_000);
        let sidebar_tabs = self
            .get_setting("sidebar_tabs")?
            .and_then(|raw| serde_json::from_str::<Vec<String>>(&raw).ok())
            .map(normalize_sidebar_tabs)
            .unwrap_or_else(default_sidebar_tabs);
        let vault_password_hash = self
            .get_setting("vault_password_hash")?
            .and_then(|raw| {
                serde_json::from_str::<Vec<u8>>(&raw).ok()
            });
        let vault_password_salt = self
            .get_setting("vault_password_salt")?
            .and_then(|raw| {
                serde_json::from_str::<Vec<u8>>(&raw).ok()
            });
        let auto_translate_enabled = self
            .get_setting("auto_translate_enabled")?
            .map(|v| v == "1")
            .unwrap_or(false);
        let auto_translate_target_lang = self
            .get_setting("auto_translate_target_lang")?
            .map(|s| {
                let t = s.trim().to_ascii_lowercase();
                if t.len() == 2 && t.chars().all(|c| c.is_ascii_alphabetic()) {
                    t
                } else {
                    default_auto_translate_target_lang()
                }
            })
            .unwrap_or_else(default_auto_translate_target_lang);
        let auto_eval_math = self
            .get_setting("auto_eval_math")?
            .map(|v| v == "1")
            .unwrap_or(false);
        let direct_paste_enabled = self
            .get_setting("direct_paste_enabled")?
            .map(|v| v == "1")
            .unwrap_or(false);
        let compact_dock = self
            .get_setting("compact_dock")?
            .map(|v| v == "1")
            .unwrap_or(false);
        let main_always_on_top = self
            .get_setting("main_always_on_top")?
            .map(|v| v == "1")
            .unwrap_or(false);
        let max_history = self
            .get_setting("max_history")?
            .and_then(|v| v.parse::<u32>().ok())
            .map(clamp_max_history)
            .unwrap_or_else(default_max_history);
        let ui_scale = self
            .get_setting("ui_scale")?
            .and_then(|v| v.parse::<u32>().ok())
            .map(clamp_ui_scale)
            .unwrap_or_else(default_ui_scale);
        let klipy_api_key = self
            .get_setting("klipy_api_key")?
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        Ok(AppSettings {
            hotkey_clipboard: self
                .get_setting("hotkey_clipboard")?
                .unwrap_or_else(|| DEFAULT_HOTKEY_CLIPBOARD.to_string()),
            hotkey_snip: self
                .get_setting("hotkey_snip")?
                .unwrap_or_else(|| DEFAULT_HOTKEY_SNIP.to_string()),
            hotkey_record: self
                .get_setting("hotkey_record")?
                .unwrap_or_else(|| DEFAULT_HOTKEY_RECORD.to_string()),
            hotkey_dock: self
                .get_setting("hotkey_dock")?
                .unwrap_or_else(|| DEFAULT_HOTKEY_DOCK.to_string()),
            clear_on_boot,
            clear_interval,
            last_cleanup,
            launch_at_startup,
            theme_mode,
            accent_color,
            theme_use_custom,
            theme_custom,
            theme_glassmorphic,
            theme_translucency,
            theme_background_image,
            ignore_list,
            snip_delay_enabled,
            snip_delay_ms,
            sidebar_tabs,
            vault_password_hash,
            vault_password_salt,
            auto_translate_enabled,
            auto_translate_target_lang,
            auto_eval_math,
            direct_paste_enabled,
            compact_dock,
            main_always_on_top,
            max_history,
            ui_scale,
            theme_backdrop,
            ui_prefs,
            klipy_api_key,
            replay_enabled: self.get_setting("replay_enabled")?.as_deref() == Some("1"),
            replay_seconds: self
                .get_setting("replay_seconds")?
                .and_then(|v| v.parse::<u32>().ok())
                .map(|n| n.clamp(crate::replay::MIN_SECONDS, crate::replay::MAX_SECONDS))
                .unwrap_or_else(default_replay_seconds),
            replay_hotkey: self
                .get_setting("replay_hotkey")?
                .filter(|v| !v.trim().is_empty())
                .unwrap_or_else(default_replay_hotkey),
            replay_fps: match self.get_setting("replay_fps")?.as_deref() {
                Some("30") => 30,
                _ => 60,
            },
            replay_quality: normalize_replay_quality(
                self.get_setting("replay_quality")?.as_deref().unwrap_or(""),
            ),
            replay_resolution: normalize_replay_resolution(
                self.get_setting("replay_resolution")?.as_deref().unwrap_or(""),
            ),
            replay_audio: self.get_setting("replay_audio")?.as_deref() != Some("0"),
            replay_monitor: self
                .get_setting("replay_monitor")?
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(0)
                .min(15),
            replay_notify_popup: self.get_setting("replay_notify_popup")?.as_deref() != Some("0"),
            replay_notify_sound: self.get_setting("replay_notify_sound")?.as_deref() != Some("0"),
        })
    }

    pub fn save_settings(&self, settings: &AppSettings) -> Result<(), String> {
        self.set_setting("hotkey_clipboard", &settings.hotkey_clipboard)?;
        self.set_setting("hotkey_snip", &settings.hotkey_snip)?;
        self.set_setting("hotkey_record", &settings.hotkey_record)?;
        self.set_setting("hotkey_dock", &settings.hotkey_dock)?;
        self.set_setting(
            "clear_on_boot",
            if settings.clear_on_boot { "1" } else { "0" },
        )?;
        let interval = match settings.clear_interval.as_str() {
            CLEAR_INTERVAL_REBOOT | CLEAR_INTERVAL_DAILY | CLEAR_INTERVAL_WEEKLY => {
                settings.clear_interval.as_str()
            }
            _ => CLEAR_INTERVAL_NEVER,
        };
        self.set_setting("clear_interval", interval)?;
        self.set_setting(
            "launch_at_startup",
            if settings.launch_at_startup { "1" } else { "0" },
        )?;
        self.set_setting("theme_mode", &normalize_theme_mode(&settings.theme_mode))?;
        self.set_setting(
            "accent_color",
            &normalize_accent_color(&settings.accent_color),
        )?;
        self.set_setting(
            "theme_backdrop",
            &normalize_theme_backdrop(&settings.theme_backdrop),
        )?;
        self.set_setting(
            "theme_use_custom",
            if settings.theme_use_custom { "1" } else { "0" },
        )?;
        if let Some(custom) = &settings.theme_custom {
            let json = serde_json::to_string(custom).unwrap_or_else(|_| "{}".to_string());
            self.set_setting("theme_custom", &json)?;
        } else {
            self.set_setting("theme_custom", "")?;
        }
        self.set_setting(
            "theme_glassmorphic",
            if settings.theme_glassmorphic {
                "1"
            } else {
                "0"
            },
        )?;
        self.set_setting(
            "theme_translucency",
            &settings.theme_translucency.min(100).to_string(),
        )?;
        self.set_setting(
            "theme_background_image",
            settings.theme_background_image.as_deref().unwrap_or(""),
        )?;
        let ignore = normalize_ignore_list(settings.ignore_list.clone());
        let ignore_json = serde_json::to_string(&ignore).unwrap_or_else(|_| "[]".to_string());
        self.set_setting("ignore_list", &ignore_json)?;
        self.set_setting(
            "snip_delay_enabled",
            if settings.snip_delay_enabled {
                "1"
            } else {
                "0"
            },
        )?;
        self.set_setting(
            "snip_delay_ms",
            &settings.snip_delay_ms.clamp(500, 30_000).to_string(),
        )?;
        let tabs = normalize_sidebar_tabs(settings.sidebar_tabs.clone());
        let tabs_json = serde_json::to_string(&tabs).unwrap_or_else(|_| "[]".to_string());
        self.set_setting("sidebar_tabs", &tabs_json)?;
        if let Some(hash) = &settings.vault_password_hash {
            let hash_json =
                serde_json::to_string(hash).unwrap_or_else(|_| "[]".to_string());
            self.set_setting("vault_password_hash", &hash_json)?;
        } else {
            self.set_setting("vault_password_hash", "")?;
        }
        if let Some(salt) = &settings.vault_password_salt {
            let salt_json =
                serde_json::to_string(salt).unwrap_or_else(|_| "[]".to_string());
            self.set_setting("vault_password_salt", &salt_json)?;
        } else {
            self.set_setting("vault_password_salt", "")?;
        }
        self.set_setting(
            "auto_translate_enabled",
            if settings.auto_translate_enabled {
                "1"
            } else {
                "0"
            },
        )?;
        let lang = {
            let t = settings.auto_translate_target_lang.trim().to_ascii_lowercase();
            if t.len() == 2 && t.chars().all(|c| c.is_ascii_alphabetic()) {
                t
            } else {
                default_auto_translate_target_lang()
            }
        };
        self.set_setting("auto_translate_target_lang", &lang)?;
        self.set_setting(
            "auto_eval_math",
            if settings.auto_eval_math { "1" } else { "0" },
        )?;
        self.set_setting(
            "direct_paste_enabled",
            if settings.direct_paste_enabled {
                "1"
            } else {
                "0"
            },
        )?;
        self.set_setting(
            "compact_dock",
            if settings.compact_dock { "1" } else { "0" },
        )?;
        self.set_setting(
            "main_always_on_top",
            if settings.main_always_on_top { "1" } else { "0" },
        )?;
        self.set_setting(
            "max_history",
            &clamp_max_history(settings.max_history).to_string(),
        )?;
        self.set_setting(
            "ui_scale",
            &clamp_ui_scale(settings.ui_scale).to_string(),
        )?;
        if let Some(prefs) = &settings.ui_prefs {
            let json = serde_json::to_string(prefs).unwrap_or_else(|_| "{}".to_string());
            self.set_setting("ui_prefs", &json)?;
        } else {
            self.set_setting("ui_prefs", "")?;
        }
        self.set_setting("klipy_api_key", settings.klipy_api_key.trim())?;
        self.set_setting("replay_enabled", if settings.replay_enabled { "1" } else { "0" })?;
        self.set_setting(
            "replay_seconds",
            &settings
                .replay_seconds
                .clamp(crate::replay::MIN_SECONDS, crate::replay::MAX_SECONDS)
                .to_string(),
        )?;
        self.set_setting("replay_hotkey", settings.replay_hotkey.trim())?;
        self.set_setting("replay_fps", if settings.replay_fps >= 60 { "60" } else { "30" })?;
        self.set_setting("replay_quality", &normalize_replay_quality(&settings.replay_quality))?;
        self.set_setting(
            "replay_resolution",
            &normalize_replay_resolution(&settings.replay_resolution),
        )?;
        self.set_setting("replay_audio", if settings.replay_audio { "1" } else { "0" })?;
        self.set_setting("replay_monitor", &settings.replay_monitor.min(15).to_string())?;
        self.set_setting("replay_notify_popup", if settings.replay_notify_popup { "1" } else { "0" })?;
        self.set_setting("replay_notify_sound", if settings.replay_notify_sound { "1" } else { "0" })?;
        // last_cleanup is owned by check_and_run_auto_clear — do not overwrite from UI
        Ok(())
    }

    /// Estimate OS boot time (unix seconds) from uptime.
    pub fn current_boot_id() -> i64 {
        let now = Utc::now().timestamp();
        let uptime_secs = system_uptime_secs().unwrap_or(0) as i64;
        now.saturating_sub(uptime_secs)
    }

    /// Run vault auto-clear rules on app startup. Keeps pinned items.
    pub fn check_and_run_auto_clear(&self) -> Result<bool, String> {
        let settings = self.get_settings()?;
        let now = Utc::now().timestamp();
        let boot_id = Self::current_boot_id();
        let stored_boot = self
            .get_setting("last_boot_id")?
            .and_then(|v| v.parse::<i64>().ok())
            .unwrap_or(0);

        // First launch after install: seed markers, never wipe history yet
        if stored_boot == 0 {
            self.set_setting("last_boot_id", &boot_id.to_string())?;
            if settings.last_cleanup == 0 {
                self.set_setting("last_cleanup", &now.to_string())?;
            }
            return Ok(false);
        }

        // New boot if boot id drifted by more than ~2 minutes (clock / rounding)
        let new_boot = (boot_id - stored_boot).abs() > 120;

        let interval_due = match settings.clear_interval.as_str() {
            CLEAR_INTERVAL_REBOOT => new_boot,
            CLEAR_INTERVAL_DAILY => {
                settings.last_cleanup > 0 && now - settings.last_cleanup >= 86_400
            }
            CLEAR_INTERVAL_WEEKLY => {
                settings.last_cleanup > 0 && now - settings.last_cleanup >= 604_800
            }
            _ => false,
        };

        let boot_due = settings.clear_on_boot && new_boot;
        let should_clear = interval_due || boot_due;

        if should_clear {
            self.clear_unpinned()?;
            self.set_setting("last_cleanup", &now.to_string())?;
            crate::clipboard::resync_seen_clipboard();
        } else if settings.last_cleanup == 0 {
            self.set_setting("last_cleanup", &now.to_string())?;
        }

        self.set_setting("last_boot_id", &boot_id.to_string())?;
        Ok(should_clear)
    }

    /// Drop oldest unpinned items until count fits `max_history`. Pins are never removed.
    pub fn prune_unpinned_to_limit(&self, max_history: u32) -> Result<u32, String> {
        let limit = clamp_max_history(max_history) as i64;
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let deleted = conn
            .execute(
                "DELETE FROM items WHERE id IN (
                    SELECT id FROM items WHERE is_pinned = 0
                    ORDER BY created_at DESC
                    LIMIT -1 OFFSET ?1
                )",
                params![limit],
            )
            .map_err(|e| e.to_string())? as u32;
        if deleted > 0 {
            let _ = conn.execute(
                "DELETE FROM items_fts WHERE rowid NOT IN (SELECT id FROM items)",
                [],
            );
        }
        Ok(deleted)
    }

    pub fn insert(
        &self,
        content_type: &str,
        content: &str,
        preview: &str,
    ) -> Result<ClipboardItem, String> {
        self.insert_with_meta(content_type, content, preview, &ItemMeta::default())
    }

    /// Insert with capture metadata (source process, image pixel size).
    pub fn insert_with_meta(
        &self,
        content_type: &str,
        content: &str,
        preview: &str,
        meta: &ItemMeta,
    ) -> Result<ClipboardItem, String> {
        // Read cap before taking the items lock (get_setting uses the same mutex)
        let max_history = self
            .get_setting("max_history")?
            .and_then(|v| v.parse::<u32>().ok())
            .map(clamp_max_history)
            .unwrap_or_else(default_max_history) as i64;

        let conn = self.conn.lock().map_err(|e| e.to_string())?;

        // Compare inside SQLite so the recent rows (often multi-MB base64 images)
        // are never copied into Rust just to check for a duplicate.
        let is_dup: bool = conn
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM (SELECT content_type, content FROM items ORDER BY id DESC LIMIT 8)
                    WHERE content_type = ?1 AND octet_length(content) = octet_length(?2) AND content = ?2
                )",
                params![content_type, content],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if is_dup {
            return Err("duplicate".into());
        }

        let created_at: DateTime<Utc> = Utc::now();
        let created_at_str = created_at.to_rfc3339();

        conn.execute(
            "INSERT INTO items (content_type, content, preview, is_pinned, created_at, source_app, width, height)
             VALUES (?1, ?2, ?3, 0, ?4, ?5, ?6, ?7)",
            params![
                content_type,
                content,
                preview,
                created_at_str,
                meta.source_app,
                meta.width,
                meta.height
            ],
        )
        .map_err(|e| e.to_string())?;

        let id = conn.last_insert_rowid();
        let _ = Self::fts_upsert_conn(&conn, id, content_type, content, preview);

        match conn.execute(
            "DELETE FROM items WHERE id IN (
                SELECT id FROM items WHERE is_pinned = 0
                ORDER BY created_at DESC
                LIMIT -1 OFFSET ?1
            )",
            params![max_history],
        ) {
            // Row is already inserted — don't fail the whole write or the UI never sees it.
            Err(e) => eprintln!("history trim skipped: {e}"),
            Ok(0) => {}
            Ok(_) => {
                // Drop FTS rows for items trimmed out of the main table (only when
                // something was actually trimmed — this is a full scan).
                let _ = conn.execute(
                    "DELETE FROM items_fts WHERE rowid NOT IN (SELECT id FROM items)",
                    [],
                );
            }
        }

        Ok(ClipboardItem {
            id,
            content_type: content_type.to_string(),
            content: content.to_string(),
            preview: preview.to_string(),
            is_pinned: false,
            created_at: created_at_str,
            source_app: meta.source_app.clone(),
            width: meta.width,
            height: meta.height,
        })
    }

    pub fn update_media_content(
        &self,
        id: i64,
        content_type: &str,
        content: &str,
        preview: &str,
    ) -> Result<ClipboardItem, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let updated = conn
            .execute(
                "UPDATE items SET content_type = ?1, content = ?2, preview = ?3 WHERE id = ?4 AND content_type IN ('video', 'gif')",
                params![content_type, content, preview, id],
            )
            .map_err(|e| e.to_string())?;
        if updated == 0 {
            return Err("item not found".into());
        }
        let _ = Self::fts_upsert_conn(&conn, id, content_type, content, preview);
        drop(conn);
        self.get(id)?.ok_or_else(|| "item not found".to_string())
    }

    pub fn update_image_content(
        &self,
        id: i64,
        content: &str,
        preview: &str,
        width: Option<u32>,
        height: Option<u32>,
    ) -> Result<ClipboardItem, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        // Crops change the pixel size — keep the stored dimensions in step (None keeps the old value)
        let updated = conn
            .execute(
                "UPDATE items SET content = ?1, preview = ?2,
                    width = COALESCE(?4, width), height = COALESCE(?5, height)
                 WHERE id = ?3 AND content_type IN ('image', 'screenshot')",
                params![content, preview, id, width, height],
            )
            .map_err(|e| e.to_string())?;
        if updated == 0 {
            return Err("item not found".into());
        }
        drop(conn);
        self.get(id)?.ok_or_else(|| "item not found".to_string())
    }

    pub fn list(
        &self,
        category: Option<&str>,
        query: Option<&str>,
        limit: i64,
    ) -> Result<Vec<ClipboardItem>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        // Omit full image blobs from list payloads — preview holds a tiny thumbnail.
        let mut sql = String::from(
            "SELECT id, content_type,
                CASE WHEN content_type IN ('image', 'screenshot') THEN '' ELSE content END,
                preview, is_pinned, created_at, source_app, width, height
             FROM items WHERE 1=1",
        );
        let mut binds: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        if let Some(cat) = category {
            match cat {
                "text" => {
                    sql.push_str(" AND content_type IN ('text', 'translated')");
                }
                "images" => {
                    sql.push_str(" AND content_type = ?");
                    binds.push(Box::new("image".to_string()));
                }
                "screenshots" => {
                    sql.push_str(" AND content_type = ?");
                    binds.push(Box::new("screenshot".to_string()));
                }
                "videos" => {
                    sql.push_str(" AND content_type IN ('video', 'gif')");
                }
                "links" => {
                    sql.push_str(" AND content_type = ?");
                    binds.push(Box::new("link".to_string()));
                }
                "math" => {
                    sql.push_str(" AND content_type = ?");
                    binds.push(Box::new("math".to_string()));
                }
                "pinned" => {
                    sql.push_str(" AND is_pinned = 1");
                }
                _ => {}
            }
        }

        if let Some(q) = query {
            if !q.trim().is_empty() {
                sql.push_str(" AND (preview LIKE ? ESCAPE '\\' OR (content_type NOT IN ('image', 'screenshot') AND content LIKE ? ESCAPE '\\'))");
                let pattern = format!("%{}%", escape_like(q.trim()));
                binds.push(Box::new(pattern.clone()));
                binds.push(Box::new(pattern));
            }
        }

        sql.push_str(" ORDER BY is_pinned DESC, created_at DESC LIMIT ?");
        binds.push(Box::new(limit));

        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let params_refs: Vec<&dyn rusqlite::types::ToSql> =
            binds.iter().map(|b| b.as_ref()).collect();

        let rows = stmt
            .query_map(params_refs.as_slice(), item_from_row)
            .map_err(|e| e.to_string())?;

        let mut items = Vec::new();
        for row in rows {
            items.push(row.map_err(|e| e.to_string())?);
        }
        Ok(items)
    }

    // wiring up the sqlite search command to filter history in real-time as the user types
    pub fn search_clipboard(&self, query: &str, limit: i64) -> Result<Vec<ClipboardItem>, String> {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            // Win+V-style panel shows a short recent stack (pins float first via list ORDER BY)
            return self.list(None, None, limit);
        }

        if let Some(match_q) = Self::fts_match_query(trimmed) {
            // A broken index or an odd query must degrade to the LIKE search below,
            // never fail the whole search.
            match self.search_fts(&match_q, limit) {
                Ok(items) if !items.is_empty() => return Ok(items),
                Ok(_) => {}
                Err(e) => eprintln!("fts search failed, falling back: {e}"),
            }
        }

        // Fallback for punctuation-only queries or empty FTS hits
        self.list(None, Some(trimmed), limit)
    }

    fn search_fts(&self, match_q: &str, limit: i64) -> Result<Vec<ClipboardItem>, String> {
        {
            let conn = self.conn.lock().map_err(|e| e.to_string())?;
            let mut stmt = conn
                .prepare(
                    "SELECT i.id, i.content_type,
                        CASE WHEN i.content_type IN ('image', 'screenshot') THEN '' ELSE i.content END,
                        i.preview, i.is_pinned, i.created_at, i.source_app, i.width, i.height
                     FROM items_fts f
                     JOIN items i ON i.id = f.rowid
                     WHERE items_fts MATCH ?1
                     ORDER BY i.is_pinned DESC,
                              min(i.use_count, 5) DESC,
                              COALESCE(i.last_used_at, i.created_at) DESC
                     LIMIT ?2",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![match_q, limit], item_from_row)
                .map_err(|e| e.to_string())?;
            let mut items = Vec::new();
            for row in rows {
                items.push(row.map_err(|e| e.to_string())?);
            }
            Ok(items)
        }
    }

    /// Per-category counts for the sidebar — one row per visible tab.
    /// Badge counts keyed by sidebar category id ("images", "videos", …), the same ids
    /// `list(Some(category), …)` filters on, plus "pinned" and "all".
    pub fn category_counts(&self) -> Result<Vec<(String, i64)>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT content_type, COUNT(*) FROM items GROUP BY content_type")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)))
            .map_err(|e| e.to_string())?;
        let mut out: Vec<(String, i64)> = Vec::new();
        for row in rows {
            let (ctype, count) = row.map_err(|e| e.to_string())?;
            // Content types with no tab of their own (e.g. code) only show under All.
            let Some(cat) = category_of_content_type(&ctype) else {
                continue;
            };
            match out.iter_mut().find(|(k, _)| k == cat) {
                Some((_, n)) => *n += count,
                None => out.push((cat.to_string(), count)),
            }
        }
        let pinned = conn
            .query_row("SELECT COUNT(*) FROM items WHERE is_pinned = 1", [], |row| {
                row.get::<_, i64>(0)
            })
            .map_err(|e| e.to_string())?;
        out.push(("pinned".into(), pinned));
        let total = conn
            .query_row("SELECT COUNT(*) FROM items", [], |row| row.get::<_, i64>(0))
            .map_err(|e| e.to_string())?;
        out.push(("all".into(), total));
        Ok(out)
    }

    pub fn get(&self, id: i64) -> Result<Option<ClipboardItem>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT id, content_type, content, preview, is_pinned, created_at, source_app, width, height
             FROM items WHERE id = ?1",
            params![id],
            item_from_row,
        )
        .optional()
        .map_err(|e| e.to_string())
    }

    /// Content type and byte length of an item, without loading the content itself.
    pub fn content_info(&self, id: i64) -> Result<Option<(String, usize)>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT content_type, octet_length(content) FROM items WHERE id = ?1",
            params![id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? as usize)),
        )
        .optional()
        .map_err(|e| e.to_string())
    }

    pub fn toggle_pin(&self, id: i64) -> Result<bool, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE items SET is_pinned = CASE WHEN is_pinned = 1 THEN 0 ELSE 1 END WHERE id = ?1",
            params![id],
        )
        .map_err(|e| e.to_string())?;
        let pinned: i64 = conn
            .query_row(
                "SELECT is_pinned FROM items WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        Ok(pinned != 0)
    }

    pub fn delete(&self, id: i64) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let _ = Self::fts_delete_conn(&conn, id);
        conn.execute("DELETE FROM items WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// wiring up inline text editing so users can tweak their copied snippets before pasting
    pub fn update_text_content(&self, id: i64, content: &str) -> Result<ClipboardItem, String> {
        let trimmed = content.trim();
        if trimmed.is_empty() {
            return Err("content cannot be empty".into());
        }
        if trimmed.len() > 500_000 {
            return Err("content is too long".into());
        }

        let preview: String = trimmed.chars().take(120).collect();
        let content_type = if trimmed.starts_with("http://")
            || trimmed.starts_with("https://")
            || trimmed.starts_with("www.")
        {
            "link"
        } else {
            "text"
        };

        const MAX_ATTEMPTS: u32 = 6;
        for attempt in 0..MAX_ATTEMPTS {
            match self.try_update_text_content(id, trimmed, &preview, content_type) {
                Ok(item) => return Ok(item),
                Err(e) if is_db_busy(&e) && attempt + 1 < MAX_ATTEMPTS => {
                    std::thread::sleep(std::time::Duration::from_millis(25 * (attempt + 1) as u64));
                }
                Err(e) => return Err(e),
            }
        }
        Err("database is busy — try saving again".into())
    }

    fn try_update_text_content(
        &self,
        id: i64,
        content: &str,
        preview: &str,
        content_type: &str,
    ) -> Result<ClipboardItem, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let updated = conn
            .execute(
                "UPDATE items SET content = ?1, preview = ?2, content_type = ?3
                 WHERE id = ?4 AND content_type NOT IN ('image', 'screenshot')",
                params![content, preview, content_type, id],
            )
            .map_err(|e| e.to_string())?;
        if updated == 0 {
            return Err("item not found or not editable".into());
        }
        let _ = Self::fts_upsert_conn(&conn, id, content_type, content, preview);
        drop(conn);
        self.get(id)?.ok_or_else(|| "item not found".to_string())
    }

    pub fn clear_unpinned(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        // Batch deletes so a vault full of large images doesn't lock the DB in one huge statement.
        loop {
            let deleted = conn
                .execute(
                    "DELETE FROM items WHERE id IN (
                        SELECT id FROM items WHERE is_pinned = 0 LIMIT 100
                    )",
                    [],
                )
                .map_err(|e| e.to_string())?;
            if deleted == 0 {
                break;
            }
        }
        let _ = conn.execute(
            "DELETE FROM items_fts WHERE rowid NOT IN (SELECT id FROM items)",
            [],
        );
        Ok(())
    }
}

fn is_db_busy(err: &str) -> bool {
    let lower = err.to_lowercase();
    lower.contains("database is locked")
        || lower.contains("database busy")
        || lower.contains("busy")
}

fn system_uptime_secs() -> Option<u64> {
    #[cfg(windows)]
    {
        // SAFETY: GetTickCount64 is a simple kernel call returning ms since boot.
        unsafe {
            #[link(name = "kernel32")]
            extern "system" {
                fn GetTickCount64() -> u64;
            }
            Some(GetTickCount64() / 1000)
        }
    }
    #[cfg(target_os = "linux")]
    {
        std::fs::read_to_string("/proc/uptime")
            .ok()
            .and_then(|s| s.split_whitespace().next()?.parse::<f64>().ok())
            .map(|secs| secs as u64)
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Regression: badges used raw content types ("image") while the sidebar looks up tab
    /// ids ("images"), so Images / Screenshots / Clips / Links never showed a count.
    #[test]
    fn category_counts_match_list() {
        let db = Database::open(temp_db("counts")).unwrap();
        let samples = [
            ("text", "hello"),
            ("translated", "hola

——— original ———
hello"),
            ("image", "data:image/png;base64,AAAA"),
            ("image", "data:image/png;base64,BBBB"),
            ("screenshot", "data:image/png;base64,CCCC"),
            ("video", "C:/clips/a.mp4"),
            ("gif", "C:/clips/b.gif"),
            ("link", "https://example.com"),
            ("math", "2+2"),
            ("code", "fn main() {}"),
        ];
        for (ctype, content) in samples {
            db.insert(ctype, content, content).unwrap();
        }
        let first = db.list(Some("images"), None, 1000).unwrap()[0].id;
        db.toggle_pin(first).unwrap();

        let counts: std::collections::HashMap<String, i64> =
            db.category_counts().unwrap().into_iter().collect();
        for tab in SIDEBAR_TAB_IDS {
            let listed = if *tab == "all" {
                db.list(None, None, 1000).unwrap().len()
            } else {
                db.list(Some(tab), None, 1000).unwrap().len()
            } as i64;
            assert_eq!(
                counts.get(*tab).copied().unwrap_or(0),
                listed,
                "badge for tab {tab:?} must equal what the tab lists"
            );
        }
        assert_eq!(counts["images"], 2);
        assert_eq!(counts["videos"], 2);
        assert_eq!(counts["text"], 2);
        assert_eq!(counts["all"], 10);
    }

    fn temp_db(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "snipclip-test-{name}-{}-{}",
            std::process::id(),
            Utc::now().timestamp_nanos_opt().unwrap_or(0)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("snipclip.db")
    }

    fn columns(db: &Database) -> Vec<String> {
        let conn = db.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT name FROM pragma_table_info('items')")
            .unwrap();
        let cols = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        cols
    }

    #[test]
    fn new_vault_keeps_content_last() {
        let path = temp_db("new");
        let db = Database::open(path.clone()).unwrap();
        assert_eq!(columns(&db).last().map(String::as_str), Some("content"));
        let item = db.insert("text", "hello world", "hello world").unwrap();
        assert_eq!(db.get(item.id).unwrap().unwrap().content, "hello world");
        assert!(db.insert("text", "hello world", "hello world").is_err());
        drop(db);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn old_vault_is_reordered_without_losing_anything() {
        let path = temp_db("old");
        {
            // the schema as shipped up to v1.7.0, with `content` third
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    content_type TEXT NOT NULL,
                    content TEXT NOT NULL,
                    preview TEXT NOT NULL,
                    is_pinned INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX idx_items_pinned ON items(is_pinned);
                ALTER TABLE items ADD COLUMN use_count INTEGER NOT NULL DEFAULT 0;
                ALTER TABLE items ADD COLUMN last_used_at TEXT;
                ALTER TABLE items ADD COLUMN source_app TEXT;
                INSERT INTO items (content_type, content, preview, is_pinned, created_at, use_count, source_app)
                    VALUES ('text', 'first clip', 'first', 1, '2026-01-01T00:00:00+00:00', 3, 'notepad.exe');
                INSERT INTO items (content_type, content, preview, is_pinned, created_at)
                    VALUES ('link', 'https://example.com', 'example', 0, '2026-01-02T00:00:00+00:00');
                INSERT INTO items (content_type, content, preview, is_pinned, created_at)
                    VALUES ('text', 'deleted later', 'deleted', 0, '2026-01-03T00:00:00+00:00');
                DELETE FROM items WHERE id = 3;",
            )
            .unwrap();
        }

        let db = Database::open(path.clone()).unwrap();
        assert_eq!(columns(&db).last().map(String::as_str), Some("content"));

        let first = db.get(1).unwrap().unwrap();
        assert_eq!(first.content, "first clip");
        assert_eq!(first.preview, "first");
        assert!(first.is_pinned);
        assert_eq!(first.source_app.as_deref(), Some("notepad.exe"));
        assert_eq!(first.width, None);
        let use_count: i64 = db
            .conn
            .lock()
            .unwrap()
            .query_row("SELECT use_count FROM items WHERE id = 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(use_count, 3);

        let listed = db.list(None, None, 50).unwrap();
        assert_eq!(listed.iter().map(|i| i.id).collect::<Vec<_>>(), vec![1, 2]);
        assert_eq!(db.search_clipboard("example", 10).unwrap().len(), 1);
        assert_eq!(db.search_fts("\"exam\"*", 10).unwrap().len(), 1);
        // dots and hyphens used to be FTS5 syntax errors
        assert_eq!(db.search_clipboard("example.com", 10).unwrap().len(), 1);
        assert!(db.search_clipboard("no-such-thing", 10).unwrap().is_empty());

        // id 3 was used and deleted before the upgrade; it must not be handed out again
        let next = db.insert("text", "after upgrade", "after").unwrap();
        assert_eq!(next.id, 4);

        // the ordering index exists and the redundant one is gone
        let indexes: Vec<String> = {
            let conn = db.conn.lock().unwrap();
            let mut stmt = conn
                .prepare("SELECT name FROM pragma_index_list('items')")
                .unwrap();
            let v = stmt
                .query_map([], |row| row.get::<_, String>(0))
                .unwrap()
                .map(Result::unwrap)
                .collect();
            v
        };
        assert!(indexes.iter().any(|n| n == "idx_items_pinned_created"));
        assert!(!indexes.iter().any(|n| n == "idx_items_pinned"));

        // reopening is a no-op
        drop(db);
        let db = Database::open(path.clone()).unwrap();
        assert_eq!(db.list(None, None, 50).unwrap().len(), 3);
        drop(db);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}
