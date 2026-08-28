import { describe, expect, it, vi } from "vitest";
import type { NotifyChannelOptions, NotifySink } from "@innocenceharness/notify-channel";
import { createLazyNotifySink } from "./notifySink";

const options: NotifyChannelOptions = { appId: "a", appSecret: "s", receiveId: "r" };

describe("createLazyNotifySink", () => {
  it("loads configuration once and delegates subsequent sends to one sink", async () => {
    const load = vi.fn(async () => options);
    const inner: NotifySink = { send: vi.fn().mockResolvedValue(undefined) };
    const factory = vi.fn(() => inner);
    const sink = createLazyNotifySink({ load, factory });

    await sink.send({ title: "t", text: "1" });
    await sink.send({ title: "t", text: "2" });
    expect(load).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(inner.send).toHaveBeenCalledTimes(2);
  });

  it("skips delivery silently when the channel is unconfigured", async () => {
    const load = vi.fn(async () => undefined);
    const sink = createLazyNotifySink({ load, factory: () => { throw new Error("must not construct"); } });
    await expect(sink.send({ title: "t", text: "x" })).resolves.toBeUndefined();
    await expect(sink.send({ title: "t", text: "y" })).resolves.toBeUndefined();
    expect(load).toHaveBeenCalledTimes(1);
  });
});
