// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button, buttonVariants } from "./Button";

afterEach(cleanup);

describe("Button", () => {
  it("渲染 default 变体 + default 尺寸（无 asChild）", () => {
    render(<Button>提交</Button>);
    const btn = screen.getByRole("button", { name: "提交" });
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.className).toContain("bg-(--color-app-strong)");
    expect(btn.className).toContain("h-8 px-3");
  });

  it("ghost + sm 变体对应行类", () => {
    render(<Button variant="ghost" size="sm">提交</Button>);
    const btn = screen.getByRole("button", { name: "提交" });
    expect(btn.className).toContain("bg-transparent");
    expect(btn.className).toContain("h-7 px-2");
  });

  it("icon 尺寸 square 7", () => {
    render(<Button variant="ghost" size="icon" aria-label="折叠"><span /></Button>);
    expect(screen.getByRole("button", { name: "折叠" }).className).toContain("size-7");
  });

  it("透传自定义 className（追加在 cva 之后）", () => {
    render(<Button className="w-full justify-start">x</Button>);
    const btn = screen.getByRole("button");
    // className 同时含 cva base 与 custom
    expect(btn.className.split(/\s+/)).toEqual(expect.arrayContaining(["w-full", "justify-start"]));
  });

  it("disabled 时透传 + 不响应 click", () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>x</Button>);
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    btn.click();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("buttonVariants 导出可在外部复用", () => {
    expect(typeof buttonVariants).toBe("function");
    expect(buttonVariants({ variant: "destructive" })).toContain("bg-(--color-diff-del)");
  });
});
