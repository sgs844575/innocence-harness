// 上下文容量指示器：18px 常显环（阈值三档色）+ 点击弹出容量明细清单弹层。
// 颜色全部取语义 token（accent/tool-warn/tool-err/border），弹层复用 DropdownMenu。
import { DropdownMenu } from "../ui/DropdownMenu";
import type { ChatContextUsageSnapshot } from "../../../../shared/ipc";

interface Props {
  t: (key: string) => string;
  snapshot: ChatContextUsageSnapshot | null;
  /** 测试与故事板用受控展开：false = 不渲染；true = 跳过 Radix 直接渲染弹层面板；
   *  undefined = 生产形态，由 DropdownMenu 自管开合。 */
  open?: boolean;
}

const RING_RADIUS = 7;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

// 阈值分档（单一来源）：<60% 蓝 / 60–85% 警示橙 / ≥85% 危险红。
export type ContextAccentTier = "accent" | "warn" | "err";

/** 测试锚点：占用比例 → 分档名，渲染用色由它派生。 */
export function contextAccentClass(pct: number): ContextAccentTier {
  if (pct >= 0.85) return "err";
  if (pct >= 0.6) return "warn";
  return "accent";
}

/** 档位 → 弧色 token 映射。 */
const TIER_VAR: Record<ContextAccentTier, string> = {
  accent: "var(--color-accent)",
  warn: "var(--color-tool-warn)",
  err: "var(--color-tool-err)",
};

/** 占用比例 → 弧色 token（contextAccentClass 分档派生，无平行阈值链）。 */
export function contextAccentVar(pct: number): string {
  return TIER_VAR[contextAccentClass(pct)];
}

/** token 数 compact 格式：≥1亿 → 亿、≥1万 → 万、≥1000 → k（1 位小数去尾零），其余原值。 */
export function formatTokenCount(value: number): string {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1).replace(/\.0$/, "")}亿`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(1).replace(/\.0$/, "")}万`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(value);
}

function Ring({ pct }: { pct: number }): React.JSX.Element {
  const color = contextAccentVar(pct);
  const dash = Math.max(0, Math.min(1, pct)) * RING_CIRCUMFERENCE;
  return (
    <svg width={18} height={18} viewBox="0 0 18 18" style={{ transform: "rotate(-90deg)" }} aria-hidden>
      <circle cx={9} cy={9} r={RING_RADIUS} fill="none" strokeWidth={2.5} style={{ stroke: "var(--color-border)" }} />
      <circle
        cx={9}
        cy={9}
        r={RING_RADIUS}
        fill="none"
        strokeWidth={2.5}
        strokeLinecap="round"
        style={{ stroke: color, strokeDasharray: `${dash} ${RING_CIRCUMFERENCE}` }}
      />
    </svg>
  );
}

// 分类行键：渲染前过滤零值并按 token 占比降序。
const CATEGORY_KEYS = [
  ["mcpTools", "chat.contextMeter.mcpTools"],
  ["systemTools", "chat.contextMeter.systemTools"],
  ["messages", "chat.contextMeter.messages"],
  ["other", "chat.contextMeter.other"],
  ["skills", "chat.contextMeter.skills"],
  ["systemPrompt", "chat.contextMeter.systemPrompt"],
] as const;

function MeterPanel({ t, snapshot }: { t: (key: string) => string; snapshot: ChatContextUsageSnapshot }): React.JSX.Element {
  const pct = snapshot.contextWindow ? snapshot.inputTokens / snapshot.contextWindow : 0;
  const categories = CATEGORY_KEYS
    .map(([field, key]) => ({ field, key, value: snapshot.breakdown[field] }))
    .filter((c) => c.value > 0)
    .sort((a, b) => b.value - a.value);
  const totalPct = snapshot.contextWindow ? (pct * 100).toFixed(1) : null;
  const hitRate =
    snapshot.cache.inputTokens > 0 ? (snapshot.cache.cachedInputTokens / snapshot.cache.inputTokens) * 100 : null;
  return (
    <div className="w-72 px-3.5 pb-2 pt-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold text-(--color-foreground-strong)">{t("chat.contextMeter.title")}</span>
        <span className="font-mono text-[11.5px] text-(--color-muted)">
          {formatTokenCount(snapshot.inputTokens)}
          {snapshot.contextWindow ? ` / ${formatTokenCount(snapshot.contextWindow)}` : " / —"}
          {totalPct ? `（${totalPct}%）` : ""}
        </span>
      </div>
      {/* 4px 总进度条，弧色同源（阈值三档）。 */}
      <div className="mt-2.5 mb-2.5 h-1 overflow-hidden rounded-full bg-(--color-hover)">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(100, Math.max(0, pct * 100))}%`, background: contextAccentVar(pct) }}
        />
      </div>
      {categories.map((c) => (
        <div key={c.field} data-testid="context-category-row" className="flex items-center gap-2 py-[5px] text-[12.5px]">
          <span className="size-1.5 shrink-0 rounded-full" style={{ background: "var(--color-accent)" }} />
          <span className="text-(--color-foreground)">{t(c.key)}</span>
          <span className="ml-auto font-mono text-[11.5px] text-(--color-muted)">
            {((c.value / snapshot.inputTokens) * 100).toFixed(1)}%
          </span>
        </div>
      ))}
      {hitRate !== null && (
        <div className="mt-1.5 flex items-center justify-between border-t border-(--color-hairline) pt-2 pb-1 text-[12.5px]">
          <span className="text-(--color-foreground)">{t("chat.contextMeter.cacheHitRate")}</span>
          <span className="font-mono text-xs text-(--color-foreground-strong)">{hitRate.toFixed(1)}%</span>
        </div>
      )}
    </div>
  );
}

// 触发钮组件：透传额外 props/ref（Radix asChild 经 Slot 合并 aria/事件到钮上）。
function MeterTrigger({
  t,
  pct,
  ...rest
}: { t: (key: string) => string; pct: number } & React.ComponentPropsWithRef<"button">): React.JSX.Element {
  return (
    <button
      type="button"
      data-testid="chat-context-meter"
      aria-label={t("chat.contextMeter.trigger")}
      title={t("chat.contextMeter.trigger")}
      className="grid shrink-0 cursor-pointer place-items-center rounded-md px-1 py-1 hover:bg-(--color-hover)"
      {...rest}
    >
      <Ring pct={pct} />
    </button>
  );
}

export function ContextMeter({ t, snapshot, open }: Props): React.JSX.Element | null {
  if (open === false) return null;
  if (!snapshot) {
    // 新会话（无快照）：0% 灰环常显，无可展开明细。
    return <MeterTrigger t={t} pct={0} />;
  }
  // 故事板/测试受控展开：true = 不经 Radix 直接渲染面板，便于 jsdom 断言。
  if (open === true) return <MeterPanel t={t} snapshot={snapshot} />;
  const pct = snapshot.contextWindow ? snapshot.inputTokens / snapshot.contextWindow : 0;
  return (
    <DropdownMenu
      contentClassName="w-72"
      trigger={<MeterTrigger t={t} pct={pct} />}
    >
      <MeterPanel t={t} snapshot={snapshot} />
    </DropdownMenu>
  );
}
