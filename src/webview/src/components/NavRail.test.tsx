// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PanelLeftOpen, SquareTerminal } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NavRail } from "./NavRail";


afterEach(cleanup);

describe("NavRail", () => {
  it("exposes separate expand-sidebar and terminal entries", () => {
    const expand = vi.fn();
    const openTerminal = vi.fn();
    render(
      <NavRail
        items={[
          { icon: PanelLeftOpen, label: "展开侧边栏", onClick: expand },
          { icon: SquareTerminal, label: "终端", onClick: openTerminal },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "展开侧边栏" }));
    fireEvent.click(screen.getByRole("button", { name: "终端" }));
    expect(expand).toHaveBeenCalledTimes(1);
    expect(openTerminal).toHaveBeenCalledTimes(1);
  });
});
