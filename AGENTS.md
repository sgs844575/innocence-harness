# InnocenceCode Repository Guidelines

## Architecture

1. **Prefer plugins for reusable capabilities.** New providers, tools, skills, policies, message processors, and reusable domain capabilities should live in independently testable `packages/*` modules and register through the vendor kernel family and harness spine extension points. Pure presentation, host lifecycle code, and narrowly scoped changes inside an existing responsibility may remain in the host. Document any exception in the change summary.

2. **Keep the framework and capability layers separate.** The `vendor/kernel*` family is the framework layer. The `harness-*` packages are spine services that compose sessions and runtime capabilities. `plugin-*`, `tools-*`, and `provider-*` packages are capability plugins. Domain packages must remain host-agnostic and must not import or depend on Electron, React, React DOM, browser DOM APIs, `src/main`, `src/preload`, or `src/webview`; host framework dependencies belong only in root host code or explicitly named host adapter packages.

3. **Inject production sessions through the dynamic staging spine.** Production sessions must be created and wired by the dynamically staged spine rather than by presentation code or hard-coded host imports. Capability plugins load only from the two approved roots: packaged `resources/plugins` and the user's `~/.innocence/plugins` directory. Plugin loading, lifecycle, and disposal must remain explicit and testable.

4. **Integrate hosts and UI clients through ports, adapters, and slots.** Electron, a future CLI, tests, and UI clients must inject capabilities through typed interfaces, callbacks, configuration, factories, events, and slot registry contracts. UI client contributions use the `innocence-plugin://` protocol and the slot registry. Domain packages must not call Electron IPC, `BrowserWindow`, React state, DOM presentation APIs, or CLI stdout directly.

5. **Keep core protocols host- and provider-neutral.** Canonical messages, deltas, tools, providers, skills, policies, permissions, and events must not contain Electron types, React components, IPC channel names, DOM objects, or provider wire payloads. Provider conversion belongs in `provider-*`; host conversion belongs in adapters; unavoidable cross-domain dependencies must be documented.

## Module Design

6. **Use divide-and-conquer and single responsibility.** Each module should have one clear reason to change. Treat roughly 250-300 lines in a production TS/TSX file as a signal to split by responsibility, such as `protocol`, `domain`, `adapter`, `store`, or `view`. Do not add unrelated behavior to already oversized modules such as `App.tsx`, `settings.ts`, or `sessions.ts` without first extracting the relevant responsibility.

7. **Keep presentation replaceable.** React components render typed view models and emit commands; they do not own Git, Playwright, attachment parsing, task state machines, or persistence rules. A feature must remain usable by a non-UI host unless it is inherently visual.

8. **Manage resources explicitly.** Plugins and runtimes that start processes, watchers, workers, transports, PTYs, browser contexts, or temporary worktrees must expose asynchronous cleanup and be disposed by their owner. Deleting a cache entry is not resource cleanup.

## Testing And Verification

9. **Require non-UI tests for domain behavior.** Every plugin or domain capability needs Node/Vitest coverage that does not start Electron or render React. Cover registration and the primary behavior with fake ports, fake runtime hooks, mock providers, or CLI-style `AgentSession` integration tests. UI tests supplement rather than replace these tests.

10. **Verify package and host boundaries.** New workspace packages belong under `packages/*` and need `package.json`, `tsconfig.json`, a `typecheck` script, and tests appropriate to their responsibility. Before completion run `npm test`, `npm run typecheck`, and `npm run typecheck:packages`. Also run `npm run package` when changing Electron main/preload code, packaging, native resources, workspace bundling, or embedded browser binaries.

## Editing Safety

11. **Preserve user work.** Never overwrite or revert unrelated working-tree changes. Task-level restore, review, and automation features must not use or mutate the user's Git index unless the user explicitly requests that operation.

12. **Use safe UTF-8 file operations.** On Windows, do not rewrite repository text with PowerShell `Get-Content`/`Set-Content`, CMD redirection, or other locale-dependent commands. Use repository-aware edit tools or Node APIs with explicit UTF-8 encoding.

13. **Keep documentation out of Git.** Never add, stage, or commit documentation files. In particular, files under `docs/` or `documentation/`, as well as repository plans, specifications, and other documentation artifacts, are local-only and must remain ignored; `AGENTS.md` is the required repository-instruction exception.

## Expression

14. **Keep third-party names and trademarks out of development artifacts.** Code identifiers, comments, commit messages, changelogs, user-facing documentation, UI copy, and log output must not mention third-party product, company, or model names or trademarks; use neutral terms (for example "the plugin kernel", "the reference project") instead. Exemptions: dependency declarations and import specifiers required to resolve packages, opaque API key strings defined by external code, legal attribution files (`LICENSE`, `THIRD_PARTY_NOTICES.md`), and vendored third-party sources under `vendor/` (kept verbatim for upstream synchronization). Local, uncommitted working documents may reference upstream names when needed for development.
