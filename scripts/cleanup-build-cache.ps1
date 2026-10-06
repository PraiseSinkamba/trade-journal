# Removes cargo + tauri build cache from C:, redirects future ones via env vars.
# Safe to re-run; idempotent.

$ErrorActionPreference = 'Stop'

# 1. Tauri local cache (C:) — always safe, redownloads to TAURI_BUNDLER_CACHE on next build.
$tauriCache = 'C:\Users\4004\AppData\Local\tauri'
if (Test-Path $tauriCache) {
  $size = (Get-ChildItem $tauriCache -Recurse -Force | Measure-Object -Property Length -Sum).Sum / 1MB
  Remove-Item -Recurse -Force $tauriCache
  Write-Host "Removed Tauri cache: $tauriCache ($([math]::Round($size,1)) MB freed)"
} else {
  Write-Host "Tauri cache already absent: $tauriCache"
}

# 2. Cargo registry + git checkouts (C:) — keep bin/ and .crates*; drop the rest.
#    New builds write to CARGO_HOME=E:\build-cache\cargo, so C: copy is wasted.
$cargoRoot = 'C:\Users\4004\.cargo'
if (Test-Path $cargoRoot) {
  Get-ChildItem -Force $cargoRoot | ForEach-Object {
    $name = $_.Name
    $size = (Get-ChildItem $_.FullName -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum / 1MB
    if ($name -in @('bin', '.crates.toml', '.crates2.json', '.crates2-cache', 'env')) {
      Write-Host ("Keeping: {0,-20} ({1:N1} MB)" -f $name, $size)
    } else {
      Remove-Item -Recurse -Force $_.FullName
      Write-Host ("Removed: {0,-20} ({1:N1} MB)" -f $name, $size)
    }
  }
} else {
  Write-Host "Cargo dir absent: $cargoRoot"
}

# 3. Stale Tauri build target on E: — now redundant since CARGO_TARGET_DIR points elsewhere.
$staleTarget = 'E:\4004\orca\trade-journal\desktop\src-tauri\target'
if (Test-Path $staleTarget) {
  $size = (Get-ChildItem $staleTarget -Recurse -Force | Measure-Object -Property Length -Sum).Sum / 1MB
  Remove-Item -Recurse -Force $staleTarget
  Write-Host "Removed stale target: $staleTarget ($([math]::Round($size,1)) MB freed)"
}

# 4. Stale Tauri-dist (rebuilt on every web build via copy-static-build.js).
$staleTauriDist = 'E:\4004\orca\trade-journal\apps\web\.next\tauri-dist'
if (Test-Path $staleTauriDist) {
  $size = (Get-ChildItem $staleTauriDist -Recurse -Force | Measure-Object -Property Length -Sum).Sum / 1MB
  Remove-Item -Recurse -Force $staleTauriDist
  Write-Host "Removed stale tauri-dist: $staleTauriDist ($([math]::Round($size,1)) MB freed)"
}

# 5. Show free space on C: and E: after cleanup.
''
Write-Host "--- Post-cleanup disk state ---"
foreach ($letter in @('C', 'E')) {
  $d = Get-PSDrive $letter -ErrorAction SilentlyContinue
  if ($d) {
    Write-Host ("{0}: free {1:N1} GB / total {2:N1} GB" -f $letter, $d.Free/1GB, ($d.Used + $d.Free)/1GB)
  }
}