import { describe, expect, it } from "vitest";
import { createSettingsMutationGate } from "./settingsMutationGate";

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  return { promise: new Promise<void>((done) => { resolve = done; }), resolve };
}

describe("settings mutation gate", () => {
  it("holds readers until an already queued settings write completes", async () => {
    const gate = createSettingsMutationGate();
    const writeStarted = deferred();
    const releaseWrite = deferred();
    let persisted = false;

    const write = gate.enqueue(async () => {
      writeStarted.resolve();
      await releaseWrite.promise;
      persisted = true;
    });
    await writeStarted.promise;
    const reader = gate.waitForPending().then(() => persisted);

    releaseWrite.resolve();
    expect(await reader).toBe(true);
    await write;
  });

  it("continues processing after a failed write", async () => {
    const gate = createSettingsMutationGate();
    await expect(gate.enqueue(async () => { throw new Error("write failed"); })).rejects.toThrow("write failed");
    await expect(gate.enqueue(async () => "next")).resolves.toBe("next");
  });

  it("rebases queued mutations by reading state inside each gated operation", async () => {
    const gate = createSettingsMutationGate();
    let committed = 0;
    const first = gate.enqueue(async () => { committed = 1; });
    const second = gate.enqueue(async () => {
      committed += 1;
      return committed;
    });

    await first;
    await expect(second).resolves.toBe(2);
  });
});
