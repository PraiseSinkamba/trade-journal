// ponytail: minimal static build for Tauri webview — no node_modules
import { copyFileSync, mkdirSync, readdirSync, readlinkSync, realpathSync, statSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const standaloneDir = join(root, ".next/standalone/apps/web");
const staticDir = join(root, ".next/static");
const publicDir = join(root, "public");
const outputDir = join(root, ".next/tauri-dist");

if (existsSync(outputDir)) rmSync(outputDir, { recursive: true });
mkdirSync(outputDir, { recursive: true });

// Structure: tauri-dist/ = webview files (no node_modules)
// server.rs looks for resource_dir/apps/web/server.js
// so we put server files at outputDir/apps/web/
const appsWebDir = join(outputDir, "apps/web");
mkdirSync(appsWebDir, { recursive: true });

// Copy standalone server.js, package.json, .next, data dirs
for (const name of ["server.js", "package.json"]) {
  const src = join(standaloneDir, name);
  if (existsSync(src)) copyFileSync(src, join(appsWebDir, name));
}

// Copy .next (server/ app/ etc, but NOT node_modules)
const standaloneNext = join(standaloneDir, ".next");
if (existsSync(standaloneNext)) copyDir(standaloneNext, join(appsWebDir, ".next"));

// Copy data dir if present
const dataDir = join(standaloneDir, "data");
if (existsSync(dataDir)) copyDir(dataDir, join(appsWebDir, "data"));

// Copy node_modules. The standalone output uses pnpm's structure: apps/web/node_modules/{next,...}
// are junctions to .pnpm/next@15.5.23_.../node_modules/next. Node walks up from `next` and finds
// its dependencies as siblings in the same parent dir. We mirror that here:
//   1. Copy the apps/web-level entries (next, react, better-sqlite3) — they're the packages server.js needs.
//   2. Copy ALL `.pnpm/*` packages flat into apps/web/node_modules/ so they're siblings of `next/`
//      and Node can resolve Next.js's transitive deps (styled-jsx, react-dom, picocolors, etc.).
const appsWebNodeModules = join(standaloneDir, "node_modules");
const standaloneRootNm = join(root, ".next/standalone/node_modules");
const targetNm = join(appsWebDir, "node_modules");

if (existsSync(appsWebNodeModules)) {
  mkdirSync(targetNm, { recursive: true });

  // (1) Apps/web-level entries (next, react, etc.) — copy each package directory.
  for (const entry of readdirSync(appsWebNodeModules)) {
    const srcPath = join(appsWebNodeModules, entry);
    const destPath = join(targetNm, entry);
    let resolved = srcPath;
    try {
      const stat = statSync(srcPath);
      if (stat.isDirectory()) {
        copyDir(srcPath, destPath);
        continue;
      }
      copyFileSync(srcPath, destPath);
      continue;
    } catch {
      // Junction — read link target.
      try {
        const linkTarget = readlinkSync(srcPath);
        resolved = join(appsWebNodeModules, linkTarget);
      } catch {
        console.warn("skip:", entry);
        continue;
      }
    }
    try {
      const stat = statSync(resolved);
      if (stat.isDirectory()) {
        copyDir(resolved, destPath);
      } else {
        copyFileSync(resolved, destPath);
      }
    } catch (e) {
      console.warn("skip:", entry, e.code);
    }
  }
}

// (2) Copy ALL .pnpm packages flat. Each package's node_modules contents are flattened into
// apps/web/node_modules/ alongside `next`. We only copy the leaf package directories, not the
// .pnpm virtual-store structure (which pnpm uses for symlink resolution).
const pnpmDir = join(standaloneRootNm, ".pnpm");
if (existsSync(pnpmDir)) {
  for (const pkgDir of readdirSync(pnpmDir)) {
    const pkgNodeModules = join(pnpmDir, pkgDir, "node_modules");
    if (!existsSync(pkgNodeModules)) continue;
    for (const pkgName of readdirSync(pkgNodeModules)) {
      const srcPath = join(pkgNodeModules, pkgName);
      const destPath = join(targetNm, pkgName);
      if (existsSync(destPath)) continue; // already copied from step (1)
      try {
        const stat = statSync(srcPath);
        if (stat.isDirectory()) {
          copyDir(srcPath, destPath);
        } else {
          copyFileSync(srcPath, destPath);
        }
      } catch (e) {
        console.warn("skip pnpm:", pkgName, e.code);
      }
    }
  }
}

// Copy .next/static as apps/web/.next/static (for Next.js runtime)
mkdirSync(join(appsWebDir, ".next"), { recursive: true });
copyDir(staticDir, join(appsWebDir, ".next/static"));

// Copy public as apps/web/public
if (existsSync(publicDir)) copyDir(publicDir, join(appsWebDir, "public"));

// Generate splash page. Tauri's webview loads `apps/web/` as `frontendDist`. Before the sidecar
// Next.js server is listening, we serve this splash; it listens for the `server-ready` event and
// redirects the webview to the local Next.js URL.
const splashHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Trade Journal — Starting</title>
    <style>
      html, body { margin: 0; height: 100%; background: #0f172a; color: #e2e8f0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
      .wrap { display: flex; flex-direction: column; align-items: center; justify-content: center;
        height: 100%; gap: 1.5rem; }
      h1 { font-size: 1.5rem; font-weight: 500; margin: 0; color: #f1f5f9; }
      p { font-size: 0.875rem; color: #94a3b8; margin: 0; max-width: 28rem; text-align: center; }
      .spinner { width: 2.5rem; height: 2.5rem; border: 3px solid #1e293b; border-top-color: #60a5fa;
        border-radius: 50%; animation: spin 0.9s linear infinite; }
      .err { color: #fca5a5; font-family: ui-monospace, monospace; font-size: 0.75rem;
        max-width: 36rem; white-space: pre-wrap; word-break: break-word; }
      @keyframes spin { to { transform: rotate(360deg); } }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="spinner"></div>
      <h1>Trade Journal</h1>
      <p id="status">Starting the local server…</p>
      <p class="err" id="error"></p>
    </div>
    <script>
      const { invoke } = window.__TAURI__.core;
      const { listen } = window.__TAURI__.event;
      listen('server-ready', (event) => {
        try {
          document.getElementById('status').textContent = 'Loading journal…';
          window.location.href = event.payload.url;
        } catch (e) {
          document.getElementById('error').textContent = String(e);
        }
      });
      listen('server-error', (event) => {
        document.getElementById('status').textContent = 'Server failed to start.';
        document.getElementById('error').textContent = event.payload;
      });
    </script>
  </body>
</html>
`;
writeFileSync(join(appsWebDir, "index.html"), splashHtml);

console.log("Static build ready at", outputDir);

function copyDir(src, dest) {
  // Resolve symlinks at the root so recursive copy doesn't stat() through them.
  const realSrc = src;
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(realSrc)) {
    const srcPath = join(realSrc, entry);
    const destPath = join(dest, entry);
    const stat = statSync(srcPath);
    if (stat.isDirectory()) {
      copyDir(srcPath, destPath);
    } else if (stat.isSymbolicLink()) {
      // Resolve the symlink and copy the real file content (not the symlink itself).
      const realPath = stat.realpathSync?.() ?? srcPath;
      try {
        copyFileSync(realPath, destPath);
      } catch {
        copyFileSync(srcPath, destPath);
      }
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}
