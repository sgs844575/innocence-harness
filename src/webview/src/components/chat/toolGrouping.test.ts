import { describe, expect, it } from "vitest";
import type { HarnessSettings } from "../../../../shared/ipc";
import {
  categoryForRow,
  groupToolRows,
  isReadOnlyCommand,
  streamDisplayFromSettings,
  type ToolGroupingOptions,
} from "./toolGrouping";
import type { ToolRowModel } from "./toolRows";

function row(overrides: Partial<ToolRowModel> & { id: string }): ToolRowModel {
  return { toolName: "Read", verbKey: "tool.verb.read", title: "", running: false, isError: false, ...overrides };
}

const ALL_ON: ToolGroupingOptions = { explore: true, terminal: true, changes: true };

describe("isReadOnlyCommand", () => {
  it("只读白名单首 token 命中", () => {
    for (const command of [
      "ls",
      "ls -la src",
      "pwd",
      "cat package.json",
      "head -20 a.ts",
      "tail -f log.txt",
      "wc -l a.ts",
      "grep foo bar",
      "rg foo",
      "find . -name a",
      "echo hi",
      "env",
      "which node",
      "type ls",
      "file a.png",
      "stat a.ts",
      "du -sh .",
      "df -h",
      "date",
      "uname -a",
      "whoami",
      "hostname",
    ]) {
      expect(isReadOnlyCommand(command), command).toBe(true);
    }
  });

  it("git 只读子命令命中，写子命令不命中", () => {
    for (const command of ["git status", "git status -s", "git diff", "git log --oneline", "git show HEAD", "git branch -a", "git remote -v"]) {
      expect(isReadOnlyCommand(command), command).toBe(true);
    }
    for (const command of ["git", "git push", "git commit -m x", "git checkout main", "git add ."]) {
      expect(isReadOnlyCommand(command), command).toBe(false);
    }
  });

  it("剥掉前导 sudo 与环境变量赋值后再判定", () => {
    expect(isReadOnlyCommand("sudo ls /root")).toBe(true);
    expect(isReadOnlyCommand("FOO=1 BAR=baz cat a.ts")).toBe(true);
    expect(isReadOnlyCommand("sudo FOO=1 git status")).toBe(true);
    expect(isReadOnlyCommand("FOO=1 npm test")).toBe(false);
    expect(isReadOnlyCommand("sudo rm -rf /tmp/x")).toBe(false);
  });

  it("其余一律非只读（含空串/未知命令/管道首段之外的命令）", () => {
    expect(isReadOnlyCommand("")).toBe(false);
    expect(isReadOnlyCommand("   ")).toBe(false);
    expect(isReadOnlyCommand("npm test")).toBe(false);
    expect(isReadOnlyCommand("rm a.ts")).toBe(false);
    expect(isReadOnlyCommand("mv a b")).toBe(false);
    expect(isReadOnlyCommand("node script.js")).toBe(false);
    expect(isReadOnlyCommand("cd src && ls")).toBe(false);
  });
});

describe("categoryForRow", () => {
  it("读取/搜索动词 → explore；写入/编辑动词 → changes", () => {
    expect(categoryForRow(row({ id: "1", verbKey: "tool.verb.read" }))).toBe("explore");
    expect(categoryForRow(row({ id: "2", verbKey: "tool.verb.glob" }))).toBe("explore");
    expect(categoryForRow(row({ id: "3", verbKey: "tool.verb.grep" }))).toBe("explore");
    expect(categoryForRow(row({ id: "4", verbKey: "tool.verb.write" }))).toBe("changes");
    expect(categoryForRow(row({ id: "5", verbKey: "tool.verb.edit" }))).toBe("changes");
  });

  it("Shell 行按命令只读性分流：非只读 → terminal，只读 → 无类别", () => {
    expect(categoryForRow(row({ id: "1", toolName: "Bash", verbKey: "tool.verb.bash", title: "npm test", command: "npm test" }))).toBe("terminal");
    expect(categoryForRow(row({ id: "2", toolName: "Bash", verbKey: "tool.verb.bash", title: "ls -la", command: "ls -la" }))).toBeUndefined();
    // 无 command 投影的旧档案行回退按标题判定。
    expect(categoryForRow(row({ id: "3", toolName: "Bash", verbKey: "tool.verb.bash", title: "npm test" }))).toBe("terminal");
    expect(categoryForRow(row({ id: "4", toolName: "Bash", verbKey: "tool.verb.bash", title: "git status" }))).toBeUndefined();
  });

  it("todo/task/其他动词行无类别（永不入组）", () => {
    expect(categoryForRow(row({ id: "1", toolName: "TodoWrite", verbKey: "tool.verb.todo" }))).toBeUndefined();
    expect(categoryForRow(row({ id: "2", toolName: "Task", verbKey: "tool.verb.task" }))).toBeUndefined();
    expect(categoryForRow(row({ id: "3", toolName: "web_fetch", verbKey: "tool.verb.default" }))).toBeUndefined();
  });
});

describe("groupToolRows", () => {
  const reads = [
    row({ id: "r1", toolName: "Read", verbKey: "tool.verb.read", title: "a.ts" }),
    row({ id: "r2", toolName: "Grep", verbKey: "tool.verb.grep", title: "foo" }),
    row({ id: "r3", toolName: "Glob", verbKey: "tool.verb.glob", title: "*.ts" }),
  ];
  const shells = [
    row({ id: "s1", toolName: "Bash", verbKey: "tool.verb.bash", title: "npm test", command: "npm test" }),
    row({ id: "s2", toolName: "Bash", verbKey: "tool.verb.bash", title: "npm run build", command: "npm run build" }),
  ];
  const writes = [
    row({ id: "w1", toolName: "Write", verbKey: "tool.verb.write", title: "a.ts" }),
    row({ id: "w2", toolName: "Edit", verbKey: "tool.verb.edit", title: "b.ts" }),
  ];

  it("2+ 连续同类行聚合成组（组内保序），单行保持原行", () => {
    const items = groupToolRows([...reads, writes[0]!], ALL_ON);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: "group", category: "explore", id: "explore:r1" });
    expect((items[0] as { rows: ToolRowModel[] }).rows.map((r) => r.id)).toEqual(["r1", "r2", "r3"]);
    expect(items[1]).toMatchObject({ kind: "row", row: { id: "w1" } });
  });

  it("非同类行打断连续段；只读 Shell 行打断 terminal 段", () => {
    const lsRow = row({ id: "s1b", toolName: "Bash", verbKey: "tool.verb.bash", title: "ls", command: "ls" });
    const items = groupToolRows([shells[0]!, lsRow, shells[1]!], ALL_ON);
    expect(items.map((item) => item.kind)).toEqual(["row", "row", "row"]);
    const grouped = groupToolRows([shells[0]!, shells[1]!, reads[0]!, reads[1]!], ALL_ON);
    expect(grouped.map((item) => [item.kind, item.kind === "group" ? item.category : undefined])).toEqual([
      ["group", "terminal"],
      ["group", "explore"],
    ]);
  });

  it("类别被设置关闭时该行不参与分组（其余类别照常）", () => {
    const options: ToolGroupingOptions = { explore: false, terminal: true, changes: false };
    const items = groupToolRows([...reads, ...shells, ...writes], options);
    expect(items.map((item) => item.kind)).toEqual(["row", "row", "row", "group", "row", "row"]);
    expect(items[3]).toMatchObject({ category: "terminal" });
  });

  it("changes 默认关：写入/编辑行保持原行", () => {
    const items = groupToolRows(writes, { explore: true, terminal: true, changes: false });
    expect(items.map((item) => item.kind)).toEqual(["row", "row"]);
  });

  it("todo/task 行不入组也不影响相邻段的连续性判断", () => {
    const todo = row({ id: "t1", toolName: "TodoWrite", verbKey: "tool.verb.todo" });
    const task = row({ id: "t2", toolName: "Task", verbKey: "tool.verb.task" });
    const items = groupToolRows([reads[0]!, todo, reads[1]!, reads[2]!, task], ALL_ON);
    expect(items.map((item) => item.kind)).toEqual(["row", "row", "group", "row"]);
  });

  it("空输入 → 空列表", () => {
    expect(groupToolRows([], ALL_ON)).toEqual([]);
  });
});

describe("streamDisplayFromSettings", () => {
  it("缺省设置 → 产品默认：思考/todo 开，explore/terminal 分组开，changes 分组关", () => {
    expect(streamDisplayFromSettings(null)).toEqual({
      aggregateResponse: false,
      showThinking: true,
      showTodos: true,
      grouping: { explore: true, terminal: true, changes: false },
    });
    expect(streamDisplayFromSettings(undefined)).toEqual({
      aggregateResponse: false,
      showThinking: true,
      showTodos: true,
      grouping: { explore: true, terminal: true, changes: false },
    });
  });

  it("显式关闭逐项生效", () => {
    const settings = {
      showThinking: false,
      showTodos: false,
      groupExploreTools: false,
      groupTerminalCommands: false,
      groupFileChanges: true,
    } as HarnessSettings;
    expect(streamDisplayFromSettings(settings)).toEqual({
      aggregateResponse: false,
      showThinking: false,
      showTodos: false,
      grouping: { explore: false, terminal: false, changes: true },
    });
  });
});
