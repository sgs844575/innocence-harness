// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ConversationHeader } from "./ConversationHeader";

afterEach(cleanup);

describe("ConversationHeader", () => {
  it("renders task, project, and branch context", () => {
    render(<ConversationHeader task="Build the desktop shell" project="InnocenceCode" branch="main" />);
    expect(screen.getByRole("heading", { name: "Build the desktop shell" })).toBeTruthy();
    expect(screen.getByText("InnocenceCode")).toBeTruthy();
    expect(screen.getByText("main")).toBeTruthy();
  });
});
