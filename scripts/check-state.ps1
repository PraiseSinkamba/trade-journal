Write-Host '--- Disk state ---'
foreach ($letter in @('C', 'E')) {
  $d = Get-PSDrive $letter -ErrorAction SilentlyContinue
  if ($d) {
    Write-Host ("{0}: free {1:N1} GB / total {2:N1} GB" -f $letter, $d.Free/1GB, ($d.Used + $d.Free)/1GB)
  }
}

Write-Host ''
Write-Host '--- E: build artifact status ---'
$paths = @(
  'E:\4004\orca\trade-journal\desktop\src-tauri\target',
  'E:\4004\orca\trade-journal\apps\web\.next\standalone',
  'E:\4004\orca\trade-journal\apps\web\.next\tauri-dist'
)
foreach ($p in $paths) {
  $exists = Test-Path $p
  Write-Host ("{0} : {1}" -f $p, $(if ($exists) { 'EXISTS' } else { 'gone' }))
}