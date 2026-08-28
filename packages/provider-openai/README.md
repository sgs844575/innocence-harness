# provider-openai — OpenAI 兼容协议 Provider

`@innocenceharness/provider-openai` 是 OpenAI 兼容 `chat/completions` 协议的 Provider 配置入口：
把 profile（凭据、Base URL、模型、请求选项）交给共享模型运行时（`harness-ai-runtime`），由它完成
wire 传输、SSE 流式解析与载荷映射。支持自定义 Base URL，因此 Ollama、vLLM 及各类网关等
OpenAI 兼容端点都能直接接入。

## 作用

- 协议选择：配置了 `baseURL` 走 `openai-compatible`，否则走 `openai`。
- 请求选项透传：`max_tokens / temperature / reasoning_effort`。
- API Key 取 `config.apiKey`，缺省回落环境变量 `OPENAI_API_KEY`；两者皆无时构造即抛错。

## 公开 API

| 导出 | 说明 |
|---|---|
| `createOpenAIProvider(config)` | 构造不透明模型载体（`ProviderModel`，id 默认 `openai`） |
| `default` | 动态分发入口（磁盘加载的插件以此工厂为入口） |

`OpenAIProviderConfig`：`apiKey? / baseURL? / model / maxTokens? / temperature? / reasoningEffort? / id? / fetchImpl?`。
`fetchImpl` 供测试注入；线格式夹具回放经共享运行时完成（见 `tests/openai.test.ts`）。

## 使用

```ts
import { createOpenAIProvider } from "@innocenceharness/provider-openai";

const model = createOpenAIProvider({
  apiKey: "sk-…",
  model: "gpt-4.1",
  // baseURL: "http://localhost:11434/v1",  // OpenAI 兼容端点（本地推理/网关）
});
```

桌面宿主里由组合层（`src/main/pluginBoot/sessionComposition.ts`）按当前设置构造模型载体并包成
provider 插件入组合集（设置界面可填 API Key 与 Base URL，Key 仅存本机）。

## 关键行为与约束

- 请求 signal（用户停止）沿共享运行时传导，中断流。
- 思考档位 `reasoningEffort`（`low/medium/high` 等）：`off` 或不传则不带该参数。
- 规范消息里不出现任何 wire 字段（providers 脊柱协议中立约束）；wire 映射属于共享模型运行时。

## 测试

```bash
npx vitest run packages/provider-openai
```

`tests/openai.test.ts`（线格式夹具经共享运行时回放）与 `tests/provider.test.ts`（工厂装配面）。
