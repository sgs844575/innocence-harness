// Git 图谱泳道布局（纯函数，可测）：输入拓扑序提交（新→旧），输出每条提交的
// 节点泳道、峰值泳道数与父子连线。规则：首父沿本泳道直下；其余父在节点右侧
// 紧邻开新泳道；多个泳道等待同一提交时在节点处汇合；窗口外父提交留下挂线。
import type { GitGraphCommit } from "../../../shared/ipc";

export interface GraphEdge {
  /** 子提交行/泳道。 */
  fromRow: number;
  fromLane: number;
  /** 父提交行/泳道；toRow === 提交总数 表示历史截断的下挂线（超出末端半行）。 */
  toRow: number;
  toLane: number;
}

export interface GraphLayout {
  /** 每条提交（按输入序）的节点泳道。 */
  nodeLanes: number[];
  /** 峰值泳道数（图列宽 = laneCount × 泳道宽）。 */
  laneCount: number;
  edges: GraphEdge[];
}

export function layoutGitGraph(commits: Pick<GitGraphCommit, "hash" | "parents">[]): GraphLayout {
  const indexOf = new Map(commits.map((commit, index) => [commit.hash, index]));
  // lanes[i] = 该泳道正在等待出现的提交哈希（null = 空闲，可回收）。
  const lanes: (string | null)[] = [];
  // 泳道最后一次被指派期望值的行号（截断下挂线的起点）。
  const laneTouchedAt: number[] = [];
  const nodeLanes: number[] = [];
  let laneCount = 0;

  const claimFreeLane = (after: number, expected: string, row: number): number => {
    // 优先复用 after 右侧的空闲泳道；没有则紧邻 after 插入新泳道。
    for (let index = after + 1; index < lanes.length; index += 1) {
      if (lanes[index] === null) {
        lanes[index] = expected;
        laneTouchedAt[index] = row;
        return index;
      }
    }
    lanes.splice(after + 1, 0, expected);
    laneTouchedAt.splice(after + 1, 0, row);
    return after + 1;
  };

  commits.forEach((commit, row) => {
    // 汇合：等待本提交的所有泳道取最左为节点位，其余释放。
    let node = -1;
    for (let index = 0; index < lanes.length; index += 1) {
      if (lanes[index] !== commit.hash) continue;
      if (node === -1) {
        node = index;
      } else {
        lanes[index] = null;
      }
    }
    if (node === -1) {
      // 新线头（分支顶端提交）：复用首个空闲泳道，否则追加。
      node = lanes.indexOf(null);
      if (node === -1) {
        node = lanes.length;
        lanes.push(null);
        laneTouchedAt.push(row);
      }
    }
    nodeLanes.push(node);

    const [first, ...rest] = commit.parents;
    if (first === undefined) {
      lanes[node] = null;
    } else {
      lanes[node] = first;
      laneTouchedAt[node] = row;
      for (const parent of rest) {
        if (lanes.includes(parent)) continue; // 已有泳道在等待：汇合到它。
        claimFreeLane(node, parent, row);
      }
    }
    laneCount = Math.max(laneCount, lanes.length);
  });

  const edges: GraphEdge[] = [];
  commits.forEach((commit, row) => {
    for (const parent of commit.parents) {
      const target = indexOf.get(parent);
      if (target === undefined) continue;
      edges.push({ fromRow: row, fromLane: nodeLanes[row]!, toRow: target, toLane: nodeLanes[target]! });
    }
  });
  // 窗口截断：仍持有期望的泳道从最后触点多向下延半行。
  lanes.forEach((expected, lane) => {
    if (expected !== null && !indexOf.has(expected)) {
      edges.push({ fromRow: laneTouchedAt[lane] ?? 0, fromLane: lane, toRow: commits.length, toLane: lane });
    }
  });

  return { nodeLanes, laneCount, edges };
}
