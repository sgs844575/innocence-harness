import { describe, expect, it } from "vitest";
import { layoutGitGraph } from "./gitGraph";

function commit(hash: string, parents: string[] = []) {
  return { hash, parents };
}

describe("layoutGitGraph", () => {
  it("线性历史：全部在泳道 0，相邻连线", () => {
    const layout = layoutGitGraph([commit("c3", ["c2"]), commit("c2", ["c1"]), commit("c1")]);
    expect(layout.nodeLanes).toEqual([0, 0, 0]);
    expect(layout.laneCount).toBe(1);
    expect(layout.edges).toEqual([
      { fromRow: 0, fromLane: 0, toRow: 1, toLane: 0 },
      { fromRow: 1, fromLane: 0, toRow: 2, toLane: 0 },
    ]);
  });

  it("分叉：新分支顶端占新泳道，汇合到共同父提交", () => {
    // main: m2 → m1 → base；feature: f1 → base。显示序（拓扑）：m2, f1, m1, base。
    const layout = layoutGitGraph([
      commit("m2", ["m1"]),
      commit("f1", ["base"]),
      commit("m1", ["base"]),
      commit("base"),
    ]);
    expect(layout.nodeLanes).toEqual([0, 1, 0, 0]);
    expect(layout.laneCount).toBe(2);
    // f1 → base 是跨泳道连线（1 → 0）。
    expect(layout.edges).toContainEqual({ fromRow: 1, fromLane: 1, toRow: 3, toLane: 0 });
    expect(layout.edges).toContainEqual({ fromRow: 2, fromLane: 0, toRow: 3, toLane: 0 });
  });

  it("合并提交：次父紧邻节点右侧开泳道", () => {
    // merge 有两个父：m1（首父）与 f1（次父）。
    const layout = layoutGitGraph([
      commit("merge", ["m1", "f1"]),
      commit("f1", ["base"]),
      commit("m1", ["base"]),
      commit("base"),
    ]);
    expect(layout.nodeLanes).toEqual([0, 1, 0, 0]);
    expect(layout.edges).toContainEqual({ fromRow: 0, fromLane: 0, toRow: 2, toLane: 0 });
    expect(layout.edges).toContainEqual({ fromRow: 0, fromLane: 0, toRow: 1, toLane: 1 });
  });

  it("多泳道等待同一提交时在节点处汇合", () => {
    // a、b 都以 base 为父；base 出现时应只占一个泳道。
    const layout = layoutGitGraph([commit("a", ["base"]), commit("b", ["base"]), commit("base")]);
    expect(layout.nodeLanes).toEqual([0, 1, 0]);
    expect(layout.edges).toHaveLength(2);
    expect(layout.laneCount).toBe(2);
  });

  it("窗口外父提交：从最末相关行向下挂线", () => {
    const layout = layoutGitGraph([commit("c2", ["c1"])]);
    expect(layout.edges).toEqual([{ fromRow: 0, fromLane: 0, toRow: 1, toLane: 0 }]);
  });

  it("空闲泳道被后续新分支回收，泳道数不无限增长", () => {
    // 两段独立线性历史交替出现（模拟 --all 下两个无交集分支）。
    const layout = layoutGitGraph([
      commit("a2", ["a1"]),
      commit("b2", ["b1"]),
      commit("a1"),
      commit("b1"),
    ]);
    expect(layout.laneCount).toBe(2);
    expect(layout.nodeLanes).toEqual([0, 1, 0, 1]);
  });
});
