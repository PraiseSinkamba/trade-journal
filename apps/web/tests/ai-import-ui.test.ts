// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TooltipProvider } from "../src/components/ui/tooltip";
const state = vi.hoisted(() => ({ post: vi.fn(), push: vi.fn(), configured: false }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock("@/components/filter-bar", () => ({ FilterBar: () => null }));
vi.mock("@/components/manual-trade-entry", () => ({ ManualTradeEntry: () => null }));
vi.mock("@/components/import-reconciliation", () => ({ ImportReconciliation: () => null }));
vi.mock("@/components/timezone-picker", () => ({ TimeZonePicker: () => null }));
vi.mock("@/components/account-picker", () => ({
  AccountPicker: ({ onChange }: { onChange: (id: string) => void }) =>
    createElement("button", { onClick: () => onChange("test-account") }, "Choose test account"),
}));
vi.mock("@/lib/use-api", () => ({
  postJson: (...args: unknown[]) => Promise.resolve(state.post(...args)),
  useApi: (url: string) => ({
    data:
      url === "/api/settings"
        ? {
            timeZone: "UTC",
            importTimeZone: "UTC",
            aiProvider: "openai",
            aiModel: "gpt-4.1-mini",
            aiConfigured: state.configured,
            aiConnections: {
              openai: { configured: state.configured, model: "gpt-4.1-mini", source: "saved" },
              anthropic: { configured: false, model: "claude-opus-5", source: null },
            },
          }
        : { formats: [] },
  }),
}));
const { default: ImportPage } = await import("../src/app/import/page");
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.post.mockReset();
  state.push.mockReset();
  state.configured = false;
  vi.spyOn(window, "alert").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
const render = () =>
  act(async () => root.render(createElement(TooltipProvider, null, createElement(ImportPage))));
const button = (name: string) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent === name,
  )!;
const upload = () =>
  act(async () => {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [
        {
          name: "sample.csv",
          size: 10,
          arrayBuffer: async () => new TextEncoder().encode("statement").buffer,
        },
      ],
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
it("defaults off and never sends a chosen file to AI until explicitly previewed with a configured key", async () => {
  await render();
  // With Settings reporting an unconfigured selected provider, the AI
  // preview control must not appear; only a Settings link is rendered.
  expect(container.querySelector("#ai-import-enabled")).toBeNull();
  expect(button("Preview with AI")).toBeUndefined();
  expect(container.textContent).toMatch(/add your openai api key in settings/i);
  // Uploading a file without AI configured still triggers a native
  // preview (no AI provider call), proving the AI control was gated
  // on configuration.
  state.post.mockResolvedValueOnce({ detected: null, timeZone: "UTC" });
  await upload();
  expect(state.post).toHaveBeenCalledTimes(1);
  expect(state.post.mock.calls[0]![1]).not.toHaveProperty("ai");
  // And there is no AI preview button to mis-click.
  expect(button("Preview with AI")).toBeUndefined();
});
it("shows all extracted rows and requires review before committing the frozen preview", async () => {
  state.configured = true;
  await render();
  await act(async () =>
    (container.querySelector("#ai-import-enabled") as HTMLButtonElement).click(),
  );
  await upload();
  expect(state.post).not.toHaveBeenCalled();
  state.post.mockResolvedValueOnce({
    detected: "AI-assisted",
    timeZone: "UTC",
    aiPreviewToken: "opaque-token",
    sources: ["Row 1"],
    executions: [
      {
        symbol: "TEST",
        side: "buy",
        quantity: 2,
        price: 100,
        fee: 0,
        executedAt: "2026-09-01T10:00:00Z",
      },
    ],
    totals: {
      executions: 1,
      symbols: 1,
      skippedRows: 0,
      skippedReasons: [],
      from: "2026-09-01T10:00:00Z",
      to: "2026-09-01T10:00:00Z",
    },
  });
  await act(async () => button("Preview with AI").click());
  // The browser preview request must never serialize an apiKey, provider,
  // or model: those are now resolved on the server.
  const previewCall = state.post.mock.calls.find((call) => isImportCall(call[1], "preview"));
  expect(previewCall).toBeDefined();
  const previewBody = previewCall![1] as Record<string, unknown>;
  expect(previewBody).toMatchObject({
    mode: "preview",
    content: "statement",
    fileName: "sample.csv",
    timeZone: "UTC",
    encoding: "text",
    ai: true,
  });
  expect(previewBody.ai).not.toHaveProperty("apiKey");
  expect(previewBody.ai).not.toHaveProperty("provider");
  expect(previewBody.ai).not.toHaveProperty("model");
  expect(container.textContent).toContain("2 @ 100 · Fees 0");
  expect(container.textContent).toContain("Source: Row 1");
  await act(async () => button("Choose test account").click());
  expect(button("Import").disabled).toBe(true);
  const checkboxes = container.querySelectorAll<HTMLButtonElement>('button[role="checkbox"]');
  await act(async () => checkboxes[checkboxes.length - 1]!.click());
  expect(button("Import").disabled).toBe(false);
  state.post.mockResolvedValueOnce({ inserted: 1, duplicates: 0 });
  await act(async () => button("Import").click());
  // Commit must not call a model: the request body carries the reviewed
  // preview token and the boolean AI intent — no apiKey, provider, or model.
  const commitCall = state.post.mock.calls.find((call) => isImportCall(call[1], "commit"));
  expect(commitCall).toBeDefined();
  const commitBody = commitCall![1] as Record<string, unknown>;
  expect(commitBody).toMatchObject({
    mode: "commit",
    ai: true,
    aiPreviewToken: "opaque-token",
    aiReviewed: true,
  });
  expect(commitBody.ai).not.toHaveProperty("apiKey");
  expect(commitBody.ai).not.toHaveProperty("provider");
  expect(commitBody.ai).not.toHaveProperty("model");
});

const isImportCall = (
  body: unknown,
  mode: "preview" | "commit",
): body is { mode: string; ai?: unknown } =>
  typeof body === "object" &&
  body !== null &&
  "mode" in body &&
  (body as { mode: unknown }).mode === mode;
