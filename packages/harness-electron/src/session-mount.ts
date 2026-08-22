import type { Context, ObjectPlugin } from "@innocencecode/kernel";
import type { SessionService } from "@innocencecode/harness-session";
import type { ToolsService } from "@innocencecode/harness-tools";
import type { Provider } from "@innocencecode/harness-providers";
import type { SessionPlugin } from "./registry";
import type { SessionRegistryView } from "./session-registry-view";

export function assertSpineServices(ctx: Context, names: readonly string[]): void {
  for (const name of names) {
    if (ctx.services.resolve(name) === undefined) {
      throw new Error(`spine service missing after mount: ${name}`);
    }
  }
}

export function isKernelPlugin(plugin: SessionPlugin): plugin is ObjectPlugin {
  return "apply" in plugin && typeof plugin.apply === "function";
}

export function chokepointTools(base: ToolsService, view: SessionRegistryView): ToolsService {
  return {
    register: view.registerTool,
    get: (name) => base.get(name),
    specs: () => base.specs(),
    registerMiddleware: (middleware) => base.registerMiddleware(middleware),
    middlewares: () => base.middlewares(),
  };
}

export function chokepointSession(base: Context, view: SessionRegistryView): SessionService {
  const late = (): SessionService => {
    const resolved = base.services.resolve<SessionService>("session");
    if (!resolved) throw new Error("spine service missing after mount: session");
    return resolved;
  };
  return {
    get history() { return late().history; },
    registerProcessor: view.registerMessageProcessor,
    processors: () => late().processors(),
    processUserInput: (input, signal) => late().processUserInput(input, signal),
    emit: (event) => late().emit(event),
    get compactor() { return late().compactor; },
  };
}

export function resolveRegistryProvider(ctx: Context, providerId: string | undefined): Provider {
  if (providerId) {
    const found = ctx.providers.get(providerId);
    if (!found) throw new Error(`provider not found: ${providerId}`);
    return found;
  }
  const ids = ctx.providers.ids();
  if (ids.length !== 1) throw new Error("no provider configured");
  return ctx.providers.get(ids[0])!;
}
