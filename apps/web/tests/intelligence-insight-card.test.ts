// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { InteractionCard } from "@/components/intelligence/interaction-card";
import { PrivacyProvider } from "@/components/privacy";
import { PRIVACY_KEY } from "@/lib/privacy-preference";

/**
 * The review question on the card (Phase 24).
 *
 * The question reaches the DOM only through the privacy overlay: with privacy
 * on the card shows a mask that announces the QUESTION as hidden, and the
 * question text itself is absent from the DOM.
 */

const QUESTION = "Why did this trade close so fast after the London open?";

const OBSERVATION = {
  id: "obs-1",
  subjectId: "trade-42",
  accountId: "acc-1",
  type: "trade_outcome",
  status: "active",
  currency: "USD",
  netPnl: 987.65,
  fees: 3.5,
  tradeStatus: "win",
  timingQuality: "source_reported",
  recordedAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  reviewState: "live",
};

const REVIEW_INTENT = {
  kind: "observation-review",
  intentId: "intent:workflow:wf-1:review",
  workflowId: "wf-1",
  expectedRevision: 3,
  subject: { type: "observation", id: "obs-1" },
  text: "win trade, net 987.65 USD.",
  evidence: [{ revisionId: "rev-1", kind: "projection_revision" }],
  insight: { question: QUESTION, sourceRevision: "rev-1" },
  actions: [
    {
      actionId: "act:wf-1:acknowledge:3",
      action: "acknowledge",
      label: "Acknowledge",
      requiresInput: false,
    },
  ],
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const render = async (privacy: string) => {
  window.localStorage.setItem(PRIVACY_KEY, privacy);
  await act(async () => {
    root.render(
      createElement(
        PrivacyProvider,
        null,
        createElement(InteractionCard, {
          intent: REVIEW_INTENT as never,
          observation: OBSERVATION as never,
        }),
      ),
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
};

it("labels the review question", async () => {
  await render("false");
  const label = Array.from(container.querySelectorAll("p")).find(
    (element) => element.textContent?.trim() === "AI question",
  );
  expect(label).toBeTruthy();
  expect(label?.className).toContain("text-xs");
  expect(label?.className).toContain("text-muted-foreground");
});

it("shows the question while privacy is off", async () => {
  await render("false");
  expect(container.textContent).toContain(QUESTION);
  expect(container.textContent).not.toContain("••••");
});

it("masks the question while privacy is on", async () => {
  await render("true");
  expect(container.textContent).not.toContain(QUESTION);
  expect(container.textContent).toContain("••••");
  const mask = container.querySelector('[aria-label="AI question hidden"]');
  expect(mask).toBeTruthy();
  expect(mask?.getAttribute("aria-label")?.toLowerCase()).toContain("question");
});
