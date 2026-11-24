# Packaged smoke: the packaged app serves the journal, publishes the readiness
# signal, and leaves no orphaned node.exe behind.
#
# The desktop's Rust side parses the supervisor's readiness line and now writes
# one marker to the app's stderr when it accepts that readiness:
#
#   [server] ready url=http://127.0.0.1:<port>
#
# The smoke asserts that marker exists and that its port is the port the
# journal actually listens on, so a run cannot pass with a splash-screen app.

[CmdletBinding()]
param(
  # The packaged executable. Defaults to the release build the CI job produces.
  [string]$Exe,
  # The journal data directory passed to the app's child through
  # JOURNAL_DATA_DIR. The desktop itself resolves its own data directory from
  # the OS profile (app_data_dir/TradeJournal/data), so this only sets the
  # environment the supervisor inherits.
  [string]$DataDir,
  # How long the app may take to open its loopback listener.
  [int]$DiscoverTimeoutSeconds = 180,
  # How many times the smoke polls the journal's HTTP surface.
  [int]$HttpAttempts = 60,
  # Verification mode: check a captured stderr file against an expected port and
  # exit. Used to prove the readiness assertion has teeth.
  [string]$VerifyReadinessFile,
  [int]$VerifyReadinessPort = 0
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

# The one line that proves the app accepted the supervisor's readiness.
$ReadinessPattern = '^\[server\] ready url=http://127\.0\.0\.1:(\d+)\s*$'

function Get-ReadinessSignal {
  param([Parameter(Mandatory = $true)][string]$Path)

  $signal = [pscustomobject]@{ Found = $false; Port = 0; Line = '' }
  if (-not (Test-Path -LiteralPath $Path)) { return $signal }
  # The app still holds the redirected file open, so read it with sharing.
  $stream = [System.IO.File]::Open(
    $Path,
    [System.IO.FileMode]::Open,
    [System.IO.FileAccess]::Read,
    [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
  )
  try {
    $reader = [System.IO.StreamReader]::new($stream)
    while (-not $reader.EndOfStream) {
      $line = $reader.ReadLine()
      if ($line -match $ReadinessPattern) {
        $signal.Found = $true
        $signal.Port = [int]$Matches[1]
        $signal.Line = $line.Trim()
        break
      }
    }
  }
  finally {
    $stream.Dispose()
  }
  return $signal
}

function Get-SharedText {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) { return '' }
  $stream = [System.IO.File]::Open(
    $Path,
    [System.IO.FileMode]::Open,
    [System.IO.FileAccess]::Read,
    [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
  )
  try {
    $reader = [System.IO.StreamReader]::new($stream)
    return $reader.ReadToEnd()
  }
  finally {
    $stream.Dispose()
  }
}

function Get-ProcessTree {
  param([int]$RootId)

  $children = @{}
  foreach ($p in (Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name)) {
    $key = [int]$p.ParentProcessId
    if (-not $children.ContainsKey($key)) { $children[$key] = @() }
    $children[$key] += $p
  }
  $found = @()
  $queue = [System.Collections.Generic.Queue[int]]::new()
  $queue.Enqueue($RootId)
  while ($queue.Count -gt 0) {
    $current = $queue.Dequeue()
    foreach ($child in $children[$current]) {
      $found += $child
      $queue.Enqueue([int]$child.ProcessId)
    }
  }
  return $found
}

if ($VerifyReadinessFile) {
  $signal = Get-ReadinessSignal -Path $VerifyReadinessFile
  if (-not $signal.Found) {
    Write-Host "no readiness marker in $VerifyReadinessFile"
    exit 1
  }
  if ($VerifyReadinessPort -gt 0 -and $signal.Port -ne $VerifyReadinessPort) {
    Write-Host "readiness marker port $($signal.Port) does not match the expected port $VerifyReadinessPort"
    exit 1
  }
  Write-Host "readiness marker: $($signal.Line)"
  exit 0
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..' '..')).Path
if (-not $Exe) { $Exe = Join-Path $repoRoot 'desktop/src-tauri/target/release/trade-journal-desktop.exe' }
if (-not (Test-Path -LiteralPath $Exe)) { throw "The packaged app is missing: $Exe" }

if (-not $DataDir) {
  if ($env:JOURNAL_DATA_DIR) { $DataDir = $env:JOURNAL_DATA_DIR }
  else { $DataDir = Join-Path ([System.IO.Path]::GetTempPath()) 'journal-packaged-smoke' }
}
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
$env:JOURNAL_DATA_DIR = (Resolve-Path -LiteralPath $DataDir).Path

$scratchRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [System.IO.Path]::GetTempPath() }
$stderrFile = Join-Path $scratchRoot 'journal-packaged-smoke-stderr.log'
$stdoutFile = Join-Path $scratchRoot 'journal-packaged-smoke-stdout.log'
Remove-Item -LiteralPath $stderrFile, $stdoutFile -ErrorAction SilentlyContinue

$app = $null
$nodeChildren = @()
try {
  $app = Start-Process -FilePath $Exe -PassThru -RedirectStandardError $stderrFile -RedirectStandardOutput $stdoutFile
  Write-Host "started the packaged app (pid $($app.Id))"

  # The desktop picks its own nonzero port, so the smoke discovers the
  # loopback listener the journal's node child owns.
  $port = $null
  $deadline = (Get-Date).AddSeconds($DiscoverTimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if ($app.HasExited) { throw "The packaged app exited with code $($app.ExitCode) before the journal answered." }
    $nodeIds = @(Get-ProcessTree $app.Id | Where-Object { $_.Name -eq 'node.exe' } | ForEach-Object { [int]$_.ProcessId })
    if ($nodeIds.Count -gt 0) {
      $listener = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
        Where-Object { $nodeIds -contains [int]$_.OwningProcess -and $_.LocalAddress -eq '127.0.0.1' } |
        Select-Object -First 1
      if ($listener) { $port = [int]$listener.LocalPort; break }
    }
    Start-Sleep -Seconds 2
  }
  if (-not $port) { throw 'The packaged app never opened a loopback listener for the journal.' }
  if ($port -in 3000, 3001) { throw "The journal bound a reserved port ($port)." }
  Write-Host "the journal listens on 127.0.0.1:$port"

  $answered = $false
  for ($attempt = 0; $attempt -lt $HttpAttempts; $attempt++) {
    try {
      $response = Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/accounts" -TimeoutSec 5
      if ($response.StatusCode -eq 200) { $answered = $true; break }
    }
    catch { }
    Start-Sleep -Seconds 2
  }
  if (-not $answered) { throw "The journal did not answer HTTP on http://127.0.0.1:$port/api/accounts." }
  Write-Host 'the journal answered over HTTP'

  # The readiness signal is the defect this smoke exists for: the app must have
  # accepted the supervisor's readiness, on the very port the journal serves.
  $signal = Get-ReadinessSignal -Path $stderrFile
  for ($wait = 0; -not $signal.Found -and $wait -lt 30; $wait++) {
    Start-Sleep -Seconds 1
    $signal = Get-ReadinessSignal -Path $stderrFile
  }
  if (-not $signal.Found) {
    $seen = Get-SharedText -Path $stderrFile
    throw "The packaged app never published the readiness signal ($ReadinessPattern). stderr was: $seen"
  }
  if ($signal.Port -ne $port) {
    throw "The readiness signal reports port $($signal.Port) but the journal listens on $port."
  }
  Write-Host "readiness signal: $($signal.Line)"

  # The node children the app owned while it served.
  $nodeChildren = @(Get-ProcessTree $app.Id | Where-Object { $_.Name -eq 'node.exe' } | ForEach-Object { [int]$_.ProcessId })
  Write-Host "node.exe children: $($nodeChildren -join ', ')"

  # Terminate the app the way a user does, then prove that no node child of it
  # survives.
  [void]$app.CloseMainWindow()
  if (-not $app.WaitForExit(30000)) { Stop-Process -Id $app.Id -Force }
  Start-Sleep -Seconds 10

  $orphans = @($nodeChildren | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })
  if ($orphans.Count -gt 0) {
    foreach ($orphan in $orphans) { Stop-Process -Id $orphan -Force -ErrorAction SilentlyContinue }
    throw "Orphaned node.exe processes survived the app: $($orphans -join ', ')"
  }
  Write-Host 'no orphaned node.exe survived the app'
  Write-Host "pid $($app.Id), port $port, readiness '$($signal.Line)', orphans [$($orphans -join ', ')]"
}
catch {
  Write-Host "packaged smoke failed: $($_.Exception.Message)"
  if ($app -and -not $app.HasExited) {
    # Kill the whole tree so a failed smoke leaves no node.exe behind.
    & taskkill /F /T /PID $app.Id | Out-Null
  }
  exit 1
}

exit 0
