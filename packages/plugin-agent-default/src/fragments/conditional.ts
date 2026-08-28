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
    id: "default.conditional.powershell",
    order: 3000,
    when: (t) => t.os === "win32",
    render: (ctx) => (ctx.traits.os === "win32" ? `# Windows shell notes

On this host the shell tool speaks cmd, and PowerShell is a program you
opt into by name — \`powershell\` for edition 5.1, \`pwsh\` for 7+ — when a
task genuinely needs it: registry work, service control, Windows
management objects, or cmd-unfriendly scripting.

## Editions to keep apart

- 5.1 (\`powershell.exe\`) is missing every modern operator: no \`&&\` or
  \`||\` chaining, no ternary, no null-coalescing, and no null-conditional
  member access — writing any of them is a parse error. Sequence
  statements with \`;\`, guard success with \`if ($?)\`, branch with
  \`if/else\`, and test for emptiness against \`$null\` outright.
- 7+ (\`pwsh\`) understands all of those and writes UTF-8 with no byte
  order mark by default. When you cannot tell which edition will execute
  a script, stay inside the 5.1 subset — it runs under both.
- Assorted 5.1 traps: pointing \`2>&1\` at a native tool's error stream
  wraps each line into an error record and counts the pipeline as failed
  even though the process exited zero, while the tool already collects
  that stream for you; \`Set-Content\` keeps writing the legacy ANSI
  codepage unless \`-Encoding utf8\` is passed, which matters the moment
  another tool reads the file back; and \`ConvertFrom-Json\` yields a
  \`PSCustomObject\` rather than a hashtable.

## Quotes and escapes

- Single-quoted strings are literal — embed one quote by writing it
  twice (\`'it''s'\`) — and double quotes interpolate, so prefer single
  quotes around text carrying \`$\` or backticks that must arrive intact.
- Carry multi-line text in a here-string (\`@'\` opening, \`'@\` closing at
  column 0) instead of stacking escape sequences.
- The cmd layer sits underneath: a \`powershell -Command\` line sent
  through the shell tool is parsed by cmd first, and \`%\` or doubled
  quotes can shift meaning before PowerShell ever sees them.

## Waiting

\`Start-Sleep\` gets the same discipline as any other wait: commands that
are ready go out now; a failing command gets its cause diagnosed, not a
pause and a repeat; an outside process is polled with a command that
reports its state; and a pause that cannot be avoided stays a few
seconds.

Windows and a Linux subsystem sharing one machine stay separate
environments for configuration: settings travel between them only where
an explicit flag carries them, and when both sides set a rule, the
Windows value wins.` : ""),
  },
  {
    id: "default.conditional.monorepo",
    order: 3010,
    when: (t) => t.monorepo === "workspaces",
    render: (ctx) => (ctx.traits.monorepo === "workspaces" ? `# Workspace layout

This repository is one npm-workspaces tree: the root manifest holds the
shared configuration and the lockfile, and each workspace is a package
under \`packages/<name>\` with its own manifest, sources, and tests.

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
