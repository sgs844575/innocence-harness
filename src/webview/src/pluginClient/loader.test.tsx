// @vitest-environment jsdom
// 插件 client 装载器（loader）：清单过滤（active+client）→ 协议 URL 动态
// import → default(api) 注册；失败隔离（warn 含插件 id 不阻断其余）、无
// default 跳过、同注册表重装载先撤销旧注册；末组为 jsdom 集成——真实示例
// client 模块经 mock importModule 装载后渲染 fake ToolCallPart。
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentType } from "react";
import type { PluginInventoryEntry, ToolCallPart, ToolResultPart } from "../../../shared/ipc";
import { SlotProvider } from "../slots/react";
import { createSlotRegistry, type SlotRegistry } from "../slots/registry";
import { useToolCard, TOOLCARD_SLOT, type ToolCardProps } from "../components/chat/toolcards/registry";
import registerExampleClient from "../../../../packages/plugin-example/src/client";
import { loadPluginClients, type PluginClientModule } from "./loader";
import type { PluginClientApi } from "./api";
import type { ExternalPanelContribution, ExternalSettingsContribution } from "../slots/types";
import { PANEL_SLOT } from "../components/workbench/WorkbenchTabs";
import { SETTINGS_SECTION_SLOT } from "../components/SettingsNav";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const entry = (id: string, over: Partial<PluginInventoryEntry> = {}): PluginInventoryEntry => ({
  id,
  title: id,
  core: false,
  client: true,
  toggleable: true,
  state: "active",
  via: "default",
  ...over,
});

const resolveCard = (registry: SlotRegistry, name: string): ComponentType<ToolCardProps> | undefined =>
  registry.keyed<ComponentType<ToolCardProps>>(TOOLCARD_SLOT).resolve(name);

/** 渲染期探针：Provider 内按名解析卡并渲染（与 toolcards.test 同款）。 */
function CardProbe({ name, ...card }: { name: string } & ToolCardProps): React.JSX.Element {
  const Card = useToolCard(name);
  return <Card {...card} />;
}

const call = (toolName: string, args: Record<string, unknown>): ToolCallPart =>
  ({ type: "toolCall", id: "c1", toolName, args });
const res = (content: string, over: Partial<ToolResultPart> = {}): ToolResultPart =>
  ({ type: "toolResult", toolCallId: "c1", content, isError: false, durationMs: 500, ...over });

describe("loadPluginClients", () => {
  it("并行结算：慢条目未完成时，成功条目已注册", async () => {
    const registry = createSlotRegistry();
    let releaseSlow!: () => void;
    let resolveGood!: () => void;
    const slow = new Promise<void>((resolve) => { releaseSlow = resolve; });
    const good = new Promise<void>((resolve) => { resolveGood = resolve; });
    const loading = loadPluginClients({
      inventory: [entry("slow"), entry("good")],
      registry,
      importModule: async (url) => {
        if (url.includes("slow")) {
          await slow;
          return { default: (api) => { api.registerToolCard("slow", {}); } };
        }
        await good;
        return { default: (api) => { api.registerToolCard("good", {}); } };
      },
    });

    resolveGood();
    await vi.waitFor(() => expect(resolveCard(registry, "good")).toBeDefined());
    expect(resolveCard(registry, "slow")).toBeUndefined();
    releaseSlow();
    await loading;
  });

  it("成功链：active+client 条目按协议 URL 装载，default(api) 的注册进槽位", async () => {
    const registry = createSlotRegistry();
    const urls: string[] = [];
    await loadPluginClients({
      inventory: [entry("example")],
      registry,
      importModule: async (url) => {
        urls.push(url);
        return { default: (api) => { api.registerToolCard("example", { title: "示例插件卡" }); } };
      },
    });
    // 协议布局与 staging 一致：<id>/dist/client.js（构建产物目录段不可省）。
    expect(urls).toEqual(["innocence-plugin://example/dist/client.js"]);
    expect(resolveCard(registry, "example")).toBeDefined();
  });

  it("HMR revision 使新模块 URL 失效缓存并替换旧模块注册内容", async () => {
    const registry = createSlotRegistry();
    const urls: string[] = [];
    const OldCard: ComponentType<ToolCardProps> = () => null;
    const NewCard: ComponentType<ToolCardProps> = () => null;
    const importModule = async (url: string) => {
      urls.push(url);
      return {
        default: (api: PluginClientApi) => {
          api.registerToolCardComponent({
            name: "example",
            component: new URL(url).searchParams.get("hmr") === "1" ? NewCard : OldCard,
          });
        },
      };
    };

    await loadPluginClients({ inventory: [entry("example")], registry, importModule });
    expect(resolveCard(registry, "example")).toBe(OldCard);

    await loadPluginClients({ inventory: [entry("example")], registry, revision: 1, importModule });

    expect(urls).toEqual([
      "innocence-plugin://example/dist/client.js",
      "innocence-plugin://example/dist/client.js?hmr=1",
    ]);
    expect(resolveCard(registry, "example")).toBe(NewCard);
  });

  it("失败隔离：importModule 拒绝只 warn 含插件 id，其余条目继续注册", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const registry = createSlotRegistry();
    await loadPluginClients({
      inventory: [entry("bad"), entry("good")],
      registry,
      importModule: async (url) => {
        if (url.includes("bad")) throw new Error("boom");
        return { default: (api) => { api.registerToolCard("good", {}); } };
      },
    });
    expect(resolveCard(registry, "good")).toBeDefined();
    expect(resolveCard(registry, "bad")).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0].join(" ")).toContain("bad");
  });

  it("无 default 导出或 default 非函数：warn 含 id 并跳过，不阻断其余", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const registry = createSlotRegistry();
    await loadPluginClients({
      inventory: [entry("nodefault"), entry("notfn"), entry("good")],
      registry,
      importModule: async (url) => {
        if (url.includes("nodefault")) return {};
        if (url.includes("notfn")) return { default: 42 } as unknown as PluginClientModule;
        return { default: (api) => { api.registerToolCard("good", {}); } };
      },
    });
    expect(resolveCard(registry, "good")).toBeDefined();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0].join(" ")).toContain("nodefault");
    expect(warn.mock.calls[1].join(" ")).toContain("notfn");
  });

  it("default(api) 异步拒绝同样隔离（warn 含 id，不阻断其余）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const registry = createSlotRegistry();
    await loadPluginClients({
      inventory: [entry("rejects"), entry("good")],
      registry,
      importModule: async (url) =>
        url.includes("rejects")
          ? { default: async () => { throw new Error("register failed"); } }
          : { default: (api) => { api.registerToolCard("good", {}); } },
    });
    expect(resolveCard(registry, "good")).toBeDefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0].join(" ")).toContain("rejects");
  });

  it("非 active 或非 client 条目不装载（importModule 零调用）", async () => {
    const importModule = vi.fn(async () => ({ default: () => {} }));
    const registry = createSlotRegistry();
    await loadPluginClients({
      inventory: [
        entry("off", { state: "disabled-by-config" }),
        entry("depped", { state: "dependency-disabled" }),
        entry("noclient", { client: false }),
      ],
      registry,
      importModule,
    });
    expect(importModule).not.toHaveBeenCalled();
  });

  it("同注册表重装载先撤销旧注册（清单变化重放，停用条目回落兜底）", async () => {
    const registry = createSlotRegistry();
    const loader = (inventory: PluginInventoryEntry[]) =>
      loadPluginClients({
        inventory,
        registry,
        importModule: async () => ({
          default: (api) => { api.registerToolCard("example", { title: "示例插件卡" }); },
        }),
      });
    await loader([entry("example")]);
    expect(resolveCard(registry, "example")).toBeDefined();
    await loader([entry("example", { state: "disabled-by-config" })]);
    expect(resolveCard(registry, "example")).toBeUndefined();
  });

  it("重装载撤销仍在结算的回合，迟到注册不会恢复已停用卡", async () => {
    const registry = createSlotRegistry();
    let release!: () => void;
    const delayed = new Promise<void>((resolve) => { release = resolve; });
    const first = loadPluginClients({
      inventory: [entry("example")],
      registry,
      importModule: async () => {
        await delayed;
        return { default: (api) => { api.registerToolCard("example", {}); } };
      },
    });

    await loadPluginClients({
      inventory: [entry("example", { state: "disabled-by-config" })],
      registry,
      importModule: async () => ({ default: () => {} }),
    });
    release();
    await first;

    expect(resolveCard(registry, "example")).toBeUndefined();
  });
  it("同一 client 同时注册 panel/settings，停用重载后两类贡献一起撤销", async () => {
    const registry = createSlotRegistry();
    const registerBoth = (api: PluginClientApi) => {
      api.registerPanel({ id: "fixture-panel", labelKey: "fixture.panel", render: () => "Fixture panel content" });
      api.registerSettingsSection({ id: "fixture-settings", labelKey: "fixture.settings", icon: () => null, render: () => "Fixture settings content" });
    };
    await loadPluginClients({ inventory: [entry("fixture")], registry, importModule: async () => ({ default: registerBoth }) });
    expect(registry.list(PANEL_SLOT).all()).toHaveLength(1);
    expect(registry.list(SETTINGS_SECTION_SLOT).all()).toHaveLength(1);
    await loadPluginClients({ inventory: [entry("fixture", { state: "disabled-by-config" })], registry, importModule: async () => ({ default: registerBoth }) });
    expect(registry.list(PANEL_SLOT).all()).toEqual([]);
    expect(registry.list(SETTINGS_SECTION_SLOT).all()).toEqual([]);
  });
  it("失败 client 不影响其他 client 的 panel/settings 贡献", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const registry = createSlotRegistry();
    const registerBoth = (api: PluginClientApi) => {
      api.registerPanel({ id: "good-panel", labelKey: "good.panel", render: () => "Good panel" });
      api.registerSettingsSection({ id: "good-settings", labelKey: "good.settings", icon: () => null, render: () => "Good settings" });
    };
    await loadPluginClients({
      inventory: [entry("bad"), entry("good")],
      registry,
      importModule: async (url) => {
        if (url.includes("bad")) return { default: async () => { throw new Error("fixture registration failed"); } };
        return { default: registerBoth };
      },
    });
    expect(Array.from(registry.list<ExternalPanelContribution>(PANEL_SLOT).all(), (item) => item.id)).toEqual(["good-panel"]);
    expect(Array.from(registry.list<ExternalSettingsContribution>(SETTINGS_SECTION_SLOT).all(), (item) => item.id)).toEqual(["good-settings"]);
    expect(warn.mock.calls[0]?.join(" ")).toContain("bad");
  });
  it("不同注册表互不干扰（撤销集按注册表隔离）", async () => {
    const a = createSlotRegistry();
    const b = createSlotRegistry();
    const importModule = async () => ({
      default: (api: { registerToolCard: (n: string, d: { title?: string }) => void }) => {
        api.registerToolCard("example", {});
      },
    });
    await loadPluginClients({ inventory: [entry("example")], registry: a, importModule });
    await loadPluginClients({ inventory: [], registry: b, importModule });
    expect(resolveCard(a, "example")).toBeDefined();
  });
});

describe("client 装载集成（jsdom 渲染）", () => {
  it("真实示例 client 装载后渲染 toolName=example 的调用显示 title 徽标", async () => {
    const registry = createSlotRegistry();
    await loadPluginClients({
      inventory: [entry("example")],
      registry,
      importModule: async () => ({ default: registerExampleClient }),
    });
    render(
      <SlotProvider registry={registry}>
        <CardProbe
          name="example"
          call={call("example", { greeting: "hi" })}
          result={res("done")}
          open={true}
          onToggle={() => {}}
        />
      </SlotProvider>,
    );
    expect(screen.getByText("示例插件卡")).toBeTruthy();
    expect(screen.getByText(/"greeting": "hi"/)).toBeTruthy();
    expect(screen.getByText(/done/)).toBeTruthy();
    expect(screen.getByText(/0\.5s/)).toBeTruthy();
  });

  it("折叠态（open=false）不展示参数与结果；停用重装载后回落兜底卡", async () => {
    const registry = createSlotRegistry();
    const importModule = async () => ({ default: registerExampleClient });
    await loadPluginClients({ inventory: [entry("example")], registry, importModule });
    const view = render(
      <SlotProvider registry={registry}>
        <CardProbe
          name="example"
          call={call("example", { greeting: "hi" })}
          result={res("done")}
          open={false}
          onToggle={() => {}}
        />
      </SlotProvider>,
    );
    expect(view.container.textContent).not.toContain('"greeting"');
    expect(view.container.textContent).not.toContain("done");
    // 重装载（示例停用）后同树重渲染：title 徽标消失，兜底卡接管。
    await loadPluginClients({
      inventory: [entry("example", { state: "disabled-by-config" })],
      registry,
      importModule,
    });
    view.rerender(
      <SlotProvider registry={registry}>
        <CardProbe
          name="example"
          call={call("example", { greeting: "hi" })}
          result={res("done")}
          open={true}
          onToggle={() => {}}
        />
      </SlotProvider>,
    );
    expect(screen.queryByText("示例插件卡")).toBeNull();
    expect(screen.getByText("example")).toBeTruthy();
  });

  it("描述符渲染开关：renderArgs/renderResult 关闭时不渲染对应区块", async () => {
    const registry = createSlotRegistry();
    await loadPluginClients({
      inventory: [entry("minimal")],
      registry,
      importModule: async () => ({
        default: (api) => { api.registerToolCard("minimal", { title: "极简卡", renderArgs: false, renderResult: false }); },
      }),
    });
    const view = render(
      <SlotProvider registry={registry}>
        <CardProbe
          name="minimal"
          call={call("minimal", { secret: 1 })}
          result={res("hidden")}
          open={true}
          onToggle={() => {}}
        />
      </SlotProvider>,
    );
    expect(screen.getByText("极简卡")).toBeTruthy();
    expect(view.container.textContent).not.toContain('"secret"');
    expect(view.container.textContent).not.toContain("hidden");
  });
});
