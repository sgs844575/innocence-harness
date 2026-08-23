# Group Loader Ecosystem Requirements

## Requirement Blocks

### RB-1: Declarative group entries
- **Priority:** High
- **Dependencies:** Existing manifest descriptors, `ConfigLayer`, loader entry protocol.
- Configuration layers may declare `groups.<name>` entries. Each group has a loader-facing id and ordered child entry declarations; child declarations support `id`, optional `name`, `config`, and `disabled`.
- Group declarations are normalized without mutating source objects. Invalid group shapes produce warnings and are ignored rather than aborting config loading.

### RB-2: ConfigLayer group parsing and layered overrides
- **Priority:** High
- **Dependencies:** RB-1.
- `ConfigLayer` exposes normalized groups. User and project layers merge by group name with project values taking precedence; a project group can override a user group atomically.
- Unknown groups and malformed child declarations emit deterministic warnings. Existing plugin toggle/config semantics remain unchanged.

### RB-3: resolveEntries group projection
- **Priority:** High
- **Dependencies:** RB-1, RB-2.
- `resolveEntries` appends active group loader entries after ordinary manifest entries using `group:<name>` IDs and loader builtin names.
- Group entries retain ordered child options, active/disabled state, and config payloads. Group entries participate in the returned active/skipped/warnings projection without changing existing plugin dependency topology.

### RB-4: Staging and route loader integration
- **Priority:** High
- **Dependencies:** RB-3, existing dynamic spine loading and `createResolved` bridge.
- The staging build includes `kernel-group`; `spineLoader` dynamically loads it and `SessionSpineSuite` exposes it.
- Root and route loader composition mounts group entries through the real loader tree. Route `SessionLoaderPlugin` supports resolved plugin injection and group ownership while preserving `ctx.entry`.
- Skills and MCP children are resolved by host factories and injected into child entries; no domain package imports Electron or React.

### RB-5: Real loader subtree identity and transactional cleanup
- **Priority:** High
- **Dependencies:** RB-3, RB-4.
- Group children use composite IDs (`group:<child>` under the group entry, nested groups supported) and are visible through `loader.resolve`/`entries`.
- If any child import/start fails, all children started by that group attempt are disposed and the failure is rethrown. Disposing the group disposes its complete child subtree.

### RB-6: Verification and delivery
- **Priority:** High
- **Dependencies:** RB-1 through RB-5.
- Add TDD coverage for parser warnings, layer precedence, group projection, host factory injection, composite IDs, nested groups, disabled children, rollback, and disposal.
- Run targeted tests, `npm run typecheck`, and `npm run typecheck:packages`; review the full diff and commit the complete implementation.

## Acceptance Criteria

1. `ConfigLayer` parses valid group declarations and warns/ignores malformed declarations without changing existing plugin parsing.
2. Project group values override user group values deterministically; source layers remain unchanged.
3. `resolveEntries` keeps ordinary entries intact and appends `group:<name>` entries with ordered child options.
4. Staging includes the group package and both static and dynamically loaded spine contracts expose the group module.
5. Route sessions use `createResolved` for host-configured skills/MCP children and loader ownership remains the source of lifecycle truth.
6. Real loader trees expose composite IDs, support nested groups, skip disabled children, roll back all started members on failure, and dispose members with their group.
7. Non-UI tests cover all primary domain behavior; root and package typechecks pass.
8. No unrelated untracked files are modified.

## Change Log

| Date | Reason | Content |
| --- | --- | --- |
| 2026-08-22 | Approved solution 1 and original task brief | Defined declarative groups, layered configuration, resolved group entries, staging spine injection, host factories, composite loader identities, transactional rollback, and verification scope. |
