// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { AppShell } from "./AppShell";
import { AutomationView } from "./AutomationView";
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

describe("AppShell global search", () => {
  it("opens the shell search dialog from both typed navigation and Ctrl/Cmd+K", () => {
    render(
      <SlotProvider registry={createSlotRegistry()}>
        <AppShell
          t={(key) => key}
          titleBar={(nav) => <button type="button" onClick={(nav as typeof nav & { openSearch: () => void }).openSearch}>Open search</button>}
          sidebar={() => null}
          rail={() => null}
          chat={<div>Chat surface</div>}
          automation={null}
          search={(nav) => nav.searchOpen ? <div role="dialog" aria-label="Global search">Global search</div> : null}
          settings={() => null}
          panels={{}}
        />
      </SlotProvider>,
    );

    expect(screen.queryByRole("dialog", { name: /global search/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open search" }));
    expect(screen.getByRole("dialog", { name: /global search/i })).toBeTruthy();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByRole("dialog", { name: /global search/i })).toBeTruthy();
  });
});

describe("AutomationView creation flow", () => {
  it("generates a reviewable candidate from natural language and explicitly disables unavailable submission", () => {
    render(<AutomationView onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "新建自动化" }));
    fireEvent.change(screen.getByRole("textbox", { name: "自动化需求" }), { target: { value: "每天整理未完成任务" } });
    fireEvent.click(screen.getByRole("button", { name: "生成候选" }));
    expect(screen.getByText(/候选方案/)).toBeTruthy();
    const submit = screen.getByRole("button", { name: "提交自动化" });
    expect(submit.hasAttribute("disabled")).toBe(true);
    expect(submit.getAttribute("aria-description")).toMatch(/尚未提供自动化提交接口/);
  });
});
