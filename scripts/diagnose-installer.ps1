# Check 1: sidecar present in binaries/
$binDir = 'E:\4004\orca\trade-journal\desktop\src-tauri\binaries'
Write-Host "--- Sidecar binaries dir ---"
if (Test-Path $binDir) {
  Get-ChildItem $binDir | Select-Object Name,Length | Format-Table -AutoSize
} else {
  Write-Host "(missing: $binDir)"
}

# Check 2: bundle config
Write-Host "`n--- Tauri bundle config ---"
$conf = 'E:\4004\orca\trade-journal\desktop\src-tauri\tauri.conf.json'
$json = Get-Content $conf -Raw | ConvertFrom-Json
Write-Host "externalBin: $($json.bundle.externalBin -join ', ')"
Write-Host "resources: $($json.bundle.resources | ConvertTo-Json -Compress)"

# Check 3: server.rs reads what path?
Write-Host "`n--- server.rs spawn command ---"
$server = Get-Content 'E:\4004\orca\trade-journal\desktop\src-tauri\src\server.rs' -Raw
$matches = [regex]::Matches($server, '(sidecar_path|server_js_path)\s*=\s*resource_dir\.join\([^)]+\)')
foreach ($m in $matches) { Write-Host $m.Value }

# Check 4: what's actually inside the installer (NSIS uses 7z/lzma; can extract via 7z)
Write-Host "`n--- Extract NSIS installer to inspect bundled files ---"
$nsis = 'E:\4004\orca\trade-journal\desktop\src-tauri\target\release\bundle\nsis\Trade Journal_0.1.0_x64-setup.exe'
$extract = 'E:\4004\orca\trade-journal\desktop\src-tauri\target\release\bundle\nsis-extracted'
if (Test-Path $extract) { Remove-Item -Recurse -Force $extract }
New-Item -ItemType Directory -Path $extract | Out-Null

# NSIS installers can be extracted with 7z if available, otherwise we list from MSI instead
$sevenZip = (Get-Command '7z' -ErrorAction SilentlyContinue).Source
if ($sevenZip) {
  & 7z x "-o$extract" "-y" $nsis 2>&1 | Select-Object -Last 5
  Write-Host "`nExtracted files of interest:"
  Get-ChildItem $extract -Recurse | Where-Object { $_.Name -like '*.exe' -or $_.Name -like 'server.js' -or $_.Name -like 'node*' } | Select-Object FullName,Length | Format-Table -AutoSize
} else {
  Write-Host "(7z not installed, skipping NSIS extract)"
}