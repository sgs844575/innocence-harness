import { afterEach, expect, it } from "vitest";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Context } from "@innocenceharness/kernel";
import { LoggerPlugin } from "@innocenceharness/kernel-logger";
import { ToolsPlugin } from "@innocenceharness/harness-tools";
import { createMcpPlugin } from "../src/index";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const dispose of cleanup.reverse()) await dispose(); cleanup.length = 0; });

/** Requires `Bearer token` on every request; 401 otherwise. */
async function protectedEndpoint(token: string) {
  const sdk = new Server({ name: "fixture", version: "1" }, { capabilities: { tools: {} } });
  sdk.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: "echo", inputSchema: { type: "object" } }] }));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID, enableJsonResponse: true });
  await sdk.connect(transport);
  const seen: string[] = [];
  const http = createServer(async (req, res) => {
    seen.push(req.headers.authorization ?? "");
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401, { "www-authenticate": 'Bearer realm="https://auth.example/rm"' });
      res.end("unauthorized");
      return;
    }
    try {
      await transport.handleRequest(req, res);
    } catch (error) {
      if (!res.headersSent) res.writeHead(500);
      res.end(String(error));
    }
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  cleanup.push(async () => {
    await sdk.close();
    http.closeAllConnections();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  });
  return { url: `http://127.0.0.1:${(http.address() as { port: number }).port}/mcp`, seen };
}

it("merges authorized headers into the http connect and registers tools", async () => {
  const oauth = { clientId: "registered-client", callbackPort: 8765, scopes: ["read"] };
  const server = await protectedEndpoint("granted");
  const asked: Array<{ name: string; url: string }> = [];
  const ctx = new Context();
  cleanup.push(() => ctx.fiber.dispose());
  await ctx.plugin(LoggerPlugin);
  await ctx.plugin(ToolsPlugin);
  await ctx.plugin(createMcpPlugin({
    servers: { remote: { url: server.url, type: "http", oauth } },
    authorizeServer: async (serverInfo) => {
      asked.push(serverInfo);
      return { status: "authorized", headers: { authorization: "Bearer granted" } };
    },
  }));
  expect(asked).toEqual([{ name: "remote", url: server.url, oauth }]);
  expect(ctx.tools.get("mcp__remote__echo")).toBeDefined();
  expect(server.seen.every((header) => header === "Bearer granted")).toBe(true);
});

it("skips the server with a failure note when authorization is declined", async () => {
  const server = await protectedEndpoint("granted");
  const ctx = new Context();
  cleanup.push(() => ctx.fiber.dispose());
  await ctx.plugin(LoggerPlugin);
  await ctx.plugin(ToolsPlugin);
  await ctx.plugin(createMcpPlugin({
    servers: { remote: { url: server.url, type: "http" } },
    authorizeServer: async () => ({ status: "declined", reason: "user declined authorization" }),
  }));
  expect(ctx.tools.get("mcp__remote__echo")).toBeUndefined();
});

it("connects anonymously when the port answers none and never asks stdio servers", async () => {
  const server = await protectedEndpoint("none-will-fail");
  const calls: string[] = [];
  const ctx = new Context();
  cleanup.push(() => ctx.fiber.dispose());
  await ctx.plugin(LoggerPlugin);
  await ctx.plugin(ToolsPlugin);
  await ctx.plugin(createMcpPlugin({
    servers: { remote: { url: server.url, type: "http" } },
    authorizeServer: async () => {
      calls.push("remote");
      return { status: "none" };
    },
  }));
  expect(calls).toEqual(["remote"]);
  // "none" 之后匿名连接：本夹具恒 401，服务器失败、工具不注册。
  expect(ctx.tools.get("mcp__remote__echo")).toBeUndefined();
});
