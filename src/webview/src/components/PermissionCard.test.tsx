// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatPermissionEvent } from "../../../shared/ipc";
import { PermissionCard } from "./PermissionCard";

afterEach(cleanup);

const t = (key: string) => key;

const request: ChatPermissionEvent = {
  sessionId: "s1",
  messageId: "m1",
  requestId: "p1",
  toolName: "Write",
  args: { path: "src/a.ts" },
  resource: { kind: "file", action: "write", scope: "src/a.ts" },
};

describe("PermissionCard 资源摘要渲染", () => {
  it("显示 kind/action/scope 稳定摘要与工具名", () => {
    render(<PermissionCard t={t} request={request} onRespond={() => {}} />);
    expect(screen.getByText("Write")).toBeTruthy();
    expect(screen.getByText("write")).toBeTruthy();
    expect(screen.getByText("file")).toBeTruthy();
    expect(screen.getByText("src/a.ts")).toBeTruthy();
  });

  it("matches the composer width without a narrower max-width cap", () => {
    render(<PermissionCard t={t} request={request} onRespond={() => {}} />);
    const card = screen.getByRole("alertdialog");
    expect(card.className).not.toContain("max-w-3xl");
    expect(card.className).toContain("w-full");
  });

  it("args 默认折叠，点开 summary 后可见", () => {
    const { container } = render(<PermissionCard t={t} request={request} onRespond={() => {}} />);
    const details = container.querySelector("details");
    expect(details).toBeTruthy();
    expect(details?.open).toBe(false);
    fireEvent.click(details!.querySelector("summary")!);
    expect(details?.open).toBe(true);
    expect(screen.getByText(/"path": "src\/a\.ts"/)).toBeTruthy();
  });

  it("rejects duplicate clicks while an async permission response is pending", async () => {
    let resolve: (() => void) | undefined;
    const onRespond = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
    render(<PermissionCard t={t} request={request} onRespond={onRespond} />);
    const allow = screen.getByText("permission.card.allow");
    fireEvent.click(allow);
    fireEvent.click(allow);
    expect(onRespond).toHaveBeenCalledTimes(1);
    resolve?.();
    await vi.waitFor(() => expect((allow as HTMLButtonElement).disabled).toBe(false));
  });
  it("unlocks after a synchronous permission response throws", () => {
    const onRespond = vi.fn()
      .mockImplementationOnce(() => { throw new Error("response failed"); })
      .mockImplementationOnce(() => undefined);
    render(<PermissionCard t={t} request={request} onRespond={onRespond} />);
    const allow = screen.getByText("permission.card.allow");
    fireEvent.click(allow);
    expect(onRespond).toHaveBeenCalledTimes(1);
    fireEvent.click(allow);
    expect(onRespond).toHaveBeenCalledTimes(2);
  });
  it("拒绝 / 会话内允许 / 允许一次 分别回调对应选择", () => {
    const onRespond = vi.fn();
    render(<PermissionCard t={t} request={request} onRespond={onRespond} />);
    fireEvent.click(screen.getByText("permission.card.deny"));
    fireEvent.click(screen.getByText("permission.card.allowSession"));
    fireEvent.click(screen.getByText("permission.card.allow"));
    expect(onRespond.mock.calls).toEqual([
      ["p1", "deny"],
      ["p1", "allowSession"],
      ["p1", "allow"],
    ]);
  });
});
