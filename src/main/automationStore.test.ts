import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createAutomationStore } from "./automationStore";

const definition = {
  id: "automation-1",
  name: "Weekly review",
  candidate: {
    trigger: { kind: "idle" as const, expression: "5m", idleForMs: 300_000 },
    actions: [{ kind: "review" as const, command: "Review pending tasks" }],
    constraints: ["ask permission"],
    reviewSummary: "Review work after idle time.",
  },
  enabled: true,
  createdAt: 1,
  updatedAt: 1,
};

describe("automation store", () => {
  it("atomically persists confirmed definitions and restores them on restart", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ic-automation-"));
    const file = path.join(dir, "automations.json");
    const store = createAutomationStore(file);

    store.save(definition);

    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ version: 1, definitions: [definition] });
    expect(createAutomationStore(file).list()).toEqual([definition]);
  });

  it("atomically replaces and deletes definitions across restart", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ic-automation-"));
    const file = path.join(dir, "automations.json");
    const store = createAutomationStore(file);

    store.save(definition);
    store.save({ ...definition, name: "Updated weekly review", updatedAt: 2 });
    expect(store.list()).toEqual([{ ...definition, name: "Updated weekly review", updatedAt: 2 }]);

    expect(store.remove("automation-1")).toBe(true);
    expect(store.remove("automation-1")).toBe(false);
    expect(createAutomationStore(file).list()).toEqual([]);
  });
});
