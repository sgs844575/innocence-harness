// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddProviderDialog } from "./AddProviderDialog";
import type { ProviderPresetMirror } from "../../../../../shared/ipc";

afterEach(cleanup);

const presets: ProviderPresetMirror[] = [
  { name: "Native generative", kind: "google", baseURL: "", models: ["gemini-2.5-pro"] },
];

describe("AddProviderDialog", () => {
  it("creates a native generative provider with a blank URL and separates its key", () => {
    const onCreate = vi.fn();
    render(<AddProviderDialog open presets={presets} onClose={() => {}} onCreate={onCreate} />);

    fireEvent.click(screen.getByRole("button", { name: /^Native generative$/ }));
    fireEvent.change(screen.getByLabelText("API 密钥（可选）"), { target: { value: "new-key" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "google", baseURL: "", apiKey: "", models: [] }),
      "new-key",
    );
  });

  it("offers the native generative protocol with its default URL hint", () => {
    render(<AddProviderDialog open presets={presets} onClose={() => {}} onCreate={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^Native generative$/ }));
    expect(screen.getByPlaceholderText("https://generativelanguage.googleapis.com/v1beta")).toBeTruthy();
  });
});
