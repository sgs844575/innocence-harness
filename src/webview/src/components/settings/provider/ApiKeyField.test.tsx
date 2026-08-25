// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

  it("submits the typed replacement credential only when editing finishes", () => {
    const onChange = vi.fn();
    render(<ApiKeyField configured onChange={onChange} onCheck={vi.fn()} />);
    const input = screen.getByPlaceholderText(/已配置/);
    fireEvent.change(input, { target: { value: "replacement-key" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith("replacement-key");
    expect((input as HTMLInputElement).value).toBe("");
  });
});
