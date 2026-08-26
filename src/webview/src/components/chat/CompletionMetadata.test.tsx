// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CompletionMetadata } from "./CompletionMetadata";

afterEach(cleanup);

describe("CompletionMetadata", () => {
  it("renders host-provided finish and usage without inferring completion", () => {
    render(
      <CompletionMetadata
        completion={{
          providerId: "provider-safe",
          modelId: "model-safe",
          finishReason: "stop",
          usage: { inputTokens: 10, outputTokens: 5, reasoningTokens: 2, totalTokens: 17 },
          aborted: false,
        }}
      />,
    );
    expect(screen.getByText("provider-safe / model-safe")).toBeTruthy();
    expect(screen.getByText(/17 tokens/)).toBeTruthy();
    expect(screen.getByText(/stop/)).toBeTruthy();
  });

  it("renders nothing when the host has not supplied completion metadata", () => {
    const { container } = render(<CompletionMetadata completion={undefined} />);
    expect(container.textContent).toBe("");
  });
});
