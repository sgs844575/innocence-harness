import { describe, expect, it } from "vitest";
import { formatThinkingDuration, greetingKeyForHour, relativeTime } from "./time";
import { enUS, zhCN } from "./i18n";

describe("relativeTime", () => {
  it("分钟/小时/天 三档", () => {
    const now = 1_000_000_000_000;
    expect(relativeTime(now - 30_000, now)).toBe("刚刚");
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5分");
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe("3时");
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe("2天");
  });
});

describe("formatThinkingDuration", () => {
  it("短秒数与长时长", () => {
    expect(formatThinkingDuration(1_500)).toBe("了几秒");
    expect(formatThinkingDuration(30_000)).toBe("了 30 秒");
    expect(formatThinkingDuration(95_000)).toBe("了 1 分 35 秒");
  });
});

describe("greetingKeyForHour", () => {
  it("按小时分档（[5,9,12,14,18,23] 边界）且各档文案在两套字典均非空", () => {
    const cases: [number, string][] = [
      [0, "chat.greeting.lateNight"],
      [4, "chat.greeting.lateNight"],
      [5, "chat.greeting.morningEarly"],
      [8, "chat.greeting.morningEarly"],
      [9, "chat.greeting.morning"],
      [11, "chat.greeting.morning"],
      [12, "chat.greeting.noon"],
      [13, "chat.greeting.noon"],
      [14, "chat.greeting.afternoon"],
      [17, "chat.greeting.afternoon"],
      [18, "chat.greeting.evening"],
      [22, "chat.greeting.evening"],
      [23, "chat.greeting.lateNight"],
    ];
    for (const [hour, key] of cases) {
      expect(greetingKeyForHour(hour)).toBe(key);
      expect(zhCN[key]?.length).toBeGreaterThan(0);
      expect(enUS[key]?.length).toBeGreaterThan(0);
    }
  });
});
