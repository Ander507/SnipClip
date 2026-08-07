use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

pub const MAX_HISTORY: usize = 500;
pub const DEFAULT_HOTKEY_CLIPBOARD: &str = "Control+Shift+V";
pub const DEFAULT_HOTKEY_SNIP: &str = "Control+Shift+S";

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
        if clone.content_type == "image" {
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
    /// Wipe unpinned items when a new OS boot is detected.
    pub clear_on_boot: bool,
    /// "never" | "reboot" | "daily" | "weekly"
    pub clear_interval: String,
    /// Unix timestamp of last auto-clear run (internal bookkeeping).
    pub last_cleanup: i64,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            hotkey_clipboard: DEFAULT_HOTKEY_CLIPBOARD.to_string(),
            hotkey_snip: DEFAULT_HOTKEY_SNIP.to_string(),
            clear_on_boot: false,
            clear_interval: CLEAR_INTERVAL_NEVER.to_string(),
            last_cleanup: 0,
        }
    }
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
            ",
        )
        .map_err(|e| e.to_string())?;

        let db = Self {
            conn: Mutex::new(conn),
        };
        db.ensure_default_settings()?;
        Ok(db)
    }

    fn ensure_default_settings(&self) -> Result<(), String> {
        let defaults = AppSettings::default();
        if self.get_setting("hotkey_clipboard")?.is_none() {
            self.set_setting("hotkey_clipboard", &defaults.hotkey_clipboard)?;
        }
        if self.get_setting("hotkey_snip")?.is_none() {
            self.set_setting("hotkey_snip", &defaults.hotkey_snip)?;
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
        Ok(AppSettings {
            hotkey_clipboard: self
                .get_setting("hotkey_clipboard")?
                .unwrap_or_else(|| DEFAULT_HOTKEY_CLIPBOARD.to_string()),
            hotkey_snip: self
                .get_setting("hotkey_snip")?
                .unwrap_or_else(|| DEFAULT_HOTKEY_SNIP.to_string()),
            clear_on_boot,
            clear_interval,
            last_cleanup,
        })
    }

    pub fn save_settings(&self, settings: &AppSettings) -> Result<(), String> {
        self.set_setting("hotkey_clipboard", &settings.hotkey_clipboard)?;
        self.set_setting("hotkey_snip", &settings.hotkey_snip)?;
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

        let last: Option<(String, String)> = conn
            .query_row(
                "SELECT content_type, content FROM items ORDER BY id DESC LIMIT 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        if let Some((t, c)) = last {
            if t == content_type && c == content {
                return Err("duplicate".into());
            }
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

        conn.execute(
            "DELETE FROM items WHERE id IN (
                SELECT id FROM items WHERE is_pinned = 0
                ORDER BY created_at DESC
                LIMIT -1 OFFSET ?1
            )",
            params![MAX_HISTORY as i64],
        )
        .map_err(|e| e.to_string())?;

        Ok(ClipboardItem {
            id,
            content_type: content_type.to_string(),
            content: content.to_string(),
            preview: preview.to_string(),
            is_pinned: false,
            created_at: created_at_str,
        })
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
                CASE WHEN content_type = 'image' THEN '' ELSE content END,
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
                sql.push_str(" AND (preview LIKE ? OR (content_type != 'image' AND content LIKE ?))");
                let pattern = format!("%{q}%");
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
        conn.execute("DELETE FROM items WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn clear_unpinned(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM items WHERE is_pinned = 0", [])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
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
