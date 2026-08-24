// Session spine suite: the plugin objects, factories and loop entry the
// session kernel mounts on every session context. A host that loads the
// spine dynamically from the distributed tree (staging/resources node_modules)
// injects the suite it loaded, so every mount — boot root, session scopes,
// disk-loaded capability plugins — shares ONE set of spine module identities.
// Hosts and ordinary runtime composition roots must inject the suite loaded
// from their distribution tree. Only test helpers and explicit test seams may
// opt into the bundled static suite below; production must never rely on it.
import type * as KernelLogger from "@innocencecode/kernel-logger";
import type * as KernelTimer from "@innocencecode/kernel-timer";
import type * as KernelHmr from "@innocencecode/kernel-hmr";
import type * as SpineTools from "@innocencecode/harness-tools";
import type * as SpinePermissions from "@innocencecode/harness-permissions";
import type * as SpineProviders from "@innocencecode/harness-providers";
import type * as SpineSkills from "@innocencecode/harness-skills";
import type * as SpineSystemPrompt from "@innocencecode/harness-system-prompt";
import type * as SpineAgents from "@innocencecode/harness-agent";
import type * as SpineSession from "@innocencecode/harness-session";
import type * as SpineLoop from "@innocencecode/harness-agent-loop";
import type * as KernelLoader from "@innocencecode/kernel-loader";
import type * as KernelGroup from "@innocencecode/kernel-group";
import * as loggerModule from "@innocencecode/kernel-logger";
import * as timerModule from "@innocencecode/kernel-timer";
import * as hmrModule from "@innocencecode/kernel-hmr";
import * as toolsModule from "@innocencecode/harness-tools";
import * as permissionsModule from "@innocencecode/harness-permissions";
import * as providersModule from "@innocencecode/harness-providers";
import * as skillsModule from "@innocencecode/harness-skills";
import * as systemPromptModule from "@innocencecode/harness-system-prompt";
import * as agentsModule from "@innocencecode/harness-agent";
import * as sessionModule from "@innocencecode/harness-session";
import * as loopModule from "@innocencecode/harness-agent-loop";
import * as loaderModule from "@innocencecode/kernel-loader";
import * as groupModule from "@innocencecode/kernel-group";

/**
 * The mounting face the session kernel consumes, grouped by owning module.
 * Each member is the module's namespace type, so a dynamically loaded module
 * namespace satisfies it structurally and a static import object does too.
 */
export interface SessionSpineSuite {
  readonly logger: typeof KernelLogger;
  readonly timer: typeof KernelTimer;
  readonly hmr: typeof KernelHmr;
  readonly tools: typeof SpineTools;
  readonly permissions: typeof SpinePermissions;
  readonly providers: typeof SpineProviders;
  readonly skills: typeof SpineSkills;
  readonly systemPrompt: typeof SpineSystemPrompt;
  readonly agents: typeof SpineAgents;
  readonly session: typeof SpineSession;
  readonly loop: typeof SpineLoop;
  readonly loader: typeof KernelLoader;
  readonly group: typeof KernelGroup;
}

let memo: SessionSpineSuite | undefined;

/**
 * The bundled static spine (workspace sources; explicit test seam only).
 * WARNING: production hosts and ordinary runtime composition roots MUST inject
 * the dynamically loaded spine suite through AgentSessionOptions.spine — the
 * production domain relies on the single-instance invariant (one set of spine
 * module identities per process, shared by the boot root, session scopes,
 * disk-loaded capability plugins and spawned child sessions). This static
 * suite serves only test helpers and explicit test composition roots.
 */
export function staticSpineSuite(): SessionSpineSuite {
  memo ??= {
    logger: loggerModule,
    timer: timerModule,
    hmr: hmrModule,
    tools: toolsModule,
    permissions: permissionsModule,
    providers: providersModule,
    skills: skillsModule,
    systemPrompt: systemPromptModule,
    agents: agentsModule,
    session: sessionModule,
    loop: loopModule,
    loader: loaderModule,
    group: groupModule,
  };
  return memo;
}
