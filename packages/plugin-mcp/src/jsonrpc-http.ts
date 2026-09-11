import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

export interface HttpServerOptions { url: string; type?: "http" | "sse"; headers?: Record<string, string>; timeout?: number; protocolVersion?: string }

/** The SDK owns HTTP framing, protocol negotiation, streams and cancellation. */
export class HttpJsonRpcClient {
  private readonly client = new Client({ name: "InnocenceHarness", version: "0.1.0" });
  private readonly transport: StreamableHTTPClientTransport | SSEClientTransport;
  private exited = false;
  private disposal?: Promise<void>;
  constructor(private readonly options: HttpServerOptions) {
    const url = new URL(options.url);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("Expected an HTTP server URL.");
    const requestInit = { headers: options.headers };
    this.transport = options.type === "sse"
      ? new SSEClientTransport(url, { requestInit, eventSourceInit: { fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        for (const [key, value] of Object.entries(options.headers ?? {})) headers.set(key, value);
        return fetch(input, { ...init, headers });
      } } })
      : new StreamableHTTPClientTransport(url, { requestInit });
    this.client.onclose = () => { this.exited = true; };
  }
  get isExited() { return this.exited; }
  async start() {
    try { await this.client.connect(this.transport, { timeout: this.options.timeout }); }
    catch (error) { await this.dispose(); throw error; }
  }
  async request<T>(method: string, params?: unknown, options?: { signal?: AbortSignal; timeout?: number }): Promise<T> {
    options = { timeout: this.options.timeout, ...options };
    if (this.exited) throw new Error("MCP client is closed.");
    if (method === "initialize") return {} as T; // connect already negotiated the session.
    if (method === "tools/list") {
      const tools = [];
      let cursor: string | undefined;
      const seen = new Set<string>();
      do {
        const page = await this.client.listTools({ cursor }, options);
        tools.push(...page.tools);
        cursor = page.nextCursor;
        if (cursor && seen.has(cursor)) throw new Error("Repeated tool listing cursor.");
        if (cursor) seen.add(cursor);
      } while (cursor);
      return { tools } as T;
    }
    if (method === "tools/call") return await this.client.callTool(params as { name: string; arguments?: Record<string, unknown> }, undefined, options) as T;
    throw new Error(`Unsupported MCP client method: ${method}`);
  }
  notify(_method: string, _params?: unknown) { /* Initialization notification is owned by connect. */ }
  dispose(): Promise<void> {
    this.exited = true;
    return this.disposal ??= this.client.close();
  }
  stop() { void this.dispose().catch(() => {}); }
}
