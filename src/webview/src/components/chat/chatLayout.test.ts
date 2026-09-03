import { describe, expect, it } from "vitest";
import { CAPSULE_RESERVE, capsuleHasContent, capsuleRightGutter, CAPSULE_SQUEEZE_MIN_WIDTH } from "./chatLayout";

describe("capsuleRightGutter", () => {
  it("容器 ≥1280px 且胶囊展开时预留 337px 挤压内容列", () => {
    expect(capsuleRightGutter(CAPSULE_SQUEEZE_MIN_WIDTH, true)).toBe(CAPSULE_RESERVE);
    expect(capsuleRightGutter(1920, true)).toBe(CAPSULE_RESERVE);
  });

  it("默认窗口（容器约 1015px）不挤压", () => {
    expect(capsuleRightGutter(1015, true)).toBe(0);
    expect(capsuleRightGutter(CAPSULE_SQUEEZE_MIN_WIDTH - 1, true)).toBe(0);
  });

  it("胶囊折叠为小图标时不挤压", () => {
    expect(capsuleRightGutter(1920, false)).toBe(0);
  });
});

describe("capsuleHasContent", () => {
  it("默认不出现：非 Git、无待办、无智能体、无终端", () => {
    expect(capsuleHasContent({ isGitRepo: false, todos: [] })).toBe(false);
  });

  it("四个出现条件各自独立成立", () => {
    expect(capsuleHasContent({ isGitRepo: true, todos: [] })).toBe(true);
    expect(capsuleHasContent({ isGitRepo: false, todos: [{}] })).toBe(true);
    expect(capsuleHasContent({ isGitRepo: false, todos: [], subagents: { total: 2, running: 0 } })).toBe(true);
    expect(capsuleHasContent({ isGitRepo: false, todos: [], terminals: { count: 1 } })).toBe(true);
  });

  it("计数为 0 的段不算内容", () => {
    expect(capsuleHasContent({ isGitRepo: false, todos: [], subagents: { total: 0, running: 0 }, terminals: { count: 0 } })).toBe(false);
  });
});
