// Run the platform-appropriate Node sidecar setup script.
// Windows: setup-sidecar-node.ps1  | macOS/Linux: setup-sidecar-node.sh
// Resolves relative to this file so it works regardless of `pnpm` CWD.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const isWindows = process.platform === "win32";
const script = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
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
  // PowerShell 7 first: the script needs Get-FileHash, which Windows PowerShell 5.1 lacks.
  cmd = "pwsh";
  args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script];
} else {
  cmd = "bash";
  args = [script];
}

const child = spawn(cmd, args, { stdio: "inherit" });
child.on("error", (err) => {
  console.error(`Failed to spawn ${cmd}: ${err.message}`);
  if (isWindows && err.code === "ENOENT") {
    // No PowerShell 7: fall back to Windows PowerShell 5.1.
    const fallback = spawn("powershell", args, { stdio: "inherit" });
    fallback.on("error", (fallbackError) => {
      console.error(`Failed to spawn powershell: ${fallbackError.message}`);
      process.exit(1);
    });
    fallback.on("exit", (code) => process.exit(code ?? 1));
    return;
  }
  process.exit(1);
});
child.on("exit", (code) => process.exit(code ?? 1));