import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";

/*
 * ADR 0002 enforces two boundaries:
 * 1. Inside apps/web/src/server/ctrader-mcp/** (the carve-out):
 *    only @ai-sdk/mcp is permitted. Raw fetch/axios/http.* or node-fetch are forbidden.
 * 2. Outside the carve-out (including packages/importers/src/**):
 *    fetch (Node 18+ global) is legitimate; axios, node-fetch, http.get/http.post
 *    are not normally used and are forbidden by ADR 0001.
 *
 * Scan layers:
 *   1. Bare-call  — catches axios(...) / node-fetch(...) directly.
 *   2. Identifier — catches imports and member-calls: axios.get(...), import axios,
 *                    axios.default.post(...), nodeFetch(...).
 *   Layer 1 alone misses member-call and import forms; combining both closes the gap.
 */

// Inside the carve-out: any raw fetch/axios/node-fetch/http.get/http.post is forbidden.
// Lookbehind (?<![...]) avoids matching identifiers like myFetch or $.fetch.
const RAW_HTTP_IN_CARVEOUT =
  /(?<![.\w$])(?:fetch|axios|node-fetch)\(|(?<![.\w$])http\.(?:get|post)\(/;

// Identifier token for axios / node-fetch (catches imports + member-call forms like axios.get).
// Negative lookbehind (?<![.\w$]) ensures myAxios or $.axios are not matched.
const IDENT_AXIOS_IN_CARVEOUT = /(?<![.\w$])(?:axios|node-fetch|nodeFetch)(?![.\w])/;

// Outside the carve-out: only axios, node-fetch, http.get/http.post are flagged.
// fetch() is a legitimate Node 18+ global used throughout the codebase.
const RAW_HTTP_OUTSIDE_CARVEOUT =
  /(?<![.\w$])(?:axios|node-fetch)\(|(?<![.\w$])http\.(?:get|post)\(/;

// Identifier token for axios / node-fetch outside the carve-out.
const IDENT_AXIOS_OUTSIDE_CARVEOUT = /(?<![.\w$])(?:axios|node-fetch|nodeFetch)(?![.\w])/;

describe("ADR 0002 boundary", () => {
  it("forbids raw HTTP inside the cTrader MCP carve-out folder", async () => {
    for await (const file of glob("apps/web/src/server/ctrader-mcp/**/*.ts")) {
      const src = readFileSync(file, "utf8");
      const bareMatches = src.match(RAW_HTTP_IN_CARVEOUT);
      if (bareMatches) {
        throw new Error(
          "Raw HTTP in carve-out " +
            file +
            ": " +
            JSON.stringify(bareMatches) +
            ". Use @ai-sdk/mcp for MCP calls inside apps/web/src/server/ctrader-mcp/**.",
        );
      }
      const identMatches = src.match(IDENT_AXIOS_IN_CARVEOUT);
      if (identMatches) {
        throw new Error(
          "Axios/node-fetch identifier in carve-out " +
            file +
            ": " +
            JSON.stringify(identMatches) +
            ". Use @ai-sdk/mcp for MCP calls inside apps/web/src/server/ctrader-mcp/**.",
        );
      }
    }
  });

  it("forbids raw HTTP outside the carve-out (axios / node-fetch / http.get / http.post)", async () => {
    for await (const file of glob("apps/web/src/**/*.ts")) {
      if (file.includes("node_modules")) continue;
      if (file.startsWith("apps/web/src/server/ctrader-mcp/")) continue;
      // ctrader-mcp-preview/route.ts imports from the carve-out and does no raw HTTP itself — exact-path exempt
      if (file === "apps/web/src/app/api/accounts/ctrader-mcp-preview/route.ts") continue;
      const src = readFileSync(file, "utf8");
      const bareMatches = src.match(RAW_HTTP_OUTSIDE_CARVEOUT);
      if (bareMatches) {
        throw new Error(
          "Raw HTTP outside carve-out in " +
            file +
            ": " +
            JSON.stringify(bareMatches) +
            ". Only fetch() (Node 18+ global) is permitted outside the carve-out.",
        );
      }
      const identMatches = src.match(IDENT_AXIOS_OUTSIDE_CARVEOUT);
      if (identMatches) {
        throw new Error(
          "Axios/node-fetch identifier outside carve-out in " +
            file +
            ": " +
            JSON.stringify(identMatches) +
            ". Only fetch() (Node 18+ global) is permitted outside the carve-out.",
        );
      }
    }
  });

  // ---- Identifier scans: member-call and import forms ----

  it("catches axios.get(...) inside the carve-out", async () => {
    const src = 'import axios from "axios";\naxios.get("/foo");';
    expect(src).toMatch(IDENT_AXIOS_IN_CARVEOUT);
  });

  it("catches axios.post(...) inside the carve-out", async () => {
    const src = 'import axios from "axios";\naxios.post("/foo");';
    expect(src).toMatch(IDENT_AXIOS_IN_CARVEOUT);
  });

  it("catches import axios from 'axios' inside the carve-out", async () => {
    const src = 'import axios from "axios";';
    expect(src).toMatch(IDENT_AXIOS_IN_CARVEOUT);
  });

  it("catches import nodeFetch from 'node-fetch' inside the carve-out", async () => {
    const src = 'import nodeFetch from "node-fetch";';
    expect(src).toMatch(IDENT_AXIOS_IN_CARVEOUT);
  });

  it("catches axios.default.post(...) inside the carve-out", async () => {
    const src = 'import axios from "axios";\naxios.default.post("/foo");';
    expect(src).toMatch(IDENT_AXIOS_IN_CARVEOUT);
  });

  it("catches bare axios(...) inside the carve-out via bare-call scan", async () => {
    const src = 'import axios from "axios";\naxios("/foo");';
    expect(src).toMatch(RAW_HTTP_IN_CARVEOUT);
  });

  it("bare-call regex catches direct axios(...) outside the carve-out", async () => {
    const src = 'axios("/foo");';
    expect(src).toMatch(RAW_HTTP_OUTSIDE_CARVEOUT);
  });

  it("identifier regex catches axios.get(...) outside the carve-out", async () => {
    const src = 'import axios from "axios";\naxios.get("/foo");';
    expect(src).toMatch(IDENT_AXIOS_OUTSIDE_CARVEOUT);
  });

  // ---- End identifier scans ----

  // or cTrader-specific identifiers (CTraderMcpClient, CTraderMcpSyncError).
  // Allows Pepperstone/IC Markets format files that mention "cTrader" as a platform
  // in docstrings and labels — those are about broker export formats, not the MCP module.
  // Matches the ctrader-mcp path inside any quoted string, covering ALL ESM import forms:
  // namespace (import * as mcp from "..."), combined default+named, type-only, side-effect, and dynamic.
  it("forbids cTrader MCP module imports inside packages/importers/src/**", async () => {
    const CTRADER_IMPORT =
      /["'][^"']*ctrader[_-]mcp[^"']*["']|CTraderMcpClient|CTraderMcpSyncError/i;
    for await (const file of glob("packages/importers/src/**/*.ts")) {
      const src = readFileSync(file, "utf8");
      expect(src).not.toMatch(CTRADER_IMPORT);
    }
  });
});
