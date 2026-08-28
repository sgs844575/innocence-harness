import { defineSkill } from "../define";

/**
 * Run-the-app skill (adapted from the reference project's run skill and
 * its per-shape examples): discover the entry before launching, probe
 * liveness by application shape, treat logs as the first diagnostic
 * surface, and clean up every process and file the run created.
 */
export const runAppSkill = defineSkill(
  "run-app",
  "Launch the project through its real entry point per app shape, probe liveness, read logs, interact, then clean up",
  `# Running the real application

To know a change works, meet the application where its users meet it. Launch the genuine artifact through the real entry point — the command a person types, the port a client connects to, the window a human sees — not an import of an internal module with a printed value.

## Find the entry before starting

Never guess how to start things; discover it first:

- package.json scripts plus the main and module entry fields, including any workspace layout;
- README and contributor docs for the documented command;
- build outputs and configuration files naming the executable.

Only after the entry is identified, launch it.

## Probe liveness per application shape

- Command-line tool: invoke it once with representative arguments; the exit status and printed output are the signal.
- Web service: start it as a background process, then poll the port or health endpoint until it answers. A readiness poll beats a fixed sleep — it returns the moment the service is up and fails loudly when it never is.
- GUI application: start it and wait for the window or first screen to render; capture a screenshot and actually examine it, because a blank frame means the launch failed.
- Library: author the smallest program that calls the public export and print the result.

## Logs are the first diagnostic surface

When startup stalls or behavior surprises, read the process log before changing anything. Errors, warnings, and stack output usually name the failing subsystem and the reason. Record the log file path for every process you start, and check it even when the surface looks healthy.

## Interact, then clean up

Launching alone proves little — drive one meaningful flow before concluding anything. Afterwards leave the machine as you found it: terminate every process you spawned, preferring the recorded process id or the port's listener over broad pattern matching that can hit unrelated sessions, and delete scratch files and temporary directories you produced. Nothing you started may outlive the task.`,
);
