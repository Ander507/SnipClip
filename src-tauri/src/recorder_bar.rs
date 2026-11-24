use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter, Manager, Position, Size, WebviewWindow};
use tauri::{PhysicalPosition, PhysicalSize};

/// Logical (CSS) pixels; multiplied by the monitor's scale factor when the bar is shown.
pub const RECORDER_BAR_WIDTH: u32 = 380;
pub const RECORDER_BAR_HEIGHT: u32 = 52;
const BAR_MARGIN: i32 = 8;
const BAR_GAP: i32 = 10;

/// A rectangle in physical desktop pixels.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Rect {
    x: i32,
    y: i32,
    w: i32,
    h: i32,
}

impl Rect {
    fn right(&self) -> i32 {
        self.x + self.w
    }
    fn bottom(&self) -> i32 {
        self.y + self.h
    }
    fn contains(&self, x: i32, y: i32) -> bool {
        x >= self.x && x < self.right() && y >= self.y && y < self.bottom()
    }
}

/// Where the bar goes so that it is always fully on screen: under the region when there is
/// room, else above it, else along the bottom edge of the screen (inside the region; the bar
/// is excluded from capture, so it never shows up in the video).
///
/// The bar used to be placed blindly at "region bottom + 10 px". A region that reached the
/// bottom or right edge of the screen pushed the buttons partly or completely off screen.
fn place_bar(region: Rect, area: Rect, bar_w: i32, bar_h: i32) -> (i32, i32) {
    let max_x = (area.right() - bar_w - BAR_MARGIN).max(area.x + BAR_MARGIN);
    let x = region.x.clamp(area.x + BAR_MARGIN, max_x);

    let below = region.bottom() + BAR_GAP;
    let above = region.y - BAR_GAP - bar_h;
    let y = if below + bar_h + BAR_MARGIN <= area.bottom() {
        below
    } else if above >= area.y + BAR_MARGIN {
        above
    } else {
        area.bottom() - bar_h - BAR_MARGIN
    };
    (x, y.max(area.y))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordRegionPayload {
    pub phys_x: i32,
    pub phys_y: i32,
    pub phys_w: i32,
    pub phys_h: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecorderBarShowPayload {
    pub region: RecordRegionPayload,
    pub format: String,
    pub fps: u32,
}

static PENDING_SHOW: OnceLock<Mutex<Option<RecorderBarShowPayload>>> = OnceLock::new();

fn pending_show() -> &'static Mutex<Option<RecorderBarShowPayload>> {
    PENDING_SHOW.get_or_init(|| Mutex::new(None))
}

fn recorder_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window("recorder_bar")
        .ok_or_else(|| "recorder_bar window missing".to_string())
}

/// Last show payload for the recorder webview if it mounted after the event fired.
pub fn take_pending_show() -> Option<RecorderBarShowPayload> {
    pending_show().lock().take()
}

pub fn show_recorder_bar(
    app: &AppHandle,
    screen_x: i32,
    screen_y: i32,
    region: RecordRegionPayload,
    format: String,
    fps: u32,
) -> Result<(), String> {
    crate::screenshot_popup::park_all_snipper_windows(app);
    // hiding the tauri overlay and sleeping 150ms so windows DWM clears it from the gpu buffer before we capture
    std::thread::sleep(std::time::Duration::from_millis(150));

    let bar = recorder_window(app)?;

    // The monitor the selection is on decides the bar's scale and the area it must stay in.
    let region_rect = Rect {
        x: region.phys_x,
        y: region.phys_y,
        w: region.phys_w.max(0),
        h: region.phys_h.max(0),
    };
    let (center_x, center_y) = (
        region_rect.x + region_rect.w / 2,
        region_rect.y + region_rect.h / 2,
    );
    let monitors = bar.available_monitors().unwrap_or_default();
    let monitor_rect = |m: &tauri::Monitor| Rect {
        x: m.position().x,
        y: m.position().y,
        w: m.size().width as i32,
        h: m.size().height as i32,
    };
    let monitor = monitors
        .iter()
        .find(|m| monitor_rect(m).contains(center_x, center_y))
        .or_else(|| {
            monitors
                .iter()
                .find(|m| monitor_rect(m).contains(screen_x, screen_y))
        })
        .or_else(|| monitors.first());
    let (scale, area) = match monitor {
        Some(m) => {
            let work = m.work_area();
            (
                m.scale_factor(),
                Rect {
                    x: work.position.x,
                    y: work.position.y,
                    w: work.size.width as i32,
                    h: work.size.height as i32,
                },
            )
        }
        None => (1.0, region_rect),
    };
    // Sized in physical pixels for that monitor: at 125% or 150% scaling a fixed 360 px wide
    // window was narrower than the controls, which cut the outer buttons off.
    let bar_w = (RECORDER_BAR_WIDTH as f64 * scale).round() as i32;
    let bar_h = (RECORDER_BAR_HEIGHT as f64 * scale).round() as i32;
    let (bar_x, bar_y) = if monitor.is_some() {
        place_bar(region_rect, area, bar_w, bar_h)
    } else {
        (screen_x, screen_y)
    };

    let payload = RecorderBarShowPayload {
        region,
        format,
        fps,
    };
    *pending_show().lock() = Some(payload.clone());

    let _ = bar.set_decorations(false);
    let _ = bar.set_skip_taskbar(true);
    let _ = bar.set_always_on_top(true);
    // Keeps the bar out of screen captures, so it can sit on top of the recorded region.
    let _ = bar.set_content_protected(true);
    let _ = bar.set_position(Position::Physical(PhysicalPosition::new(bar_x, bar_y)));
    let _ = bar.set_size(Size::Physical(PhysicalSize::new(
        bar_w.max(1) as u32,
        bar_h.max(1) as u32,
    )));
    let _ = bar.show();
    let _ = bar.set_focus();
    let _ = bar.emit("recorder-bar-show", payload);
    Ok(())
}

pub fn hide_recorder_bar(app: &AppHandle) -> Result<(), String> {
    pending_show().lock().take();
    if let Some(bar) = app.get_webview_window("recorder_bar") {
        let _ = bar.emit("recorder-bar-hide", ());
        let _ = bar.hide();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCREEN: Rect = Rect { x: 0, y: 0, w: 2560, h: 1400 };
    const W: i32 = 380;
    const H: i32 = 52;

    fn on_screen(pos: (i32, i32), area: Rect) -> bool {
        pos.0 >= area.x && pos.0 + W <= area.right() && pos.1 >= area.y && pos.1 + H <= area.bottom()
    }

    #[test]
    fn sits_under_the_region_when_there_is_room() {
        let region = Rect { x: 400, y: 300, w: 800, h: 600 };
        assert_eq!(place_bar(region, SCREEN, W, H), (400, 910));
    }

    #[test]
    fn moves_above_a_region_that_touches_the_bottom() {
        let region = Rect { x: 400, y: 700, w: 800, h: 700 };
        let pos = place_bar(region, SCREEN, W, H);
        assert_eq!(pos, (400, 700 - 10 - H));
        assert!(on_screen(pos, SCREEN));
    }

    #[test]
    fn stays_visible_for_a_full_screen_region() {
        let pos = place_bar(SCREEN, SCREEN, W, H);
        assert!(on_screen(pos, SCREEN));
    }

    #[test]
    fn stays_visible_at_the_right_edge_and_on_a_left_monitor() {
        let region = Rect { x: 2400, y: 100, w: 160, h: 200 };
        assert!(on_screen(place_bar(region, SCREEN, W, H), SCREEN));

        let left = Rect { x: -1050, y: 0, w: 1050, h: 1680 };
        let region = Rect { x: -1050, y: 0, w: 1050, h: 1680 };
        assert!(on_screen(place_bar(region, left, W, H), left));
    }
}
