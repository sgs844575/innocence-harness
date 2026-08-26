// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiKeyField } from "./ApiKeyField";

afterEach(cleanup);

describe("ApiKeyField", () => {
  it("does not receive or display an existing key and only signals configured state", () => {
    render(<ApiKeyField configured onChange={vi.fn()} onCheck={vi.fn()} />);
    const input = screen.getByPlaceholderText(/已配置/) as HTMLInputElement;
    expect(input.value).toBe("");
    expect(input.placeholder).toContain("已配置");
    expect(screen.queryByRole("button", { name: /显示密钥|隐藏密钥/ })).toBeNull();
  });

  it("does not clear an existing credential when focus leaves an untouched field", () => {
    const onChange = vi.fn();
    render(<ApiKeyField configured onChange={onChange} onCheck={vi.fn()} />);
    const input = screen.getByPlaceholderText(/已配置/);
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("submits the typed replacement credential only when editing finishes", async () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    render(<ApiKeyField configured onChange={onChange} onCheck={vi.fn()} />);
    const input = screen.getByPlaceholderText(/已配置/);
    fireEvent.change(input, { target: { value: "replacement-key" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(input);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("replacement-key"));
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(""));
  });

  it("retains the draft when the host rejects persistence", async () => {
    const onChange = vi.fn().mockRejectedValue(new Error("save failed"));
    render(<ApiKeyField configured={false} onChange={onChange} onCheck={vi.fn()} />);
    const input = screen.getByPlaceholderText("API 密钥") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "retry-key" } });
    fireEvent.blur(input);

    await waitFor(() => expect(onChange).toHaveBeenCalledWith("retry-key"));
    expect(input.value).toBe("retry-key");
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });
});
