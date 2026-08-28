import type { PromptFragment } from "@innocenceharness/harness-system-prompt";

/** Trait-conditional fragments (no `modes`, gated by `when` on host-detected
 *  project traits; each render re-checks its trait so direct renders outside
 *  the assembler stay honest — an unmet trait yields an empty string, which
 *  the assembler skips). English adaptation of the reference prompt library's
 *  environment notes: rewritten, never verbatim; neutral terminology except
 *  the unavoidable platform and runner names; mechanics mapped to this
 *  harness (cmd-backed shell tool on Windows, npm-workspaces repository,
 *  vitest suite, desktop Electron application). */
export const conditionalFragments: PromptFragment[] = [
  {
    id: "default.conditional.winshell",
    order: 3000,
    when: (t) => t.os === "win32",
    render: (ctx) => (ctx.traits.os === "win32" ? `# Windows shell notes

On this host the shell tool runs commands through cmd, not a POSIX
shell: quoting, escapes, and the available utilities all differ.

## Quoting and escapes

- Double quotes are the quoting character; single quotes are ordinary
  text. Wrap an argument that contains spaces in double quotes, and
  escape a literal double quote inside a quoted stretch by doubling it.
- The caret \`^\` escapes the next character. A \`%\` pair expands
  variables even inside double quotes, so spell out any literal percent
  sign deliberately or keep it out of echoed text.

## Missing POSIX utilities

- Pipes (\`|\`), redirection (\`>\` and \`>>\`), and \`&&\` / \`||\` chaining
  exist; \`grep\`, \`sed\`, \`awk\`, and \`ls\` do not. Reach for the
  equivalents: \`findstr\` for text search, \`dir\` for listings, and
  when nothing in cmd fits, a short Node one-liner (\`node -e "…"\`)
  beats a pile of caret continuations.

## Paths and long runs

- Paths use backslashes and often contain spaces: quote the whole path
  (\`"C:\\Program Files\\app"\`) instead of relying on the tool to guess
  where it ends.
- Give long-running commands — installs, builds, test suites — an
  explicit generous \`timeoutMs\` rather than letting the default cut
  them short.
- Sleeping stays a last resort: issue a ready command now, diagnose a
  failing one instead of pausing and repeating it, and poll an outside
  process with a command that reports its actual state.` : ""),
  },
  {
    id: "default.conditional.monorepo",
    order: 3010,
    when: (t) => t.monorepo === "workspaces",
    render: (ctx) => (ctx.traits.monorepo === "workspaces" ? `# Workspace layout

This repository is one npm-workspaces tree: the root manifest holds the
shared configuration and the lockfile, and each workspace is a package
under \`packages/<name>\` or \`vendor/<name>\` with its own manifest,
sources, and tests.

- Find a file's package before acting on it: walk up to the nearest
  \`package.json\` and treat that directory as the unit of scope —
  commands, typechecks, and test runs are all per package.
- Every shell call starts over in the repository root, so name the
  target: \`npx vitest run packages/<name>\` covers one package's suite,
  and \`npm run <script> --workspace <name>\` reaches a package script.
  Whole-tree commands (\`npm test\`, \`npm run typecheck:packages\`) belong
  at the root.
- Installed modules hoist to the root \`node_modules\`, yet a dependency
  is declared by the package that imports it; adding one without a
  consumer in the same change leaves dead weight behind.
- Respect the boundary when editing: reach a sibling package through its
  exported surface, never by importing around it, and keep a change
  inside one package from rewriting another package's files.` : ""),
  },
  {
    id: "default.conditional.testrunner",
    order: 3020,
    when: (t) => t.test === "vitest",
    render: (ctx) => (ctx.traits.test === "vitest" ? `# Test suite

The suite is vitest, driven from the repository root.

- Scope the run to what changed: \`npx vitest run packages/<name>\` covers
  a single package, and a path argument narrows to one suite. Watch mode
  does not fit this harness — each command runs in a fresh shell, so use
  the one-shot \`run\` form and let it exit.
- Finish with the suite green. After a code change, run the tests that
  cover the changed behavior before reporting the work done; a red test
  named after your change means the change is still unfinished. New
  behavior arrives together with the test that pins it, ideally written
  first so it fails for the right reason.
- Read a failure as information: the assertion diff names what actually
  happened and the stack locates it. Fix the cause rather than bending
  the test to the accident, and when a test is genuinely obsolete, say
  so and replace it rather than quietly deleting it.
- A passing suite settles code shape, not working features: what the
  user can see still needs exercising in the running desktop
  application, and where no verification can run at all, report that
  plainly instead of a clean result.` : ""),
  },
];
