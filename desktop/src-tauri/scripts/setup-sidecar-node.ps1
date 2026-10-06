# setup-sidecar-node.ps1
# Download the Node.js sidecar binary that Tauri ships as `binaries/node`.
# Run from the desktop/ workspace:  pnpm setup:sidecar
#
# Mirrors the binary Node v24.11.0 Windows x64 (win-x64) from nodejs.org/dist,
# extracts it, renames node.exe to the Tauri-required triple-suffixed name, and
# verifies the SHA-256 before placing it in src-tauri/binaries/.
#
# Re-runnable: skips download + extract when the destination is already present
# and matches the expected SHA-256.

$ErrorActionPreference = "Stop"

# Resolve src-tauri/binaries relative to this script regardless of CWD.
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..\..\..")
$TauriDir = Join-Path $RepoRoot "desktop\src-tauri"
$BinDir = Join-Path $TauriDir "binaries"

$NodeVersion = "24.11.0"
$Triple = "x86_64-pc-windows-msvc"
$BinaryName = "node-$Triple.exe"
$ExpectedSha256 = "b7d912484d42e7a0d0cb5b26a86410ec973a79ece7d61ad535e2d1a97a9026e1"
$DownloadUrl = "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip"

$Dest = Join-Path $BinDir $BinaryName

if (-not (Test-Path $BinDir)) {
    New-Item -ItemType Directory -Path $BinDir -Force | Out-Null
}

# Skip if the binary is already present and matches the expected hash.
if (Test-Path $Dest) {
    $actual = (Get-FileHash -Path $Dest -Algorithm SHA256).Hash.ToLower()
    if ($actual -eq $ExpectedSha256) {
        Write-Host "Sidecar already in place at $Dest (sha256 matches)."
        exit 0
    }
    Write-Host "Existing sidecar hash mismatch (got $actual). Re-downloading."
    Remove-Item $Dest -Force
}

$workDir = Join-Path ([System.IO.Path]::GetTempPath()) "tj-sidecar-$NodeVersion"
if (Test-Path $workDir) { Remove-Item $workDir -Recurse -Force }
New-Item -ItemType Directory -Path $workDir -Force | Out-Null

try {
    $zipPath = Join-Path $workDir "node.zip"
    Write-Host "Fetching $DownloadUrl"
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $zipPath -UseBasicParsing
    Write-Host "Extracting..."
    Expand-Archive -Path $zipPath -DestinationPath $workDir -Force

    # node-v24.11.0-win-x64/node.exe
    $extracted = Get-ChildItem -Path $workDir -Filter node.exe -Recurse | Select-Object -First 1
    if (-not $extracted) { throw "node.exe not found in downloaded archive" }

    Move-Item -Path $extracted.FullName -Destination $Dest -Force

    $actual = (Get-FileHash -Path $Dest -Algorithm SHA256).Hash.ToLower()
    if ($actual -ne $ExpectedSha256) {
        throw "SHA-256 mismatch after download. expected=$ExpectedSha256 actual=$actual"
    }

    Write-Host "Installed sidecar to $Dest (sha256 verified)."
}
finally {
    Remove-Item $workDir -Recurse -Force -ErrorAction SilentlyContinue
}