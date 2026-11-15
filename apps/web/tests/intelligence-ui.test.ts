// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PrivacyProvider } from "@/components/privacy";
import { IntelligenceControls } from "@/components/intelligence/controls";
import { IntelligenceInbox } from "@/components/intelligence/inbox";
import { PRIVACY_KEY } from "@/lib/privacy-preference";

/**
 * The intelligence UI (Phase 19).
 *
 * Two things are proven here: that every control is a native, named and
 * focusable element (a DOM without a browser engine does not turn a key
 * press into a click, so the native semantics are asserted instead), and that
 * the money reaches the DOM only through the privacy overlay.
 */

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
};

const OPPORTUNITY = {
  id: "opp-1",
  subjectType: "observation",
  subjectId: "obs-1",
  accountId: "acc-1",
  status: "eligible",
  eligibleAt: 1_700_000_000_000,
  expiresAt: 1_700_700_000_000,
  evidenceIds: ["rev-1"],
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

const REVIEW_INTENT = {
  kind: "observation-review",
  intentId: "intent:workflow:wf-1:review",
  workflowId: "wf-1",
  expectedRevision: 3,
  subject: { type: "observation", id: "obs-1" },
  // The composed text carries the net P&L in plain characters: the card must
  // not render it, so the privacy overlay can mask the money.
  text: "win trade, net 987.65 USD.",
  evidence: [{ revisionId: "rev-1", kind: "projection_revision" }],
  actions: [
    {
      actionId: "act:wf-1:acknowledge:3",
      action: "acknowledge",
      label: "Acknowledge",
      requiresInput: false,
    },
    { actionId: "act:wf-1:correct:3", action: "correct", label: "Correct", requiresInput: true },
    { actionId: "act:wf-1:defer:3", action: "defer", label: "Defer", requiresInput: false },
  ],
};

const STATUS_INTENT = {
  kind: "status",
  intentId: "intent:opportunity:opp-1:inbox",
  surface: "inbox",
  subject: { type: "observation", id: "obs-1" },
  status: "eligible",
  updatedAt: 1_700_000_000_000,
  text: "The journal has something to show you.",
  actions: [
    {
      actionId: "act:opportunity:opp-1:dismiss",
      action: "dismiss",
      label: "Dismiss",
      requiresInput: false,
    },
  ],
};

interface Route {
  status: number;
  body: unknown;
}

const routes = new Map<string, Route>();
const calls: { url: string; method: string; body: unknown }[] = [];

const jsonResponse = (status: number, body: unknown) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as Response;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  routes.clear();
  calls.length = 0;
  window.localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({
        url,
        method,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      });
      const route = routes.get(`${method} ${url}`) ?? routes.get(url);
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

/** Flushes the pending reads so the fetched state is rendered. */
const settle = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

const render = async (element: React.ReactElement) => {
  await act(async () => root.render(createElement(PrivacyProvider, null, element)));
  await settle();
};

/** The accessible name of one element, as a screen reader reads it. */
const accessibleName = (element: Element): string => {
  const label = element.getAttribute("aria-label");
  if (label?.trim()) return label.trim();
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ")
      .trim();
    if (text) return text;
  }
  const id = element.getAttribute("id");
  if (id) {
    for (const candidate of container.querySelectorAll("label")) {
      if (candidate.getAttribute("for") === id && candidate.textContent?.trim())
        return candidate.textContent.trim();
    }
  }
  const wrapping = element.closest("label");
  if (wrapping?.textContent?.trim()) return wrapping.textContent.trim();
  return element.textContent?.trim() ?? "";
};

/** Every control the operator may reach, the hidden ones left out. */
const interactive = (): HTMLElement[] =>
  Array.from(container.querySelectorAll<HTMLElement>("button, input, textarea, select")).filter(
    (element) =>
      element.getAttribute("aria-hidden") !== "true" &&
      element.getAttribute("type") !== "hidden" &&
      element.tabIndex !== -1,
  );

const button = (name: string): HTMLElement => {
  const found = Array.from(container.querySelectorAll("button")).find(
    (element) => element.textContent?.trim() === name,
  );
  if (!found) throw new Error(`No button named ${name}`);
  return found;
};

/** Activates a control the way the browser does: a click with a pointer. */
const activate = async (element: HTMLElement) => {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
  });
  await settle();
};

/** Sets the value of a controlled input the way the browser does. */
const type = async (element: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(element) as object,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
};

/** The last request the client posted to one route. */
const posted = (url: string) =>
  calls.filter((call) => call.method === "POST" && call.url === url).at(-1);

it("offers only native, focusable controls with an accessible name", async () => {
  routes.set("GET /api/intelligence/observations", {
    status: 200,
    body: { observations: [OBSERVATION], intents: [REVIEW_INTENT] },
  });
  routes.set("GET /api/intelligence/opportunities", {
    status: 200,
    body: { opportunities: [OPPORTUNITY], intents: [STATUS_INTENT] },
  });

  await render(createElement(IntelligenceInbox));

  const controls = interactive();
  expect(controls.length).toBeGreaterThan(0);
  for (const control of controls) {
    expect(["BUTTON", "INPUT", "TEXTAREA"]).toContain(control.tagName);
    expect(accessibleName(control)).not.toBe("");
    control.focus();
    expect(document.activeElement).toBe(control);
  }

  // The composed intent text carries the net P&L in plain characters: it is
  // never rendered, masked or not.
  expect(container.textContent).not.toContain("win trade, net");
});

it("starts the review of an observation the journal has not asked about", async () => {
  routes.set("GET /api/intelligence/observations", {
    status: 200,
    body: { observations: [OBSERVATION], intents: [] },
  });
  routes.set("GET /api/intelligence/opportunities", {
    status: 200,
    body: { opportunities: [], intents: [] },
  });

  await render(createElement(IntelligenceInbox));
  await activate(button("Review"));

  expect(posted("/api/intelligence/observations")?.body).toEqual({ observationId: "obs-1" });
});

it("shows the review it started and never offers that review again", async () => {
  // The observation surface serves no intent at all: the server pairs the
  // first workflow of an observation, so the review the client just started
  // would never be served. The client must still show it, actionable.
  routes.set("GET /api/intelligence/observations", {
    status: 200,
    body: { observations: [OBSERVATION], intents: [] },
  });
  routes.set("GET /api/intelligence/opportunities", {
    status: 200,
    body: { opportunities: [], intents: [] },
  });
  routes.set("POST /api/intelligence/observations", {
    status: 200,
    body: {
      workflowId: "wf-2",
      revision: 1,
      intent: {
        kind: "observation-review",
        intentId: "intent:workflow:wf-2:review",
        workflowId: "wf-2",
        expectedRevision: 1,
        subject: { type: "observation", id: "obs-1" },
        text: "win trade, net 987.65 USD.",
        evidence: [{ revisionId: "rev-1", kind: "projection_revision" }],
        actions: [
          {
            actionId: "act:wf-2:acknowledge:1",
            action: "acknowledge",
            label: "Acknowledge",
            requiresInput: false,
          },
        ],
      },
    },
  });
  routes.set("POST /api/intelligence/commands", { status: 200, body: { ok: true } });

  await render(createElement(IntelligenceInbox));
  await activate(button("Review"));
  await settle();

  // The observation is not offered a second review.
  const reviewButtons = Array.from(container.querySelectorAll("button")).filter(
    (element) => element.textContent?.trim() === "Review",
  );
  expect(reviewButtons).toHaveLength(0);

  // The intent the server answered with is actionable straight away, with the
  // action ids it issued.
  await activate(button("Acknowledge"));
  expect(posted("/api/intelligence/commands")?.body).toEqual({
    actionId: "act:wf-2:acknowledge:1",
    commandId: expect.any(String),
    expectedRevision: 1,
    action: "acknowledge",
  });

  // The review is never offered again for that observation.
  const remainingReviewButtons = Array.from(container.querySelectorAll("button")).filter(
    (element) => element.textContent?.trim() === "Review",
  );
  expect(remainingReviewButtons).toHaveLength(0);
});

it("sends the action the server offered with its action id and revision", async () => {
  routes.set("GET /api/intelligence/observations", {
    status: 200,
    body: { observations: [OBSERVATION], intents: [REVIEW_INTENT] },
  });
  routes.set("GET /api/intelligence/opportunities", {
    status: 200,
    body: { opportunities: [], intents: [] },
  });

  await render(createElement(IntelligenceInbox));
  await activate(button("Acknowledge"));

  expect(posted("/api/intelligence/commands")?.body).toEqual({
    actionId: "act:wf-1:acknowledge:3",
    commandId: expect.any(String),
    expectedRevision: 3,
    action: "acknowledge",
  });
});

it("dismisses what the server's action id names", async () => {
  routes.set("GET /api/intelligence/observations", {
    status: 200,
    body: { observations: [OBSERVATION], intents: [] },
  });
  routes.set("GET /api/intelligence/opportunities", {
    status: 200,
    body: { opportunities: [OPPORTUNITY], intents: [STATUS_INTENT] },
  });

  await render(createElement(IntelligenceInbox));
  await activate(button("Dismiss"));

  expect(posted("/api/intelligence/opportunities")?.body).toEqual({
    actionId: "act:opportunity:opp-1:dismiss",
    scope: "opportunity",
    target: "opp-1",
  });
});

it("reports a stale answer as a change and does not retry it", async () => {
  routes.set("GET /api/intelligence/observations", {
    status: 200,
    body: { observations: [OBSERVATION], intents: [REVIEW_INTENT] },
  });
  routes.set("GET /api/intelligence/opportunities", {
    status: 200,
    body: { opportunities: [], intents: [] },
  });
  routes.set("POST /api/intelligence/commands", { status: 409, body: { error: "stale_revision" } });

  await render(createElement(IntelligenceInbox));
  await activate(button("Acknowledge"));

  expect(container.textContent).toContain("This interaction changed");
  expect(calls.filter((call) => call.url === "/api/intelligence/commands")).toHaveLength(1);
});

it("carries the correction and the deferral the operator supplied", async () => {
  routes.set("GET /api/intelligence/observations", {
    status: 200,
    body: { observations: [OBSERVATION], intents: [REVIEW_INTENT] },
  });
  routes.set("GET /api/intelligence/opportunities", {
    status: 200,
    body: { opportunities: [], intents: [] },
  });

  await render(createElement(IntelligenceInbox));

  await activate(button("Correct"));
  const textarea = container.querySelector("textarea");
  expect(textarea).not.toBeNull();
  expect(textarea?.tagName).toBe("TEXTAREA");
  expect(accessibleName(textarea as Element)).not.toBe("");
  await type(textarea as HTMLTextAreaElement, "The fee was twice what the journal read");
  await activate(button("Send correction"));
  expect(posted("/api/intelligence/commands")?.body).toEqual({
    actionId: "act:wf-1:correct:3",
    commandId: expect.any(String),
    expectedRevision: 3,
    action: "correct",
    correction: "The fee was twice what the journal read",
  });

  await activate(button("Defer"));
  const instant = container.querySelector('input[type="datetime-local"]');
  expect(instant).not.toBeNull();
  expect(accessibleName(instant as Element)).not.toBe("");
  await type(instant as HTMLInputElement, "2026-01-02T09:30");
  await activate(button("Defer until then"));
  expect(posted("/api/intelligence/commands")?.body).toEqual({
    actionId: "act:wf-1:defer:3",
    commandId: expect.any(String),
    expectedRevision: 3,
    action: "defer",
    deferUntil: Date.parse("2026-01-02T09:30"),
  });
});

it("masks the money while privacy is on and shows it while privacy is off", async () => {
  routes.set("GET /api/intelligence/observations", {
    status: 200,
    body: { observations: [OBSERVATION], intents: [REVIEW_INTENT] },
  });
  routes.set("GET /api/intelligence/opportunities", {
    status: 200,
    body: { opportunities: [], intents: [] },
  });

  window.localStorage.setItem(PRIVACY_KEY, "true");
  await render(createElement(IntelligenceInbox));
  expect(container.textContent).not.toContain("987.65");
  expect(container.textContent).toContain("••••");

  await act(async () => root.unmount());
  container.remove();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  window.localStorage.setItem(PRIVACY_KEY, "false");
  await render(createElement(IntelligenceInbox));
  expect(container.textContent).toContain("987.65");
});

it("writes the journal switches the operator changed", async () => {
  routes.set("GET /api/intelligence/controls", {
    status: 200,
    body: { controls: { proactiveOptIn: true, paused: false } },
  });
  routes.set("GET /api/intelligence/status", {
    status: 200,
    body: {
      status: {
        backgroundPolicy: {
          enabled: false,
          accounts: [],
          capabilities: { tools: false, structuredOutput: false },
          maxInputCharacters: 8000,
          revision: 3,
        },
        worker: null,
        engagementDefaults: {
          proactiveCooldownMs: 86_400_000,
          proactivePerDay: 1,
          opportunityExpiryMs: 604_800_000,
          neverExpires: 9_007_199_254_740_991,
        },
      },
    },
  });

  await render(createElement(IntelligenceControls));

  const switches = container.querySelectorAll<HTMLElement>('[role="checkbox"]');
  expect(switches).toHaveLength(2);
  for (const element of switches) {
    expect(element.tagName).toBe("BUTTON");
    expect(accessibleName(element)).not.toBe("");
    element.focus();
    expect(document.activeElement).toBe(element);
  }

  await activate(switches[0] as HTMLElement);
  expect(posted("/api/intelligence/controls")?.body).toEqual({ proactiveOptIn: false });

  await activate(switches[1] as HTMLElement);
  expect(posted("/api/intelligence/controls")?.body).toEqual({ paused: true });
});

it("shows the served background policy, the worker state and the engagement defaults", async () => {
  routes.set("GET /api/intelligence/controls", {
    status: 200,
    body: { controls: { proactiveOptIn: true, paused: false } },
  });
  routes.set("GET /api/intelligence/status", {
    status: 200,
    body: {
      status: {
        backgroundPolicy: {
          enabled: false,
          accounts: [],
          capabilities: { tools: false, structuredOutput: false },
          maxInputCharacters: 8000,
          revision: 3,
        },
        worker: null,
        engagementDefaults: {
          proactiveCooldownMs: 86_400_000,
          proactivePerDay: 1,
          opportunityExpiryMs: 604_800_000,
          neverExpires: 9_007_199_254_740_991,
        },
      },
    },
  });

  await render(createElement(IntelligenceControls));

  // The background policy is served read-only here: the AI section edits it.
  expect(container.textContent).toContain("AI section");
  expect(container.querySelectorAll("input").length).toBe(0);

  // The web process serves no worker: the card says so plainly.
  expect(container.textContent).toContain("No worker runs in this web process.");

  expect(container.textContent).toContain("24 hours");
  expect(container.textContent).toContain("7 days");
});
