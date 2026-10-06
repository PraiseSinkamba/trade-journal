// @ts-nocheck — runtime-loaded by omp; the ExtensionAPI contract is supplied
// by omp at runtime, not by any npm package. This file is not part of any
// package's strict typecheck; it executes inside the omp host process.
import { appendFileSync } from "node:fs";

const GATED_COMMANDS = [
  /^pnpm\s+(format:check|typecheck|test|build)\b/,
  /^node\s+scripts\/check-licenses\.mjs\b/,
  /^pnpm\s+-r\s+--filter\s+"\.\/packages\/\*"\s+build\b/,
];

/**
 * Observer: append one line per "important" command result to .omp/.reviewer-log
 * so the reviewer subagent can correlate session activity with later findings.
 * Never blocks.
 */
export default function reviewerReportObserver(pi) {
  pi.on("tool_result", (event) => {
    try {
      const command = String(event.input?.command ?? "");
      const matches = GATED_COMMANDS.some((rx) => rx.test(command));
      if (!matches) return;
      const tool = String(event.tool ?? "");
      const exitCode = Number(event.exitCode ?? 0);
      const ts = new Date().toISOString();
      const line = `${ts}\t${tool}\texit=${exitCode}\t${command}\n`;
      appendFileSync(".omp/.reviewer-log", line, "utf8");
    } catch {
      // Observer failures must never break the host session.
    }
  });
}