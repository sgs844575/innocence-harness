// Queue/steer lanes of HarnessRuntime.send: a send targeting a busy route
// never starts a second concurrent run — queue mode parks it in the per-route
// FIFO (auto-started at run settle), steer mode parks it in the running
// loop's mailbox (mid-run injection; remainder → queued follow-up).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createMockProvider, type MockTurn } from "@innocenceharness/provider-mock";
import { FsPlugin } from "@innocenceharness/tools-fs";
import { ShellPlugin } from "@innocenceharness/tools-shell";
import type { ChatRequest } from "@innocenceharness/harness-providers";
import {
  DEFAULT_SETTINGS,
  HarnessRuntime,
  staticSpineSuite,
  type AskResponse,
  type HarnessSettings,
  type RuntimeHooks,
  type RuntimeOptions,
  type RuntimeSendDisposition,
  type RuntimeSendRequest,
} from "../src";

let persistDir: string;
let workspace: string;

beforeAll(async () => {
  persistDir = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-q-"));
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "innocence-qws-"));
});

afterAll(async () => {
  await fs.rm(persistDir, { recursive: true, force: true });
  await fs.rm(workspace, { recursive: true, force: true });
});

interface Recorded {
  deltas: string[];
  completions: Array<{ messageId: string; completion: { finishReason: string; aborted: boolean } }>;
  errors: Array<{ messageId: string; error: string }>;
}

const emptyRecorded = (): Recorded => ({ deltas: [], completions: [], errors: [] });

function makeHooks(recorded: Recorded): RuntimeHooks {
  return {
    onDelta: (_s, _m, delta) => recorded.deltas.push(delta),
    onTool: () => {},
    onThinking: () => {},
    onCompleted: (_sessionId, messageId, completion) => {
      recorded.completions.push({
        messageId,
        completion: { finishReason: completion.finishReason, aborted: completion.aborted },
      });
    },
    onError: (_s, messageId, error) => recorded.errors.push({ messageId, error }),
    askPermission: async (): Promise<AskResponse> => "allow",
    log: () => {},
  };
}

function makeRuntime(
  turns: MockTurn[],
  recorded: Recorded,
  providerOptions: { chunkSize?: number; delayMs?: number } = {},
  onChat?: (req: ChatRequest) => void,
): HarnessRuntime {
  const settings: HarnessSettings = { ...DEFAULT_SETTINGS, workspaceRoot: workspace };
  const options: RuntimeOptions = {
    settings: () => settings,
    hooks: makeHooks(recorded),
    persistDir,
    providerFactory: () => createMockProvider({ turns, ...providerOptions, onChat }),
    pluginsForSession: () => [FsPlugin, ShellPlugin],
    sessionSpine: () => staticSpineSuite(),
  };
  return new HarnessRuntime(options);
}

function send(
  runtime: HarnessRuntime,
  sessionId: string,
  text: string,
  messageId: string,
  interactionMode?: RuntimeSendRequest["interactionMode"],
  dispositions?: RuntimeSendDisposition[],
): Promise<void> {
  return runtime.send({
    sessionId,
    taskId: "",
    routeId: "main",
    text,
    messageId,
    ...(interactionMode ? { interactionMode } : {}),
    ...(dispositions ? { onDisposition: (d) => dispositions.push(d) } : {}),
  });
}

/** Extracts the per-chat-call message text transcript from a mock onChat hook. */
const textOf = (req: ChatRequest) =>
  req.messages.map((m) => m.parts.filter((p) => p.type === "text").map((p) => p.text).join(""));

describe("HarnessRuntime queue lane", () => {
  it("parks mid-run sends in a per-route FIFO and auto-starts them in order", async () => {
    const recorded = emptyRecorded();
    const requests: string[][] = [];
    const dispositions: Record<string, RuntimeSendDisposition[]> = { m1: [], m2: [], m3: [] };
    const runtime = makeRuntime(
      [{ text: "答一" }, { text: "答二" }, { text: "答三" }],
      recorded,
      { chunkSize: 2, delayMs: 2 },
      (req) => requests.push(textOf(req)),
    );

    const first = send(runtime, "q-1", "问一", "m1", "queue", dispositions.m1);
    const second = send(runtime, "q-1", "问二", "m2", "queue", dispositions.m2);
    const third = send(runtime, "q-1", "问三", "m3", "queue", dispositions.m3);
    // 全程忙闲面无空档：排队期间路由始终 running。
    expect(runtime.isRouteRunning("q-1")).toBe(true);
    await Promise.all([first, second, third]);
    expect(runtime.isRouteRunning("q-1")).toBe(false);

    expect(dispositions.m1).toEqual(["started"]);
    expect(dispositions.m2).toEqual(["queued", "started"]);
    expect(dispositions.m3).toEqual(["queued", "started"]);
    // FIFO：三轮按序完成，模型上下文逐轮累积（同一 AgentSession 历史）。
    expect(recorded.completions.map((c) => c.messageId)).toEqual(["m1", "m2", "m3"]);
    expect(recorded.completions.every((c) => c.completion.finishReason === "stop")).toBe(true);
    expect(requests).toHaveLength(3);
    expect(requests[1]).toEqual(["问一", "答一", "问二"]);
    expect(requests[2]).toEqual(["问一", "答一", "问二", "答二", "问三"]);
    expect(recorded.errors).toEqual([]);
    await runtime.disposeAll();
  });

  it("absent interactionMode normalizes to queue", async () => {
    const recorded = emptyRecorded();
    const dispositions: RuntimeSendDisposition[] = [];
    const runtime = makeRuntime([{ text: "答一" }, { text: "答二" }], recorded, { chunkSize: 2, delayMs: 2 });

    const first = send(runtime, "q-default", "问一", "m1");
    const second = send(runtime, "q-default", "问二", "m2", undefined, dispositions);
    await Promise.all([first, second]);

    expect(dispositions).toEqual(["queued", "started"]);
    expect(recorded.completions.map((c) => c.messageId)).toEqual(["m1", "m2"]);
    await runtime.disposeAll();
  });

  it("stop() aborts the current turn; the queued send still runs afterwards", async () => {
    const recorded = emptyRecorded();
    let firstDelta!: () => void;
    const deltaSeen = new Promise<void>((resolve) => (firstDelta = resolve));
    const runtime = new HarnessRuntime({
      settings: () => ({ ...DEFAULT_SETTINGS, workspaceRoot: workspace }),
      hooks: {
        ...makeHooks(recorded),
        onDelta: (_s, _m, delta) => {
          recorded.deltas.push(delta);
          firstDelta();
        },
      },
      persistDir,
      providerFactory: () => createMockProvider({ turns: [{ text: "a long answer to stop" }, { text: "答二" }], chunkSize: 1, delayMs: 3 }),
      pluginsForSession: () => [FsPlugin, ShellPlugin],
      sessionSpine: () => staticSpineSuite(),
    });

    const first = send(runtime, "q-stop", "问一", "m1");
    await deltaSeen;
    const second = send(runtime, "q-stop", "问二", "m2", "queue");
    runtime.stop("q-stop", "main");
    await Promise.all([first, second]);

    // 选择：stop 只停当前轮；排队的用户消息是明确意图，随后照常运行。
    expect(recorded.completions.map((c) => [c.messageId, c.completion.finishReason])).toEqual([
      ["m1", "aborted"],
      ["m2", "stop"],
    ]);
    expect(recorded.deltas.join("")).toContain("答二");
    await runtime.disposeAll();
  });

  it("dispose drops queued sends with the disposed-route error and never runs them", async () => {
    const recorded = emptyRecorded();
    let chatCalls = 0;
    let firstDelta!: () => void;
    const deltaSeen = new Promise<void>((resolve) => (firstDelta = resolve));
    const runtime = new HarnessRuntime({
      settings: () => ({ ...DEFAULT_SETTINGS, workspaceRoot: workspace }),
      hooks: {
        ...makeHooks(recorded),
        onDelta: (_s, _m, delta) => {
          recorded.deltas.push(delta);
          firstDelta();
        },
      },
      persistDir,
      providerFactory: () =>
        createMockProvider({
          turns: [{ text: "a long answer" }, { text: "答二" }],
          chunkSize: 1,
          delayMs: 3,
          onChat: () => {
            chatCalls += 1;
          },
        }),
      pluginsForSession: () => [FsPlugin, ShellPlugin],
      sessionSpine: () => staticSpineSuite(),
    });

    const first = send(runtime, "q-dispose", "问一", "m1");
    // 等首轮真正开跑（构建落定、模型流出首个 delta）再排队与释放。
    await deltaSeen;
    const second = send(runtime, "q-dispose", "问二", "m2", "queue");
    await runtime.dispose("q-dispose");
    await Promise.all([first, second]);

    expect(chatCalls).toBe(1); // m2 从未开跑
    expect(recorded.completions.map((c) => c.messageId)).toEqual(["m1"]);
    expect(recorded.errors).toHaveLength(1);
    expect(recorded.errors[0].messageId).toBe("m2");
    expect(recorded.errors[0].error).toContain("会话已释放");
    await runtime.disposeAll();
  });
});

describe("HarnessRuntime steer lane", () => {
  it("injects a mid-run send into the running turn (single completion, no second turn)", async () => {
    const recorded = emptyRecorded();
    const requests: string[][] = [];
    const dispositions: RuntimeSendDisposition[] = [];
    const runtime = makeRuntime(
      [{ text: "答一" }],
      recorded,
      { chunkSize: 2, delayMs: 2 },
      (req) => requests.push(textOf(req)),
    );

    const first = send(runtime, "s-1", "问一", "m1");
    const second = send(runtime, "s-1", "引导补充", "m2", "steer", dispositions);
    await Promise.all([first, second]);

    expect(dispositions).toEqual(["steered"]);
    // 引导消息并入在跑回合：首个模型请求即带两条用户文本，整轮只完成一次。
    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual(["问一", "引导补充"]);
    expect(recorded.completions.map((c) => c.messageId)).toEqual(["m1"]);
    expect(recorded.errors).toEqual([]);
    await runtime.disposeAll();
  });

  it("upgrades an undrained steer input to a queued follow-up run at settle", async () => {
    const recorded = emptyRecorded();
    const requests: string[][] = [];
    const dispositions: RuntimeSendDisposition[] = [];
    let firstDelta!: () => void;
    const deltaSeen = new Promise<void>((resolve) => (firstDelta = resolve));
    const runtime = new HarnessRuntime({
      settings: () => ({ ...DEFAULT_SETTINGS, workspaceRoot: workspace }),
      hooks: {
        ...makeHooks(recorded),
        onDelta: (_s, _m, delta) => {
          recorded.deltas.push(delta);
          firstDelta();
        },
      },
      persistDir,
      providerFactory: () =>
        createMockProvider({
          turns: [{ text: "答一" }, { text: "答二" }],
          chunkSize: 1,
          delayMs: 3,
          onChat: (req) => requests.push(textOf(req)),
        }),
      pluginsForSession: () => [FsPlugin, ShellPlugin],
      sessionSpine: () => staticSpineSuite(),
    });

    const first = send(runtime, "s-late", "问一", "m1");
    // 等首个 delta：循环已越过首轮轮顶（唯一的 drain 点），此时泊入的引导
    // 在本轮内不再被消费。
    await deltaSeen;
    const second = send(runtime, "s-late", "迟到的引导", "m2", "steer", dispositions);
    await Promise.all([first, second]);

    // steered → 运行结束未消费 → 升级 queued → 作为独立后续轮跑完（started）。
    expect(dispositions).toEqual(["steered", "queued", "started"]);
    expect(recorded.completions.map((c) => c.messageId)).toEqual(["m1", "m2"]);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(["问一", "答一", "迟到的引导"]);
    expect(recorded.errors).toEqual([]);
    await runtime.disposeAll();
  });

  it("dispose drops a parked steer input with the disposed-route error", async () => {
    const recorded = emptyRecorded();
    let firstDelta!: () => void;
    const deltaSeen = new Promise<void>((resolve) => (firstDelta = resolve));
    const runtime = new HarnessRuntime({
      settings: () => ({ ...DEFAULT_SETTINGS, workspaceRoot: workspace }),
      hooks: {
        ...makeHooks(recorded),
        onDelta: (_s, _m, delta) => {
          recorded.deltas.push(delta);
          firstDelta();
        },
      },
      persistDir,
      providerFactory: () =>
        createMockProvider({ turns: [{ text: "a long answer" }], chunkSize: 1, delayMs: 5 }),
      pluginsForSession: () => [FsPlugin, ShellPlugin],
      sessionSpine: () => staticSpineSuite(),
    });

    const first = send(runtime, "s-dispose", "问一", "m1");
    await deltaSeen;
    const second = send(runtime, "s-dispose", "被丢弃的引导", "m2", "steer");
    await runtime.dispose("s-dispose");
    await Promise.all([first, second]);

    expect(recorded.errors).toHaveLength(1);
    expect(recorded.errors[0].messageId).toBe("m2");
    expect(recorded.errors[0].error).toContain("会话已释放");
    await runtime.disposeAll();
  });
});
