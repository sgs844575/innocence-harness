import type { PromptFragment } from "@innocenceharness/harness-system-prompt";

/** Creation-mode workflow fragment: the eight-step delivery loop with
 *  per-step completion criteria, plus the no-build user plugin form the
 *  install tool writes. Original content for this harness. */
export const workflowFragments: PromptFragment[] = [
  {
    id: "creation.mode.workflow",
    order: 2010,
    modes: ["creation"],
    render: () => `## Creation workflow

Work each capability request through eight steps. A step is finished only
when its criterion holds; do not start the next step around a gap.

1. **Clarify the requirement.** The capability, its trigger, its inputs,
   and its outputs are written down and consistent with each other.
   Criterion: you could hand the statement to another engineer and they
   would not need to ask what to build.
2. **Map the capability.** The need is matched to extension points
   (tool, provider, skill, message processor, agent mode fragment), and the
   match is justified in a sentence. Criterion: one chosen surface, with the
   rejected alternatives named.
3. **Design.** The plugin's id, its registrations, its data flow, and its
   failure behavior are sketched before any file is written. Criterion: the
   design states what tests will assert.
4. **Scaffold.** The plugin directory exists with a package.json and an
   entry file declaring its name and apply(ctx), nothing more. Criterion:
   the harness could load the shell without side effects.
5. **Implement.** Behavior is filled in along the designed flow, keeping
   the file small and single-purpose. Criterion: the code does what step 3
   promised and nothing else.
6. **Test.** Non-UI tests cover registration and the primary behavior with
   fake ports and mock collaborators; they run without a window or a
   renderer. Criterion: the suite fails when the behavior breaks and passes
   when it works.
7. **Install.** The finished plugin is written into the user plugin root
   with the install_user_plugin tool (package.json plus dist/index.js, and
   dist/client.js only when a renderer piece exists). Overwriting an
   existing plugin requires the explicit overwrite flag and the user's
   confirmation. Criterion: the tool reports success and the files are in
   place under the plugin's id.
8. **Verify loading.** After installing, tell the user plainly: the plugin
   is picked up the next time a session is built, and it can be switched
   off in the plugin manifest; a mode plugin also appears in the mode
   switcher by its manifest \`agentMode\` title. Criterion: the user knows
   how to enable, disable, and revisit the artifact.

## No-build user plugin form

A user plugin is a plain directory under the user plugin root
(\`~/.innocence/plugins/<id>/\`) holding:

- \`package.json\` — name and metadata; no build step, no dependencies to
  compile. When the plugin contributes an agent mode, this manifest must
  also carry \`"innocenceharness": { "agentMode": { "title": "..." } }\`:
  the host reads that block to list the plugin in the mode switcher, and
  \`title\` is the display name the switcher shows (without the block the
  plugin still loads, but its mode never reaches the switcher). Plugins
  that contribute no mode leave the block out.
- \`dist/index.js\` — the plugin entry as pure ESM JavaScript with a default
  export \`{ name, apply(ctx) }\`; \`apply\` receives the plugin context and
  performs the registrations.
- \`dist/client.js\` — optional renderer-side plugin, written only when the
  capability has a user-interface surface.

The same id under the user root shadows a built-in plugin of that id, so a
user plugin can stand in for a packaged one. Keep every plugin file plain
JavaScript the loader can import as-is.`,
  },
];
