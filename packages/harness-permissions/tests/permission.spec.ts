import { describe, expect, it } from "vitest";
import {
  PermissionEngine,
  resourceGrantKey,
  type AskResponse,
  type PermissionAuditEntry,
  type PermissionClassificationInput,
  type PermissionClassifier,
  type PermissionRequest,
  type PolicyRule,
} from "@innocenceharness/harness-permissions";

function request(
  toolName: string,
  action: string,
  scope: string,
  kind = "path",
  args: Record<string, unknown> = {},
): PermissionRequest {
  return { toolName, resource: { action, kind, scope }, args };
}

function recordingDecider(answer: AskResponse) {
  const requests: PermissionRequest[] = [];
  return {
    requests,
    decider: {
      ask: async (req: PermissionRequest) => {
        requests.push(req);
        return answer;
      },
    },
  };
}

const readReq = request("Read", "read", "src/a.ts");
const editReq = request("Edit", "write", "src/a.ts", "path", { path: "src/a.ts" });
const bashReq = request("Bash", "execute", "npm", "command", { command: "npm" });
const write = { readOnly: false, sideEffect: "paths" as const };
const read = { readOnly: true, sideEffect: "none" as const };

describe("resourceGrantKey", () => {
  it("joins tool name and canonical resource fields with \\u0000", () => {
    expect(resourceGrantKey("Write", { action: "write", kind: "path", scope: "src/a.ts" })).toBe(
      "Write\u0000write\u0000path\u0000src/a.ts",
    );
    expect(resourceGrantKey("Bash", { action: "execute", kind: "command", scope: "npm" })).toBe(
      "Bash\u0000execute\u0000command\u0000npm",
    );
  });

  it("distinguishes actions and kinds on the same scope", () => {
    const a = resourceGrantKey("T", { action: "read", kind: "path", scope: "x" });
    const b = resourceGrantKey("T", { action: "write", kind: "path", scope: "x" });
    const c = resourceGrantKey("T", { action: "read", kind: "url", scope: "x" });
    expect(new Set([a, b, c]).size).toBe(3);
  });
});

describe("PermissionEngine pipeline", () => {
  it("deny rules win over everything, including auto mode", async () => {
    const { decider } = recordingDecider("allow");
    const engine = new PermissionEngine({ mode: "auto", decider });
    engine.addRules([
      { name: "deny:Edit(src/**)", match: (c) => (c.toolName === "Edit" ? "deny" : "skip") },
      { name: "allow:Edit", match: (c) => (c.toolName === "Edit" ? "allow" : "skip") },
    ]);
    const r = await engine.resolve(editReq, write);
    expect(r.decision).toBe("deny");
    expect(r.via).toBe("denyRule");
  });

  it("full mode (完全访问) bypasses even deny rules without asking", async () => {
    const { decider, requests } = recordingDecider("deny");
    const engine = new PermissionEngine({ mode: "full", decider });
    engine.addRules([
      { name: "deny:Edit(src/**)", match: (c) => (c.toolName === "Edit" ? "deny" : "skip") },
    ]);
    const r = await engine.resolve(editReq, write);
    expect(r.decision).toBe("allow");
    expect(r.via).toBe("fullMode");
    expect(requests).toHaveLength(0); // 不弹任何询问
  });

  it("plan mode auto-allows readOnly (planReadOnly) without asking and denies writes (planMode)", async () => {
    const { decider, requests } = recordingDecider("deny");
    const engine = new PermissionEngine({ mode: "plan", decider });
    const r = await engine.resolve(readReq, read);
    expect(r.decision).toBe("allow");
    expect(r.via).toBe("planReadOnly");
    expect(requests).toHaveLength(0); // 只读探索自由：不弹 decider
    const w = await engine.resolve(editReq, write);
    expect(w.decision).toBe("deny");
    expect(w.via).toBe("planMode");
    expect(requests).toHaveLength(0);
  });

  it("plan mode deny rules still win over the planReadOnly short-circuit", async () => {
    const { decider, requests } = recordingDecider("allow");
    const engine = new PermissionEngine({ mode: "plan", decider });
    engine.addRules([
      { name: "deny:Read(src/**)", match: (c) => (c.toolName === "Read" ? "deny" : "skip") },
    ]);
    const r = await engine.resolve(readReq, read);
    expect(r.decision).toBe("deny");
    expect(r.via).toBe("denyRule");
    expect(requests).toHaveLength(0);
  });

  it("readOnly tools still ask in ask mode — planReadOnly only applies to plan mode", async () => {
    const { decider, requests } = recordingDecider("deny");
    const engine = new PermissionEngine({ mode: "ask", decider });
    const r = await engine.resolve(readReq, read);
    expect(r.decision).toBe("deny");
    expect(r.via).toBe("ask");
    expect(requests).toHaveLength(1);
  });

  it("allow rules admit calls in ask mode without asking", async () => {
    const { decider, requests } = recordingDecider("deny");
    const engine = new PermissionEngine({ mode: "ask", decider });
    engine.addRules([
      { name: "allow:Bash(npm)", match: () => "allow" } as PolicyRule,
    ]);
    const r = await engine.resolve(bashReq, { readOnly: false, sideEffect: "process" });
    expect(r.decision).toBe("allow");
    expect(r.via).toBe("allowRule");
    expect(requests).toHaveLength(0);
  });

  it("auto mode allows without asking", async () => {
    const { decider, requests } = recordingDecider("deny");
    const engine = new PermissionEngine({ mode: "auto", decider });
    expect((await engine.resolve(editReq, write)).via).toBe("autoMode");
    expect(requests).toHaveLength(0);
  });

  it("ask mode consults decider; allowSession writes a subcommand-granular resource grant", async () => {
    const { decider, requests } = recordingDecider("allowSession");
    const engine = new PermissionEngine({ mode: "ask", decider });
    const bash = (summary: string) => request("Bash", "execute", summary, "command", { command: summary });
    const first = await engine.resolve(bash("npm test"), { readOnly: false, sideEffect: "process" });
    expect(first.decision).toBe("allow");
    expect(first.via).toBe("ask");
    expect(requests).toHaveLength(1);

    // The same canonical summary (flags never enter it) reuses the grant.
    const second = await engine.resolve(bash("npm test"), { readOnly: false, sideEffect: "process" });
    expect(second.via).toBe("sessionGrant");
    expect(requests).toHaveLength(1);

    // A different subcommand under the same program must NOT ride the grant:
    // allowing `npm test` never admits `npm publish`.
    const third = await engine.resolve(bash("npm publish"), { readOnly: false, sideEffect: "process" });
    expect(third.via).toBe("ask");
    expect(third.decision).toBe("allow");
    expect(requests).toHaveLength(2);
    expect(requests.map((r) => r.resource.scope)).toEqual(["npm test", "npm publish"]);
  });

  it("does not reuse a session grant for another resource", async () => {
    const asked: string[] = [];
    const engine = new PermissionEngine({
      mode: "ask",
      decider: {
        ask: async (req) => {
          asked.push(req.resource.scope);
          return "allowSession";
        },
      },
    });

    await engine.resolve(request("Write", "write", "src/a.ts"), { readOnly: false, sideEffect: "paths" });
    await engine.resolve(request("Write", "write", "src/b.ts"), { readOnly: false, sideEffect: "paths" });

    expect(asked).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("decider deny denies", async () => {
    const { decider } = recordingDecider("deny");
    const engine = new PermissionEngine({ mode: "ask", decider });
    expect((await engine.resolve(bashReq, { readOnly: false, sideEffect: "process" })).decision).toBe("deny");
  });

  it("runs hard resource validation in full mode", async () => {
    const engine = new PermissionEngine({
      mode: "full",
      decider: { ask: async () => "allow" },
      validateResource: async () => {
        throw new Error("blocked resource");
      },
    });

    await expect(
      engine.resolve(request("BrowserNavigate", "navigate", "file:///secret", "url"), {
        readOnly: false,
        sideEffect: "unknown",
      }),
    ).rejects.toThrow("blocked resource");
  });

  it("runs hard resource validation in ask mode too (fail-closed)", async () => {
    const { decider, requests } = recordingDecider("allow");
    const engine = new PermissionEngine({
      mode: "ask",
      decider,
      validateResource: (resource) => {
        if (resource.kind === "url") throw new Error("blocked resource");
      },
    });

    await expect(
      engine.resolve(request("BrowserNavigate", "navigate", "file:///secret", "url"), {
        readOnly: false,
        sideEffect: "unknown",
      }),
    ).rejects.toThrow("blocked resource");
    expect(requests).toHaveLength(0); // never reached the ask stage
  });

  it("audits validateResource rejections as a deny before rethrowing", async () => {
    const entries: PermissionAuditEntry[] = [];
    const engine = new PermissionEngine({
      mode: "ask",
      decider: { ask: async () => "allow" },
      validateResource: () => {
        throw new Error("blocked resource");
      },
      audit: (entry) => entries.push(entry),
    });

    await expect(
      engine.resolve(request("BrowserNavigate", "navigate", "file:///secret", "url"), {
        readOnly: false,
        sideEffect: "unknown",
      }),
    ).rejects.toThrow("blocked resource");

    // Exactly one ledger entry for the rejected gate — decision deny, via validateResource.
    expect(entries).toHaveLength(1);
    expect(entries[0]!.resolution).toEqual({
      decision: "deny",
      via: "validateResource",
      reason: "blocked resource",
    });
    expect(entries[0]!.request.resource.scope).toBe("file:///secret");
    expect(entries[0]!.tool).toEqual({ readOnly: false, sideEffect: "unknown" });
  });

  it("audits every resolution, including full mode", async () => {
    const entries: PermissionAuditEntry[] = [];
    const engine = new PermissionEngine({
      mode: "full",
      decider: { ask: async () => "deny" },
      audit: (entry) => entries.push(entry),
    });
    const resolution = await engine.resolve(editReq, write);
    expect(resolution.via).toBe("fullMode");
    expect(entries).toHaveLength(1);
    expect(entries[0].mode).toBe("full");
    expect(entries[0].resolution).toEqual(resolution);
    expect(entries[0].request.resource.scope).toBe("src/a.ts");
    expect(entries[0].tool).toEqual({ readOnly: false, sideEffect: "paths" });
  });

  it("audits ask-mode decisions with the persisted request", async () => {
    const entries: PermissionAuditEntry[] = [];
    const engine = new PermissionEngine({
      mode: "ask",
      decider: { ask: async () => "deny" },
      audit: (entry) => entries.push(entry),
    });
    await engine.resolve(editReq, write);
    expect(entries).toHaveLength(1);
    expect(entries[0].request.args).toEqual({ path: "src/a.ts" });
    expect(entries[0].resolution.decision).toBe("deny");
  });
});

describe("PermissionEngine plan approval (approvePlan)", () => {
  it("unapproved plan mode: writes denied via planMode, readOnly allowed via planReadOnly", async () => {
    const { decider, requests } = recordingDecider("deny");
    const engine = new PermissionEngine({ mode: "plan", decider });
    const w = await engine.resolve(editReq, write);
    expect(w.decision).toBe("deny");
    expect(w.via).toBe("planMode");
    const r = await engine.resolve(readReq, read);
    expect(r.decision).toBe("allow");
    expect(r.via).toBe("planReadOnly");
    expect(requests).toHaveLength(0);
  });

  it("approvePlan() sends writes back through the regular pipeline to ask", async () => {
    const { decider, requests } = recordingDecider("allow");
    const engine = new PermissionEngine({ mode: "plan", decider });
    expect((await engine.resolve(editReq, write)).via).toBe("planMode"); // 未批准先硬拒
    engine.approvePlan();
    const w = await engine.resolve(editReq, write);
    expect(w.decision).toBe("allow");
    expect(w.via).toBe("ask"); // 不再 deny planMode，落回常规管线末端的 ask
    expect(requests).toHaveLength(1);
  });

  it("approved plan mode resumes the regular pipeline at allow rules", async () => {
    const { decider, requests } = recordingDecider("deny");
    const engine = new PermissionEngine({ mode: "plan", decider });
    engine.addRules([
      { name: "allow:Edit", match: (c) => (c.toolName === "Edit" ? "allow" : "skip") },
    ]);
    engine.approvePlan();
    const w = await engine.resolve(editReq, write);
    expect(w.decision).toBe("allow");
    expect(w.via).toBe("allowRule"); // 常规管线从 allow 规则处恢复，未到 ask
    expect(requests).toHaveLength(0);
  });

  it("setMode() resets planApproved — re-entering plan re-arms the write deny", async () => {
    const { decider, requests } = recordingDecider("allow");
    const engine = new PermissionEngine({ mode: "plan", decider });
    engine.approvePlan();
    const approved = await engine.resolve(editReq, write);
    expect(approved.via).toBe("ask"); // 批准后走 ask
    engine.setMode("ask");
    engine.setMode("plan");
    const w = await engine.resolve(editReq, write);
    expect(w.decision).toBe("deny");
    expect(w.via).toBe("planMode"); // 批准态已复位，写操作重新硬拒
    expect(requests).toHaveLength(1); // 第二次未再到达 ask
  });

  it("approvePlan() outside plan mode is a no-op (cannot pre-arm a cross-mode unlock)", async () => {
    const { decider, requests } = recordingDecider("allow");
    const engine = new PermissionEngine({ mode: "ask", decider });
    engine.approvePlan(); // ask 档调用：无操作，不置位
    engine.setMode("plan");
    const w = await engine.resolve(editReq, write);
    expect(w.decision).toBe("deny");
    expect(w.via).toBe("planMode");
    expect(requests).toHaveLength(0);
  });
});

describe("PermissionEngine plan-kind approval channel", () => {
  // 计划提交资源（引擎特例的批准通道本身）：与实际 plan_submit 工具同形。
  const planReq = request("plan_submit", "submit", "session", "plan");

  it("unapproved plan mode routes plan-kind resources straight to ask (the approval face)", async () => {
    const { decider, requests } = recordingDecider("allow");
    const engine = new PermissionEngine({ mode: "plan", decider });
    const r = await engine.resolve(planReq, read);
    expect(r.decision).toBe("allow");
    expect(r.via).toBe("ask");
    expect(requests).toHaveLength(1); // decider 被调：plan 档内提交即询问
  });

  it("a denied submission ask leaves the plan state untouched (writes still planMode-deny)", async () => {
    const { decider, requests } = recordingDecider("deny");
    const engine = new PermissionEngine({ mode: "plan", decider });
    const r = await engine.resolve(planReq, read);
    expect(r.decision).toBe("deny");
    expect(r.via).toBe("ask");
    const w = await engine.resolve(editReq, write);
    expect(w.decision).toBe("deny");
    expect(w.via).toBe("planMode"); // 被拒的提交不解锁任何写操作
    expect(requests).toHaveLength(1);
  });

  it("plan-kind routing changes nothing for other resources (readOnly allow / write deny)", async () => {
    const { decider, requests } = recordingDecider("deny");
    const engine = new PermissionEngine({ mode: "plan", decider });
    expect((await engine.resolve(readReq, read)).via).toBe("planReadOnly");
    expect((await engine.resolve(editReq, write)).via).toBe("planMode");
    expect(requests).toHaveLength(0);
  });

  it("deny rules still precede the plan-kind channel (stage order preserved)", async () => {
    const { decider, requests } = recordingDecider("allow");
    const engine = new PermissionEngine({ mode: "plan", decider });
    engine.addRules([
      { name: "deny:plan_submit", match: (c) => (c.toolName === "plan_submit" ? "deny" : "skip") },
    ]);
    const r = await engine.resolve(planReq, read);
    expect(r.decision).toBe("deny");
    expect(r.via).toBe("denyRule");
    expect(requests).toHaveLength(0);
  });

  it("outside plan mode plan-kind resources just follow the regular pipeline", async () => {
    const { decider, requests } = recordingDecider("deny");
    const engine = new PermissionEngine({ mode: "ask", decider });
    const r = await engine.resolve(planReq, read);
    expect(r.decision).toBe("deny");
    expect(r.via).toBe("ask");
    expect(requests).toHaveLength(1);
  });
});

describe("PermissionEngine path normalization", () => {
  it("absolute paths under the root become relative for rule matching", async () => {
    const { decider } = recordingDecider("deny");
    const engine = new PermissionEngine({
      mode: "ask",
      decider,
      workspaceRoot: "D:/work/proj",
    });
    engine.addRules([
      {
        name: "allow:Edit(src/**)",
        match: (c) =>
          c.toolName === "Edit" &&
          typeof c.args.path === "string" &&
          c.args.path.startsWith("src/")
            ? "allow"
            : "skip",
      },
    ]);
    const r = await engine.resolve(
      request("Edit", "write", "src/a.ts", "path", { path: "D:\\work\\proj\\src\\a.ts" }),
      write,
    );
    expect(r.decision).toBe("allow");
    expect(r.via).toBe("allowRule");
  });
});

describe("PermissionEngine ask-boundary classifier (S3)", () => {
  it("classifier allow resolves without surfacing the ask; via classifier with its reason", async () => {
    const { decider } = recordingDecider("allow");
    const seen: PermissionClassificationInput[] = [];
    const classifier: PermissionClassifier = {
      classify: async (input) => {
        seen.push(input);
        return { decision: "allow", reason: "clearly safe read" };
      },
    };
    const engine = new PermissionEngine({ mode: "ask", decider, classifier });
    const r = await engine.resolve(readReq, read);
    expect(r).toMatchObject({ decision: "allow", via: "classifier", reason: "clearly safe read" });
    expect(seen).toHaveLength(1);
    // 分类器看到的就是持久化面：与审计/规则同一份请求（无原始参数）。
    expect(seen[0].request).toEqual(readReq);
  });

  it("deny verdict denies; ask/undefined verdicts escalate to the human", async () => {
    const { decider, requests } = recordingDecider("deny");
    const engine = new PermissionEngine({
      mode: "ask",
      decider,
      classifier: { classify: async () => ({ decision: "deny", reason: "destructive" }) },
    });
    const denied = await engine.resolve(editReq, write);
    expect(denied).toMatchObject({ decision: "deny", via: "classifier", reason: "destructive" });
    expect(requests).toHaveLength(0);

    const escalatedEngine = new PermissionEngine({
      mode: "ask",
      decider: recordingDecider("deny").decider,
      classifier: { classify: async () => ({ decision: "ask", reason: "borderline" }) },
    });
    expect(await escalatedEngine.resolve(editReq, write)).toMatchObject({ decision: "deny", via: "ask" });

    const noOpinionEngine = new PermissionEngine({
      mode: "ask",
      decider: recordingDecider("allow").decider,
      classifier: { classify: async () => undefined },
    });
    expect(await noOpinionEngine.resolve(editReq, write)).toMatchObject({ decision: "allow", via: "ask" });
  });

  it("classifier failure is swallowed and escalates to the human (fail-closed)", async () => {
    const { decider, requests } = recordingDecider("deny");
    const engine = new PermissionEngine({
      mode: "ask",
      decider,
      classifier: {
        classify: async () => {
          throw new Error("provider down");
        },
      },
    });
    const r = await engine.resolve(editReq, write);
    expect(r).toMatchObject({ decision: "deny", via: "ask" });
    expect(requests).toHaveLength(1);
  });

  it("static rules keep priority: deny rules, allow rules and auto mode never reach the classifier", async () => {
    let calls = 0;
    const classifier: PermissionClassifier = {
      classify: async () => {
        calls += 1;
        return { decision: "allow", reason: "should not matter" };
      },
    };
    const engine = new PermissionEngine({ mode: "auto", decider: recordingDecider("deny").decider, classifier });
    engine.addRules([
      { name: "deny:Edit(src/**)", match: (c) => (c.toolName === "Edit" ? "deny" : "skip") },
    ]);
    expect(await engine.resolve(editReq, write)).toMatchObject({ decision: "deny", via: "denyRule" });
    expect(await engine.resolve(readReq, read)).toMatchObject({ decision: "allow", via: "autoMode" });
    expect(calls).toBe(0);
  });

  it("recent deny resolutions are surfaced to the classifier, bounded to the ring limit", async () => {
    const seen: PermissionClassificationInput[] = [];
    const classifier: PermissionClassifier = {
      classify: async (input) => {
        seen.push(input);
        return undefined;
      },
    };
    const engine = new PermissionEngine({ mode: "ask", decider: recordingDecider("deny").decider, classifier });
    engine.addRules([{ name: "deny:Bash", match: (c) => (c.toolName === "Bash" ? "deny" : "skip") }]);
    for (let i = 0; i < 10; i += 1) {
      await engine.resolve(request("Bash", "execute", `cmd${i}`, "command", { command: `cmd${i}` }), write);
    }
    await engine.resolve(editReq, write);
    expect(seen).toHaveLength(1);
    const ring = seen[0].recentDenials;
    expect(ring).toHaveLength(8);
    expect(ring[0].resource.scope).toBe("cmd2");
    expect(ring[7].resource.scope).toBe("cmd9");
    expect(ring[7]).toMatchObject({ toolName: "Bash", via: "denyRule" });
  });

  it("classifier denials and user denials both feed the denial ring", async () => {
    const seen: PermissionClassificationInput[] = [];
    const classifier: PermissionClassifier = {
      classify: async (input) => {
        seen.push(input);
        return { decision: "deny", reason: "circumvention attempt" };
      },
    };
    const engine = new PermissionEngine({ mode: "ask", decider: recordingDecider("deny").decider, classifier });
    await engine.resolve(editReq, write);
    await engine.resolve(readReq, read);
    expect(seen).toHaveLength(2);
    expect(seen[1].recentDenials[0]).toMatchObject({ via: "classifier", reason: "circumvention attempt" });
  });

  it("validateResource rejections feed the denial ring too", async () => {
    const seen: PermissionClassificationInput[] = [];
    const classifier: PermissionClassifier = {
      classify: async (input) => {
        seen.push(input);
        return undefined;
      },
    };
    const engine = new PermissionEngine({
      mode: "ask",
      decider: recordingDecider("allow").decider,
      classifier,
      validateResource: (resource) => {
        if (resource.kind === "url") throw new Error("blocked host");
      },
    });
    await expect(
      engine.resolve(request("WebFetch", "navigate", "https://blocked", "url", {}), read),
    ).rejects.toThrow("blocked host");
    await engine.resolve(editReq, write);
    expect(seen).toHaveLength(1);
    expect(seen[0].recentDenials[0]).toMatchObject({ toolName: "WebFetch", via: "validateResource" });
  });
});
