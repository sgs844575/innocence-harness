import { describe, expect, it } from "vitest";
import { parseGitLog, parseRefKinds } from "./workspaceGitGraph";

const SEP = "\x1f";

describe("parseRefKinds", () => {
  it("按 refs 前缀分类；重名时 heads 优先、remotes 垫底", () => {
    const kinds = parseRefKinds(
      ["refs/heads/main", "refs/remotes/origin/main", "refs/tags/v1.0", "refs/heads/feature/login"].join("\n"),
    );
    expect(kinds.get("main")).toBe("branch");
    expect(kinds.get("origin/main")).toBe("remote");
    expect(kinds.get("v1.0")).toBe("tag");
    expect(kinds.get("feature/login")).toBe("branch");
  });
});

describe("parseGitLog", () => {
  it("逐行解析字段；%D 装饰归并 HEAD/tag/远端", () => {
    const kinds = parseRefKinds("refs/heads/main\nrefs/remotes/origin/main\nrefs/tags/v1.0");
    const line = [
      "aaa111bbb222",
      "ccc333 ddd444",
      "Alice",
      "1700000000",
      "feat: 初次提交",
      "HEAD -> main, origin/main, tag: v1.0",
    ].join(SEP);
    const [commit] = parseGitLog(line, kinds);
    expect(commit).toBeTruthy();
    expect(commit!.hash).toBe("aaa111bbb222");
    expect(commit!.parents).toEqual(["ccc333", "ddd444"]);
    expect(commit!.author).toBe("Alice");
    expect(commit!.at).toBe(1700000000);
    expect(commit!.subject).toBe("feat: 初次提交");
    expect(commit!.refs).toEqual([
      { name: "main", kind: "branch" },
      { name: "origin/main", kind: "remote" },
      { name: "v1.0", kind: "tag" },
    ]);
  });

  it("裸 HEAD（分离头）不进引用列表；未知引用按斜杠猜远端", () => {
    const kinds = new Map<string, "branch" | "remote" | "tag">();
    const line = ["eee555", "", "Bob", "1700000100", "chore", "HEAD, upstream/dev"].join(SEP);
    const [commit] = parseGitLog(line, kinds);
    expect(commit!.refs).toEqual([{ name: "upstream/dev", kind: "remote" }]);
    expect(commit!.parents).toEqual([]);
  });

  it("空输出与缺字段行安全跳过", () => {
    expect(parseGitLog("\n\n", new Map())).toEqual([]);
    expect(parseGitLog(`${SEP}${SEP}`, new Map())).toEqual([]);
  });
});
