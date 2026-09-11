import { afterEach, expect, it } from "vitest";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Context } from "@innocenceharness/kernel";
import { LoggerPlugin } from "@innocenceharness/kernel-logger";
import { ToolsPlugin, createExecutionScope } from "@innocenceharness/harness-tools";
import { createMcpPlugin, HttpJsonRpcClient } from "../src/index";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const dispose of cleanup.reverse()) await dispose(); cleanup.length = 0; });
async function endpoint(type: "http" | "sse") {
  const sdk = new Server({ name: "fixture", version: "1" }, { capabilities: { tools: {} } });
  let cancelled!: () => void;
  let started!: () => void;
  const cancellation = new Promise<void>((resolve) => { cancelled = resolve; });
  const pending = new Promise<void>((resolve) => { started = resolve; });
  sdk.setRequestHandler(ListToolsRequestSchema, async (request) => ({ tools: [{ name: request.params?.cursor ? "wait" : "echo", inputSchema: { type: "object" } }], ...(!request.params?.cursor ? { nextCursor: "second" } : {}) }));
  sdk.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    if (request.params.name === "wait") {
      started();
      await new Promise<void>((resolve) => {
        const aborted = () => { cancelled(); resolve(); };
        if (extra.signal.aborted) aborted(); else extra.signal.addEventListener("abort", aborted, { once: true });
      });
    }
    return { content: [{ type: "text", text: String(request.params.arguments?.text ?? "done") }] };
  });
  let transport: StreamableHTTPServerTransport | SSEServerTransport;
  const requests: Array<{ method?: string; authorization?: string }> = [];
  if (type === "http") {
    transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID, enableJsonResponse: true });
    await sdk.connect(transport);
  }
  const http = createServer(async (req, res) => {
    requests.push({ method: req.method, authorization: req.headers.authorization });
    try {
      if (type === "sse" && req.method === "GET") {
        transport = new SSEServerTransport("/messages", res);
        await sdk.connect(transport);
      } else if (type === "sse") await (transport as SSEServerTransport).handlePostMessage(req, res);
      else await (transport as StreamableHTTPServerTransport).handleRequest(req, res);
    } catch (error) { if (!res.headersSent) res.writeHead(500); res.end(String(error)); }
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  cleanup.push(async () => { await sdk.close(); http.closeAllConnections(); await new Promise<void>((resolve) => http.close(() => resolve())); });
  return { url: `http://127.0.0.1:${(http.address() as { port: number }).port}/mcp`, requests, cancellation, pending };
}
it.each(["http", "sse"] as const)("registers paginated %s tools, sends headers and maps results through the kernel", async (type) => {
  const server = await endpoint(type);
  const ctx = new Context();
  cleanup.push(() => ctx.fiber.dispose());
  await ctx.plugin(LoggerPlugin);
  await ctx.plugin(ToolsPlugin);
  await ctx.plugin(createMcpPlugin({ servers: { remote: { url: server.url, type, headers: { Authorization: "Bearer fixture" } } } }));
  expect(ctx.tools.get("mcp__remote__wait")).toBeDefined();
  const result = await ctx.tools.get("mcp__remote__echo")!.execute({ text: "round trip" }, {
    workspaceRoot: "", signal: new AbortController().signal, log: () => {}, scope: createExecutionScope("mcp__remote__echo"),
  });
  expect(result.content).toBe("round trip");
  expect(server.requests.every((request) => request.authorization === "Bearer fixture")).toBe(true);
  await ctx.fiber.dispose();
});
it("forwards cancellation to a remote call and closes idempotently", async () => {
  const server = await endpoint("http");
  const client = new HttpJsonRpcClient({ url: server.url });
  cleanup.push(() => client.dispose());
  await client.start();
  const abort = new AbortController();
  const call = client.request("tools/call", { name: "wait" }, { signal: abort.signal });
  const rejected = expect(call).rejects.toThrow();
  await server.pending;
  abort.abort();
  await rejected;
  await server.cancellation;
  await client.dispose();
  await client.dispose();
  expect(client.isExited).toBe(true);
  await expect(client.request("tools/list")).rejects.toThrow("closed");
});
