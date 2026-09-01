// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Popover } from "./Popover";
import { Switch } from "./Switch";
import { Badge } from "./Badge";
import { Separator } from "./Separator";
import { CapabilityTags } from "../tags/CapabilityTags";

afterEach(cleanup);

describe("ui 基础件", () => {
  it("Popover 点击触发器打开内容", () => {
    render(
      <Popover trigger={<button>open</button>}>
        <div>panel</div>
      </Popover>,
    );
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    expect(screen.getByText("panel")).toBeTruthy();
  });
  it("Switch 点击切换并回调", () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} aria-label="s" />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(true);
  });
  it("能力标签按固定顺序渲染", () => {
    render(<CapabilityTags model={{ reasoning: true, tools: true, vision: true, id: "x", source: "manual" }} />);
    const titles = screen.getAllByTestId("cap-tag").map((el) => el.getAttribute("title"));
    expect(titles).toEqual(["视觉", "工具调用", "推理"]);
  });
  it("Badge 渲染文本并随变体切换语义色", () => {
    render(
      <>
        <Badge variant="success">+7</Badge>
        <Badge variant="destructive">−3</Badge>
      </>,
    );
    expect(screen.getByText("+7").className).toContain("text-(--color-diff-add)");
    expect(screen.getByText("−3").className).toContain("text-(--color-diff-del)");
  });
  it("Separator 默认横向发丝线、可转纵向", () => {
    const { container } = render(
      <>
        <Separator />
        <Separator orientation="vertical" data-testid="v" />
      </>,
    );
    const [h, v] = Array.from(container.querySelectorAll("div"));
    expect(h.className).toContain("h-px w-full");
    expect(v.className).toContain("h-full w-px");
  });
});
