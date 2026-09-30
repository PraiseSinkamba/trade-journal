// ponytail: minimal static build for Tauri webview — no node_modules
import { copyFileSync, mkdirSync, readdirSync, statSync, rmSync, existsSync } from "node:fs";
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

// Copy .next/static as apps/web/.next/static (for Next.js runtime)
mkdirSync(join(appsWebDir, ".next"), { recursive: true });
copyDir(staticDir, join(appsWebDir, ".next/static"));

// Copy public as apps/web/public
if (existsSync(publicDir)) copyDir(publicDir, join(appsWebDir, "public"));

console.log("Static build ready at", outputDir);

function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    if (statSync(srcPath).isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}
