$ErrorActionPreference = 'Stop'
$binDir = 'E:\4004\orca\trade-journal\desktop\src-tauri\binaries'

Write-Host "Before cleanup:"
Get-ChildItem $binDir | Select-Object Name,Length | Format-Table -AutoSize

# Keep only node.exe; remove duplicates and the unix wrapper
$keep = @('node.exe')
Get-ChildItem $binDir | ForEach-Object {
  if ($keep -notcontains $_.Name) {
    Remove-Item -Force $_.FullName
    Write-Host ("Removed: {0}" -f $_.Name)
  }
}

Write-Host "`nAfter cleanup:"
Get-ChildItem $binDir | Select-Object Name,Length | Format-Table -AutoSize