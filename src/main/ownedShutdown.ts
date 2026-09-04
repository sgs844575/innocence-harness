export interface OwnedShutdownOptions {
  blockStartup(): void;
  waitForStartup(): Promise<void>;
  rejectPendingPermissionAsks(): void;
  /** Skips every unanswered question card (ask_user) at shutdown. */
  rejectAllPendingQuestions(): void;
  disposeAutomationLifecycle(): Promise<void>;
  disposeAllRuntime(): Promise<void>;
  disposeTelemetry(): Promise<void>;
  disposePluginBoot(): Promise<void>;
  disposeTaskRuntime(): Promise<void>;
  disposeTerminals(): Promise<void>;
}

/** Releases startup-owned and runtime resources in deterministic owner order. */
export function createOwnedShutdown(options: OwnedShutdownOptions): () => Promise<void> {
  return async () => {
    options.blockStartup();
    options.rejectPendingPermissionAsks();
    options.rejectAllPendingQuestions();
    await options.waitForStartup();
    await options.disposeAutomationLifecycle();
    await options.disposeAllRuntime();
    await options.disposeTelemetry();
    await options.disposePluginBoot();
    await options.disposeTaskRuntime();
    await options.disposeTerminals();
  };
}
