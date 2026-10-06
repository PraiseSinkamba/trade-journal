$paths = @(
  'C:\Users\4004\.cargo',
  'C:\Users\4004\AppData\Local\tauri',
  'C:\Users\4004\AppData\Local\com.luxalgo.tradejournal',
  'C:\Users\4004\AppData\Roaming\com.luxalgo.tradejournal',
  'desktop\src-tauri\target',
  'apps\web\.next\standalone',
  'apps\web\.next\tauri-dist'
)
foreach ($p in $paths) {
  $full = Resolve-Path $p -ErrorAction SilentlyContinue
  if ($full) {
    $size = (Get-ChildItem $full -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
    '{0,-70} {1,10:N1} MB' -f $full.Path, ($size/1MB)
  } else {
    '{0,-70} (missing)' -f $p
  }
}