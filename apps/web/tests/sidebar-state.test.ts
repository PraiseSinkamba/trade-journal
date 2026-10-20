// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SidebarProvider, useSidebar } from "../src/components/ui/sidebar";

const preferenceKey = "journal-sidebar-collapsed-v1";
let container: HTMLDivElement;
let root: Root | undefined;
let savedStorage: [string, string][];

/** Expose the real provider's state and action through an ordinary consumer. */
function SidebarConsumer() {
  const { state, toggleSidebar } = useSidebar();
  return createElement(
    "button",
    { type: "button", onClick: toggleSidebar, "aria-expanded": state === "expanded" },
    state,
  );
}

/** Flush hydration effects before observing the consumer. */
async function mountSidebar() {
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(SidebarProvider, null, createElement(SidebarConsumer)));
  });
  const button = container.querySelector("button");
  if (!button) throw new Error("Sidebar consumer did not render");
  return button;
}

beforeEach(() => {
  savedStorage = Object.entries(localStorage);
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // jsdom has no media-query evaluator; these state tests exercise the desktop branch.
  vi.stubGlobal("matchMedia", (media: string) =>
    Object.assign(new EventTarget(), { media, matches: false, onchange: null }),
  );
  // Keep diagnostics visible and fail rather than hiding React warnings.
  vi.spyOn(console, "error");
  vi.spyOn(console, "warn");
});

afterEach(async () => {
  try {
    await act(async () => root?.unmount());
    expect(console.error).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  } finally {
    root = undefined;
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    for (const [key, value] of savedStorage) localStorage.setItem(key, value);
  }
});

it("hydrates the saved collapsed preference and persists the inverse desktop state", async () => {
  localStorage.setItem(preferenceKey, "true");
  const button = await mountSidebar();
  expect(button.textContent).toBe("collapsed");
  expect(localStorage.getItem(preferenceKey)).toBe("true");

  await act(async () => button.click());
  expect(button.textContent).toBe("expanded");
  expect(button.getAttribute("aria-expanded")).toBe("true");
  expect(localStorage.getItem(preferenceKey)).toBe("false");

  await act(async () => button.click());
  expect(button.textContent).toBe("collapsed");
  expect(button.getAttribute("aria-expanded")).toBe("false");
  expect(localStorage.getItem(preferenceKey)).toBe("true");
});

it("synchronizes cross-tab preference changes and storage clear with the mounted consumer", async () => {
  localStorage.setItem(preferenceKey, "false");
  const button = await mountSidebar();

  // A storage event arrives after the other tab has already changed shared storage.
  for (const collapsed of [true, false, true]) {
    await act(async () => {
      const oldValue = localStorage.getItem(preferenceKey);
      const newValue = String(collapsed);
      localStorage.setItem(preferenceKey, newValue);
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: preferenceKey,
          oldValue,
          newValue,
          storageArea: localStorage,
        }),
      );
    });
    expect(button.textContent).toBe(collapsed ? "collapsed" : "expanded");
  }

  await act(async () => {
    localStorage.clear();
    window.dispatchEvent(new StorageEvent("storage", { key: null, storageArea: localStorage }));
  });
  expect(button.textContent).toBe("expanded");
});

it.each(["ctrlKey", "metaKey"] as const)(
  "%s+B toggles outside editors without taking their native shortcuts",
  async (modifier) => {
    localStorage.setItem(preferenceKey, "true");
    const button = await mountSidebar();
    const shortcut = new KeyboardEvent("keydown", {
      key: "b",
      [modifier]: true,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => button.dispatchEvent(shortcut));
    expect(button.textContent).toBe("expanded");
    expect(shortcut.defaultPrevented).toBe(true);

    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    const descendant = document.createElement("span");
    editor.append(descendant);
    const targets = [
      document.createElement("input"),
      document.createElement("textarea"),
      document.createElement("select"),
      editor,
    ];
    container.append(...targets);
    for (const target of [...targets, descendant]) {
      const editingShortcut = new KeyboardEvent("keydown", {
        key: "b",
        [modifier]: true,
        bubbles: true,
        cancelable: true,
      });
      await act(async () => target.dispatchEvent(editingShortcut));
      expect(button.textContent).toBe("expanded");
      expect(editingShortcut.defaultPrevented).toBe(false);
      expect(localStorage.getItem(preferenceKey)).toBe("false");
    }

    const uppercaseShortcut = new KeyboardEvent("keydown", {
      key: "B",
      [modifier]: true,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => button.dispatchEvent(uppercaseShortcut));
    expect(button.textContent).toBe("collapsed");
    expect(uppercaseShortcut.defaultPrevented).toBe(true);
  },
);

it("still allows desktop interaction when preference reads and writes are unavailable", async () => {
  // Storage denial must not prevent hydration or leave the toggle unusable.
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new DOMException("Storage denied", "SecurityError");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Storage denied", "SecurityError");
  });
  const button = await mountSidebar();
  await act(async () => button.click());
  expect(button.textContent).toBe("collapsed");
  await act(async () => button.click());
  expect(button.textContent).toBe("expanded");
});
