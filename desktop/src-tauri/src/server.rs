use regex::Regex;
use serde::{Deserialize, Serialize};
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerStatus {
    pub state: String,
    pub url: Option<String>,
    pub pid: Option<u32>,
}

pub(crate) struct ServerState {
    pub(crate) child: Option<Child>,
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

    let sidecar_path = resource_dir.join("binaries").join("node.exe-x86_64-pc-windows-msvc.exe");

    let journal_data_dir = data_dir.to_string_lossy().to_string();

    let server_js_path = resource_dir.join("apps/web/server.js");

    let mut child = Command::new(&sidecar_path)
        .arg(&server_js_path)
        .env("PORT", "0")
        .env("JOURNAL_DATA_DIR", &journal_data_dir)
        .env("NODE_ENV", "production")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take();

    let app_handle = app.clone();
    let state_clone = state.clone();

    // Spawn port discovery task
    tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let port_regex = Regex::new(r"Local:.*http://127\.0\.0\.1:(\d+)").unwrap();
        let localhost_regex = Regex::new(r"localhost:(\d+)").unwrap();

        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if let Some(caps) = port_regex.captures(&line) {
                if let Some(port_str) = caps.get(1) {
                    let port: u16 = port_str.as_str().parse().unwrap();
                    {
                        let mut s = state_clone.lock().await;
                        s.port = Some(port);
                    }
                    let url = format!("http://127.0.0.1:{}", port);
                    let _ = app_handle.emit("server-ready", serde_json::json!({ "url": &url }));
                    break;
                }
            } else if let Some(caps) = localhost_regex.captures(&line) {
                if let Some(port_str) = caps.get(1) {
                    let port: u16 = port_str.as_str().parse().unwrap();
                    {
                        let mut s = state_clone.lock().await;
                        s.port = Some(port);
                    }
                    let url = format!("http://127.0.0.1:{}", port);
                    let _ = app_handle.emit("server-ready", serde_json::json!({ "url": &url }));
                    break;
                }
            }
        }
    });

    // Log stderr in background
    if let Some(stderr_pipe) = stderr {
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr_pipe).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                eprintln!("[node] {}", line);
            }
        });
    }

    {
        let mut s = state.lock().await;
        s.child = Some(child);
    }

    Ok(state)
}

pub async fn get_status(state: &SharedServerState) -> ServerStatus {
    let mut s = state.lock().await;
    if let Some(ref mut child) = s.child {
        if let Ok(Some(_)) = child.try_wait() {
            return ServerStatus {
                state: "stopped".to_string(),
                url: None,
                pid: None,
            };
        }
        let pid = child.id();
        ServerStatus {
            state: s.port.map(|_| "ready".to_string()).unwrap_or_else(|| "starting".to_string()),
            url: s.port.map(|p| format!("http://127.0.0.1:{}", p)),
            pid,
        }
    } else {
        ServerStatus {
            state: "stopped".to_string(),
            url: None,
            pid: None,
        }
    }
}

pub async fn restart_server(state: &SharedServerState) {
    let mut s = state.lock().await;
    if let Some(mut child) = s.child.take() {
        let _ = child.kill().await;
    }
    s.port = None;
}

pub async fn stop_server(state: &SharedServerState) {
    let mut s = state.lock().await;
    if let Some(mut child) = s.child.take() {
        let _ = child.kill().await;
    }
    s.port = None;
}
