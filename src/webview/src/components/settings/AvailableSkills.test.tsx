// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AvailableSkills } from "./AvailableSkills";
afterEach(cleanup);
const skills = Array.from({ length: 23 }, (_, n) => ({ name: `skill-${n}`, description: "Workflow" }));
it("bounds rendered rows, disables edge controls, and clamps a shrinking result set", () => {
  const { rerender } = render(<AvailableSkills skills={skills} query="" label={(key) => key} />);
  expect(screen.getAllByRole("listitem")).toHaveLength(10);
  expect(screen.getByLabelText("previous")).toBeDisabled();
  fireEvent.click(screen.getByLabelText("next"));
  expect(screen.queryByText("skill-0")).toBeNull();
  fireEvent.click(screen.getByLabelText("next"));
  expect(screen.getAllByRole("listitem")).toHaveLength(3);
  expect(screen.getByLabelText("next")).toBeDisabled();
  rerender(<AvailableSkills skills={skills.slice(0, 2)} query="" label={(key) => key} />);
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
  expect(screen.queryByLabelText("pagination")).toBeNull();
});
