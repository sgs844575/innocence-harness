# provider-anthropic — Anthropic messages 协议 Provider

`@innocenceharness/provider-anthropic` 是 Anthropic `v1/messages` 协议的 Provider 配置入口：
把 profile（凭据、Base URL、模型、思考档位）交给共享模型运行时（`harness-ai-runtime`），由它完成
wire 传输、SSE 流式解析与载荷映射。

## 作用

- 协议固定为 `anthropic`；请求头带 `x-api-key` 与 `anthropic-version: 2023-06-01`。
- 思考档位 `reasoningEffort`（`low/medium/high`）映射为 thinking budget，`off` 或不传则不开启。
- API Key 取 `config.apiKey`，缺省回落环境变量 `ANTHROPIC_API_KEY`，两者皆无时构造即抛错。

## 公开 API

| 导出 | 说明 |
|---|---|
| `createAnthropicProvider(config)` | 构造不透明模型载体（`ProviderModel`，id 默认 `anthropic`） |
| `default` | 动态分发入口（磁盘加载的插件以此工厂为入口） |

`AnthropicProviderConfig`：`apiKey? / baseURL? / model / maxTokens? / temperature? / reasoningEffort? / id? / fetchImpl?`。
`baseURL` 默认 `https://api.anthropic.com/v1`；`fetchImpl` 供测试注入；线格式夹具回放经共享运行时完成
（见 `tests/anthropic.test.ts`）。

## 使用

```ts
import { createAnthropicProvider } from "@innocenceharness/provider-anthropic";

const model = createAnthropicProvider({ apiKey: "sk-ant-…", model: "claude-sonnet-4" });
```

桌面宿主里由组合层（`src/main/pluginBoot/sessionComposition.ts`）按当前设置构造模型载体并包成
provider 插件入组合集。

## 关键行为与约束

- 请求 signal（用户停止）沿共享运行时传导，中断流。
- 规范消息里不出现任何 wire 字段（providers 脊柱协议中立约束）；wire 映射属于共享模型运行时。

## 测试

```bash
npx vitest run packages/provider-anthropic
```

`tests/anthropic.test.ts`（线格式夹具经共享运行时回放）与 `tests/provider.test.ts`（传输与工厂装配面）。
