import type { Context } from "@innocenceharness/kernel";
// Side-effect type import: pulls the Context service augmentation (ctx.skills)
// into src-only builds (tsconfig.build.json excludes the test-side imports).
import type {} from "@innocenceharness/harness-skills";
import { debuggingSkill } from "./skills/debugging";
import { codeReviewSkill } from "./skills/codeReview";
import { verifySkill } from "./skills/verify";
import { runAppSkill } from "./skills/runApp";
import { dataVisualizationSkill } from "./skills/dataVisualization";
import { agentDesignPatternsSkill } from "./skills/agentDesignPatterns";
import { stuckDiagnosticsSkill } from "./skills/stuckDiagnostics";
import { costOptimizationSkill } from "./skills/costOptimization";
import { promptAuditSkill } from "./skills/promptAudit";
import { modelMigrationSkill } from "./skills/modelMigration";
import { permissionAllowlistSkill } from "./skills/permissionAllowlist";
import { harnessConfigurationSkill } from "./skills/harnessConfiguration";
import { repoInstructionsSkill } from "./skills/repoInstructions";
import { memoryUpkeepSkill } from "./skills/memoryUpkeep";

/**
 * All built-in skill definitions, in registration (index) order. The
 * description of each feeds the skills index table; the body stays
 * out of context until a "/name" expansion loads it.
 */
export const builtinSkills = [
  debuggingSkill,
  codeReviewSkill,
  verifySkill,
  runAppSkill,
  dataVisualizationSkill,
  agentDesignPatternsSkill,
  stuckDiagnosticsSkill,
  costOptimizationSkill,
  promptAuditSkill,
  modelMigrationSkill,
  permissionAllowlistSkill,
  harnessConfigurationSkill,
  repoInstructionsSkill,
  memoryUpkeepSkill,
] as const;

/**
 * Built-in skill pack plugin — registers the fourteen resident skills on the
 * spine skills service at apply time (no scanning; bodies are compiled
 * in). Name collisions are tolerated silently and resolved first-wins:
 * in manifest order this plugin mounts after the disk-scanning "skills"
 * plugin, so project/user skills with a clashing name take precedence —
 * the same user-layer-shadows-builtin convention the module resolver
 * applies to plugin code.
 */
export const BuiltinSkillsPlugin = {
  name: "builtin-skills",
  apply(ctx: Context) {
    for (const skill of builtinSkills) {
      try {
        ctx.skills.register(skill);
      } catch {
        // duplicate skill name: the earlier registration wins
      }
    }
  },
};
export default BuiltinSkillsPlugin;
