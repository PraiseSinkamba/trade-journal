// @ts-nocheck — runtime-loaded by omp; the ExtensionAPI contract is supplied
// by omp at runtime, not by any npm package. This file is not part of any
// package's strict typecheck; it executes inside the omp host process.
import { isToolCallEventType } from "@oh-my-pi/pi-coding-agent";

const IMPORTER_DIR = /packages[\\/]importers[\\/]src[\\/]/;
const RAW_HTTP = /\b(fetch|axios)\s*\(|\bhttp\.(get|post|request|put|delete|patch)\b/;

/**
 * Gate: raw HTTP forbidden inside packages/importers/src/.
 * Routes all broker connectivity through @luxalgo/broker-sdk (ADR 0001).
 */
export default function blockImporterFetch(pi) {
  pi.on("tool_call", (event) => {
    if (!isToolCallEventType("edit", event) && !isToolCallEventType("write", event)) {
      return;
    }
    const path = event.input?.path ?? event.input?.file_path ?? "";
    if (!IMPORTER_DIR.test(path)) return;
    const content = event.input?.content ?? event.input?.new_string ?? "";
    if (RAW_HTTP.test(content)) {
      return {
        block: true,
        reason:
          "Raw HTTP forbidden in packages/importers/src/; route broker connectivity through @luxalgo/broker-sdk (ADR 0001).",
      };
    }
  });
}