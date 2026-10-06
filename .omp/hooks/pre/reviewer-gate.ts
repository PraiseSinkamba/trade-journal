// @ts-nocheck — runtime-loaded by omp; the ExtensionAPI contract is supplied
// by omp at runtime, not by any npm package. This file is not part of any
// package's strict typecheck; it executes inside the omp host process.
import { existsSync, readFileSync } from "node:fs";
import { isToolCallEventType } from "@oh-my-pi/pi-coding-agent";

const GIT_COMMIT = /\bgit\b[^\n]*\bcommit\b/;
const REPORT_PATH = ".omp/reviewer-report.md";
const VERDICT_RE = /^##\s*Verdict:\s*(PASS|FAIL|BLOCK)\b/im;

/**
 * Gate: `git commit` requires .omp/reviewer-report.md with `## Verdict: PASS`.
 * The reviewer (or the orchestrator, after copying its findings) writes the
 * report. This hook enforces it at tool-call time so the commit cannot land
 * without a passing review.
 */
export default function reviewerGate(pi) {
  pi.on("tool_call", (event) => {
    if (!isToolCallEventType("bash", event)) return;
    const command = String(event.input?.command ?? "");
    if (!GIT_COMMIT.test(command)) return;

    const cwd = event.input?.cwd ?? process.cwd();
    const reportPath = `${cwd}/${REPORT_PATH}`;
    if (!existsSync(reportPath)) {
      return {
        block: true,
        reason:
          "git commit blocked: .omp/reviewer-report.md is missing. Run the reviewer (.omp/agents/reviewer.md) and write the report with `## Verdict: PASS` before committing.",
      };
    }
    let verdict = "";
    try {
      const text = readFileSync(reportPath, "utf8");
      const match = text.match(VERDICT_RE);
      verdict = match?.[1] ?? "";
    } catch {
      verdict = "";
    }
    if (verdict !== "PASS") {
      return {
        block: true,
        reason: `git commit blocked: .omp/reviewer-report.md Verdict is '${verdict || "missing"}'. Re-run the reviewer and overwrite the report with '## Verdict: PASS' before committing.`,
      };
    }
  });
}