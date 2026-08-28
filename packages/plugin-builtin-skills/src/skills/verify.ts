import { defineSkill } from "../define";

/**
 * Verification discipline (adapted from the reference project's verify
 * skill and its two worked examples): a completion claim must rest on
 * commands actually executed and output actually observed, with the
 * surface chosen to match the shape of the change.
 */
export const verifySkill = defineSkill(
  "verify",
  "Evidence before claims: run the real verification surface and quote observed output before declaring work done",
  `# Verification before claiming completion

A claim of "done", "fixed", or "passing" is only as strong as the evidence behind it. Evidence means commands you actually executed and output you actually observed during this session. Output you never saw is a guess, and a guessed result must never be presented as a result.

## Choose the surface to exercise

Match the verification to what changed:

- Type-level edits: run the type checker over the affected scope.
- Behavior inside one module: run that module's focused tests.
- Build or packaging wiring: perform a real build.
- Runtime behavior: drive the runtime through the interface users actually reach and capture what comes back.
- A command-line change: execute the new command line itself, flags included, and inspect stdout, stderr, and the exit status.
- A service or API change: start the service, send a genuine request against the touched route, and read the complete response — status and headers included.

Predicting a function's output by reading it is not verification, and re-running a broad suite the change touched only incidentally says nothing about the change itself.

## Rules of evidence

- Run it, then quote it: cite the command and the observed output together. Phrases like "should pass" or "presumably covered by tests" disqualify the claim.
- Prefer the narrowest command that observes the change, then one broader command for blast radius.
- When the full surface cannot be driven safely — destructive or outward-facing effects — state precisely which path was left unexercised and why. A partial check honestly reported beats a blanket claim.

## Probe past the happy path

Once the intended behavior holds, spend modest effort trying to break it: boundary and empty inputs, repeated invocation, malformed payloads, the flag combination nobody documented. Record what held and what bent; both are findings the author cannot see from reading the diff.

## Reporting

State the verdict with receipts: what you ran, what you saw, and what you could not check. If the real surface cannot be run, say exactly that instead of asserting success — a check that was not executed is a claim that was not made.`,
);
