$ErrorActionPreference = 'Continue'
Set-Location 'E:\4004\orca\trade-journal\node_modules\.pnpm\better-sqlite3@12.11.1\node_modules\better-sqlite3'

# What Node ABI do we need?
$nodeAbi = (node -e "console.log(process.versions.modules)")
Write-Host "Current Node ABI: $nodeAbi"

# What ABI is the installed binary?
# easier to read from better-sqlite3's runtime check
$bindingCheck = node -e "try { require('better-sqlite3'); console.log('LOADS OK'); } catch(e) { console.log('LOAD FAIL:', e.message); }"
Write-Host "Binding check: $bindingCheck"

# Check prebuild-install's logic: what targets exist for our version?
$npm = 'C:\nvm4w\nodejs\npm.cmd'
Write-Host '--- prebuild-install --runtime napi --target-arch x64 --verbose output ---'
& npx --no-install prebuild-install --runtime napi --target-arch x64 --verbose 2>&1 | Select-Object -First 20