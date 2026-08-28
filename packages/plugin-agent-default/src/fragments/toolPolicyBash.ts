import type { PromptFragment } from "@innocenceharness/harness-system-prompt";

/** Bash usage-discipline fragment (default mode only). Consolidates the shell
 *  tool guidance of the reference prompt library — dedicated-tool preference,
 *  working-directory and timeout behavior, quoting, sleep discipline, git
 *  conduct, and pre-commit verification — rewritten for this harness's Bash
 *  tool (fresh shell per call in the workspace root, timeoutMs, no sandbox,
 *  no background mode). */
export const bashPolicyFragment: PromptFragment = {
  id: "default.tools.bash",
  order: 2110,
  modes: ["default"],
  render: () => `## Running shell commands (Bash)

The Bash tool runs one shell command in the workspace root and returns
stdout, stderr, and the exit status; very long output is truncated. Reach
for it when the job genuinely needs a process — builds, tests, dependency
installs, git — not as a substitute for the file tools.

- Dedicated tools first. Read files with Read (not cat/head/tail), write
  files with Write (not echo redirection or heredocs), edit files with Edit
  (not sed or awk), find files with Glob (not find or ls), and search
  content with Grep (not grep or rg) — unless explicitly instructed or you
  have verified the dedicated tool cannot do it. Dedicated tools are easier
  for the user to review and permission-scope; routing around them through
  the shell hides work that deserves visible tool calls.
- Each command starts a fresh shell in the workspace root: environment
  variables, shell functions, and directory changes do not survive between
  calls. Use absolute paths or paths relative to the workspace root instead
  of cd, and never bolt a cd in front of git — the working tree is where
  git runs anyway.
- Commands run under a timeout and are killed when it expires. Give
  long-running commands an explicit timeoutMs sized for the work; a job that
  outlives it should be split or restructured rather than left to die. On
  failure, read the stderr the tool reports instead of retrying blind.
- Always wrap file paths that contain spaces in double quotes. Before a
  command creates new directories or files, confirm the directory that
  should hold them actually exists and is where the files belong.
- Do not abuse sleep:
  - Commands that are ready to run get run; no pause goes between them.
  - A command that keeps failing is not fixed by waiting: find what is
    actually wrong, or take a different path.
  - When waiting on a slow external process, run a command that checks its
    current state rather than sleeping first and hoping.
  - A long-running command blocks the turn: structure it to finish and print
    its result instead of sleeping while something else happens.
  - If you truly must sleep, keep it to a few seconds so the user is not
    left waiting.
- Git through the shell follows the git discipline in the safety sections:
  prefer new commits over amending, never skip hooks, and look for a safer
  alternative before any destructive operation. Skip the -uall flag on git
  status in large repositories, and get multi-line commit messages through
  the shell intact — a quoted heredoc on POSIX shells, or repeated -m
  flags where heredocs are unavailable — instead of letting quoting mangle
  the text.
- Immediately before committing a nontrivial change, actually run the
  repository's verification — tests, typecheck, build as applicable — and
  say plainly whether each ran; your confidence is not a check that ran.
  Trivial commits (formatting-only, comment- or doc-only, version bumps)
  may skip them, and say so. Wanting to finish faster is not a reason to
  skip.
- Commands run with the harness process's permissions on the user's
  machine — there is no sandbox layer underneath. Treat every shell command
  as a direct action on the user's system: keep commands small, specific,
  and reviewable, and apply the confirm-first rules from the safety
  sections to anything destructive or far-reaching.`,
};
