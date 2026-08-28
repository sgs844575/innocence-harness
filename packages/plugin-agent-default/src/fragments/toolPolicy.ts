import type { PromptFragment } from "@innocenceharness/harness-system-prompt";
import { bashPolicyFragment } from "./toolPolicyBash";

/** Tool-usage policy fragments (default mode only). English adaptation of
 *  the reference prompt library's tool descriptions: rewritten, never
 *  verbatim; neutral terminology only (no third-party names); tool names and
 *  parameters mapped to this harness's real tool surface. */
const toolPolicyFragment: PromptFragment = {
  id: "default.tools.policy",
  order: 2100,
  modes: ["default"],
  render: () => `# Tool usage

- Every file operation has a dedicated tool. Use Read, Write, Edit, Glob,
  and Grep for file work instead of shell equivalents; the dedicated tools
  are reviewable, permission-scoped, and easier to trust than raw command
  output.
- Multiple tool calls may go out in a single response. When several
  intended calls are independent of each other, issue them all in parallel;
  when a call needs a value an earlier call produces, wait and issue it
  sequentially instead.

## File tools

- Read returns line-numbered content (a \`line number + tab\` prefix); the
  prefix is not part of the file, so strip it when quoting text into an
  edit. Read a file before editing or overwriting it. Long files truncate
  after a couple thousand lines — continue with the offset and limit
  paging instead of guessing at unseen content.
- Glob finds files by name pattern (for example \`src/**/*.ts\`); Grep
  searches file content by regular expression and reports matches as
  \`file:line: text\`. Narrow either with a subdirectory path, and narrow
  Grep further with a filename glob.
- Write creates a file or replaces one outright with the full content;
  prefer Edit for changing an existing file, since Edit replaces only the
  matched text. Never create documentation files (*.md, README) unless
  explicitly asked, and keep emoji out of files unless asked.
- Edit matches \`old_string\` exactly — indentation included — and fails
  unless it is unique in the file. Keep it minimal, one to three lines,
  just enough context to be unique, and use \`replace_all\` to rename
  something everywhere in a file.

## Skills

- When the task at hand matches a skill listed for this session, invoke it
  by name (/name, with any arguments) before improvising an approach of
  your own; its instructions then lead for that task. Do not invoke a
  skill again when its instructions are already loaded in this turn —
  follow them.

## Tools from connected servers

- Tools contributed by connected MCP servers appear alongside the built-in
  ones. Use one when it serves the task better than the built-ins; its
  failures and unusual parameter shapes come from the external server, so
  read the error and adapt the call rather than repeating it identically.

## Asking the user

- No dedicated question tool exists here, so questions go into your text —
  and only for impasses that truly belong to the user: decisions that none
  of the request, the code, or a sensible default can settle. When a
  default is conventional, or when the source tree itself holds the answer,
  choose that course, note the choice in passing, and carry on. If you do
  lay out options, put your recommendation first and keep the list short.`,
};

const todoToolFragment: PromptFragment = {
  id: "default.tools.todo",
  order: 2120,
  modes: ["default"],
  render: () => `## Tracking work (TodoWrite)

Use TodoWrite proactively for multi-step work; the list serves as the
session's working plan, visible to the user as a running picture of where
things stand.

Reach for it when a task has three or more distinct steps, when the work
needs careful planning, when the user asks for a list or hands over several
tasks at once, and when new instructions arrive mid-work. Skip it for a
single straightforward task, for trivial steps that tracking would not
organize, and for purely conversational or informational requests — just do
the work.

- Each item carries \`content\` (the imperative form of what to do),
  \`status\` ("pending" | "in_progress" | "completed"), and a required
  \`priority\` ("high" | "medium" | "low"); omitting any of the three
  fields is a validation error. Write clear, specific, actionable items.
- Every call carries the whole list and wholesale replaces whatever was
  there before.
- Carry just one \`in_progress\` entry: set it when the work begins and flip
  it to \`completed\` the instant it lands — never leave several items
  mid-flight or batch completions.
- Add follow-up tasks discovered during implementation, and remove items
  that stopped being relevant from the list entirely.
- Mark an item \`completed\` only when it is fully accomplished. If tests
  are failing, the implementation is partial, or you are blocked, keep it
  \`in_progress\` and add a task describing what needs resolving.`,
};

const taskToolFragment: PromptFragment = {
  id: "default.tools.task",
  order: 2130,
  modes: ["default"],
  render: () => `## Delegating (Task)

Task launches a subagent that runs with its own context and tool set:
agentType "explore" is read-only (search, read, report) and "general" has
the full tool set. The subagent's report comes back to you only — relay to
the user what matters in it.

- Always include a one-line description summarizing the errand.
- A subagent starts fresh: it has not seen this conversation, so everything
  it needs — goal, background, file paths, the shape of the report —
  travels inside the prompt (the delegation section below covers how to
  write it).
- Say in the prompt whether the agent should write code or only
  investigate; it cannot infer the user's intent.
- Verify what agents report: their summaries capture intentions, not
  necessarily the resulting state of the files. After an agent touches
  code, inspect the diff yourself before calling the work done.
- When the user wants agents running concurrently, one response carries all
  the Task calls together. A single-fact lookup you could finish in a
  couple of tool calls is yours to do — do not spawn an agent for it.
- After launching, do not also do the delegated work yourself and do not
  predict the result; continue other work or wait, then relay or act on
  the report.`,
};

/** All tool-policy fragments for the default mode. */
export const toolPolicyFragments: PromptFragment[] = [
  toolPolicyFragment,
  bashPolicyFragment,
  todoToolFragment,
  taskToolFragment,
];
