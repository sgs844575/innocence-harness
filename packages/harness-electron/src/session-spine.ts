// Session spine suite: the plugin objects, factories and loop entry the
// session kernel mounts on every session context. A host that loads the
// spine dynamically from the distributed tree (staging/resources node_modules)
// injects the suite it loaded, so every mount — boot root, session scopes,
// disk-loaded capability plugins — shares ONE set of spine module identities.
// Hosts and ordinary runtime composition roots must inject the suite loaded
// from their distribution tree. Only test helpers and explicit test seams may
// opt into the bundled static suite below; production must never rely on it.
import type * as KernelLogger from "@innocenceharness/kernel-logger";
import type * as KernelTimer from "@innocenceharness/kernel-timer";
import type * as KernelHmr from "@innocenceharness/kernel-hmr";
import type * as SpineTools from "@innocenceharness/harness-tools";
import type * as SpinePermissions from "@innocenceharness/harness-permissions";
import type * as SpineProviders from "@innocenceharness/harness-providers";
import type * as SpineSkills from "@innocenceharness/harness-skills";
import type * as SpineSystemPrompt from "@innocenceharness/harness-system-prompt";
import type * as SpineAgents from "@innocenceharness/harness-agent";
import type * as SpineSession from "@innocenceharness/harness-session";
import type * as SpineLoop from "@innocenceharness/harness-agent-loop";
import type * as KernelLoader from "@innocenceharness/kernel-loader";
import type * as KernelGroup from "@innocenceharness/kernel-group";
import * as loggerModule from "@innocenceharness/kernel-logger";
import * as timerModule from "@innocenceharness/kernel-timer";
import * as hmrModule from "@innocenceharness/kernel-hmr";
import * as toolsModule from "@innocenceharness/harness-tools";
import * as permissionsModule from "@innocenceharness/harness-permissions";
import * as providersModule from "@innocenceharness/harness-providers";
import * as skillsModule from "@innocenceharness/harness-skills";
import * as systemPromptModule from "@innocenceharness/harness-system-prompt";
import * as agentsModule from "@innocenceharness/harness-agent";
import * as sessionModule from "@innocenceharness/harness-session";
import * as loopModule from "@innocenceharness/harness-agent-loop";
import * as loaderModule from "@innocenceharness/kernel-loader";
import * as groupModule from "@innocenceharness/kernel-group";

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
