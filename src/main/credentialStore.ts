import { randomUUID } from "node:crypto";
import type { SecureStorage } from "@innocenceharness/secure-storage-node";

const CREDENTIAL_REF = /^keys\/[A-Za-z0-9_-]+\.key$/;

export interface CredentialStore {
  read(ref: string): Promise<string>;
  write(profileId: string, value: string): Promise<string>;
  delete(ref: string): Promise<void>;
}

/** Stores provider credentials in the host's secured storage namespace. */
export function createCredentialStore(storage: SecureStorage): CredentialStore {
  const assertReference = (ref: string): void => {
    if (!CREDENTIAL_REF.test(ref)) throw new Error("invalid credential reference");
  };

  return {
    async read(ref) {
      assertReference(ref);
      return storage.readTextFile(ref);
    },
    async write(_profileId, value) {
      const ref = `keys/${randomUUID()}.key`;
      await storage.writeFileAtomic(ref, value);
      return ref;
    },
    async delete(ref) {
      assertReference(ref);
      await storage.deleteFile(ref);
    },
  };
}
