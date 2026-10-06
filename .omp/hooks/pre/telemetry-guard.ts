// @ts-nocheck — runtime-loaded by omp; the ExtensionAPI contract is supplied
// by omp at runtime, not by any npm package. This file is not part of any
// package's strict typecheck; it executes inside the omp host process.
import { isToolCallEventType } from "@oh-my-pi/pi-coding-agent";

// Any shell command that points at a non-user endpoint, or that re-enables
// Next.js telemetry. The project ships with NEXT_TELEMETRY_DISABLED=1.
const TELEMETRY_URL =
  /\b(curl|wget|fetch|Invoke-WebRequest)\b[^|;&]*\bhttps?:\/\/[^/\s]*(telemetry|analytics|metrics|tracking|beacon)\./i;
const REENABLE_TELEMETRY = /\bNEXT_TELEMETRY_DISABLED\s*=\s*0\b/;
const VENDOR_TELEMETRY = /\b(googletagmanager|google-analytics|segment\.io|mixpanel|amplitude|posthog|sentry\.io)\b/;

/**
 * Gate: no telemetry endpoints, no re-enabling telemetry.
 * AGENTS.md hard block #5 — "No telemetry".
 */
export default function telemetryGuard(pi) {
  pi.on("tool_call", (event) => {
    if (!isToolCallEventType("bash", event)) return;
    const command = String(event.input?.command ?? "");
    if (
      TELEMETRY_URL.test(command) ||
      REENABLE_TELEMETRY.test(command) ||
      VENDOR_TELEMETRY.test(command)
    ) {
      return {
        block: true,
        reason:
          "Telemetry endpoint or vendor disallowed (AGENTS.md hard block #5: 'No telemetry'). NEXT_TELEMETRY_DISABLED=1 is the project default.",
      };
    }
  });
}