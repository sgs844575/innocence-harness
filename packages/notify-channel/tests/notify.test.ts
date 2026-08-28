import { describe, expect, it, vi } from "vitest";
import { createNotifyChannelSink } from "../src/index";

const baseOptions = {
  appId: "cli_app",
  appSecret: "secret",
  receiveId: "oc_chat",
};

describe("createNotifyChannelSink", () => {
  it("rejects missing credentials at construction time", () => {
    expect(() => createNotifyChannelSink({ ...baseOptions, appId: " " })).toThrow("appId");
    expect(() => createNotifyChannelSink({ ...baseOptions, appSecret: "" })).toThrow("appSecret");
    expect(() => createNotifyChannelSink({ ...baseOptions, receiveId: "  " })).toThrow("receiveId");
  });

  it("delivers title and text through the injected sender with defaults applied", async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const sink = createNotifyChannelSink(baseOptions, { sendMessage });
    await sink.send({ title: "  自动化  ", text: " 任务完成 " });
    expect(sendMessage).toHaveBeenCalledWith({ title: "自动化", text: "任务完成" });
  });

  it("falls back to a neutral title and rejects empty text", async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const sink = createNotifyChannelSink(baseOptions, { sendMessage });
    await sink.send({ title: "", text: "正文" });
    expect(sendMessage).toHaveBeenCalledWith({ title: "通知", text: "正文" });
    await expect(sink.send({ title: "t", text: "   " })).rejects.toThrow("text is required");
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("propagates sender failures to the caller", async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error("channel down"));
    const sink = createNotifyChannelSink(baseOptions, { sendMessage });
    await expect(sink.send({ title: "t", text: "x" })).rejects.toThrow("channel down");
  });
});
