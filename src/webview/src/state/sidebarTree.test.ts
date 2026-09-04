import { describe, expect, it } from "vitest";
import type { Session } from "../../../shared/ipc";
import { buildProjectTree, pinnedFirst } from "./sidebarTree";

function session(id: string, root: string, updatedAt: number): Session {
  return { id, title: id, createdAt: 0, updatedAt, messageCount: 0, workspaceRoot: root };
}

describe("buildProjectTree", () => {
  it("按 workspaceRoot 聚合，项目按最近活跃排序，项目内会话倒序", () => {
    const tree = buildProjectTree(
      [
        session("a1", "D:/alpha", 100),
        session("a2", "D:/alpha", 300),
        session("b1", "D:/beta", 200),
        session("n1", "", 50),
      ],
      {},
      "不在项目中",
    );
    expect(tree.map((node) => node.id)).toEqual(["D:/alpha", "D:/beta", ""]);
    expect(tree[0]!.name).toBe("alpha");
    expect(tree[0]!.sessions.map((s) => s.id)).toEqual(["a2", "a1"]);
    expect(tree[2]!.name).toBe("不在项目中");
  });

  it("归档会话剔除", () => {
    const tree = buildProjectTree([session("a1", "D:/alpha", 100), session("a2", "D:/alpha", 200)], { a2: true }, "不在项目中");
    expect(tree[0]!.sessions.map((s) => s.id)).toEqual(["a1"]);
  });

  it("置顶会话在项目/任务分区内稳定排前", () => {
    const tree = buildProjectTree(
      [
        session("a1", "D:/alpha", 100),
        session("a2", "D:/alpha", 300),
        session("a3", "D:/alpha", 200),
        session("n1", "", 50),
        session("n2", "", 60),
      ],
      {},
      "不在项目中",
      { a1: true, n1: true },
    );
    expect(tree[0]!.sessions.map((s) => s.id)).toEqual(["a1", "a2", "a3"]);
    expect(tree[1]!.sessions.map((s) => s.id)).toEqual(["n1", "n2"]);
  });
});

describe("pinnedFirst", () => {
  it("稳定分区：置顶项保持相对顺序排到前面", () => {
    expect(pinnedFirst([{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }], { c: true, a: true }).map((item) => item.id)).toEqual(["a", "c", "b", "d"]);
    expect(pinnedFirst([{ id: "a" }], {}).map((item) => item.id)).toEqual(["a"]);
  });
});
