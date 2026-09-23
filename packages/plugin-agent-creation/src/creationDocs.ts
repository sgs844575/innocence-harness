/**
 * Bundled creation-format help docs, one per plugin type. Compiled into the
 * creation plugin (shipped with the app by construction — no download, no
 * workspace dependency) and surfaced to the model through the creation_docs
 * tool. Written as authoritative beginner guides: a developer who has never
 * touched this harness can follow each doc step by step — full copy-paste
 * file contents, field references, a runnable smoke test, install and
 * verification, and a troubleshooting table. English and neutral terminology
 * only. Keep every fact anchored on the REAL loader and spine surfaces; when
 * a registration surface or the loader contract changes, update the matching
 * doc in the same change.
 */
export interface CreationDocEntry {
  /** Doc id the creation_docs tool takes as its `type` argument. */
  readonly type: string;
  /** One-line summary shown in the no-argument listing. */
  readonly summary: string;
  /** Full markdown body returned for the type. */
  readonly body: string;
}

// ---- shared building blocks -------------------------------------------------

const SHARED_FORM = `## The plugin form every type shares

A user plugin is a plain directory the harness loads at session build time:

\`\`\`
<your-plugin>/
  package.json      metadata; MUST contain "type": "module"
  dist/index.js     the plugin entry (plain ESM JavaScript)
\`\`\`

Non-negotiable loader rules (violating any of these makes the plugin fail
to load):

1. The entry file is exactly \`dist/index.js\` — no other path is probed.
2. \`package.json\` must contain \`"type": "module"\`; the entry is imported
   as an ES module, so \`export default ...\` is how the plugin leaves the
   file.
3. The default export must be the plugin object
   \`{ name: "<id>", apply(ctx) { ... } }\`. One default level is unwrapped;
   do not nest it deeper and do not export a factory.
4. \`name\` must equal the plugin id (the directory name you install under).
5. NO imports. A user plugin resolves no package manager dependencies —
   import statements other than Node built-ins (\`node:fs\`, \`node:path\`,
   \`node:url\`, ...) fail at load time. Write plain JavaScript against the
   \`ctx\` surface; every API you may call is documented in these docs.
6. \`apply(ctx)\` runs once per session build. Register every capability
   there and nowhere else, and do nothing else in it (no IO, no timers).

\`\`\`json title="package.json"
{
  "name": "my-plugin",
  "version": "0.1.0",
  "type": "module",
  "description": "One line: what this plugin gives the harness."
}
\`\`\``;

const SHARED_STEPS = `## The universal delivery loop

1. **Author the files in the workspace** (for example under
   \`plugins/<id>/\`) so they can be written, read, and edited with the
   normal file tools. The harness does NOT load from here — this is your
   workbench.
2. **Smoke test** with the script below (write \`smoke.mjs\` next to the
   plugin directory and run \`node smoke.mjs <plugin-dir>\`). It loads the
   entry exactly the way the harness does and proves the registrations
   happen.
3. **Install** with the \`install_user_plugin\` tool, passing the SAME file
   contents you authored: \`id\`, \`packageJson\` (full file content),
   \`indexJs\` (full \`dist/index.js\` content). Installing writes
   \`<user-plugin-root>/<id>/{package.json, dist/index.js}\`.
4. **Verify in a fresh session**: plugins are picked up the next time a
   session is built. The plugin appears in the settings plugin list and can
   be switched off there; replacing an installed plugin later requires the
   explicit \`overwrite: true\` argument.

\`\`\`js title="smoke.mjs — the universal loader probe"
// Usage: node smoke.mjs <plugin-dir>
// Loads <plugin-dir>/dist/index.js exactly like the harness (ESM import,
// one default level unwrapped) and runs apply against a recording ctx.
import { pathToFileURL } from "node:url";
import path from "node:path";
import { readFile } from "node:fs/promises";

const dir = process.argv[2];
if (!dir) throw new Error("usage: node smoke.mjs <plugin-dir>");

const pkg = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8"));
if (pkg.type !== "module") throw new Error('package.json must set "type": "module"');

const mod = await import(pathToFileURL(path.join(dir, "dist/index.js")).href);
const plugin = mod.default ?? mod;
if (typeof plugin !== "object" || typeof plugin.name !== "string" || typeof plugin.apply !== "function") {
  throw new Error("default export must be { name, apply(ctx) }");
}
if (plugin.name !== pkg.name) throw new Error(\`plugin.name (\${plugin.name}) must equal package name (\${pkg.name})\`);

const registered = [];
const ctx = {
  tools: { register: (t) => registered.push(["tool", t]) },
  skills: { register: (s) => registered.push(["skill", s]) },
  agents: { register: (a) => registered.push(["agent-mode", a]) },
  systemPrompt: { registerFragment: (f) => registered.push(["fragment", f]) },
  session: { registerProcessor: (p) => registered.push(["processor", p]) },
  providers: { register: (p) => registered.push(["provider", p]) },
};
await plugin.apply(ctx);
if (registered.length === 0) throw new Error("apply(ctx) registered nothing — a plugin must register its capability");
for (const [kind, value] of registered) {
  const id = value.name ?? value.id ?? "?";
  console.log(\`registered \${kind}: \${id}\`);
}
\`\`\``;

const SHARED_TROUBLE = `## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| \`SyntaxError: Cannot use import statement\` / import/export outside a module | \`package.json\` missing \`"type": "module"\` | add it (rule 2) |
| Loader rejects the module | default export nested or a factory | export the plugin object directly (rule 3) |
| Plugin seems absent next session | wrong entry path | entry must be \`dist/index.js\` exactly (rule 1) |
| Plugin absent although files exist | plugin disabled in the settings plugin list, or an import of a non-builtin module threw at load | re-enable it; remove non-builtin imports (rule 5) |
| Duplicate tool/skill name | registration names collide first-wins | pick a distinctive snake_case name |
| Tool never runs | missing \`permissionResource\` (registration throws) or permission denied | add the resource; check the permission mode |`;

// ---- per-type docs -----------------------------------------------------------

const overviewDoc = `# User plugin guide — start here

This guide takes you from zero to an installed, verified plugin. No prior
knowledge of this harness is assumed. Work through it top to bottom once;
after that, each type doc (tool, skill, agent-mode, message-processor,
provider) is a complete standalone recipe.

${SHARED_FORM}

${SHARED_STEPS}

## How to choose the plugin type

Match the capability to exactly one surface; when two fit, name both and
let the user pick:

| The user wants... | Type | Doc |
|---|---|---|
| The MODEL to run an action (query an API, transform data, touch files) | **tool** | creation_docs type "tool" |
| The model to follow a repeatable PROCEDURE on demand (\`/name\`) | **skill** | creation_docs type "skill" |
| A different persona/behavior profile the user can switch to | **agent-mode** | creation_docs type "agent-mode" |
| Every outgoing message to be enriched or guarded automatically | **message-processor** | creation_docs type "message-processor" |
| A new model backend behind the neutral chat contract | **provider** | creation_docs type "provider" |

Rules of thumb: a skill teaches but never executes — if code must run, it
is a tool. A processor sees every turn — use it for cross-cutting concerns
only, never for a capability with a trigger. A provider is only for custom
backends the host's model profiles cannot express.

## Verification checklist (every plugin, before you install)

- [ ] \`node smoke.mjs <plugin-dir>\` prints the expected registrations.
- [ ] The type-specific behavior probe from the type doc passes.
- [ ] package.json has \`"type": "module"\`; plugin \`name\` equals the id.
- [ ] No imports except Node built-ins.
- [ ] The user knows: takes effect next session build, switchable in the
      settings plugin list, reinstalling needs \`overwrite: true\`.

${SHARED_TROUBLE}`;

const toolDoc = `# Tool plugin — complete walkthrough

A tool is an action the MODEL can decide to call, with permission-audited
execution. Choose a tool whenever code must run.

## What you will build (copy-paste runnable)

A \`word_count\` tool: counts the words in a text argument. Two files.

\`\`\`json title="plugins/word-count/package.json"
{
  "name": "word-count",
  "version": "0.1.0",
  "type": "module",
  "description": "Counts words in the provided text."
}
\`\`\`

\`\`\`js title="plugins/word-count/dist/index.js"
const tool = {
  name: "word_count",
  description: "Count the words in the provided text and return the number.",
  readOnly: true,
  sideEffect: "none",
  parameters: {
    type: "object",
    properties: {
      text: { type: "string", description: "The text to count words in." },
    },
    required: ["text"],
  },
  validateArgs(args) {
    if (typeof args.text !== "string" || args.text.length === 0) {
      throw new Error("text must be a non-empty string");
    }
  },
  permissionResource() {
    return { action: "read", kind: "tool", scope: "word_count" };
  },
  async execute(args, ctx) {
    const count = args.text.trim().split(/\\s+/).filter(Boolean).length;
    return { content: String(count) };
  },
};

export default {
  name: "word-count",
  apply(ctx) {
    ctx.tools.register(tool);
  },
};
\`\`\`

## Steps

1. **Author both files** exactly as above (any scratch directory in the
   workspace works). Note: there is nothing else in the directory — no
   build step, no node_modules.
2. **Smoke test**: \`node smoke.mjs plugins/word-count\` must print
   \`registered tool: word_count\`.
3. **Behavior probe** (add temporarily to smoke.mjs or run standalone):

   \`\`\`js
   tool.validateArgs({ text: "hello world" });        // must not throw
   tool.validateArgs({});                              // must throw
   const ok = await tool.execute({ text: "one two three" }, fakeCtx);
   if (ok.content !== "3") throw new Error("expected 3, got " + ok.content);
   \`\`\`

4. **Install**: call \`install_user_plugin\` with
   \`{ id: "word-count", packageJson: <the package.json content>, indexJs: <the index.js content> }\`.
5. **Verify**: build a NEW session and ask the model to count words in a
   sentence; the \`word_count\` tool appears in its tool list. Check the
   settings plugin list shows "word-count".

## Field reference

| Field | Required | Meaning |
|---|---|---|
| \`name\` | yes | Unique tool name, snake_case. This is what the model calls. |
| \`description\` | yes | One sentence the model reads to decide WHEN to call it. Be specific about triggers and inputs. |
| \`readOnly\` | yes | \`true\`: changes nothing (may run in parallel, passes plan mode). \`false\`: state-changing — permission-gated. |
| \`sideEffect\` | yes | \`"none"\` for pure computation; \`"paths"\` when files change; \`"delegated"\` when work happens in a spawned child. |
| \`parameters\` | yes | JSON Schema of the arguments. The schema IS the model-facing documentation — describe every property. |
| \`validateArgs(args)\` | recommended | Cheap structural checks; throw \`Error\` with a fix-it message. No IO here. |
| \`permissionResource(args, ctx)\` | yes | Returns \`{ action, kind, scope }\` — WHAT the call acts on. A tool without it is rejected at registration. |
| \`execute(args, ctx)\` | yes | The work. Return \`{ content: string, isError?: true }\`. |

The \`execute\` context \`ctx\` provides \`workspaceRoot\` (string),
\`signal\` (AbortSignal — check it in long work), \`log(level, message)\`,
and \`scope\` (invocation identity for telemetry).

## Rules

- NEVER throw in \`execute\` for expected failures — return
  \`{ content, isError: true }\` with the original diagnostic; the model
  reads it and adapts.
- The permission resource is persisted with the full arguments: put the
  canonical target (path, URL, id) verbatim in \`scope\`, never a hint.
- Complete arguments enter history and audit — no secrets in defaults.

${SHARED_TROUBLE}`;

const skillDoc = `# Skill plugin — complete walkthrough

A skill is packaged PROCEDURAL GUIDANCE: the user types \`/name\` and the
skill body is loaded into the conversation on demand. Skills teach; they
never execute code — if code must run, build a tool instead.

## What you will build (copy-paste runnable)

A \`release-notes\` skill: a checklist for writing release notes.

\`\`\`json title="plugins/release-notes/package.json"
{
  "name": "release-notes",
  "version": "0.1.0",
  "type": "module",
  "description": "Checklist for drafting release notes."
}
\`\`\`

\`\`\`js title="plugins/release-notes/dist/index.js"
const skill = {
  name: "release_notes",
  description:
    "Draft release notes for a change set. Use when the user asks for a " +
    "release note, changelog entry, or update summary.",
  async loadBody() {
    return [
      "# Release notes checklist",
      "",
      "1. Read the changes (commits or diff) before writing anything.",
      "2. Group entries: Added / Changed / Fixed / Removed.",
      "3. Each entry is one sentence, user-visible effect first, technical cause second.",
      "4. Note breaking changes and migrations at the top, in bold.",
      "5. End with the version and date line the project convention uses.",
    ].join("\\n");
  },
};

export default {
  name: "release-notes",
  apply(ctx) {
    ctx.skills.register(skill);
  },
};
\`\`\`

## Steps

1. **Author both files** as above.
2. **Smoke test**: \`node smoke.mjs plugins/release-notes\` prints
   \`registered skill: release_notes\`.
3. **Behavior probe**:

   \`\`\`js
   const body = await skill.loadBody();
   if (!body.startsWith("# ")) throw new Error("body must be markdown");
   if (skill.description.length < 30) throw new Error("description too vague");
   \`\`\`

4. **Install** with \`install_user_plugin\`
   (\`{ id: "release-notes", packageJson, indexJs }\`).
5. **Verify**: in a NEW session, typing \`/release\` in the composer shows
   the skill in the slash menu; invoking it loads the checklist, and the
   model follows it.

## Field reference

| Field | Required | Meaning |
|---|---|---|
| \`name\` | yes | Unique skill name, lowercase with hyphens or underscores. The \`/name\` invocation key. |
| \`description\` | yes | The ONLY part in context before invocation — a precise trigger description ("Use when..."), not a title. |
| \`loadBody()\` | yes | Async function returning the markdown body (English). Loaded only on \`/name\` invocation. |

## Rules

- Keep the body actionable and self-contained: numbered steps, concrete
  criteria, no references to conversation state you cannot assume.
- The description decides whether the model reaches for the skill — spend
  real effort on it.
- Name collisions resolve first-wins against built-in skills — pick a
  distinctive name.

${SHARED_TROUBLE}`;

const agentModeDoc = `# Agent-mode plugin — complete walkthrough

An agent mode is a selectable persona/behavior profile (like "default" or
"creation"): the user switches the session into it and the system prompt
changes accordingly. A mode plugin registers the mode plus one or more
mode-tagged prompt fragments.

## What you will build (copy-paste runnable)

A \`reviewer\` mode: a careful code-review persona.

\`\`\`json title="plugins/reviewer-mode/package.json"
{
  "name": "reviewer-mode",
  "version": "0.1.0",
  "type": "module",
  "description": "A careful code-review persona.",
  "innocenceharness": {
    "agentMode": {
      "title": "Reviewer",
      "description": "Work from a careful code-review perspective."
    }
  }
}
\`\`\`

The \`innocenceharness.agentMode\` block is what puts the mode into the
mode switcher: \`title\` is the display name shown to the user (any
language; follow the workspace's own convention), \`description\` its
one-line hint. Without the block the plugin loads but the mode never
reaches the switcher.

\`\`\`js title="plugins/reviewer-mode/dist/index.js"
export default {
  name: "reviewer-mode",
  apply(ctx) {
    ctx.agents.register({
      id: "reviewer",
      title: "Reviewer",
      description: "Careful, evidence-first code review.",
    });
    ctx.systemPrompt.registerFragment({
      id: "reviewer.persona",
      order: 2000,
      modes: ["reviewer"],
      render: () => [
        "# Reviewer mode",
        "",
        "You review code changes before they land. Read the full change",
        "before judging any part of it. Every finding names the file and",
        "line, states the concrete failure mode, and offers the smallest",
        "fix that removes it. Severity over volume: report what matters,",
        "skip style noise unless it hides a real defect.",
      ].join("\\n"),
    });
  },
};
\`\`\`

## Steps

1. **Author both files** as above. The plugin id (\`reviewer-mode\`) and
   the mode id (\`reviewer\`) may differ; the PLUGIN name must equal the
   plugin id.
2. **Smoke test**: \`node smoke.mjs plugins/reviewer-mode\` prints
   \`registered agent-mode: reviewer\` and \`registered fragment:
   reviewer.persona\`.
3. **Behavior probe**:

   \`\`\`js
   const fragment = registered.find(([k]) => k === "fragment")[1];
   const text = fragment.render({ activeMode: "reviewer", traits: {} });
   if (typeof text !== "string" || text.length < 50) throw new Error("fragment must render real text");
   \`\`\`

4. **Install** with \`install_user_plugin\`.
5. **Verify**: in a NEW session the mode switcher offers "Reviewer";
   switching to it and asking for a review behaves per the persona.

## Field reference

Mode registration \`ctx.agents.register({ id, title, description })\`:
- \`id\` — the mode id used in fragment \`modes\` tags and settings.
- \`title\` / \`description\` — short human-facing labels.

Fragment registration \`ctx.systemPrompt.registerFragment(fragment)\`:

| Field | Required | Meaning |
|---|---|---|
| \`id\` | yes | Unique fragment id (\`<mode>.<cluster>\` convention). |
| \`order\` | yes | Position in the prompt: persona ~2000, workflow ~2010, knowledge ~2020. Larger = deeper. |
| \`modes\` | no | Array of mode ids this fragment applies to. Omit to apply to EVERY mode (shared fragments). |
| \`render({ activeMode, traits })\` | yes | Returns the fragment text (English, neutral terms). Runs per session build — static content only. |

## Rules

- Fragments rebuild the system prompt per session, not per turn — keep
  them short and behavioral; never dynamic per-message content (that is a
  message processor's job).
- Split persona / workflow / knowledge into separate fragments with
  distinct orders instead of one monolith.

${SHARED_TROUBLE}`;

const messageProcessorDoc = `# Message-processor plugin — complete walkthrough

A message processor transforms each OUTBOUND user message on its way to
the model: injections, enrichment, guardrails. It runs once per user turn
for every turn — use it only for cross-cutting concerns, never for a
capability with a trigger.

## What you will build (copy-paste runnable)

A \`long-input-guard\` processor: when a message is unusually long, it
appends a reminder to answer in structured sections.

\`\`\`json title="plugins/long-input-guard/package.json"
{
  "name": "long-input-guard",
  "version": "0.1.0",
  "type": "module",
  "description": "Appends a structure reminder for very long inputs."
}
\`\`\`

\`\`\`js title="plugins/long-input-guard/dist/index.js"
const LIMIT = 4000;

const processor = {
  name: "long_input_guard",
  order: 700,
  inheritToSubagents: false,
  async process(message, context) {
    if (message.role !== "user") return message;
    const text = message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("");
    if (text.length < LIMIT) return message;
    message.parts.push({
      type: "text",
      text: [
        "<system-reminder>",
        "This user message is unusually long. Answer in structured sections",
        "with a short summary first, so the response stays navigable.",
        "</system-reminder>",
      ].join("\\n"),
    });
    return message;
  },
};

export default {
  name: "long-input-guard",
  apply(ctx) {
    ctx.session.registerProcessor(processor);
  },
};
\`\`\`

## Steps

1. **Author both files** as above.
2. **Smoke test**: \`node smoke.mjs plugins/long-input-guard\` prints
   \`registered processor: long_input_guard\`.
3. **Behavior probe**:

   \`\`\`js
   const short = await processor.process(
     { role: "user", parts: [{ type: "text", text: "hi" }] },
     fakeContext,
   );
   if (short.parts.length !== 1) throw new Error("short input must stay untouched");
   const long = await processor.process(
     { role: "user", parts: [{ type: "text", text: "x".repeat(5000) }] },
     fakeContext,
   );
   if (!long.parts.at(-1).text.includes("<system-reminder>")) throw new Error("long input must gain the envelope");
   \`\`\`

4. **Install** with \`install_user_plugin\`.
5. **Verify**: in a NEW session, send a very long message; the model's
   answer arrives structured (the envelope is visible in the stored turn).

## Field reference

| Field | Required | Meaning |
|---|---|---|
| \`name\` | yes | Unique processor name. |
| \`order\` | yes | Pipeline position, smaller first: skill expansion -1000 → host processors 0 → your processors (100-800) → reminders tail 900. |
| \`inheritToSubagents\` | recommended | \`false\` (or omitted) = parent sessions only. Set \`true\` only if subagent children genuinely need it — otherwise a child's first input consumes parent-scoped state. |
| \`process(message, context)\` | yes | Transform and RETURN the same message object. |

\`message\` is \`{ role: "user" | "assistant", parts: [...] }\` with text
parts \`{ type: "text", text }\`. \`context\` provides \`signal\`,
\`provider\`, \`scope: { sessionId }\`, and optionally \`history()\`
(returning a read-only snapshot; a MISSING accessor means "history
unavailable", never "empty").

## Rules

- APPEND parts; never rewrite, reorder, or drop existing parts. Appended
  parts persist into the stored turn — they survive restarts and appear in
  transcripts.
- Wrap injected guidance in the shared \`<system-reminder>\` envelope,
  English text.
- Processors must stay cheap (they run on every outbound turn) and must
  honor \`context.signal\`.
- State kept in closure variables is per session composition — the safe
  default; do not share mutable state across messages unless the
  semantics demand it.

${SHARED_TROUBLE}`;

const providerDoc = `# Provider plugin — complete walkthrough

A provider supplies a MODEL BACKEND behind the harness's neutral chat
contract. Build one only for backends the host's model profiles cannot
express (custom gateways, translation logic, deterministic test doubles).

## What you will build (copy-paste runnable)

An \`echo\` provider for testing: answers every turn with the user's own
text (deterministic — ideal for verifying the pipeline).

\`\`\`json title="plugins/echo-provider/package.json"
{
  "name": "echo-provider",
  "version": "0.1.0",
  "type": "module",
  "description": "Deterministic echo backend for pipeline testing."
}
\`\`\`

\`\`\`js title="plugins/echo-provider/dist/index.js"
export default {
  name: "echo-provider",
  apply(ctx) {
    ctx.providers.register({
      id: "echo",
      async *chat(request) {
        // request: { system, messages, tools, signal }
        const lastUser = [...request.messages]
          .reverse()
          .find((message) => message.role === "user");
        const text = (lastUser?.parts ?? [])
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\\n");
        yield { type: "text", text: \`echo: \${text}\` };
        yield { type: "usage", inputTokens: 1, outputTokens: 1 };
      },
    });
  },
};
\`\`\`

## Steps

1. **Author both files** as above.
2. **Smoke test**: \`node smoke.mjs plugins/echo-provider\` prints
   \`registered provider: echo\`.
3. **Behavior probe**:

   \`\`\`js
   const deltas = [];
   for await (const delta of provider.chat({
     system: "s",
     messages: [{ role: "user", parts: [{ type: "text", text: "ping" }] }],
     tools: [],
     signal: new AbortController().signal,
   })) deltas.push(delta);
   if (!deltas.some((d) => d.type === "text" && d.text === "echo: ping")) throw new Error("echo failed");
   \`\`\`

4. **Install** with \`install_user_plugin\`.
5. **Verify**: in a NEW session select the provider and send a message;
   the answer echoes it.

## Contract reference

\`chat(request)\` is an async generator yielding typed deltas; request
carries \`system\`, \`messages\` (canonical parts model), \`tools\`
(schema-only specs), and \`signal\`.

| Delta | Shape | Rules |
|---|---|---|
| text | \`{ type: "text", text }\` | Final-answer fragments, streamed in order. |
| thinking | \`{ type: "thinking", text }\` | Reasoning trace; optional per delta. |
| toolCall | \`{ type: "toolCall", id, toolName, args }\` | COMPLETE calls — the loop does not aggregate fragments; mint unique ids. |
| usage | \`{ type: "usage", inputTokens, outputTokens }\` | Token accounting; emit once at the end. |

## Rules

- The neutral contract only: canonical messages in, typed deltas out. Any
  vendor wire format is fetched, parsed, and mapped INSIDE the provider —
  never leaked into messages or deltas.
- Honor \`request.signal\`: stop generating and return when aborted.
- If the backend emits tool calls as plain-text markup, translate them
  into typed \`toolCall\` deltas before yielding — the loop only executes
  typed calls.
- Registering a provider makes it AVAILABLE; sessions still select it via
  the host's model settings.

${SHARED_TROUBLE}`;

export const creationDocs: readonly CreationDocEntry[] = [
  { type: "overview", summary: "Start here: the plugin form, the choose-type table, the universal delivery loop with a runnable smoke test, and troubleshooting.", body: overviewDoc },
  { type: "tool", summary: "Tool plugins step by step: a complete runnable example, the full registration SPI reference, behavior probe, install and verify.", body: toolDoc },
  { type: "skill", summary: "Skill plugins step by step: /name procedural guidance with a complete runnable example and field reference.", body: skillDoc },
  { type: "agent-mode", summary: "Agent modes step by step: mode registration, mode-tagged prompt fragments, the switcher manifest block, runnable example.", body: agentModeDoc },
  { type: "message-processor", summary: "Message processors step by step: append-only outbound-turn transformation with a runnable example and pipeline orders.", body: messageProcessorDoc },
  { type: "provider", summary: "Provider plugins step by step: the neutral chat delta contract with a deterministic runnable example.", body: providerDoc },
];
