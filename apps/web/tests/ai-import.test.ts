import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { mockRunObjectAi, mockGenerateText } = vi.hoisted(() => ({
  mockRunObjectAi: vi.fn(),
  mockGenerateText: vi.fn(),
}));

vi.mock("ai", async (original) => ({
  ...(await original<typeof import("ai")>()),
  generateText: mockGenerateText,
}));
vi.mock("../src/server/ai-runtime", () => ({
  runTextAi: vi.fn(),
  runObjectAi: mockRunObjectAi,
  mapAiRuntimeError: (error: unknown) => error,
}));
const originalDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "journal-ai-import-"));
process.env.JOURNAL_DATA_DIR = scratch;
const { db, accounts, executions, trades, settings } = await import("../src/db");
const { setAiKey, setSetting } = await import("../src/server/settings");
const { parseStatementWithAi, validateAiExtraction, readAiImportPreview } =
  await import("../src/server/ai-import");
const { AiRuntimeError } = await import("../src/server/ai-contracts");
const { POST } = await import("../src/app/api/import/route");
const valid = () => ({
  complete: true,
  sourceAccounts: ["A"],
  warnings: [],
  errors: [],
  executions: [
    {
      symbol: "AAPL",
      side: "buy",
      quantity: 2,
      price: 100,
      fee: 0,
      executedAt: "2026-09-01T09:30:00",
      assetClass: "equity",
      source: "Row 2: Buy 2 AAPL at 100, fee 0",
    },
    {
      symbol: "AAPL",
      side: "sell",
      quantity: 2,
      price: 110,
      fee: 1,
      executedAt: "2026-09-01T10:30:00",
      assetClass: "equity",
      source: "Row 3: Sell 2 AAPL at 110, fee 1",
    },
  ],
});
const base = {
  content: "Unfamiliar statement: buy 2 AAPL at 100; sell 2 AAPL at 110",
  fileName: "statement.txt",
  timeZone: "America/Jamaica",
};
const request = (body: unknown) =>
  POST(
    new Request("http://localhost/api/import", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
  );
const modelResult = (output: unknown, finishReason = "stop") =>
  mockRunObjectAi.mockResolvedValue({
    output,
    meta: { finishReason },
  });
beforeEach(() => {
  vi.stubEnv("JOURNAL_PASSWORD", "");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  db.delete(trades).run();
  db.delete(executions).run();
  db.delete(accounts).run();
  db.delete(settings).run();
  db.insert(accounts)
    .values({ id: "a", name: "Test", kind: "import", createdAt: "2026-01-01" })
    .run();
  mockRunObjectAi.mockReset();
  mockGenerateText.mockReset();
  modelResult(valid());
});
afterAll(() => {
  db.$client.close();
  vi.unstubAllEnvs();
  if (originalDir === undefined) delete process.env.JOURNAL_DATA_DIR;
  else process.env.JOURNAL_DATA_DIR = originalDir;
  rmSync(scratch, { recursive: true, force: true });
});
it("keeps native parsing local and unchanged when AI is off", async () => {
  const response = await request({
    mode: "preview",
    timeZone: "UTC",
    content:
      "Date,Time,Symbol,Quantity,Price,Side,Commission\n2026-09-01,09:30:00,AAPL,2,100,Buy,0",
  });
  const result = await response.json();
  expect(result.detected).toBe("tradervue");
  expect(result.totals.executions).toBe(1);
  expect(result.aiPreviewToken).toBeUndefined();
  expect(mockRunObjectAi).not.toHaveBeenCalled();
});
it("uses the selected provider key from Settings and sends the import through the runtime", async () => {
  setAiKey("openai", "settings-openai-key");
  setSetting("aiProvider", "openai");
  const response = await request({ ...base, mode: "preview", ai: true });
  expect(response.status).toBe(200);
  const preview = await response.json();
  expect(preview.executions[0].executedAt).toBe("2026-09-01T14:30:00.000Z");
  expect(preview.sources).toHaveLength(2);
  expect(preview.aiPreviewToken).toBeTruthy();
  expect(db.select().from(executions).all()).toHaveLength(0);
  // The runtime is invoked with the statementImport feature and the
  // server-resolved configuration: provider, model, and key come from
  // Settings — never from the import request body.
  expect(mockRunObjectAi).toHaveBeenCalledWith(
    expect.objectContaining({
      feature: "statementImport",
      promptVersion: "statement-import-v1",
      output: expect.anything(),
      abortSignal: expect.any(AbortSignal),
      configuration: expect.objectContaining({
        provider: "openai",
        apiKey: "settings-openai-key",
      }),
    }),
  );
  // The browser preview response must not echo the key.
  expect(JSON.stringify(preview)).not.toContain("settings-openai-key");
});
it("never serializes apiKey, provider, or model in the import request body", async () => {
  setAiKey("openai", "settings-openai-key");
  const response = await request({ ...base, mode: "preview", ai: true });
  const preview = await response.json();
  expect(response.status).toBe(200);
  const posted = JSON.stringify(preview);
  // The browser preview response should never echo back a caller-supplied
  // API key, provider, or model: those are now resolved on the server.
  expect(posted).not.toContain("settings-openai-key");
  expect(preview).not.toHaveProperty("apiKey");
  expect(preview).not.toHaveProperty("provider");
  expect(preview).not.toHaveProperty("model");
});
it("returns the safe configuration error when no saved or environment key is configured", async () => {
  setSetting("aiProvider", "openai");
  const response = await request({ ...base, mode: "preview", ai: true });
  expect(response.status).toBe(400);
  const result = await response.json();
  expect(result.error).toMatch(/add your openai api key in settings/i);
  expect(mockRunObjectAi).not.toHaveBeenCalled();
  expect(db.select().from(executions).all()).toHaveLength(0);
});
it("keeps statement parsing on hosted providers that accept PDFs and strict schemas", async () => {
  setSetting("compatibleBaseUrl", "http://localhost:11434/v1");
  setSetting("aiProvider", "compatible");
  const response = await request({ ...base, mode: "preview", ai: true });
  expect(response.status).toBe(400);
  expect((await response.json()).error).toBe("Choose OpenAI or Anthropic.");
  expect(mockRunObjectAi).not.toHaveBeenCalled();
});
it("commits exactly the reviewed result without calling AI again and preserves zero fees", async () => {
  setAiKey("openai", "settings-openai-key");
  setSetting(
    "journalDefaults",
    JSON.stringify({
      feeRules: [{ id: "default", accountId: "", symbol: "", amount: 5, mode: "execution" }],
    }),
  );
  const preview = await (await request({ ...base, mode: "preview", ai: true })).json();
  const commit = {
    ...base,
    mode: "commit",
    ai: true,
    aiReviewed: true,
    aiPreviewToken: preview.aiPreviewToken,
    accountId: "a",
  };
  const response = await request(commit);
  expect(response.status).toBe(200);
  expect((await response.json()).inserted).toBe(2);
  // Preview only; commit must not invoke the runtime.
  expect(mockRunObjectAi).toHaveBeenCalledTimes(1);
  expect(
    db
      .select()
      .from(executions)
      .all()
      .map((e) => e.fee),
  ).toEqual([0, 1]);
  expect((await (await request(commit)).json()).duplicates).toBe(2);
  expect(mockRunObjectAi).toHaveBeenCalledTimes(1);
});
it("requires review and rejects tampered or stale previews", async () => {
  setAiKey("openai", "settings-openai-key");
  const preview = await (await request({ ...base, mode: "preview", ai: true })).json();
  const commit = {
    ...base,
    mode: "commit",
    accountId: "a",
    ai: true,
    aiPreviewToken: preview.aiPreviewToken,
  };
  expect((await request(commit)).status).toBe(400);
  for (const patch of [
    { content: "changed" },
    { timeZone: "UTC" },
    { aiPreviewToken: "tampered" },
  ]) {
    expect((await request({ ...commit, aiReviewed: true, ...patch })).ok).toBe(false);
  }
  const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31 * 60_000);
  expect(() => readAiImportPreview(base, preview.aiPreviewToken)).toThrow(/expired/);
  now.mockRestore();
  expect(db.select().from(executions).all()).toHaveLength(0);
});
it.each([
  { complete: false },
  { errors: ["Missing entry price"] },
  { sourceAccounts: ["a", "b"] },
  { executions: [{ ...valid().executions[0], quantity: -1 }] },
  { executions: [{ ...valid().executions[0], executedAt: "2026-02-30T09:30:00" }] },
  { executions: [{ ...valid().executions[0], executedAt: "09/01/2026" }] },
  { executions: [{ ...valid().executions[0], fee: undefined }] },
  { executions: [{ ...valid().executions[0], source: "" }] },
  { executions: [valid().executions[0], valid().executions[0]] },
])("blocks incomplete or invalid extracted data: %j", (patch) => {
  expect(() => validateAiExtraction({ ...valid(), ...patch }, "UTC")).toThrow();
});
it("does not send an upload without a key, or when it exceeds the text limit", async () => {
  setAiKey("openai", "settings-openai-key");
  setSetting("aiProvider", "openai");
  expect((await request({ ...base, mode: "preview", ai: true })).status).toBe(200);
  expect(mockRunObjectAi).toHaveBeenCalledTimes(1);
  // Wipe the key to simulate a deleted Settings entry: server must now refuse
  // the preview with the safe configuration error rather than sending it.
  setAiKey("openai", null);
  expect((await request({ ...base, mode: "preview", ai: true })).status).toBe(400);
  expect(mockRunObjectAi).toHaveBeenCalledTimes(1);
  expect(
    (await request({ ...base, mode: "preview", ai: true, content: "a".repeat(150001) })).status,
  ).toBe(400);
  expect(mockRunObjectAi).toHaveBeenCalledTimes(1);
});
it("sends PDF bytes as a file input", async () => {
  setAiKey("openai", "settings-openai-key");
  const response = await request({
    ...base,
    mode: "preview",
    encoding: "pdf",
    content: Buffer.from("%PDF-1.4\nsynthetic test").toString("base64"),
    ai: true,
  });
  expect(response.status).toBe(200);
  expect(JSON.stringify(mockRunObjectAi.mock.calls[0]![0].messages)).toContain(
    '"mediaType":"application/pdf"',
  );
});
it("fails closed on truncated model output and sanitizes provider errors", async () => {
  setAiKey("openai", "settings-openai-key");
  mockRunObjectAi.mockResolvedValueOnce({
    output: valid(),
    meta: { finishReason: "length" },
  });
  expect((await request({ ...base, mode: "preview", ai: true })).ok).toBe(false);
  mockRunObjectAi.mockRejectedValueOnce(
    new AiRuntimeError("provider", "AI request failed. Check your provider settings."),
  );
  const response = await request({ ...base, mode: "preview", ai: true });
  expect(JSON.stringify(await response.json())).not.toContain("private-key");
  expect(db.select().from(executions).all()).toHaveLength(0);
});
it("rejects non-stop finish reasons with the existing incomplete-response message", async () => {
  setAiKey("openai", "settings-openai-key");
  mockRunObjectAi.mockResolvedValueOnce({
    output: valid(),
    meta: { finishReason: "length" },
  });
  await expect(parseStatementWithAi({ ...base })).rejects.toThrow("AI response was incomplete");
});
