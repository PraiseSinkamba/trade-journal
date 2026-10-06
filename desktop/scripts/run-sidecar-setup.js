// Run the platform-appropriate Node sidecar setup script.
// Windows: setup-sidecar-node.ps1  | macOS/Linux: setup-sidecar-node.sh
// Resolves relative to this file so it works regardless of `pnpm` CWD.

const { spawn } = require("node:child_process");
const { existsSync } = require("node:fs");
const path = require("node:path");

const isWindows = process.platform === "win32";
const script = path.join(
  __dirname,
  "src-tauri",
  "scripts",
  isWindows ? "setup-sidecar-node.ps1" : "setup-sidecar-node.sh",
);

if (!existsSync(script)) {
  console.error(`Sidecar setup script missing: ${script}`);
  process.exit(1);
}

let cmd;
let args;
if (isWindows) {
  cmd = "powershell";
  args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script];
} else {
  cmd = "bash";
  args = [script];
}

const child = spawn(cmd, args, { stdio: "inherit" });
child.on("error", (err) => {
  console.error(`Failed to spawn ${cmd}: ${err.message}`);
  process.exit(1);
});
child.on("exit", (code) => process.exit(code ?? 1));