export interface SettingsMutationGate {
  enqueue<T>(operation: () => Promise<T>): Promise<T>;
  read<T>(reader: () => T): Promise<T>;
  waitForPending(): Promise<void>;
}

/** Serializes settings writes so dependent projections never observe stale state. */
export function createSettingsMutationGate(): SettingsMutationGate {
  let tail = Promise.resolve();

  return {
    enqueue<T>(operation: () => Promise<T>): Promise<T> {
      const result = tail.then(operation);
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
    read<T>(reader: () => T): Promise<T> {
      return tail.then(reader);
    },
    waitForPending(): Promise<void> {
      return tail;
    },
  };
}
