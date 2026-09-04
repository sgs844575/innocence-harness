import type { PromptFragment } from "@innocenceharness/harness-system-prompt";

/** Creation-mode knowledge fragment: the extension-point map of this
 *  repository — registration surfaces, plugin manifest semantics, the
 *  permission model, and the testing discipline every plugin must meet.
 *  Original content; keep the names aligned with the spine services. */
export const knowledgeFragments: PromptFragment[] = [
  {
    id: "creation.mode.knowledge",
    order: 2020,
    modes: ["creation"],
    render: () => `## Extension-point map

The plugin context (\`ctx\`) passed to \`apply\` exposes the registration
surfaces. Pick the one that matches the capability:

- **Tools** — \`ctx.tools.register(tool)\`. A tool declares \`name\`,
  \`description\`, \`readOnly\`, a JSON-schema \`parameters\` object, and the
  execution SPI: \`validateArgs\` for cheap structural checks,
  \`permissionResource\` building the canonical resource the call acts on,
  and \`execute\` doing the work. Complete invocation arguments enter
  history, events, permission requests, audit records, and diagnostics.
  A tool missing \`permissionResource\` is rejected at registration.
- **Providers** — \`ctx.providers.register(provider)\` for model backends;
  provider wire conversion stays inside provider packages and never leaks
  into core protocols.
- **Skills** — \`ctx.skills.register(skill)\` for packaged procedural
  guidance the prompt index can surface.
- **Message processors** — \`ctx.session.registerProcessor(processor)\` to
  transform session messages; the pipeline sorts by \`order\`, smaller runs
  first, ties broken by registration order.
- **Agent modes** — \`ctx.agents.register({ id, title, description })\`
  paired with \`ctx.systemPrompt.registerFragment(fragment)\`. Fragments
  carry an id, an \`order\`, an optional \`modes\` tag, an optional \`when\`
  trait predicate, and a \`render(ctx)\`; fragments without a \`modes\` tag
  load for every mode, tagged ones only for their modes. Registration
  makes the mode resolvable inside sessions; the host-side mode switcher
  catalogs it from the manifest instead: the plugin's package.json must
  carry \`"innocenceharness": { "agentMode": { "title": "..." } }\`, where
  \`title\` is the display name the switcher lists. A plugin without that
  block is treated as a plain plugin and never reaches the switcher, so
  every mode plugin must declare it. **The registered agent id, the
  fragment \`modes\` tags, and the plugin id (its directory name in the
  plugin root) must all be the same string**: the switcher stores the
  plugin id into settings and the session resolves the prompt by the
  registered id — if they diverge, the mode appears selectable but every
  turn silently falls back to the base prompt. Tag the mode's fragments
  with \`modes: ["<that id>"]\` so they load only for it.

## Manifest and roots

Plugins load from exactly two roots: the packaged built-in root and the
user root (\`~/.innocence/plugins\`). A user plugin with the same id
shadows the built-in one. The plugin manifest lists what is loaded and lets
the user switch entries off; disabling is a manifest action, never a file
deletion.

## Permissions

Effectful tools go through the permission engine driven by their declared
resource: \`permissionResource\` yields \`{ action, kind, scope }\` and the
policy engine decides allow, deny, or ask. Everything in the resource is
persisted, so the scope carries the full canonical identifier verbatim
(paths, URLs, targets). Complete invocation arguments are persisted alongside
the resource.

## Testing discipline

Every plugin ships non-UI tests: Vitest coverage of its registration and
its primary behavior, run with fake ports and mock providers, never
requiring a window or a renderer. UI tests may supplement, never replace,
this coverage.`,
  },
];
