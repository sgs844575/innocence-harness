# Group Loader Ecosystem Implementation Plan

> **For agentic workers:** Execute this plan task-by-task with TDD and update the session Todo after each completed task.

**Goal:** Add declarative, host-resolved plugin groups to the existing loader/config/staging/session pipeline with composite IDs and transactional lifecycle behavior.

**Architecture:** Extend `ConfigLayer` with normalized group declarations and keep ordinary plugin resolution unchanged. Project/user groups are merged atomically, then projected as `group:<name>` loader rows. The staging group module is injected into the dynamic spine, while route composition resolves skills/MCP factories and passes concrete child plugins through `createResolved`; the loader/group runtime owns subtrees, cleanup, and rollback.

**Tech Stack:** TypeScript, Node.js, Vitest, YAML parser, workspace packages, dynamic ESM staging.

## Global Constraints

- Domain packages remain host-agnostic and must not import Electron, React, DOM APIs, or host IPC.
- New behavior receives Node/Vitest coverage without starting Electron or rendering React.
- Preserve unrelated working-tree files, especially existing `documentation/` and `task-4-report.md` changes.
- Use explicit UTF-8 repository-aware file edits.
- Run `npm run typecheck` and `npm run typecheck:packages`; run targeted Vitest suites before final acceptance.

---

### Task 1: Normalize group declarations in ConfigLayer (RB-1, RB-2)

**Files:**
- Modify: `src/main/pluginBoot/configSources.ts`
- Test: `src/main/pluginBoot/configSources.test.ts`

**Interfaces:**
- Produce `GroupEntryConfig` and `GroupConfig` types exported from `configSources.ts`.
- Extend `ConfigLayer` with `groups: Record<string, GroupConfig>`.
- Keep `parsePluginConfigLayer(raw, options)` and `mergeConfigLayers(user, project)` signatures source-compatible.

- [ ] Add tests for valid groups, malformed group/name/child warnings, and project atomic override.
- [ ] Run `npx vitest run src/main/pluginBoot/configSources.test.ts` and observe failures.
- [ ] Implement strict normalization with deterministic warnings and immutable output.
- [ ] Update existing expected empty layers and run the config source suite to green.

### Task 2: Project groups from resolveEntries (RB-3)

**Files:**
- Modify: `src/main/pluginBoot/pluginEntries.ts`
- Test: `src/main/pluginBoot/pluginEntries.test.ts`

**Interfaces:**
- `ResolvedEntries.entries` continues to be `EntryOptions[]`; group rows use `name: "kernel:group"` and `id: "group:<name>"`.
- Group row config carries normalized child entries under a stable group payload consumed by the host composition.

- [ ] Add failing tests asserting ordinary entries remain unchanged and group rows append in declaration order.
- [ ] Run the focused test and verify missing group projection.
- [ ] Implement project-over-user group selection and active/disabled group row projection plus warnings.
- [ ] Run both `pluginEntries.test.ts` and `configSources.test.ts` to green.

### Task 3: Inject group module into static and staging spines (RB-4)

**Files:**
- Modify: `packages/harness-electron/src/session-spine.ts`
- Modify: `src/main/pluginBoot/spineLoader.ts`
- Modify: `scripts/build-plugins.mjs`
- Modify: `package.json`/lockfile only if dependency metadata requires it
- Test: `src/main/pluginBoot.integration.test.ts` or a focused spine test

**Interfaces:**
- `SessionSpineSuite.group` is the namespace type for `@innocencecode/kernel-group`.
- `loadKernelSuite` imports staged `kernel-group` alongside existing loader modules.

- [ ] Add a test assertion for the injected group namespace and staging build artifact.
- [ ] Run the focused test/build check and observe the missing spine member.
- [ ] Add the group dependency to the harness host package if needed, add `kernel-group` to `LIBS`, import it in `spineLoader`, and mount/register it as the loader builtin.
- [ ] Run staging build and targeted integration tests.

### Task 4: Route loader group ownership and host factory children (RB-4, RB-5)

**Files:**
- Modify: `packages/harness-electron/src/session-loader.ts`
- Modify: `packages/harness-electron/src/session-kernel.ts`/session composition integration points as required
- Modify: `src/main/pluginBoot/sessionComposition.ts`
- Test: `packages/harness-electron/tests/session.test.ts`, `src/main/pluginBootConfigRuntime.integration.test.ts`

**Interfaces:**
- `SessionLoaderPlugin` supports optional `parent`/group metadata and an already-resolved `plugin`.
- Host factory resolution returns concrete `ObjectPlugin` children for skills and MCP; child rows are mounted below a resolved group entry.

- [ ] Add failing route tests proving group and child rows use `createResolved`, preserve `ctx.entry`, and expose composite IDs.
- [ ] Implement route mount ordering and host factory child injection without importing host APIs in domain packages.
- [ ] Add disabled-child and nested-group coverage through the actual loader service.
- [ ] Run session and route integration tests.

### Task 5: Transactional loader group behavior (RB-5)

**Files:**
- Modify: `vendor/kernel-group/src/index.ts` only if required by the real host contract
- Modify: `vendor/kernel-loader/src/index.ts` only if parent-resolved creation needs a missing narrow API
- Test: `vendor/kernel-group/tests/group.spec.ts`, `vendor/kernel-loader/tests/loader-composition.spec.ts`

**Interfaces:**
- `createGroupPlugin({ id, entries })` remains the public group factory.
- Group children are created below `ctx.entry` using loader APIs; failure disposes every owned child fiber and rethrows.

- [ ] Add/strengthen tests for import failure rollback, nested composite IDs, disabled entries, and group disposal.
- [ ] Run vendor group/loader suites and verify failures before implementation.
- [ ] Make the smallest implementation change necessary for real staged/resolved plugins and cleanup.
- [ ] Run vendor suites and package typecheck.

### Task 6: Full verification, optimization, and acceptance (RB-6)

**Files:**
- Review all changed files; no report file is created by this task.

- [ ] Run targeted suites covering config, entries, group, loader, session, and boot integration.
- [ ] Run `npm run typecheck` and `npm run typecheck:packages`.
- [ ] Run `npm test` if the repository script is available; distinguish pre-existing/flaky failures from regressions.
- [ ] Review diff for duplicate parsing, sequential/N+1 imports, unhandled cleanup, oversized files, and dependency-direction violations.
- [ ] Re-run affected verification after fixes.
- [ ] Commit the complete implementation with a focused message and report commit, tests, and deviations.

## Plan Self-Review

- RB-1/RB-2 map to Task 1; RB-3 maps to Task 2; RB-4 maps to Tasks 3-4; RB-5 maps to Tasks 4-5; RB-6 maps to Task 6.
- No placeholder steps remain; every task names files, interfaces, tests, and commands.
- Group rows use one stable loader identity (`group:<name>`) and a single normalized payload consumed by host composition.
