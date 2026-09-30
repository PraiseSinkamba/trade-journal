mod paths;
mod server;

use server::{get_status, restart_server as srv_restart, start_server, stop_server, ServerStatus, SharedServerState};
use std::sync::Arc;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};
use tokio::sync::Mutex;

#[tauri::command]
async fn get_server_status(state: tauri::State<'_, SharedServerState>) -> Result<ServerStatus, String> {
    Ok(get_status(&state).await)
}

#[tauri::command]
async fn restart_server(
    app: AppHandle,
    state: tauri::State<'_, SharedServerState>,
) -> Result<(), String> {
    srv_restart(&state).await;
    let data_dir = app.path().app_data_dir()
        .map_err(|e| format!("Could not resolve app data directory: {}", e))?;
    let data_dir = data_dir.join("TradeJournal").join("data");
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Failed to create data directory: {}", e))?;
    let dir_clone = data_dir.clone();
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = start_server(&app_handle, &dir_clone).await {
            eprintln!("Server restart failed: {}", e);
        }
    });
    Ok(())
}

#[tauri::command]
async fn open_data_folder(app: AppHandle) -> Result<(), String> {
    let data_dir = app.path().app_data_dir()
        .map_err(|e| format!("Could not resolve app data directory: {}", e))?;
    let data_dir = data_dir.join("TradeJournal").join("data");
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Failed to create data directory: {}", e))?;
    open::that(&data_dir).map_err(|e| format!("Failed to open data folder: {}", e))
}

fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
    let restart = MenuItem::with_id(app, "restart", "Restart Server", true, None::<&str>)?;
    let data = MenuItem::with_id(app, "data", "Open Data Folder", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&show, &restart, &data, &quit])?;

    let _tray = TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let app_handle = app.clone();
            match event.id.as_ref() {
                "show" => {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                "restart" => {
                    let state = app_handle.state::<SharedServerState>();
                    let state_clone = Arc::clone(&state);
                    if let Ok(data_dir) = app_handle.path().app_data_dir() {
                        let data_dir = data_dir.join("TradeJournal").join("data");
                        let _ = std::fs::create_dir_all(&data_dir);
                        let app_clone = app_handle.clone();
                        tauri::async_runtime::spawn(async move {
                            srv_restart(&state_clone).await;
                            if let Err(e) = start_server(&app_clone, &data_dir).await {
                                eprintln!("Server restart failed: {}", e);
                            }
                        });
                    }
                }
                "data" => {
                    if let Ok(data_dir) = app_handle.path().app_data_dir() {
                        let data_dir = data_dir.join("TradeJournal").join("data");
                        let _ = std::fs::create_dir_all(&data_dir);
                        let _ = open::that(&data_dir);
                    }
                }
                "quit" => {
                    let state = app_handle.state::<SharedServerState>();
                    let state_clone = Arc::clone(&state);
                    tokio::spawn(async move {
                        stop_server(&state_clone).await;
                        std::process::exit(0);
                    });
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()
                .map_err(|e| format!("Could not resolve app data directory: {}", e))?;
            let data_dir = data_dir.join("TradeJournal").join("data");
            std::fs::create_dir_all(&data_dir)
                .map_err(|e| format!("Failed to create data directory: {}", e))?;

            let state: SharedServerState = Arc::new(Mutex::new(server::ServerState {
                child: None,
                port: None,
            }));
            app.manage(state.clone());

            // Start server
            let app_handle = app.handle().clone();
            let dir_clone = data_dir.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = start_server(&app_handle, &dir_clone).await {
                    eprintln!("Server start failed: {}", e);
                }
            });

            setup_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_server_status,
            restart_server,
            open_data_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
