import { defineSkill } from "../define";

/**
 * Workspace initialization (/init): the prompt-command counterpart of the
 * workspace-instructions injection plugin — the model explores the project
 * and writes the AGENT.md file that the plugin then injects into the first
 * turn of every new session in this workspace. Body in English per the
 * prompt-content rule.
 */
export const projectInitSkill = defineSkill(
  "init",
  "Initialize the workspace instruction file AGENT.md: explore the project, then write the behavior-changing rules future sessions need",
  `# Initialize the workspace instruction file (AGENT.md)

You are running the /init command. Your task is to create or update the workspace instruction file that every NEW session in this workspace automatically loads as its workspace instructions.

Target:
- Workspace root: the session's current workspace.
- Instruction file: AGENT.md at the workspace root.
- Existing candidates to check first: AGENT.md, agent.md, AGENTS.md, agents.md.
- Only the current workspace: never write a user-home-level instruction file.

Process:
1. Check whether any existing candidate file is already present. If one exists, read it first and update it in place with the Edit tool instead of replacing it wholesale; if several exist, update the first one in the candidate order and mention the others.
2. Inspect the repository before writing. Prefer read-only exploration: Read, Glob, Grep, and safe shell commands such as directory listings, git status, and build-manifest inspection.
3. Keep the file practical and short enough for future agents to read in one pass.
4. Include only project-specific facts a fresh session would otherwise get wrong: build/typecheck/test invocations (especially the non-guessable ones), architecture boundaries and layer rules, coding and editing conventions, platform pitfalls, and verification steps required before declaring work complete.
5. Cut directory listings, dependency inventories, and generic craftsmanship advice — the code and manifests already say those.
6. Ask the user only if a repository-specific decision cannot be inferred and would materially change the file.

After creating or editing the file, summarize the sections you wrote and mention the file path, and remind the user that new sessions in this workspace will load it automatically as workspace instructions.
`,
);
