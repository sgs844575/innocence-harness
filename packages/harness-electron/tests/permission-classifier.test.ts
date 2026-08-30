import { describe, expect, it } from "vitest";
import type { PermissionVerdictService, PermissionVerdictSubject } from "@innocenceharness/harness-ai-runtime";
import { PermissionEngine, type PermissionClassificationInput } from "@innocenceharness/harness-permissions";
import { createPermissionClassifier } from "../src/permission-classifier";

function input(toolName = "Bash", scope = "cmd", args: Record<string, unknown> = { command: scope }): PermissionClassificationInput {
  return {
    request: { toolName, resource: { action: "execute", kind: "command", scope }, args },
    tool: { readOnly: false, sideEffect: "process" },
    recentDenials: [],
  };
}

function verdictService(
  behavior: (subject: PermissionVerdictSubject) => Promise<{ decision: "allow" | "deny" | "ask"; reason: string }>,
) {
  const subjects: PermissionVerdictSubject[] = [];
  const service: PermissionVerdictService = {
    classify: async (req) => {
      subjects.push(req.subject);
      return { verdict: await behavior(req.subject), metadata: {} as never };
    },
  };
  return { service, subjects };
}

const lazyModel = async () => ({}) as never;

describe("permission verdict classifier adapter (S3)", () => {
  it("maps verdicts onto classifications with reason passthrough", async () => {
    const { service } = verdictService(async () => ({ decision: "deny", reason: "circumvention" }));
    const classifier = createPermissionClassifier({ model: lazyModel, verdictService: service });
    expect(await classifier.classify(input())).toEqual({ decision: "deny", reason: "circumvention" });
  });

  it("service failure resolves to undefined (fail-closed to the human ask)", async () => {
    const { service } = verdictService(async () => {
      throw new Error("provider down");
    });
    const logs: string[] = [];
    const classifier = createPermissionClassifier({
      model: lazyModel,
      verdictService: service,
      log: (_level, msg) => logs.push(msg),
    });
    expect(await classifier.classify(input())).toBeUndefined();
    expect(logs.length).toBeGreaterThan(0);
  });

  it("slow verdicts hit the bounded timeout and escalate", async () => {
    const { service } = verdictService(
      () => new Promise((resolve) => setTimeout(() => resolve({ decision: "allow", reason: "late" }), 60)),
    );
    const classifier = createPermissionClassifier({ model: lazyModel, verdictService: service, timeoutMs: 10 });
    expect(await classifier.classify(input())).toBeUndefined();
  });

  it("caches by request signature: identical asks classify once, arg key order does not matter", async () => {
    const { service, subjects } = verdictService(async () => ({ decision: "ask", reason: "borderline" }));
    const classifier = createPermissionClassifier({ model: lazyModel, verdictService: service });
    await classifier.classify(input());
    await classifier.classify(input());
    await classifier.classify(input("Bash", "cmd", { command: "cmd", extra: 1 }));
    await classifier.classify(input("Bash", "cmd", { extra: 1, command: "cmd" }));
    expect(subjects).toHaveLength(2);
  });

  it("evicts oldest signatures beyond the cache limit", async () => {
    const { service, subjects } = verdictService(async (subject) => ({
      decision: "ask" as const,
      reason: subject.resource.scope,
    }));
    const classifier = createPermissionClassifier({ model: lazyModel, verdictService: service });
    for (let i = 0; i < 129; i += 1) {
      await classifier.classify(input("Bash", `cmd${i}`));
    }
    // 129 个不同签名：首个（cmd0）已被挤出 128 上限，再次出现必须重新分类。
    await classifier.classify(input("Bash", "cmd0"));
    expect(subjects).toHaveLength(130);
    // 仍在缓存内的签名不再触发服务调用。
    await classifier.classify(input("Bash", "cmd128"));
    expect(subjects).toHaveLength(130);
  });

  it("failures are not cached: a later working verdict classifies afresh", async () => {
    let fail = true;
    const { service, subjects } = verdictService(async () => {
      if (fail) throw new Error("transient");
      return { decision: "allow", reason: "recovered" };
    });
    const classifier = createPermissionClassifier({ model: lazyModel, verdictService: service });
    expect(await classifier.classify(input())).toBeUndefined();
    fail = false;
    expect(await classifier.classify(input())).toEqual({ decision: "allow", reason: "recovered" });
    expect(subjects).toHaveLength(2);
  });

  it("a replayed ask after a human deny never auto-allows, even with a warm adapter cache", async () => {
    // 复审不变量（涌现语义）：缓存 allow 只可能出现在"分类器已放行"的请求上；
    // 人类拒绝过的请求其缓存条目只能是 ask——回放必须再次回到人类面前。
    let verdictCount = 0;
    const { service } = verdictService(async () => {
      verdictCount += 1;
      return { decision: "ask", reason: "borderline" };
    });
    const classifier = createPermissionClassifier({ model: lazyModel, verdictService: service });
    const deciderRequests: unknown[] = [];
    const engine = new PermissionEngine({
      mode: "ask",
      decider: {
        ask: async (req) => {
          deciderRequests.push(req);
          return "deny";
        },
      },
      classifier,
    });
    const meta = { readOnly: false, sideEffect: "process" as const };
    const first = await engine.resolve(input().request, meta);
    expect(first).toMatchObject({ decision: "deny", via: "ask" });
    // 服务此刻翻脸也想 allow：已缓存的 ask 必须继续升级给人类，不得自动放行。
    const second = await engine.resolve(input().request, meta);
    expect(second).toMatchObject({ decision: "deny", via: "ask" });
    expect(deciderRequests).toHaveLength(2);
    expect(verdictCount).toBe(1); // 第二次走缓存，不再消费一次判定调用
  });
});
