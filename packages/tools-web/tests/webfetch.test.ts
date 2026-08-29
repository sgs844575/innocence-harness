import { describe, expect, it } from "vitest";
import { createWebFetchTool, WebPlugin, type FetchLike, type FetchResponseLike } from "../src";

const ctx = { signal: new AbortController().signal } as never;

interface Route {
  status?: number;
  location?: string;
  contentType?: string | null;
  body?: string;
  hang?: boolean;
  /** When set, the response carries an open body stream whose cancel hook fires here. */
  onBodyCancel?: () => void;
}

function trackedBody(onCancel: () => void): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Buffer.from("discarded body bytes", "utf8"));
      // deliberately left open: only cancel() should end this stream
    },
    cancel() {
      onCancel();
    },
  });
}

/** Fake transport: routed responses plus a call log (offline by construction). */
function fakeFetch(routes: Record<string, Route>) {
  const calls: string[] = [];
  const impl: FetchLike = (input, init) => {
    calls.push(input);
    const route = routes[input] ?? {};
    if (route.hang) {
      return new Promise<FetchResponseLike>((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    }
    const headers = new Map<string, string>();
    if (route.location !== undefined) headers.set("location", route.location);
    const contentType = route.contentType === undefined ? "text/html; charset=utf-8" : route.contentType;
    if (contentType !== null) headers.set("content-type", contentType);
    return Promise.resolve({
      status: route.status ?? (route.location !== undefined ? 302 : 200),
      headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
      body: route.onBodyCancel ? trackedBody(route.onBodyCancel) : null,
      text: async () => route.body ?? "",
    });
  };
  return { impl, calls };
}

function tool(fetchImpl: FetchLike): ReturnType<typeof createWebFetchTool> {
  return createWebFetchTool({ fetchImpl, timeoutMs: 2000 });
}

describe("web_fetch tool", () => {
  it("accepts public http/https URLs and rejects other protocols", () => {
    const t = createWebFetchTool();
    expect(() => t.validateArgs!({ url: "https://example.com/page?q=1" })).not.toThrow();
    expect(() => t.validateArgs!({ url: "http://example.com:8080/" })).not.toThrow();
    for (const bad of ["ftp://example.com/x", "file:///etc/hosts", "javascript:alert(1)"]) {
      expect(() => t.validateArgs!({ url: bad })).toThrow(/协议/);
    }
  });

  it("rejects intranet, loopback and link-local literals plus localhost", () => {
    const t = createWebFetchTool();
    const banned = [
      "http://127.0.0.1/",
      "http://127.9.9.9/x",
      "http://10.0.0.5/",
      "http://10.255.0.1/",
      "http://172.16.0.1/",
      "http://172.31.255.255/",
      "http://192.168.1.1/",
      "http://169.254.169.254/latest/meta-data",
      "http://0.0.0.0/",
      "http://0x7f.1/",
      "http://[::1]/",
      "http://[::]/",
      "http://[fe80::1]/",
      "http://[fd12::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://localhost/",
      "http://LOCALHOST:8080/",
      "http://api.localhost/",
      // Fully-qualified trailing-dot forms: the URL parser keeps the dot on
      // "localhost." and dns.lookup still resolves it to loopback on Windows.
      "http://localhost.:8080/",
      "http://api.localhost./",
      "http://localhost../",
      "http://127.0.0.1./",
    ];
    for (const url of banned) {
      expect(() => t.validateArgs!({ url })).toThrow(/目标地址不允许/);
    }
  });

  it("keeps public-adjacent boundary hosts reachable", () => {
    const t = createWebFetchTool();
    for (const url of ["http://172.15.0.1/", "http://172.32.0.1/", "http://11.0.0.1/", "http://example.com/"]) {
      expect(() => t.validateArgs!({ url })).not.toThrow();
    }
  });

  it("rejects malformed urls, missing values and embedded credentials", () => {
    const t = createWebFetchTool();
    const badArgs = [
      {},
      { url: "" },
      { url: 42 },
      { url: "not a url" },
      { url: "/relative/path" },
      { url: "https://user:pass@example.com/" },
    ];
    for (const args of badArgs) expect(() => t.validateArgs!(args)).toThrow();
  });

  it("validation errors echo protocol and host only, never the path", () => {
    const t = createWebFetchTool();
    try {
      t.validateArgs!({ url: "http://127.0.0.1:8080/secret/path?token=1" });
      expect.unreachable("intranet literal must be rejected");
    } catch (err) {
      const message = String(err);
      expect(message).toContain("127.0.0.1");
      expect(message).not.toContain("secret");
    }
  });

  it("execute gates the same baseline before any transport call", async () => {
    const { impl, calls } = fakeFetch({});
    const res = await tool(impl).execute({ url: "http://192.168.0.1/admin" }, ctx);
    expect(res.isError).toBe(true);
    expect(res.content).toContain("目标地址不允许");
    expect(calls).toEqual([]);
  });

  it("returns the body under a metadata first line", async () => {
    const { impl, calls } = fakeFetch({ "https://example.com/page": { body: "<html>hello</html>" } });
    const res = await tool(impl).execute({ url: "https://example.com/page" }, ctx);
    expect(res.isError).toBeFalsy();
    const [meta, ...rest] = res.content.split("\n\n");
    expect(meta).toBe("[web_fetch text/html 18 bytes]");
    expect(meta).not.toContain("final=");
    expect(rest.join("\n\n")).toBe("<html>hello</html>");
    expect(calls).toEqual(["https://example.com/page"]);
  });

  it("accepts application/json responses", async () => {
    const { impl } = fakeFetch({
      "https://api.example.com/v1": { contentType: "application/json; charset=utf-8", body: '{"ok":true}' },
    });
    const res = await tool(impl).execute({ url: "https://api.example.com/v1" }, ctx);
    expect(res.isError).toBeFalsy();
    expect(res.content).toContain("application/json");
    expect(res.content).toContain('{"ok":true}');
  });

  it("rejects non-text responses with an explanation", async () => {
    for (const contentType of ["image/png", "application/octet-stream", null]) {
      const { impl } = fakeFetch({ "https://example.com/blob": { contentType, body: "binary-ish" } });
      const res = await tool(impl).execute({ url: "https://example.com/blob" }, ctx);
      expect(res.isError).toBe(true);
      expect(res.content).toContain("仅接受");
    }
  });

  it("follows up to five same-host redirects and reports the final url", async () => {
    const routes: Record<string, Route> = {
      "https://a.example/start": { location: "https://a.example/r1" },
      "https://a.example/r1": { location: "https://a.example/r2" },
      "https://a.example/r2": { location: "https://a.example/r3" },
      "https://a.example/r3": { location: "https://a.example/r4" },
      "https://a.example/r4": { location: "https://a.example/end" },
      "https://a.example/end": { body: "landed" },
    };
    const { impl, calls } = fakeFetch(routes);
    const res = await tool(impl).execute({ url: "https://a.example/start" }, ctx);
    expect(res.isError).toBeFalsy();
    expect(calls).toHaveLength(6);
    expect(res.content).toContain("final=https://a.example/end");
    expect(res.content).toContain("landed");
  });

  it("terminates cross-host redirects instead of following them", async () => {
    // Domain-scope discipline: the permission decision covers the entry host;
    // a redirect to any other host must terminate so the caller re-enters the
    // pipeline with the true scope instead of the tool silently hopping there.
    let hopCancelled = false;
    const routes: Record<string, Route> = {
      "https://entry.example/go": {
        location: "https://other.example/x",
        onBodyCancel: () => {
          hopCancelled = true;
        },
      },
      "https://other.example/x": { body: "must not be fetched" },
    };
    const { impl, calls } = fakeFetch(routes);
    const res = await tool(impl).execute({ url: "https://entry.example/go" }, ctx);
    expect(res.isError).toBe(true);
    expect(res.content).toContain("other.example"); // 错误含最终域名
    expect(res.content).toContain("https://other.example/x"); // 供重新调用的最终 URL
    expect(calls).toEqual(["https://entry.example/go"]); // 不跟随跳变
    expect(hopCancelled).toBe(true); // 丢弃的跳变响应体被释放
    // 权限资源仍以入口域名为 scope——决议不因重定向稀释。
    const t = createWebFetchTool({ fetchImpl: impl });
    expect(t.permissionResource({ url: "https://entry.example/go" }, ctx)).toEqual({
      action: "read",
      kind: "web",
      scope: "entry.example",
    });
  });

  it("cancels discarded bodies on followed redirects and non-text rejections", async () => {
    let redirectCancelled = false;
    let rejectCancelled = false;
    const follow = fakeFetch({
      "https://example.com/a": {
        location: "/b",
        onBodyCancel: () => {
          redirectCancelled = true;
        },
      },
      "https://example.com/b": { body: "ok" },
    });
    const ok = await tool(follow.impl).execute({ url: "https://example.com/a" }, ctx);
    expect(ok.isError).toBeFalsy();
    expect(redirectCancelled).toBe(true);
    const reject = fakeFetch({
      "https://example.com/blob": {
        contentType: "image/png",
        onBodyCancel: () => {
          rejectCancelled = true;
        },
      },
    });
    const denied = await tool(reject.impl).execute({ url: "https://example.com/blob" }, ctx);
    expect(denied.isError).toBe(true);
    expect(rejectCancelled).toBe(true);
  });

  it("rejects a sixth redirect hop", async () => {
    const routes: Record<string, Route> = {
      "https://a.example/start": { location: "https://a.example/r1" },
      "https://a.example/r1": { location: "https://a.example/r2" },
      "https://a.example/r2": { location: "https://a.example/r3" },
      "https://a.example/r3": { location: "https://a.example/r4" },
      "https://a.example/r4": { location: "https://a.example/r5" },
      "https://a.example/r5": { location: "https://a.example/r6" },
      "https://a.example/r6": { location: "https://a.example/r7" },
    };
    const { impl, calls } = fakeFetch(routes);
    const res = await tool(impl).execute({ url: "https://a.example/start" }, ctx);
    expect(res.isError).toBe(true);
    expect(res.content).toContain("重定向");
    expect(calls).toHaveLength(6);
  });

  it("re-validates every redirect hop against the intranet baseline", async () => {
    const { impl, calls } = fakeFetch({ "https://public.example/go": { location: "http://127.0.0.1/admin" } });
    const res = await tool(impl).execute({ url: "https://public.example/go" }, ctx);
    expect(res.isError).toBe(true);
    expect(res.content).toContain("目标地址不允许");
    expect(calls).toEqual(["https://public.example/go"]);
  });

  it("re-validates the protocol of redirect targets", async () => {
    const { impl } = fakeFetch({ "https://public.example/go": { location: "ftp://elsewhere.example/file" } });
    const res = await tool(impl).execute({ url: "https://public.example/go" }, ctx);
    expect(res.isError).toBe(true);
    expect(res.content).toContain("协议");
  });

  it("resolves relative redirect locations against the current url", async () => {
    const { impl, calls } = fakeFetch({
      "https://example.com/a": { location: "/next" },
      "https://example.com/next": { body: "second" },
    });
    const res = await tool(impl).execute({ url: "https://example.com/a" }, ctx);
    expect(res.isError).toBeFalsy();
    expect(calls).toEqual(["https://example.com/a", "https://example.com/next"]);
    expect(res.content).toContain("final=https://example.com/next");
  });

  it("times out hanging fetches", async () => {
    const { impl } = fakeFetch({ "https://slow.example/": { hang: true } });
    const res = await createWebFetchTool({ fetchImpl: impl, timeoutMs: 40 }).execute(
      { url: "https://slow.example/" },
      ctx,
    );
    expect(res.isError).toBe(true);
    expect(res.content).toContain("超时");
  });

  it("truncates oversized bodies at the byte budget with a marker", async () => {
    const body = "a".repeat(10000);
    const { impl } = fakeFetch({ "https://example.com/big": { body } });
    const res = await tool(impl).execute({ url: "https://example.com/big" }, ctx);
    expect(res.isError).toBeFalsy();
    expect(res.content).toContain("[content truncated]");
    expect(res.content).toContain("10000 bytes");
    const returned = res.content.split("\n\n").slice(1).join("\n\n");
    expect(returned.length).toBe(8192);
  });

  it("truncates multibyte bodies without splitting characters", async () => {
    const body = "汉".repeat(5000); // 3 bytes per char → 15000 bytes
    const { impl } = fakeFetch({ "https://example.com/cn": { body } });
    const res = await tool(impl).execute({ url: "https://example.com/cn" }, ctx);
    expect(res.isError).toBeFalsy();
    expect(res.content).toContain("15000 bytes");
    expect(res.content).toContain("[content truncated]");
    const returned = res.content.split("\n\n").slice(1).join("\n\n");
    expect(returned).not.toContain("\uFFFD");
    expect(returned.length).toBe(2730); // 8192-byte budget walks back to 8190 (2730 chars)
  });

  it("marks http error statuses as errors while keeping the meta line", async () => {
    const { impl } = fakeFetch({ "https://example.com/missing": { status: 404, body: "gone" } });
    const res = await tool(impl).execute({ url: "https://example.com/missing" }, ctx);
    expect(res.isError).toBe(true);
    expect(res.content).toContain("status=404");
    expect(res.content).toContain("gone");
  });

  it("streams complete small bodies without buffering through text()", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Buffer.from("hi", "utf8"));
        controller.close();
      },
    });
    const impl: FetchLike = () =>
      Promise.resolve({
        status: 200,
        headers: { get: () => "text/plain" },
        body: stream,
        text: () =>
          new Promise<never>((_resolve, reject) => {
            setTimeout(() => reject(new Error("text() must not back the streaming path")), 4000);
          }),
      });
    const res = await tool(impl).execute({ url: "https://example.com/stream" }, ctx);
    expect(res.isError).toBeFalsy();
    expect(res.content).toBe("[web_fetch text/plain 2 bytes]\n\nhi");
    expect(res.content).not.toContain("[content truncated]");
  });

  it("cancels oversized streams at the byte budget instead of buffering them", async () => {
    // An endless text stream: only the budget cancel can end this read — a
    // text()-based implementation would hang to its own timeout, and the tool
    // must not buffer more than budget + one chunk.
    let cancelled = false;
    const chunk = "x".repeat(1024);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Buffer.from(chunk, "utf8"));
      },
      pull(controller) {
        controller.enqueue(Buffer.from(chunk, "utf8"));
      },
      cancel() {
        cancelled = true;
      },
    });
    const impl: FetchLike = () =>
      Promise.resolve({
        status: 200,
        headers: { get: () => "text/plain" },
        body: stream,
        text: () =>
          new Promise<never>((_resolve, reject) => {
            setTimeout(() => reject(new Error("text() must not back the streaming path")), 4000);
          }),
      });
    const res = await tool(impl).execute({ url: "https://example.com/stream" }, ctx);
    expect(res.isError).toBeFalsy();
    expect(cancelled).toBe(true);
    expect(res.content).toContain("[content truncated]");
    expect(res.content).toContain("9216 bytes"); // 9 chunks received, then cancel
    const returned = res.content.split("\n\n").slice(1).join("\n\n");
    expect(returned.length).toBe(8192);
  });

  it("is read-only with network side effects and a hostname-scoped resource", () => {
    const t = createWebFetchTool();
    expect(t.readOnly).toBe(true);
    expect(t.sideEffect).toBe("network");
    expect(t.permissionResource({ url: "https://Example.COM:443/a" }, ctx)).toEqual({
      action: "read",
      kind: "web",
      scope: "example.com",
    });
  });

  it("persists the url verbatim", () => {
    const t = createWebFetchTool();
    expect(t.persistArgs({ url: "https://example.com/a?b=1" })).toEqual({ url: "https://example.com/a?b=1" });
    expect(t.persistArgs({})).toEqual({ url: "" });
  });

  it("description carries the guard baseline and reading discipline", () => {
    const t = createWebFetchTool();
    expect(t.description).toContain("拒绝内网与环回地址");
    expect(t.description).toContain("最终 URL");
    expect(t.description).toContain("字面量");
    expect(t.description).toContain("不可信");
    expect(t.description).toContain("跨主机重定向不自动跟随");
  });

  it("registers via the plugin", () => {
    const registered: string[] = [];
    WebPlugin.apply({ tools: { register: (t: { name: string }) => registered.push(t.name) } } as never);
    expect(registered).toEqual(["web_fetch"]);
    expect(WebPlugin.name).toBe("web");
  });
});
