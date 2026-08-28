import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { WsJsonRpcClient } from "../src/jsonrpc-ws";

/** Tiny MCP-flavored JSON-RPC echo server over a real in-process socket. */
async function startEchoServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => wss.on("listening", resolve));
  const sockets: WebSocket[] = [];
  wss.on("connection", (socket) => {
    sockets.push(socket);
    socket.on("message", (data: unknown) => {
      const text = String(data);
      let msg: { id?: number; method?: string; params?: Record<string, unknown> };
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      if (typeof msg.id !== "number") return;
      if (msg.method === "tools/list") {
        socket.send(JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: { tools: [{ name: "echo", description: "回显输入" }] },
        }));
        return;
      }
      if (msg.method === "tools/call") {
        const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
        socket.send(JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: { content: [{ type: "text", text: `echo:${JSON.stringify(args)}` }] },
        }));
        return;
      }
      socket.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }));
    });
  });
  const address = wss.address() as { port: number };
  return {
    url: `ws://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.close();
        wss.close(() => resolve());
      }),
  };
}

const echoServers: Array<{ close: () => Promise<void> }> = [];
async function server(): Promise<{ url: string; close: () => Promise<void> }> {
  const echo = await startEchoServer();
  echoServers.push(echo);
  return echo;
}

afterEach(async () => {
  for (const echo of echoServers.splice(0)) await echo.close();
});

describe("WsJsonRpcClient", () => {
  it("completes the MCP handshake shape: request, tools/list and tools/call", async () => {
    const echo = await server();
    const client = new WsJsonRpcClient({ url: echo.url });
    await client.start();
    try {
      const initialized = await client.request<{ capabilities?: unknown }>("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "InnocenceHarness", version: "0.1.0" },
      });
      expect(initialized).toBeDefined();
      client.notify("notifications/initialized", {});
      const list = await client.request<{ tools: Array<{ name: string }> }>("tools/list", {});
      expect(list.tools.map((t) => t.name)).toEqual(["echo"]);
      const call = await client.request<{ content: Array<{ text: string }> }>("tools/call", {
        name: "echo",
        arguments: { value: "你好" },
      });
      expect(call.content[0]?.text).toBe('echo:{"value":"你好"}');
      expect(client.isExited).toBe(false);
    } finally {
      await client.dispose();
    }
  });

  it("rejects requests after the server closes and marks the client exited", async () => {
    const echo = await server();
    const client = new WsJsonRpcClient({ url: echo.url });
    await client.start();
    const onExit = vi.fn();
    client.onExit = onExit;
    await echo.close();
    await vi.waitFor(() => expect(client.isExited).toBe(true));
    await expect(client.request("tools/list", {})).rejects.toThrow("不可用");
    await vi.waitFor(() => expect(onExit).toHaveBeenCalledTimes(1));
  });

  it("aborts an in-flight request and notifies the server-side cancellation", async () => {
    const echo = await server();
    const client = new WsJsonRpcClient({ url: echo.url });
    await client.start();
    try {
      const controller = new AbortController();
      const pending = client.request("tools/call", { name: "echo", arguments: {} }, { signal: controller.signal });
      controller.abort();
      await expect(pending).rejects.toThrow("已中止");
    } finally {
      await client.dispose();
    }
  });

  it("fails to start against an unreachable endpoint", async () => {
    const client = new WsJsonRpcClient({ url: "ws://127.0.0.1:9", connectTimeoutMs: 500 });
    await expect(client.start()).rejects.toBeTruthy();
    await client.dispose();
  });
});
