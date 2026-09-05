use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

pub const MAX_HISTORY: usize = 500;
pub const DEFAULT_HOTKEY_CLIPBOARD: &str = "Control+Shift+V";
pub const DEFAULT_HOTKEY_SNIP: &str = "Control+Shift+S";
pub const DEFAULT_HOTKEY_RECORD: &str = "Control+Shift+R";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardItem {
    pub id: i64,
    pub content_type: String,
    pub content: String,
    pub preview: String,
    pub is_pinned: bool,
    pub created_at: String,
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
    /// Wipe unpinned items when a new OS boot is detected.
    pub clear_on_boot: bool,
    /// "never" | "reboot" | "daily" | "weekly"
    pub clear_interval: String,
    /// Unix timestamp of last auto-clear run (internal bookkeeping).
    pub last_cleanup: i64,
    /// Launch SnipClip at login (tray / --minimized).
    pub launch_at_startup: bool,
    /// "dark" | "light"
    pub theme_mode: String,
    /// "cyan" | "purple" | "green" | "orange"
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
}

fn default_snip_delay_ms() -> u32 {
    3000
}

fn default_hotkey_record() -> String {
    DEFAULT_HOTKEY_RECORD.to_string()
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

impl Database {
    pub fn open(path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        conn.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        conn.execute_batch(
            "
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content_type TEXT NOT NULL,
                content TEXT NOT NULL,
                preview TEXT NOT NULL,
                is_pinned INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_items_created ON items(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_items_pinned ON items(is_pinned);
            CREATE INDEX IF NOT EXISTS idx_items_type ON items(content_type);
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

        let db = Self {
            conn: Mutex::new(conn),
        };
        db.ensure_default_settings()?;
        db.ensure_fts_populated()?;
        Ok(db)
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
        for (id, ctype, content, preview) in items {
            let _ = Self::fts_upsert_conn(&conn, id, &ctype, &content, &preview);
        }
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
                    Some(format!("{cleaned}*"))
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
        let theme_mode = match self
            .get_setting("theme_mode")?
            .unwrap_or_else(|| "dark".to_string())
            .as_str()
        {
            "light" => "light".to_string(),
            _ => "dark".to_string(),
        };
        let accent_raw = self
            .get_setting("accent_color")?
            .unwrap_or_else(|| "cyan".to_string());
        let accent_color = match accent_raw.as_str() {
            "purple" | "green" | "orange" => accent_raw,
            _ => "cyan".to_string(),
        };
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
        })
    }

    pub fn save_settings(&self, settings: &AppSettings) -> Result<(), String> {
        self.set_setting("hotkey_clipboard", &settings.hotkey_clipboard)?;
        self.set_setting("hotkey_snip", &settings.hotkey_snip)?;
        self.set_setting("hotkey_record", &settings.hotkey_record)?;
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
        let theme = if settings.theme_mode == "light" {
            "light"
        } else {
            "dark"
        };
        self.set_setting("theme_mode", theme)?;
        let accent = match settings.accent_color.as_str() {
            "purple" | "green" | "orange" => settings.accent_color.as_str(),
            _ => "cyan",
        };
        self.set_setting("accent_color", accent)?;
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

    pub fn insert(
        &self,
        content_type: &str,
        content: &str,
        preview: &str,
    ) -> Result<ClipboardItem, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;

        let last: Vec<(String, String)> = conn
            .prepare("SELECT content_type, content FROM items ORDER BY id DESC LIMIT 8")
            .map_err(|e| e.to_string())?
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        if last.iter().any(|(t, c)| t == content_type && c == content) {
            return Err("duplicate".into());
        }

        let created_at: DateTime<Utc> = Utc::now();
        let created_at_str = created_at.to_rfc3339();

        conn.execute(
            "INSERT INTO items (content_type, content, preview, is_pinned, created_at)
             VALUES (?1, ?2, ?3, 0, ?4)",
            params![content_type, content, preview, created_at_str],
        )
        .map_err(|e| e.to_string())?;

        let id = conn.last_insert_rowid();
        let _ = Self::fts_upsert_conn(&conn, id, content_type, content, preview);

        if let Err(e) = conn.execute(
            "DELETE FROM items WHERE id IN (
                SELECT id FROM items WHERE is_pinned = 0
                ORDER BY created_at DESC
                LIMIT -1 OFFSET ?1
            )",
            params![MAX_HISTORY as i64],
        ) {
            // Row is already inserted — don't fail the whole write or the UI never sees it.
            eprintln!("history trim skipped: {e}");
        } else {
            // Drop FTS rows for any items that were trimmed out of the main table
            let _ = conn.execute(
                "DELETE FROM items_fts WHERE rowid NOT IN (SELECT id FROM items)",
                [],
            );
        }

        Ok(ClipboardItem {
            id,
            content_type: content_type.to_string(),
            content: content.to_string(),
            preview: preview.to_string(),
            is_pinned: false,
            created_at: created_at_str,
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
    ) -> Result<ClipboardItem, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let updated = conn
            .execute(
                "UPDATE items SET content = ?1, preview = ?2 WHERE id = ?3 AND content_type IN ('image', 'screenshot')",
                params![content, preview, id],
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
                preview, is_pinned, created_at
             FROM items WHERE 1=1",
        );
        let mut binds: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        if let Some(cat) = category {
            match cat {
                "text" => {
                    sql.push_str(" AND content_type = ?");
                    binds.push(Box::new("text".to_string()));
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
            .query_map(params_refs.as_slice(), |row| {
                Ok(ClipboardItem {
                    id: row.get(0)?,
                    content_type: row.get(1)?,
                    content: row.get(2)?,
                    preview: row.get(3)?,
                    is_pinned: row.get::<_, i64>(4)? != 0,
                    created_at: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut items = Vec::new();
        for row in rows {
            items.push(row.map_err(|e| e.to_string())?);
        }
        Ok(items)
    }

    // wiring up the sqlite search command to filter history in real-time as the user types
    pub fn search_clipboard(&self, query: &str) -> Result<Vec<ClipboardItem>, String> {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return self.list(None, None, 10);
        }

        if let Some(match_q) = Self::fts_match_query(trimmed) {
            let conn = self.conn.lock().map_err(|e| e.to_string())?;
            let mut stmt = conn
                .prepare(
                    "SELECT i.id, i.content_type,
                        CASE WHEN i.content_type IN ('image', 'screenshot') THEN '' ELSE i.content END,
                        i.preview, i.is_pinned, i.created_at
                     FROM items_fts f
                     JOIN items i ON i.id = f.rowid
                     WHERE f MATCH ?1
                     ORDER BY i.created_at DESC
                     LIMIT 10",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![match_q], |row| {
                    Ok(ClipboardItem {
                        id: row.get(0)?,
                        content_type: row.get(1)?,
                        content: row.get(2)?,
                        preview: row.get(3)?,
                        is_pinned: row.get::<_, i64>(4)? != 0,
                        created_at: row.get(5)?,
                    })
                })
                .map_err(|e| e.to_string())?;
            let mut items = Vec::new();
            for row in rows {
                items.push(row.map_err(|e| e.to_string())?);
            }
            if !items.is_empty() {
                return Ok(items);
            }
        }

        // Fallback for punctuation-only queries or empty FTS hits
        self.list(None, Some(trimmed), 10)
    }

    /// Per-category counts for the sidebar — one row per visible tab.
    pub fn category_counts(&self) -> Result<Vec<(String, i64)>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT content_type, COUNT(*) FROM items GROUP BY content_type",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                let ctype: String = row.get(0)?;
                let count: i64 = row.get(1)?;
                Ok((ctype, count))
            })
            .map_err(|e| e.to_string())?;
        let mut out: Vec<(String, i64)> = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?);
        }
        let pinned = conn
            .query_row(
                "SELECT COUNT(*) FROM items WHERE is_pinned = 1",
                [],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|e| e.to_string())?;
        out.push(("pinned".into(), pinned));
        let total = conn
            .query_row(
                "SELECT COUNT(*) FROM items",
                [],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|e| e.to_string())?;
        out.push(("all".into(), total));
        Ok(out)
    }

    pub fn get(&self, id: i64) -> Result<Option<ClipboardItem>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT id, content_type, content, preview, is_pinned, created_at FROM items WHERE id = ?1",
            params![id],
            |row| {
                Ok(ClipboardItem {
                    id: row.get(0)?,
                    content_type: row.get(1)?,
                    content: row.get(2)?,
                    preview: row.get(3)?,
                    is_pinned: row.get::<_, i64>(4)? != 0,
                    created_at: row.get(5)?,
                })
            },
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
