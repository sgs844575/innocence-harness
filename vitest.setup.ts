import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

// jsdom 组件测试在同一文件内共享 localStorage——持久化 UI 状态（如
// state/uiState.ts）会跨用例泄漏初始值，逐用例清空保证默认起步。
afterEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    // Node 环境无 window，无需清理。
  }
});

