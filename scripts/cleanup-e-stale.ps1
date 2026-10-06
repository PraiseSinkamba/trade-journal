$ErrorActionPreference = 'Stop'

$dirs = @(
  'E:\4004\orca\trade-journal\desktop\src-tauri\target',
  'E:\4004\orca\trade-journal\apps\web\.next\tauri-dist'
)

foreach ($d in $dirs) {
  if (Test-Path $d) {
    Write-Host ("Removing: {0}" -f $d)
    Remove-Item -Recurse -Force $d
    Write-Host ('  done')
  } else {
    Write-Host ("Already absent: {0}" -f $d)
  }
}

# Standalone: only delete if not currently being used. Safe — `pnpm build:web` rebuilds it.
$d = 'E:\4004\orca\trade-journal\apps\web\.next\standalone'
if (Test-Path $d) {
  Write-Host ("Removing: {0}" -f $d)
  Remove-Item -Recurse -Force $d
  Write-Host '  done'
}

''
Write-Host '--- Final disk state ---'
foreach ($letter in @('C', 'E')) {
  $drive = Get-PSDrive $letter -ErrorAction SilentlyContinue
  if ($drive) {
    Write-Host ("{0}: free {1:N1} GB / total {2:N1} GB" -f $letter, $drive.Free/1GB, ($drive.Used + $drive.Free)/1GB)
  }
}