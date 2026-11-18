use serde::{Deserialize, Serialize};
use std::net::TcpListener;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::Mutex;

const MAX_START_ATTEMPTS: usize = 5;
const PROCESS_EXIT_TIMEOUT: Duration = Duration::from_secs(30);
/// The readiness marker the packaged smoke script matches on.
const READY_MARKER: &str = "[server] ready url=";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerStatus {
    pub state: String,
    pub url: Option<String>,
    pub pid: Option<u32>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Lifecycle {
    Stopped,
    Starting,
    Ready,
}

pub(crate) struct ServerState {
    pub(crate) child: Option<CommandChild>,
    pub(crate) pid: Option<u32>,
    pub(crate) url: Option<String>,
    pub(crate) lifecycle: Lifecycle,
    pub(crate) desired_running: bool,
    pub(crate) run_id: u64,
    pub(crate) generation: u64,
}

impl ServerState {
    /// Clear only state belonging to the current supervisor attempt.
    fn clear_attempt(&mut self, run_id: u64, generation: u64) -> bool {
        if self.run_id != run_id || self.generation != generation {
            return false;
        }
        self.child = None;
        self.pid = None;
        self.url = None;
        self.lifecycle = Lifecycle::Stopped;
        true
    }
}

impl Default for ServerState {
    fn default() -> Self {
        Self {
            child: None,
            pid: None,
            url: None,
            lifecycle: Lifecycle::Stopped,
            desired_running: false,
            run_id: 0,
            generation: 0,
        }
    }
}

pub type SharedServerState = Arc<Mutex<ServerState>>;

#[derive(Debug, Deserialize, PartialEq)]
struct SupervisorReady {
    #[serde(rename = "type")]
    kind: String,
    host: String,
    port: u16,
}

impl SupervisorReady {
    fn url(&self) -> String {
        format!("http://{}:{}", self.host, self.port)
    }
}

/// Parse one supervisor stdout line and accept only its ready message.
fn parse_ready_line(line: &str) -> Option<SupervisorReady> {
    let message: SupervisorReady = serde_json::from_str(line.trim()).ok()?;
    (message.kind == "ready").then_some(message)
}

/// Reserve a concrete loopback port long enough to learn the operating system's choice.
fn choose_nonzero_loopback_port() -> Result<u16, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|error| format!("Could not reserve a loopback port: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("Could not read the reserved loopback port: {error}"))?
        .port();
    drop(listener);
    if port == 0 {
        return Err("Operating system returned an invalid loopback port".to_string());
    }
    Ok(port)
}

/// Choose another port when the previous attempt lost a release-to-bind race.
fn choose_nonzero_loopback_port_excluding(excluded: Option<u16>) -> Result<u16, String> {
    for _ in 0..16 {
        let port = choose_nonzero_loopback_port()?;
        if excluded != Some(port) {
            return Ok(port);
        }
    }
    Err("Could not choose a new loopback port".to_string())
}

fn absolute_data_dir(data_dir: &Path) -> Result<String, String> {
    let absolute = if data_dir.is_absolute() {
        data_dir.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|error| format!("Could not resolve current directory: {error}"))?
            .join(data_dir)
    };
    Ok(absolute.to_string_lossy().into_owned())
}

/// Remove Windows' extended path prefix because Node 24 cannot realpath it.
fn node_path(path: &Path) -> String {
    let value = path.to_string_lossy().into_owned();
    value.strip_prefix(r"\\?\").unwrap_or(&value).to_string()
}

/// Start one supervisor task and let it own every retry for this run.
/// The shared state is owned by the application; this function only fills it.
pub async fn start_server(
    app: &AppHandle,
    data_dir: &Path,
    state: &SharedServerState,
) -> Result<(), String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| format!("Could not resolve resource directory: {error}"))?;
    let supervisor_path = resource_dir.join("apps/web/scripts/run-journal.mjs");
    let data_dir = absolute_data_dir(data_dir)?;

    let run_id = {
        let mut current = state.lock().await;
        current.run_id = current.run_id.wrapping_add(1);
        current.desired_running = true;
        current.lifecycle = Lifecycle::Starting;
        current.url = None;
        current.pid = None;
        current.child = None;
        current.run_id
    };

    eprintln!("[start_server] supervisor = {}", node_path(&supervisor_path));
    eprintln!("[start_server] data_dir = {data_dir}");

    let app = app.clone();
    let state = state.clone();
    tauri::async_runtime::spawn(async move {
        supervise(app, data_dir, state, run_id).await;
    });
    Ok(())
}

/// Retry only when the supervisor exits before publishing readiness.
async fn supervise(
    app: AppHandle,
    data_dir: String,
    state: SharedServerState,
    run_id: u64,
) {
    let mut previous_port = None;

    for attempt in 1..=MAX_START_ATTEMPTS {
        let port = match choose_nonzero_loopback_port_excluding(previous_port) {
            Ok(port) => port,
            Err(error) => {
                emit_start_error(&app, error).await;
                mark_stopped(&state, run_id).await;
                return;
            }
        };

        let attempt_result = spawn_attempt(&app, &data_dir, &state, run_id, port).await;
        let (mut events, pid, generation) = match attempt_result {
            Ok(attempt) => attempt,
            Err(error) => {
                emit_start_error(&app, error).await;
                mark_stopped(&state, run_id).await;
                return;
            }
        };
        let (ready_seen, exit_code) = monitor_attempt(
            &mut events,
            &app,
            &state,
            run_id,
            generation,
            pid,
        )
        .await;

        if ready_seen {
            return;
        }

        let should_retry = {
            let current = state.lock().await;
            current.desired_running && current.run_id == run_id
        };
        if !should_retry {
            return;
        }
        if attempt == MAX_START_ATTEMPTS {
            emit_start_error(
                &app,
                format!(
                    "Journal supervisor exited before readiness after {MAX_START_ATTEMPTS} attempts (exit code {exit_code:?})"
                ),
            )
            .await;
            mark_stopped(&state, run_id).await;
            return;
        }
        previous_port = Some(port);
    }
}

/// Spawn one supervisor child and register it as the active managed child.
async fn spawn_attempt(
    app: &AppHandle,
    data_dir: &str,
    state: &SharedServerState,
    run_id: u64,
    port: u16,
) -> Result<(tokio::sync::mpsc::Receiver<CommandEvent>, u32, u64), String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| format!("Could not resolve resource directory: {error}"))?;
    let supervisor_path = resource_dir.join("apps/web/scripts/run-journal.mjs");
    let port_text = port.to_string();
    let args = vec![
        node_path(&supervisor_path),
        "--mode".to_string(),
        "production".to_string(),
        "--host".to_string(),
        "127.0.0.1".to_string(),
        "--port".to_string(),
        port_text.clone(),
        "--data-dir".to_string(),
        data_dir.to_string(),
        "--worker".to_string(),
        "enabled".to_string(),
    ];

    let (events, child) = app
        .shell()
        .sidecar("node")
        .map_err(|error| format!("Failed to build sidecar command: {error}"))?
        .args(args)
        .env("JOURNAL_DATA_DIR", data_dir)
        .env("NODE_ENV", "production")
        .env("HOSTNAME", "127.0.0.1")
        .env("PORT", port_text)
        .spawn()
        .map_err(|error| format!("Failed to spawn sidecar: {error}"))?;

    let pid = child.pid();
    let generation = {
        let mut current = state.lock().await;
        if !current.desired_running || current.run_id != run_id {
            drop(current);
            let _ = child.kill();
            return Err("Server start was cancelled".to_string());
        }
        current.generation = current.generation.wrapping_add(1);
        current.child = Some(child);
        current.pid = Some(pid);
        current.url = None;
        current.lifecycle = Lifecycle::Starting;
        current.generation
    };

    Ok((events, pid, generation))
}

/// Consume one attempt until its direct child terminates.
async fn monitor_attempt(
    events: &mut tokio::sync::mpsc::Receiver<CommandEvent>,
    app: &AppHandle,
    state: &SharedServerState,
    run_id: u64,
    generation: u64,
    pid: u32,
) -> (bool, Option<i32>) {
    let mut ready_seen = false;

    while let Some(event) = events.recv().await {
        match event {
            CommandEvent::Stdout(bytes) => {
                let line = String::from_utf8_lossy(&bytes);
                let Some(ready) = parse_ready_line(&line) else {
                    continue;
                };
                let accepted = {
                    let mut current = state.lock().await;
                    if current.run_id != run_id
                        || current.generation != generation
                        || current.pid != Some(pid)
                    {
                        false
                    } else {
                        current.lifecycle = Lifecycle::Ready;
                        current.url = Some(ready.url());
                        true
                    }
                };
                if accepted && !ready_seen {
                    ready_seen = true;
                    let url = ready.url();
                    eprintln!("{READY_MARKER}{url}");
                    let _ = app.emit("server-ready", serde_json::json!({ "url": url }));
                }
            }
            CommandEvent::Stderr(bytes) => {
                eprintln!("[node] {}", String::from_utf8_lossy(&bytes).trim_end());
            }
            CommandEvent::Error(error) => {
                eprintln!("[node] {error}");
                let _ = app.emit("server-error", error);
            }
            CommandEvent::Terminated(payload) => {
                let mut current = state.lock().await;
                if current.clear_attempt(run_id, generation) && ready_seen {
                    current.desired_running = false;
                }
                if !ready_seen {
                    eprintln!(
                        "[node] supervisor exited before readiness (exit code {:?})",
                        payload.code
                    );
                }
                return (ready_seen, payload.code);
            }
            _ => {}
        }
    }

    (ready_seen, None)
}

async fn emit_start_error(app: &AppHandle, error: String) {
    eprintln!("[start_server] {error}");
    let _ = app.emit("server-error", error);
}

async fn mark_stopped(state: &SharedServerState, run_id: u64) {
    let mut current = state.lock().await;
    if current.run_id == run_id {
        current.child = None;
        current.pid = None;
        current.url = None;
        current.lifecycle = Lifecycle::Stopped;
        current.desired_running = false;
    }
}

/// Report the state of the one managed supervisor child.
pub async fn get_status(state: &SharedServerState) -> ServerStatus {
    let current = state.lock().await;
    let state_name = match current.lifecycle {
        Lifecycle::Starting => "starting",
        Lifecycle::Ready => "ready",
        Lifecycle::Stopped => "stopped",
    };
    ServerStatus {
        state: state_name.to_string(),
        url: current.url.clone(),
        pid: current.pid,
    }
}

/// Restart the managed supervisor only after its previous tree is gone.
pub async fn restart_server(
    app: &AppHandle,
    data_dir: &Path,
    state: &SharedServerState,
) -> Result<(), String> {
    stop_server(state).await?;
    start_server(app, data_dir, state).await
}

/// Stop the supervisor and its children, then wait until the direct child is gone.
pub async fn stop_server(state: &SharedServerState) -> Result<(), String> {
    let (child, pid) = {
        let mut current = state.lock().await;
        current.desired_running = false;
        current.run_id = current.run_id.wrapping_add(1);
        (current.child.take(), current.pid)
    };
    let Some(child) = child else {
        let mut current = state.lock().await;
        current.child = None;
        current.pid = None;
        current.url = None;
        current.lifecycle = Lifecycle::Stopped;
        return Ok(());
    };
    let pid = pid.unwrap_or_else(|| child.pid());

    #[cfg(windows)]
    terminate_windows_tree(pid).await?;

    #[cfg(not(windows))]
    {
        let _ = child.kill();
    }

    wait_for_process_exit(pid).await?;
    let mut current = state.lock().await;
    current.child = None;
    current.pid = None;
    current.url = None;
    current.lifecycle = Lifecycle::Stopped;
    Ok(())
}

/// Terminate a Windows process and every descendant owned by it.
#[cfg(windows)]
async fn terminate_windows_tree(pid: u32) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || taskkill_tree(pid))
        .await
        .map_err(|error| format!("Could not run taskkill: {error}"))?
        .map_err(|error| format!("Could not run taskkill: {error}"))
}

/// Run `taskkill /F /T /PID` so grandchildren die with their parent.
#[cfg(windows)]
fn taskkill_tree(pid: u32) -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut command = std::process::Command::new("taskkill");
    command
        .args(["/F", "/T", "/PID", &pid.to_string()])
        .creation_flags(CREATE_NO_WINDOW);
    let result = command
        .output()
        .map_err(|error| format!("Could not run taskkill: {error}"))?;

    if !result.status.success() {
        let message = String::from_utf8_lossy(&result.stderr).trim().to_string();
        return Err(format!("taskkill failed for PID {pid}: {message}"));
    }
    Ok(())
}

#[cfg(windows)]
fn process_exists(pid: u32) -> bool {
    let output = std::process::Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/NH", "/FO", "CSV"])
        .output();
    match output {
        Ok(output) => {
            let needle = format!(",\"{pid}\",");
            String::from_utf8_lossy(&output.stdout).contains(&needle)
        }
        Err(_) => false,
    }
}

#[cfg(not(windows))]
fn process_exists(pid: u32) -> bool {
    std::process::Command::new("kill")
        .args(["-0", &pid.to_string()])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

/// Wait for the managed PID to disappear instead of returning while it still runs.
async fn wait_for_process_exit(pid: u32) -> Result<(), String> {
    let deadline = Instant::now() + PROCESS_EXIT_TIMEOUT;
    while process_exists(pid) {
        if Instant::now() >= deadline {
            return Err(format!("Timed out waiting for PID {pid} to exit"));
        }
        tauri::async_runtime::spawn_blocking(|| {
            std::thread::sleep(Duration::from_millis(25));
        })
        .await
        .map_err(|error| format!("Could not wait for PID {pid}: {error}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_supervisor_ready_line() {
        let ready = parse_ready_line(
            r#"{"type":"ready","host":"127.0.0.1","port":43127,"worker":"ready"}"#,
        )
        .expect("ready line should parse");
        assert_eq!(ready.host, "127.0.0.1");
        assert_eq!(ready.port, 43127);
        assert_eq!(ready.url(), "http://127.0.0.1:43127");
    }

    #[test]
    fn rejects_non_ready_supervisor_lines() {
        assert!(parse_ready_line(
            r#"{"type":"health","http":"starting","worker":"starting"}"#
        )
        .is_none());
        assert!(parse_ready_line("not json").is_none());
    }

    #[test]
    fn chooses_nonzero_loopback_port() {
        let port = choose_nonzero_loopback_port().expect("loopback port should be available");
        assert_ne!(port, 0);
        let listener = TcpListener::bind(("127.0.0.1", port)).expect("chosen port should bind");
        assert!(listener.local_addr().unwrap().ip().is_loopback());
    }

    /// The supervisor owns grandchildren, so the tree kill must reach them.
    #[cfg(windows)]
    #[test]
    fn tree_kill_reaches_grandchildren() {
        use std::io::{BufRead, BufReader};
        use std::process::{Command, Stdio};

        let mut child = Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                "$c = Start-Process -PassThru cmd.exe -ArgumentList '/c','ping -n 60 127.0.0.1'; Write-Output $c.Id; Start-Sleep -Seconds 60",
            ])
            .stdout(Stdio::piped())
            .spawn()
            .expect("powershell should start");
        let parent_pid = child.id();

        let mut line = String::new();
        BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut line)
            .expect("the grandchild pid should be printed");
        let grandchild_pid: u32 = line.trim().parse().expect("the grandchild pid should be a pid");
        assert!(process_exists(grandchild_pid), "the grandchild should be running");

        taskkill_tree(parent_pid).expect("taskkill should succeed");

        let deadline = Instant::now() + Duration::from_secs(30);
        while process_exists(grandchild_pid) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
        }
        assert!(
            !process_exists(grandchild_pid),
            "the grandchild survived the tree kill"
        );
        let _ = child.kill();
    }
}

