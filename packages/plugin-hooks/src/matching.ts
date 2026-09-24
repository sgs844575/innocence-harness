// Hook matching semantics (ecosystem matcher adaptation): one place decides
// whether a hook's `match` applies to a subject. Native ("literal") keeps the
// historical faces — tool-name equality on tool events, prompt-text prefix on
// input events — while the ecosystem matcher shape ("regex") reads `match` as
// a JavaScript regular expression searched UNANCHORED over the same subject,
// mirroring the reference ecosystem ("startup|clear|compact" selects session
// start sources, "Bash|Edit" selects tool names). Patterns compile once per
// string through a small cache; the parser already rejects syntactically
// invalid matchers, so a compile failure here degrades to "no match" instead
// of throwing into the pipeline. Backtracking cost is bounded by the same
// trust boundary as the reference host: matchers arrive from user-installed
// configuration, not from remote content.
import type { HookDefinition } from "./config";

const patternCache = new Map<string, RegExp | null>();

function compiledPattern(pattern: string): RegExp | null {
  const cached = patternCache.get(pattern);
  if (cached !== undefined) return cached;
  let compiled: RegExp | null = null;
  try {
    compiled = new RegExp(pattern);
  } catch {
    compiled = null;
  }
  patternCache.set(pattern, compiled);
  return compiled;
}

/**
 * Decides whether `hook.match` applies to `subject`. `literalMatches` carries
 * the caller's literal semantics (equality, prefix, or an always-true face
 * that historically ignored `match`). A regex-kind hook with an uncompilable
 * pattern matches nothing.
 */
export function hookMatchesSubject(
  hook: HookDefinition,
  subject: string,
  literalMatches: (match: string) => boolean,
): boolean {
  if (hook.match === undefined) return true;
  if (hook.matchKind === "regex") {
    return compiledPattern(hook.match)?.test(subject) ?? false;
  }
  return literalMatches(hook.match);
}
