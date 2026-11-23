// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { InteractionCard } from "@/components/intelligence/interaction-card";
import { IntelligenceInbox } from "@/components/intelligence/inbox";
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

/** A second observation: another card, and no question of its own. */
const SECOND_OBSERVATION = {
  ...OBSERVATION,
  id: "obs-2",
  subjectId: "trade-b",
  reviewState: "live",
};

/** The review of the second observation: this one carries the question. */
const SECOND_REVIEW_INTENT = {
  ...REVIEW_INTENT,
  intentId: "intent:workflow:wf-2:review",
  workflowId: "wf-2",
  subject: { type: "observation", id: "obs-2" },
};

let container: HTMLDivElement;
let root: Root;

/** One route the client reads, as the server answers it. */
interface Route {
  readonly status: number;
  readonly body: unknown;
}

const routes = new Map<string, Route>();

const jsonResponse = (status: number, body: unknown) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as Response;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.clear();
  routes.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const route = routes.get(String(input));
      if (!route) return jsonResponse(404, { error: "not_found" });
      return jsonResponse(route.status, route.body);
    }),
  );
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

/**
 * Mounts the inbox, the way the page does.
 *
 * The inbox reads two surfaces and pairs every intent with its own
 * observation, so the cards are rendered from the served answers.
 */
const renderInbox = async () => {
  window.localStorage.setItem(PRIVACY_KEY, "false");
  await act(async () => {
    root.render(createElement(PrivacyProvider, null, createElement(IntelligenceInbox)));
  });
  // The reads are promises: let them land before the cards are read.
  for (let round = 0; round < 3; round += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
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

it("leaves the keyboard on the native controls the card already had", async () => {
  // The question adds text, not controls. Both privacy states are rendered:
  // the masked branch and the plain one must offer the same controls. Each
  // state gets its OWN mount, because the provider reads the saved
  // preference when it mounts.
  for (const privacy of ["true", "false"]) {
    await act(async () => root.unmount());
    container.remove();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await render(privacy);
    // The focusable set is exactly the one the card had without the
    // question — the Acknowledge button, and nothing else. A link or any
    // other focusable would break the count.
    const focusable = Array.from(
      container.querySelectorAll<HTMLElement>(
        "button, input, textarea, select, a[href], [tabindex]",
      ),
    ).filter(
      (element) => element.getAttribute("aria-hidden") !== "true" && element.tabIndex !== -1,
    );
    expect(focusable).toHaveLength(1);
    expect(focusable[0]!.tagName).toBe("BUTTON");
    expect(focusable[0]!.textContent?.trim()).toBe("Acknowledge");
    for (const control of focusable) {
      const name = control.getAttribute("aria-label")?.trim() || control.textContent?.trim() || "";
      expect(name).not.toBe("");
      control.focus();
      expect(document.activeElement).toBe(control);
    }
    // The evidence list is untouched by the question.
    expect(container.textContent).toContain("rev-1");
  }
});

it("puts the question on the card of the observation it was made from", async () => {
  // Two observations, one review. The review belongs to the second
  // observation and carries the question; the first one is offered for
  // review and has no question of its own.
  routes.set("/api/intelligence/observations", {
    status: 200,
    body: {
      observations: [{ ...OBSERVATION, reviewState: "unreviewed" }, SECOND_OBSERVATION],
      intents: [SECOND_REVIEW_INTENT],
    },
  });
  routes.set("/api/intelligence/opportunities", {
    status: 200,
    body: { opportunities: [], intents: [] },
  });

  await renderInbox();

  const cards = Array.from(container.querySelectorAll('[data-slot="card"]'));
  expect(cards).toHaveLength(2);

  // The question is on exactly one card.
  const withQuestion = cards.filter((card) => card.textContent?.includes(QUESTION));
  expect(withQuestion).toHaveLength(1);
  const questionCard = withQuestion[0]!;

  // It is the card of the observation the question was made from: that
  // card shows that trade's facts, and not the other one's.
  expect(questionCard.textContent).toContain("trade-b");
  expect(questionCard.textContent).not.toContain("trade-42");

  // The other card carries its own observation and no question.
  const otherCard = cards.find((card) => card !== questionCard)!;
  expect(otherCard.textContent).toContain("trade-42");
  expect(otherCard.textContent).not.toContain(QUESTION);
});
