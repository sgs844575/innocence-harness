import { describe, expect, it } from "vitest";
import type { Session } from "../../../shared/ipc";
import { buildProjectTree } from "./sidebarTree";

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
});
