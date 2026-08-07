mod clipboard;
mod commands;
mod db;
mod hotkeys;
mod snip;

use db::Database;
use hotkeys::HotkeyState;
use std::sync::Arc;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::list_items,
            commands::get_item,
            commands::toggle_pin,
            commands::delete_item,
            commands::clear_history,
            commands::copy_item,
            commands::capture_screen,
            commands::capture_screen_region,
            commands::save_snip,
            commands::copy_image,
            commands::save_snip_to_vault,
            commands::toggle_main_window,
            commands::show_main_window,
            commands::hide_main_window,
            commands::begin_snip,
            commands::hide_snipper,
            commands::close_snipper,
            commands::get_settings,
            commands::update_settings,
            commands::update_hotkeys,
        ])
        .setup(|app| {
            let app_data = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            let db_path = app_data.join("snipclip.db");
            let database = Arc::new(Database::open(db_path).expect("failed to open database"));
            if let Err(e) = database.check_and_run_auto_clear() {
                eprintln!("auto-clear skipped: {e}");
            }

            #[cfg(desktop)]
            {
                let settings = hotkeys::bootstrap(app.handle(), &database)
                    .expect("failed to register global hotkeys");
                app.manage(Arc::new(HotkeyState::from_settings(&settings)));
            }

            app.manage(database);
            clipboard::start_monitor(app.handle().clone());

            // Keep snipper webview warm and hidden so the first hotkey is instant
            if let Some(snipper) = app.get_webview_window("snipper") {
                let _ = snipper.hide();
                let _ = snipper.set_always_on_top(true);
            }

            let show_i = MenuItem::with_id(app, "show", "Show SnipClip", true, None::<&str>)?;
            let snip_i = MenuItem::with_id(app, "snip", "Take Screenshot", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &snip_i, &quit_i])?;

            let tray_icon = app
                .default_window_icon()
                .cloned()
                .or_else(|| {
                    // Fallback: embed generated PNG so tray never falls back to Tauri default
                    tauri::image::Image::from_bytes(include_bytes!("../icons/128x128.png")).ok()
                })
                .expect("SnipClip tray icon missing — run `npx tauri icon icon-2.png`");

            let _tray = TrayIconBuilder::new()
                .icon(tray_icon)
                .menu(&menu)
                .tooltip("SnipClip")
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        let _ = commands::show_main_window(app.clone());
                    }
                    "snip" => {
                        let _ = commands::begin_snip(app.clone());
                    }
                    "quit" => {
                        clipboard::stop_monitor();
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        let _ = commands::toggle_main_window(app.clone());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
