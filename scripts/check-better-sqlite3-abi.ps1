Set-Location 'E:\4004\orca\trade-journal'
$ErrorActionPreference = 'Continue'

# What ABI does the binary claim to need?
# .node files embed a NODE_MODULE_VERSION in PE header. Extract via dumpbin or just node test.
Write-Host '--- Direct require from apps/web (which failed during next build) ---'
Set-Location 'apps\web'
node -e "try { const m = require('better-sqlite3'); const db = new m(':memory:'); db.exec('CREATE TABLE t(x)'); db.prepare('INSERT INTO t VALUES (?)').run(42); console.log('RESULT:', db.prepare('SELECT x FROM t').get()); } catch(e) { console.log('FAIL:', e.code, '-', e.message.split(String.fromCharCode(10))[0]); }"
Set-Location '..'