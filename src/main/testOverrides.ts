export const CONTROLLED_TEST_ARGUMENT = "--innocence-controlled-test";
export const TEST_MODE_MARKER = "1";

export interface TestOverrideEnvironment {
  isPackaged: boolean;
  env: NodeJS.ProcessEnv;
  argv: readonly string[];
}

export interface TestOverrides {
  enabled: boolean;
  userData?: string;
  userPluginRoot?: string;
  builtinPluginRoot?: string;
}

/**
 * Resolve test-only host overrides. Development acceptance needs the explicit
 * marker; packaged acceptance additionally needs the explicit launch argument.
 * Ordinary packaged processes never consult the override paths.
 */
export function resolveTestOverrides(input: TestOverrideEnvironment): TestOverrides {
  if (input.env.INNOCENCE_TEST_MODE !== TEST_MODE_MARKER) return { enabled: false };
  if (input.isPackaged && !input.argv.includes(CONTROLLED_TEST_ARGUMENT)) {
    return { enabled: false };
  }
  return {
    enabled: true,
    ...(input.env.INNOCENCE_TEST_USER_DATA ? { userData: input.env.INNOCENCE_TEST_USER_DATA } : {}),
    ...(input.env.INNOCENCE_TEST_USER_PLUGIN_ROOT
      ? { userPluginRoot: input.env.INNOCENCE_TEST_USER_PLUGIN_ROOT }
      : {}),
    ...(input.env.INNOCENCE_TEST_BUILTIN_PLUGIN_ROOT
      ? { builtinPluginRoot: input.env.INNOCENCE_TEST_BUILTIN_PLUGIN_ROOT }
      : {}),
  };
}

export function currentTestOverrides(isPackaged: boolean): TestOverrides {
  return resolveTestOverrides({
    isPackaged,
    env: process.env,
    argv: process.argv,
  });
}
