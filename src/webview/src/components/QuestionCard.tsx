// 询问卡（ask_user 工具）：agent 的结构化问题渲染为逐题选项块。单选题
// 点击选项即锁定该题选择；多选题可反复切换；底部「提交」在每题都有选择
// 后可用，「跳过」直接回 null（agent 按最佳判断继续）。与权限批准卡同
// 轨道（输入卡上方），样式遵循设计 token。
import { useState } from "react";
import type { ChatQuestionEvent, ChatQuestionResponse } from "../../../shared/ipc";

export function QuestionCard({
  t,
  request,
  onRespond,
}: {
  t: (key: string) => string;
  request: ChatQuestionEvent;
  onRespond: (requestId: string, response: ChatQuestionResponse) => void;
}): React.JSX.Element {
  // 每题当前选中的 label 集合（按问题下标存；单选题集合大小恒 ≤1）。
  const [selections, setSelections] = useState<Record<number, string[]>>({});

  const toggle = (index: number, label: string, multiSelect: boolean) => {
    setSelections((prev) => {
      const current = prev[index] ?? [];
      if (multiSelect) {
        const next = current.includes(label)
          ? current.filter((item) => item !== label)
          : [...current, label];
        return { ...prev, [index]: next };
      }
      // 单选：再次点击同一选项保持选中（无取消态——提问总有语境）。
      return { ...prev, [index]: [label] };
    });
  };

  const allAnswered = request.questions.every((_q, index) => (selections[index] ?? []).length > 0);

  const submit = () => {
    if (!allAnswered) return;
    onRespond(request.requestId, {
      answers: request.questions.map((question, index) => ({
        question: question.question,
        answers: [...(selections[index] ?? [])],
      })),
    });
  };

  return (
    <div
      role="alertdialog"
      aria-label={t("question.card.title")}
      data-testid="question-card"
      className="rounded-(--radius-card) border border-(--color-border) bg-(--color-raised) p-3 shadow-(--shadow-card)"
    >
      <div className="font-medium text-(--color-foreground-strong)">{t("question.card.title")}</div>
      <div className="mt-3 space-y-4">
        {request.questions.map((question, index) => (
          <div key={`${index}-${question.question}`} data-testid={`question-item-${index}`}>
            <div className="flex items-baseline gap-2">
              {question.header ? (
                <span className="shrink-0 rounded-(--radius-pop) bg-(--color-hover) px-2 py-0.5 text-xs text-(--color-muted)">
                  {question.header}
                </span>
              ) : null}
              <span className="text-(--color-foreground)">{question.question}</span>
              {question.multiSelect ? (
                <span className="shrink-0 text-xs text-(--color-faint)">{t("question.card.multiHint")}</span>
              ) : null}
            </div>
            <div className="mt-2 flex flex-col gap-1.5">
              {question.options.map((option) => {
                const selected = (selections[index] ?? []).includes(option.label);
                return (
                  <button
                    key={option.label}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggle(index, option.label, question.multiSelect === true)}
                    className={
                      "rounded-(--radius-pop) border px-3 py-1.5 text-left transition-colors " +
                      (selected
                        ? "border-(--color-accent) bg-(--color-selected) text-(--color-foreground-strong)"
                        : "border-(--color-border) text-(--color-foreground) hover:bg-(--color-hover)")
                    }
                  >
                    <span className="text-sm">{option.label}</span>
                    {option.description ? (
                      <span className="ml-2 text-xs text-(--color-faint)">{option.description}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={!allAnswered}
          onClick={submit}
          className="h-7 rounded-md bg-(--color-foreground-strong) px-3 text-(--color-background) hover:opacity-90 disabled:cursor-default disabled:opacity-40"
        >
          {t("question.card.submit")}
        </button>
        <button
          type="button"
          onClick={() => onRespond(request.requestId, null)}
          className="h-7 rounded-md border border-(--color-border) px-3 text-(--color-muted) hover:bg-(--color-hover)"
        >
          {t("question.card.skip")}
        </button>
      </div>
    </div>
  );
}
