import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openSecureStorage } from "@innocenceharness/secure-storage-node";
import { createCredentialStore } from "./credentialStore";

describe("credential store", () => {
  it("writes a credential behind an opaque reference and reads it back", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "settings-credentials-"));
    try {
      const storage = await openSecureStorage(root, { dirs: ["keys"] });
      const store = createCredentialStore(storage);
      const ref = await store.write("profile 1", "secret-value");

      expect(ref).toMatch(/^keys\/[A-Za-z0-9_-]+\.key$/);
      await expect(store.read(ref)).resolves.toBe("secret-value");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("deletes an existing credential reference", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "settings-credentials-"));
    try {
      const storage = await openSecureStorage(root, { dirs: ["keys"] });
      const store = createCredentialStore(storage);
      const ref = await store.write("profile", "secret-value");
      await store.delete(ref);
      await expect(store.read(ref)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects references outside the credential namespace", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "settings-credentials-"));
    try {
      const storage = await openSecureStorage(root, { dirs: ["keys"] });
      const store = createCredentialStore(storage);
      await expect(store.read("objects/not-a-key")).rejects.toThrow("invalid credential reference");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
