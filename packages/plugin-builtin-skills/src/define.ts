/**
 * Static skill content shape: the markdown body travels with the definition
 * (it is compiled into the plugin), and `loadBody` resolves to that same
 * body so the definition already satisfies the spine's Skill contract.
 */
export interface SkillDefinition {
  readonly name: string;
  readonly description: string;
  readonly body: string;
  loadBody(): Promise<string>;
}

/** Builds a {@link SkillDefinition} whose body is resident as a literal. */
export function defineSkill(name: string, description: string, body: string): SkillDefinition {
  return { name, description, body, loadBody: async () => body };
}
