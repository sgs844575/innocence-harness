// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ChatMessage } from "../../../../shared/ipc";
import { MessageItem } from "../MessageItem";
import { GeneralPanel } from "../settings/GeneralPanel";
import { DEFAULT_SETTINGS, mergeSettings } from "@innocenceharness/harness-electron";
import { streamDisplayFromSettings } from "./toolGrouping";

afterEach(cleanup);
const t = (key: string) => key;
const message: ChatMessage = {
  id: "summary", role: "assistant", createdAt: 1,
  completion: { finishReason: "stop", aborted: false },
  parts: [
    { type: "text", text: "Progress" },
    { type: "toolCall", id: "edit", toolName: "Edit", args: { file_path: "src/a.ts", old_string: "old", new_string: "new" } },
    { type: "toolResult", toolCallId: "edit", content: "done", isError: false },
    { type: "text", text: "Conclusion" },
  ],
};

it("keeps the conclusion outside collapsed history and opens the original change from the summary", () => {
  const onOpenFile = vi.fn();
  const stream = streamDisplayFromSettings({ ...DEFAULT_SETTINGS, aggregateResponse: true });
  const { container, rerender } = render(<MessageItem t={t} message={message} stream={stream} onOpenFile={onOpenFile} />);
  expect(container.querySelector("details")!.open).toBe(false);
  expect(screen.getByText("Progress").closest("details")).toBeTruthy();
  expect(screen.getByText("Conclusion").closest("details")).toBeNull();
  const card = screen.getByRole("region", { name: "chat.summary.changes" });
  const file = card.querySelector("details")!;
  fireEvent.click(file.querySelector("summary")!);
  // File controls retain the original tool invocation and diff payload.
  fireEvent.click(within(file).getByRole("button", { name: "tool.openFile" }));
  expect(onOpenFile).toHaveBeenCalledWith(expect.objectContaining({ id: "edit", filePath: "src/a.ts", diff: { removed: "old", added: "new" } }));
  rerender(<MessageItem t={t} message={message} stream={{ ...stream, aggregateResponse: false }} />);
  expect(screen.queryByRole("region", { name: "chat.summary.changes" })).toBeNull();
});

it("defaults off, persists normalized settings and exposes a settings toggle", () => {
  expect(mergeSettings({}).aggregateResponse).toBe(false);
  expect(mergeSettings({ aggregateResponse: "true" }).aggregateResponse).toBe(false);
  const settings = mergeSettings({ aggregateResponse: true });
  expect(streamDisplayFromSettings(settings).aggregateResponse).toBe(true);
  expect(mergeSettings(JSON.parse(JSON.stringify(settings))).aggregateResponse).toBe(true);
  const onPatchSettings = vi.fn();
  render(<GeneralPanel t={t} settings={DEFAULT_SETTINGS} appInfo={null} onPatchSettings={onPatchSettings} />);
  fireEvent.click(screen.getByRole("switch", { name: "settings.general.aggregateResponse" }));
  expect(onPatchSettings).toHaveBeenCalledWith({ aggregateResponse: true });
});
