import { describe, expect, it } from "vitest";
import {
  AI_FEATURE_POLICIES,
  AI_PROMPT_VERSIONS,
} from "../src/server/ai-contracts";

describe("AI feature policies", () => {
  it("keeps reflection bounded and statement import non-retrying", () => {
    expect(AI_FEATURE_POLICIES.reflection.maxOutputTokens).toBe(1200);
    expect(AI_FEATURE_POLICIES.statementImport.maxRetries).toBe(0);
    expect(AI_FEATURE_POLICIES.statementImport.timeoutMs).toBe(120_000);
  });

  it("versions every current feature prompt", () => {
    expect(AI_PROMPT_VERSIONS.reflection).toMatch(/^reflection-v\d+$/);
    expect(AI_PROMPT_VERSIONS.statementImport).toMatch(/^statement-import-v\d+$/);
  });
});
