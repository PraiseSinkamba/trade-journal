import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)) } },
  test: {
    include: ["packages/*/tests/**/*.test.ts", "apps/*/tests/**/*.test.ts"],
    setupFiles: ["./apps/web/tests/vitest-setup.ts"],
    pool: "forks",
    // Post-merge the importers + AI providers add enough module-graph weight to
    // push fork tests past the 5 s default under suite load. 30 s keeps the
    // integration suite deterministic without distorting fast isolated runs.
    testTimeout: 30000,
  },
});
