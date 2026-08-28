import { defineSkill } from "../define";

/**
 * Harness configuration guide (adapted from the reference project's
 * configuration/update-config/doctor/usage-explanation skill family,
 * product-specific settings formats removed and mapped onto this harness's
 * real surfaces: the host-managed session settings file, the two-layer
 * plugin config sources, and the skill directory conventions).
 */
export const harnessConfigurationSkill = defineSkill(
  "harness-configuration",
  "Map this harness's three configuration surfaces — session settings file, user and project plugin config layers, skill directories — change one thing at a time, and verify in a fresh session",
  `# Navigating this harness's configuration surfaces

Three separate surfaces configure this harness. "Where does this live" questions start with picking the right surface, then verifying against the running repository rather than memory.

## The three surfaces

**Session settings** live in one host-managed file under the user data directory (harness-settings.json). They hold the provider profiles (endpoint, model list, enabled flag), which profile and model are active, the permission mode (ask, auto, plan, full), the active agent mode, the reasoning effort, the workspace root, and user-level builtin plugin toggles. Provider credentials sit in the host's secure storage, referenced indirectly. An unreadable settings file falls back to defaults; an incomplete active profile falls back to the offline mock — silent mock behavior usually means the active profile is disabled, lacks a credential, or names a missing model.

**Plugin configuration** spans two YAML layers: the user-level file at ~/.innocence/cordis.yml and the project-level .innocence/plugins.yml under the workspace root. Entries are a boolean or an object with an enabled flag plus a config block; unknown keys are ignored with a warning. The project layer overrides the user layer per key, and settings toggles override the user file per key. The builtin list comes from the staging manifest: core entries cannot be disabled, and disabling one cascades to its dependents. Plugins discovered by scanning the user plugin root join the list enabled by default.

**Skill directories** hold on-demand instructions as SKILL.md files — frontmatter name and description, markdown body — under .innocence/skills (project) and ~/.innocence/skills (user). On a clashing name the project root wins; malformed frontmatter skips the entry.

One precedence rule cuts across: the module resolver checks the user plugin root before the builtin staging root, so a same-named user plugin shadows the builtin module body; manifest metadata still governs toggles.

## Change one thing, then prove it

Make one change at a time. Read the target file before writing, merge instead of replacing, and keep the file parseable — an unparseable file is discarded wholesale with only a log line, so broken syntax reads as settings silently vanishing. New sessions pick up settings changes without restarting the host: session assembly reads settings fresh, and the plugin inventory re-resolves on every query. Verify in a fresh session — send a message, re-check the inventory or mode catalog — and confirm the intended effect holds. If it does not, revert that single change and re-examine which surface truly owns the setting.

## Self-diagnosis checklist

When the harness misbehaves, check in order: run the test suite and both typechecks; compare the plugin inventory against the scan and parse warnings in the log; parse-check the settings file and both YAML layers; confirm the active provider profile is enabled with a credential present and the selected model in its list.

## Explaining a capability

Capabilities are plugin contributions — tools, skills, and agent modes. Discover them from the mode switcher and the plugin inventory; a skill's one-line description sits in the skills index, and its body loads on /name invocation.`,
);
