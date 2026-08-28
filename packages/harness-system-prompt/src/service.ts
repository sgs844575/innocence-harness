import { appendSkillIndex } from "@innocenceharness/harness-skills";
import type { Skill } from "@innocenceharness/harness-skills";
import type { Context } from "@innocenceharness/kernel";

// Services are typed on `Context` through declaration merging by their
// publisher (kernel ServiceTable contract). The member is live only while
// the system-prompt plugin fiber publishing it is active; before load and
// after its unwind the property is absent at runtime.
declare module "@innocenceharness/kernel" {
  interface Context {
    systemPrompt: SystemPromptService;
  }
}

/** 项目特征（宿主探测注入；只读键值对，如 language:test:framework）。 */
export interface ProjectTraits {
  readonly [key: string]: string | undefined;
}

/** 片段渲染上下文。 */
export interface PromptContext {
  activeMode: string;
  traits: ProjectTraits;
}

/** 可条件装载的提示词片段。分桶规则（缓存纪律，波动性从低到高）：
 *  共享桶（无 modes 无 when）→ 模式桶（有 modes 且命中 activeMode，when 可叠加）
 *  → 条件桶（无 modes 有 when 且命中）→ 技能索引（appendSkillIndex 语义）。
 *  桶内按 (order, id) 升序；render 为空串则跳过。 */
export interface PromptFragment {
  id: string;
  order?: number;
  modes?: readonly string[];
  when?: (traits: ProjectTraits) => boolean;
  render(ctx: PromptContext): string;
}

export interface SystemPromptService {
  setBase(prompt: string | undefined): void;
  registerFragment(fragment: PromptFragment): void;
  /** Assembles base + shared + mode + conditional fragments + skills index. */
  build(skills: readonly Skill[], ctx?: PromptContext): string;
}

/**
 * System-prompt spine service plugin. `apply` publishes a
 * {@link SystemPromptService} under "systemPrompt" on the scope owning the
 * plugin context and returns the withdraw handle, so the service disappears
 * when the plugin fiber unwinds.
 */
export const SystemPromptPlugin: {
  name: "harness-system-prompt";
  apply(ctx: Context): () => void;
} = {
  name: "harness-system-prompt",
  apply(ctx) {
    let base = "";
    const fragments: PromptFragment[] = [];
    const DEFAULT_CTX: PromptContext = { activeMode: "default", traits: {} };

    const service: SystemPromptService = {
      setBase: (prompt) => {
        base = prompt ?? "";
      },
      registerFragment: (fragment) => {
        if (fragments.some((f) => f.id === fragment.id)) {
          throw new Error(`duplicate prompt fragment registration: ${fragment.id}`);
        }
        fragments.push(fragment);
      },
      build: (skills, ctx = DEFAULT_CTX) => {
        const shared: PromptFragment[] = [];
        const mode: PromptFragment[] = [];
        const conditional: PromptFragment[] = [];
        for (const f of fragments) {
          const modeHit = !f.modes || f.modes.includes(ctx.activeMode);
          const traitHit = !f.when || f.when(ctx.traits);
          if (!modeHit || !traitHit) continue;
          if (f.modes) mode.push(f);
          else if (f.when) conditional.push(f);
          else shared.push(f);
        }
        const byOrderThenId = (a: PromptFragment, b: PromptFragment) =>
          (a.order ?? 0) - (b.order ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
        let prompt = base;
        for (const f of [...shared.sort(byOrderThenId), ...mode.sort(byOrderThenId), ...conditional.sort(byOrderThenId)]) {
          const rendered = f.render(ctx);
          if (rendered) prompt = prompt ? `${prompt}\n\n${rendered}` : rendered;
        }
        return appendSkillIndex(prompt, skills);
      },
    };

    return ctx.provide("systemPrompt", service);
  },
};
