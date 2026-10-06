// @ts-nocheck — runtime-loaded by omp; the ExtensionAPI contract is supplied
// by omp at runtime, not by any npm package. This file is not part of any
// package's strict typecheck; it executes inside the omp host process.
import { existsSync, readdirSync } from "node:fs";
import { isToolCallEventType } from "@oh-my-pi/pi-coding-agent";

const TRADE_KEY_FILE = /packages[\\/]core[\\/]src[\\/]round-trips\.ts$/;
// Canonical key format from AGENTS.md: accountId|symbol|direction|openedAt[|importGroup][|N]
const KEY_FORMAT = /accountId\|symbol\|direction\|openedAt(\[\|importGroup\])?(\[\|N\])?/;

/**
 * Gate: changing the trade key format in packages/core/src/round-trips.ts
 * requires a matching ADR at docs/decisions/NNNN-<topic>.md
 * (AGENTS.md hard block #3).
 */
export default function protectTradeKey(pi) {
  pi.on("tool_call", (event) => {
    if (!isToolCallEventType("edit", event) && !isToolCallEventType("write", event)) {
      return;
    }
    const path = event.input?.path ?? event.input?.file_path ?? "";
    if (!TRADE_KEY_FILE.test(path)) return;

    const oldContent = event.input?.old_string ?? event.input?.content ?? "";
    const newContent = event.input?.new_string ?? event.input?.content ?? "";

    // Only fire when the canonical key-format literal is actually changing.
    const oldHas = KEY_FORMAT.test(oldContent);
    const newHas = KEY_FORMAT.test(newContent);
    if (oldHas && newHas) return; // unchanged
    if (!oldHas && !newHas) return; // not a key edit
    if (!newHas) return; // removing the literal is a different concern

    const cwd = event.input?.cwd ?? process.cwd();
    const decisionsDir = `${cwd}/docs/decisions`;
    let hasAdr = false;
    try {
      if (existsSync(decisionsDir)) {
        hasAdr = readdirSync(decisionsDir).some((f) => /^0\d{3}-.*\.md$/.test(f));
      }
    } catch {
      hasAdr = false;
    }
    if (!hasAdr) {
      return {
        block: true,
        reason:
          "Trade key format change in packages/core/src/round-trips.ts requires a migration ADR at docs/decisions/NNNN-<topic>.md before merge (AGENTS.md hard block #3).",
      };
    }
  });
}