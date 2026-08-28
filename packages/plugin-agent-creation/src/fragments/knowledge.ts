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
  persistence-safe SPI: \`validateArgs\` for cheap structural checks,
  \`permissionResource\` building the canonical resource the call acts on,
  \`persistArgs\` producing the only copy of the arguments that may enter
  history or audit, and \`execute\` doing the work. A tool missing
  \`permissionResource\` or \`persistArgs\` is rejected at registration —
  there is no legacy fallback.
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
  load for every mode, tagged ones only for their modes.

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
persisted, so the scope must contain the canonical identifier only —
redacted, never raw secret-bearing values.

## Testing discipline

Every plugin ships non-UI tests: Vitest coverage of its registration and
its primary behavior, run with fake ports and mock providers, never
requiring a window or a renderer. UI tests may supplement, never replace,
this coverage.`,
  },
];
