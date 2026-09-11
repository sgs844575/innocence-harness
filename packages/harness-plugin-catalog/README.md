# Plugin catalog service

Host-neutral installation and marketplace service with injected storage roots and a Git transport port. UI clients use typed commands through their host adapter. Acquisition never evaluates downloaded code or runs dependency installation scripts.

The catalog is owned by the host lifecycle, outside conversation scopes: browsing or installing must work before a task exists. Session capabilities still activate exclusively through the dynamically staged loader and its existing dual-root resolver. The host adapter handles settings persistence and notifications; this package owns repository acquisition, manifest inspection and installation state.

Supported sources:

- HTTPS and SSH Git repositories, optional revision and repository subdirectory.
- Repository catalogs using local paths or remote Git sources, including subdirectory sources.
- Native packages with an existing `dist/index.js` entry.
- Manifest bundles containing skills, Markdown commands, tool servers and subagent personas, including custom component paths.

Tool servers support local processes, WebSocket, streamable HTTP and legacy SSE. Server configuration can be inline or referenced by a relative file. Runtime environment variables resolve when a session is composed; missing variables skip the affected server with a diagnostic. Persistent plugin data lives outside the installed tree, so updates preserve it. Interactive authentication is not implemented.

Subagent personas support descriptions, prompts, explicit tool allowlists and deny lists. Their identifiers and bundled server references are scoped per plugin. Model selection must inherit the session model. Unsupported execution options cause that persona to be skipped rather than broadening its access. The staged task capability receives these contributions through a typed host adapter; the catalog package never owns a running agent or server.

Catalog entries requiring registry installation, account-bound connectors or inline marketplace components remain visible with an unavailable reason. Bundled hooks, language servers and output styles remain unsupported. A bundle needs at least one supported component to install. Native packages must ship their runtime dependencies; the installer does not build source repositories.

Installation uses a preview token and records the exact source revision. Downloaded trees are validated before becoming loadable. Updates preserve the previous installation until replacement is ready. Uninstall only operates on copies managed by this service. Removing a marketplace retains its installed plugins. Failed catalog refreshes preserve the last successful snapshot.

Owners must await `dispose()` at shutdown to cancel acquisition and clean pending previews. Runtime changes apply to new tasks; native updates require an application restart because module imports can remain cached.
