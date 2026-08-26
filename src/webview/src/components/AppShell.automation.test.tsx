// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { AppShell } from "./AppShell";
import { SlotProvider } from "../slots/react";
import { createSlotRegistry } from "../slots/registry";

beforeAll(() => {
  window.matchMedia = (() => ({
    matches: false,
    media: "",
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
});

afterEach(cleanup);

describe("AppShell automation navigation", () => {
  it("opens the presentation-only automation surface through the typed nav", () => {
    render(
      <SlotProvider registry={createSlotRegistry()}>
      <AppShell
        t={(key) => key}
        titleBar={(nav) => <button type="button" onClick={nav.openAutomation}>Open automation</button>}
        sidebar={() => null}
        rail={() => null}
        chat={<div>Chat surface</div>}
        automation={<div>Automation empty state</div>}
        settings={() => null}
        panels={{}}
      />
      </SlotProvider>,
    );
    expect(screen.getByText("Chat surface")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open automation" }));
    expect(screen.getByText("Automation empty state")).toBeTruthy();
    expect(screen.queryByText("Chat surface")).toBeNull();
  });
});
