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
 */

// Inside the carve-out: any raw fetch/axios/node-fetch/http.get/http.post is forbidden.
// Lookbehind (?<![...]) avoids matching identifiers like myFetch or $.fetch.
const RAW_HTTP_IN_CARVEOUT =
  /(?<![.\w$])(?:fetch|axios|node-fetch)\(|(?<![.\w$])http\.(?:get|post)\(/;

// Outside the carve-out: only axios, node-fetch, http.get/http.post are flagged.
// fetch() is a legitimate Node 18+ global used throughout the codebase.
const RAW_HTTP_OUTSIDE_CARVEOUT =
  /(?<![.\w$])(?:axios|node-fetch)\(|(?<![.\w$])http\.(?:get|post)\(/;

describe("ADR 0002 boundary", () => {
  it("forbids raw HTTP inside the cTrader MCP carve-out folder", async () => {
    for await (const file of glob("apps/web/src/server/ctrader-mcp/**/*.ts")) {
      const src = readFileSync(file, "utf8");
      const matches = src.match(RAW_HTTP_IN_CARVEOUT);
      if (matches) {
        throw new Error(
          "Raw HTTP in carve-out " +
            file +
            ": " +
            JSON.stringify(matches) +
            ". Use @ai-sdk/mcp for MCP calls inside apps/web/src/server/ctrader-mcp/**."
        );
      }
    }
  });

  it("forbids raw HTTP outside the carve-out (axios / node-fetch / http.get / http.post)", async () => {
    for await (const file of glob("apps/web/src/**/*.ts")) {
      if (file.includes("node_modules")) continue;
      if (file.startsWith("apps/web/src/server/ctrader-mcp/")) continue;
      // ctrader-mcp-preview/route.ts imports from the carve-out and does no raw HTTP itself — exempt
      if (file.includes("ctrader-mcp-preview")) continue;
      const src = readFileSync(file, "utf8");
      const matches = src.match(RAW_HTTP_OUTSIDE_CARVEOUT);
      if (matches) {
        throw new Error(
          "Raw HTTP outside carve-out in " +
            file +
            ": " +
            JSON.stringify(matches) +
            ". Only fetch() (Node 18+ global) is permitted outside the carve-out."
        );
      }
    }
  });

  // Catches actual imports of the cTrader MCP module (e.g. from "@/server/ctrader-mcp/client")
  // or cTrader-specific identifiers (CTraderMcpClient, CTraderMcpSyncError).
  // Allows Pepperstone/IC Markets format files that mention "cTrader" as a platform
  // in docstrings and labels — those are about broker export formats, not the MCP module.
  it("forbids cTrader MCP module imports inside packages/importers/src/**", async () => {
    const CTRADER_IMPORT = /from\s+["']\.\.?\/.*ctrader[_-]mcp|from\s+["']@\/server\/ctrader[_-]mcp|CTraderMcpClient|CTraderMcpSyncError/i;
    for await (const file of glob("packages/importers/src/**/*.ts")) {
      const src = readFileSync(file, "utf8");
      expect(src).not.toMatch(CTRADER_IMPORT);
    }
  });
});
