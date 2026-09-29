import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { DshToolDefinition } from "./tool";

/**
 * Reference-harness (dsh / Cordis) plugin shapes and loading. A dsh plugin is
 * a module exporting `name` / `inject` / `apply` in one of three forms — a
 * bare `apply` function, a default-exported object with an `apply` method, or
 * a `Service` subclass. The compatibility layer supports the first two; the
 * Service class form is rejected loudly (its base class import only resolves
 * inside a reference-harness installation).
 */

/** Logger face reference-harness plugins expect on `ctx.logger`. */
export interface DshLogger {
  debug(message: string, ...rest: unknown[]): void;
  info(message: string, ...rest: unknown[]): void;
  warn(message: string, ...rest: unknown[]): void;
  error(message: string, ...rest: unknown[]): void;
  success(message: string, ...rest: unknown[]): void;
}

/** The context face handed to one reference-harness plugin. */
export interface DshContext {
  on(name: string, listener: (...args: unknown[]) => void): () => void;
  emit(name: string, ...args: unknown[]): void;
  effect(
    body: () => (() => void | Promise<void>) | void,
    label?: string,
  ): () => void | Promise<void>;
  provide(name: string, instance: unknown): () => void;
  tools: { register(definition: DshToolDefinition): void };
  logger: DshLogger;
  config: Record<string, unknown>;
}

/** One loaded reference-harness plugin, normalized across module forms. */
export interface ResolvedDshPlugin {
  name?: string;
  inject: readonly string[];
  apply(ctx: DshContext, config?: unknown): void | Promise<void>;
}

/** True when the value is an ES class (the unsupported Service form). */
function isClass(value: unknown): boolean {
  if (typeof value !== "function") return false;
  return /^\s*class[\s{]/.test(Function.prototype.toString.call(value));
}

/**
 * Normalizes one imported module to a {@link ResolvedDshPlugin}. Accepts the
 * bare-function form (`export function apply` or a function default export)
 * and the object form (default export with an `apply` method); `name` /
 * `inject` may live on the module or on the exported plugin object.
 */
export function moduleToDshPlugin(mod: unknown): ResolvedDshPlugin {
  const record = (mod ?? {}) as Record<string, unknown>;
  const candidate = record.default ?? record;
  const nameOf = (holder: Record<string, unknown>): string | undefined =>
    typeof holder.name === "string" && holder.name.length > 0 ? holder.name : undefined;
  const injectOf = (holder: Record<string, unknown>): readonly string[] => declaredInject(holder.inject);
  if (isClass(candidate)) {
    throw new Error("class-form (Service) plugins are not supported by the compatibility layer");
  }
  if (typeof candidate === "function") {
    const fn = candidate as unknown as Record<string, unknown>;
    const name = nameOf(record) ?? nameOf(fn);
    return {
      ...(name ? { name } : {}),
      inject: [...injectOf(record), ...injectOf(fn)],
      apply: candidate as (ctx: DshContext, config?: unknown) => void | Promise<void>,
    };
  }
  if (candidate && typeof candidate === "object" && typeof (candidate as { apply?: unknown }).apply === "function") {
    const object = candidate as Record<string, unknown>;
    const apply = object.apply as ResolvedDshPlugin["apply"];
    const name = nameOf(record) ?? nameOf(object);
    const inject = [...injectOf(record), ...injectOf(object)];
    return {
      ...(name ? { name } : {}),
      inject,
      apply: (ctx, config) => apply(ctx, config),
    };
  }
  throw new Error("module is not a reference-harness plugin (no default export and no apply export)");
}

/**
 * Flattens a declared `inject` list. Entries may be service-name strings or
 * `{ required, optional }` objects; optional services never gate loading.
 */
export function declaredInject(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const required: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      required.push(item);
    } else if (item && typeof item === "object" && Array.isArray((item as { required?: unknown }).required)) {
      for (const name of (item as { required: unknown[] }).required) {
        if (typeof name === "string") required.push(name);
      }
    }
  }
  return required;
}

/**
 * Resolves one module specifier to a file URL and imports it. Absolute and
 * relative (`./`, `../`) specifiers resolve against `baseDir` (the patch
 * file's directory); bare specifiers resolve through the reference harness's
 * package layout in `baseDir` (bundle `node_modules`). TypeScript entry files
 * load on hosts whose runtime strips types natively; otherwise the import
 * failure is reported per entry.
 */
export async function importDshPlugin(baseDir: string, specifier: string): Promise<ResolvedDshPlugin> {
  let target: string;
  if (path.isAbsolute(specifier)) {
    target = specifier;
  } else if (specifier.startsWith("./") || specifier.startsWith("../")) {
    target = path.resolve(baseDir, specifier);
  } else {
    const require = createRequire(path.join(baseDir, "package.json"));
    target = require.resolve(specifier);
  }
  const mod = await import(pathToFileURL(target).href);
  return moduleToDshPlugin(mod);
}
