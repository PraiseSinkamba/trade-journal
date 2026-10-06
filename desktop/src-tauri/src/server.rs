use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerStatus {
    pub state: String,
    pub url: Option<String>,
    pub pid: Option<u32>,
}

pub(crate) struct ServerState {
    pub(crate) child: Option<CommandChild>,
    pub(crate) port: Option<u16>,
}

pub type SharedServerState = Arc<Mutex<ServerState>>;

pub async fn start_server(
    app: &AppHandle,
    data_dir: &std::path::Path,
) -> Result<SharedServerState, String> {
    let state: SharedServerState = Arc::new(Mutex::new(ServerState {
        child: None,
        port: None,
    }));

    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Could not resolve resource directory: {}", e))?;

    eprintln!("[start_server] resource_dir = {:?}", resource_dir);
    eprintln!("[start_server] data_dir = {:?}", data_dir);

    let journal_data_dir = data_dir.to_string_lossy().to_string();

    let server_js_path = resource_dir.join("apps/web/server.js");
    eprintln!("[start_server] server_js_path = {:?}", server_js_path);

    // Strip Windows extended-length path prefix (\\?\) — Node 24's realpathSync chokes on it,
    // resolving only down to the drive root ("E:") and then failing EISDIR.
    let server_js_str = server_js_path.to_string_lossy().to_string();
    let server_js_str = server_js_str
        .strip_prefix(r"\\?\")
        .unwrap_or(&server_js_str)
        .to_string();
    eprintln!("[start_server] server_js_arg = {}", server_js_str);

    // Use Tauri's sidecar API — handles platform/triple suffix + bundled path lookup.
    let (mut rx, child) = app
        .shell()
        .sidecar("node")
        .map_err(|e| format!("Failed to build sidecar command: {}", e))?
        .args([server_js_str])
        .env("PORT", "0")
        .env("JOURNAL_DATA_DIR", journal_data_dir.clone())
        .env("NODE_ENV", "production")
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

    // Re-read stdout/stderr via CommandEvent stream.
    let app_handle = app.clone();
    let state_clone = state.clone();

    // Spawn port discovery + stderr logging task, reading from the CommandEvent channel.
    tauri::async_runtime::spawn(async move {
        let port_regex = Regex::new(r"127\.0\.0\.1:(\d+)").unwrap();
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    if let Some(caps) = port_regex.captures(&line) {
                        if let Some(port_str) = caps.get(1) {
                            if let Ok(port) = port_str.as_str().parse::<u16>() {
                                let mut s = state_clone.lock().await;
                                s.port = Some(port);
                                drop(s);
                                let url = format!("http://127.0.0.1:{}", port);
                                let _ = app_handle.emit("server-ready", serde_json::json!({ "url": url }));
                            }
                        }
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    eprintln!("[node] {}", line);
                }
                CommandEvent::Error(err) => {
                    let _ = app_handle.emit("server-error", err);
                }
                CommandEvent::Terminated(_) => {
                    let _ = app_handle.emit("server-error", "node process terminated");
                    break;
                }
                _ => {}
            }
        }
    });

    {
        let mut s = state.lock().await;
        s.child = Some(child);
    }

    Ok(state)
}

pub async fn get_status(state: &SharedServerState) -> ServerStatus {
    let s = state.lock().await;
    let pid = s.child.as_ref().map(|c| c.pid());
    ServerStatus {
        state: s.port.map(|_| "ready".to_string()).unwrap_or_else(|| {
            if s.child.is_some() { "starting".to_string() } else { "stopped".to_string() }
        }),
        url: s.port.map(|p| format!("http://127.0.0.1:{}", p)),
        pid,
    }
}

pub async fn restart_server(state: &SharedServerState) {
    let mut s = state.lock().await;
    if let Some(child) = s.child.take() {
        let _ = child.kill();
    }
    s.port = None;
}

pub async fn stop_server(state: &SharedServerState) {
    let mut s = state.lock().await;
    if let Some(child) = s.child.take() {
        let _ = child.kill();
    }
    s.port = None;
}
