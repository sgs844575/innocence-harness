// 「添加模型」弹窗（对齐参考）：模型 ID + 智能配置（按名称匹配内置模型
// 清单自动填充属性）+ 上下文窗口 + 最大输出 Token + 高级配置折叠区
// （输入类型：文本锁定/图片/视频/PDF；模型能力：结构化输出/原生联网搜索/
// 对话中系统消息；推理等级从低到高动态列表；推理参数映射 JSON）。Esc/遮罩
// 关闭；底部 重置表单/取消/保存。
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Plus, X } from "lucide-react";
import type { ModelInfo } from "../../../../shared/ipc";
import { Switch } from "../ui/Switch";

interface Props {
  t: (key: string) => string;
  onClose: () => void;
  onSave: (model: ModelInfo) => void;
  /** 智能配置：按模型名称匹配清单（未命中返回 null）；缺省 = 不支持。 */
  onMatch?: (modelId: string) => Promise<ModelInfo | null>;
}

const DEFAULT_CONTEXT = "1000000";
const DEFAULT_OUTPUT = "128000";

export function AddModelDialog({ t, onClose, onSave, onMatch }: Props): React.JSX.Element {
  const [id, setId] = useState("");
  const [smart, setSmart] = useState(true);
  const [contextWindow, setContextWindow] = useState(DEFAULT_CONTEXT);
  const [maxOutput, setMaxOutput] = useState(DEFAULT_OUTPUT);
  const [vision, setVision] = useState(false);
  const [video, setVideo] = useState(false);
  const [pdf, setPdf] = useState(false);
  const [structuredOutput, setStructuredOutput] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  const [systemMessage, setSystemMessage] = useState(false);
  const [efforts, setEfforts] = useState<string[]>([]);
  const [effortDraft, setEffortDraft] = useState("");
  const [paramMapText, setParamMapText] = useState("");
  const [advanced, setAdvanced] = useState(true);
  const [matched, setMatched] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // 智能配置：模型 ID 停顿后匹配清单并整表填充（重打 ID 重新匹配覆盖；
  // 关闭开关或未命中不动表单）。onMatch 经 ref 持有（父层每次渲染的新闭包
  // 不触发重复匹配）；迟到结果经序号丢弃。
  const matchRef = useRef(onMatch);
  matchRef.current = onMatch;
  useEffect(() => {
    const modelId = id.trim();
    const onMatchNow = matchRef.current;
    if (!smart || !onMatchNow || !modelId) {
      setMatched(null);
      return;
    }
    let settled = false;
    const timer = window.setTimeout(() => {
      void onMatchNow(modelId)
        .then((hit) => {
          if (settled) return;
          if (!hit) {
            setMatched(null);
            return;
          }
          setMatched(hit.name ?? hit.id);
          if (hit.contextWindow !== undefined) setContextWindow(String(hit.contextWindow));
          if (hit.maxOutput !== undefined) setMaxOutput(String(hit.maxOutput));
          setVision(hit.vision === true);
          setVideo(hit.video === true);
          setPdf(hit.pdf === true);
          setStructuredOutput(hit.structuredOutput === true);
          setWebSearch(hit.webSearch === true);
          setSystemMessage(hit.systemMessage === true);
          setEfforts(hit.reasoningEfforts ?? []);
          setParamMapText(hit.reasoningParamMap ? JSON.stringify(hit.reasoningParamMap) : "");
        })
        .catch(() => undefined);
    }, 350);
    return () => {
      settled = true;
      window.clearTimeout(timer);
    };
  }, [id, smart]);

  const addEffort = (): void => {
    const level = effortDraft.trim();
    if (!level || efforts.includes(level)) return;
    setEfforts([...efforts, level]);
    setEffortDraft("");
  };

  // 参数映射：空串 = 未配置；非空必须解析为 string→string 的 JSON 对象。
  const { paramMap, paramMapError } = useMemo(() => {
    const text = paramMapText.trim();
    if (text === "") return { paramMap: undefined, paramMapError: false };
    try {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { paramMap: undefined, paramMapError: true };
      }
      const values = Object.values(parsed as Record<string, unknown>);
      if (values.length === 0 || values.some((value) => typeof value !== "string")) {
        return { paramMap: undefined, paramMapError: true };
      }
      return { paramMap: parsed as Record<string, string>, paramMapError: false };
    } catch {
      return { paramMap: undefined, paramMapError: true };
    }
  }, [paramMapText]);

  const reset = (): void => {
    setId("");
    setSmart(true);
    setContextWindow(DEFAULT_CONTEXT);
    setMaxOutput(DEFAULT_OUTPUT);
    setVision(false);
    setVideo(false);
    setPdf(false);
    setStructuredOutput(false);
    setWebSearch(false);
    setSystemMessage(false);
    setEfforts([]);
    setEffortDraft("");
    setParamMapText("");
    setMatched(null);
  };

  const save = (): void => {
    const modelId = id.trim();
    if (!modelId || paramMapError) return;
    const context = Number(contextWindow);
    const output = Number(maxOutput);
    onSave({
      id: modelId,
      name: modelId,
      source: "manual",
      ...(contextWindow.trim() !== "" && Number.isFinite(context) && context > 0 ? { contextWindow: context } : {}),
      ...(maxOutput.trim() !== "" && Number.isFinite(output) && output > 0 ? { maxOutput: output } : {}),
      ...(vision ? { vision: true } : {}),
      ...(video ? { video: true } : {}),
      ...(pdf ? { pdf: true } : {}),
      ...(structuredOutput ? { structuredOutput: true } : {}),
      ...(webSearch ? { webSearch: true } : {}),
      ...(systemMessage ? { systemMessage: true } : {}),
      ...(efforts.length > 0 ? { reasoningEfforts: efforts } : {}),
      ...(paramMap ? { reasoningParamMap: paramMap } : {}),
      dirty: true,
    });
  };

  const field = "w-full rounded-md border border-(--color-border) bg-(--color-surface) px-2.5 py-1.5 outline-none text-(--color-foreground) placeholder:text-(--color-faint) focus:border-(--color-accent)";
  const label = "mb-1 block text-(--color-muted)";
  const chipBase =
    "flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-(--color-border) px-2.5 text-(--color-foreground) hover:bg-(--color-hover)";

  const renderChip = (
    key: "image" | "video" | "pdf" | "structuredOutput" | "webSearch" | "systemMessage",
    checked: boolean,
    set: (next: boolean) => void,
  ): React.JSX.Element => (
    <label key={key} className={chipBase}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => set(event.target.checked)}
        aria-label={t(`settings.models.dialog.${key}`)}
      />
      {t(`settings.models.dialog.${key}`)}
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 grid place-items-center" role="dialog" aria-label={t("settings.models.dialog.title")}>
      <button type="button" aria-label={t("settings.dialog.cancel")} onClick={onClose} className="absolute inset-0 cursor-default bg-black/25" />
      <div data-state="open" className="modal-in relative max-h-[85vh] w-[400px] overflow-y-auto rounded-(--radius-pop) border border-(--color-border) bg-(--color-popup) p-5 shadow-(--shadow-pop)">
        <div className="mb-4 flex items-center">
          <span className="font-bold text-(--color-foreground-strong)">{t("settings.models.dialog.title")}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("settings.dialog.cancel")}
            title={t("settings.dialog.cancel")}
            className="ml-auto grid size-7 place-items-center rounded-md text-(--color-muted) hover:bg-(--color-hover) hover:text-(--color-foreground)"
          >
            <X size={14} />
          </button>
        </div>

        {/* 智能配置：按名称匹配内置模型清单，自动填充属性 */}
        <div className="mb-3 flex items-center gap-3 rounded-md border border-(--color-hairline) bg-(--color-surface) px-2.5 py-2">
          <div className="min-w-0 flex-1">
            <span className="block text-(--color-foreground)">{t("settings.models.dialog.smartConfig")}</span>
            <span className="block text-xs text-(--color-faint)">{t("settings.models.dialog.smartConfig.desc")}</span>
          </div>
          <Switch checked={smart} onChange={setSmart} label={t("settings.models.dialog.smartConfig")} />
        </div>
        {matched && (
          <div className="mb-3 text-xs text-(--color-accent)" data-testid="smart-match-hint">
            {t("settings.models.dialog.smartMatched").replace("{name}", matched)}
          </div>
        )}

        <label className="mb-3 block">
          <span className={label}>{t("settings.models.dialog.modelId")}</span>
          <input
            autoFocus
            value={id}
            onChange={(event) => setId(event.target.value)}
            placeholder={t("settings.models.dialog.modelId")}
            className={`${field} font-mono`}
          />
        </label>
        <label className="mb-3 block">
          <span className={label}>{t("settings.models.dialog.contextWindow")}</span>
          <input
            value={contextWindow}
            onChange={(event) => setContextWindow(event.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric"
            className={`${field} font-mono`}
          />
        </label>
        <label className="mb-2 block">
          <span className={label}>{t("settings.models.dialog.maxOutput")}</span>
          <input
            value={maxOutput}
            onChange={(event) => setMaxOutput(event.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric"
            className={`${field} font-mono`}
          />
        </label>

        {/* 高级配置折叠区（手风琴惯用法：按钮 + .acc-panel） */}
        <button
          type="button"
          onClick={() => setAdvanced((value) => !value)}
          aria-expanded={advanced}
          className="mb-2 flex h-8 w-full cursor-pointer items-center gap-1.5 rounded-md px-1 text-(--color-foreground) hover:bg-(--color-hover)"
        >
          <ChevronRight size={14} className={`text-(--color-muted) transition-transform duration-(--duration-fast) ${advanced ? "rotate-90" : ""}`} />
          <span className="font-medium">{t("settings.models.dialog.advanced")}</span>
        </button>
        <div className="acc-panel mb-3" data-open={advanced}>
          <div className="acc-panel-inner">
            <div className="space-y-3 rounded-md border border-(--color-hairline) bg-(--color-surface) p-2.5">
              <div>
                <span className={label}>{t("settings.models.dialog.inputTypes")}</span>
                <div className="flex flex-wrap gap-2">
                  <span className="flex h-7 items-center gap-1.5 rounded-md border border-(--color-border) px-2.5 text-(--color-faint)">
                    <input type="checkbox" checked readOnly disabled aria-label={t("settings.models.dialog.text")} />
                    {t("settings.models.dialog.text")}
                  </span>
                  {renderChip("image", vision, setVision)}
                  {renderChip("video", video, setVideo)}
                  {renderChip("pdf", pdf, setPdf)}
                </div>
              </div>

              <div>
                <span className={label}>{t("settings.models.dialog.capabilities")}</span>
                <div className="flex flex-wrap gap-2">
                  {renderChip("structuredOutput", structuredOutput, setStructuredOutput)}
                  {renderChip("webSearch", webSearch, setWebSearch)}
                  {renderChip("systemMessage", systemMessage, setSystemMessage)}
                </div>
              </div>

              <div>
                <span className={label}>{t("settings.models.dialog.reasoningLevels")}</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {efforts.map((level) => (
                    <span
                      key={level}
                      className="flex h-7 items-center gap-1 rounded-md border border-(--color-border) px-2 font-mono text-xs text-(--color-foreground)"
                    >
                      {level}
                      <button
                        type="button"
                        aria-label={`${t("settings.models.dialog.removeLevel")} ${level}`}
                        onClick={() => setEfforts(efforts.filter((item) => item !== level))}
                        className="grid size-4 cursor-pointer place-items-center rounded text-(--color-faint) hover:bg-(--color-hover) hover:text-(--color-foreground)"
                      >
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                  <input
                    value={effortDraft}
                    onChange={(event) => setEffortDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addEffort();
                      }
                    }}
                    placeholder={t("settings.models.dialog.levelPlaceholder")}
                    aria-label={t("settings.models.dialog.reasoningLevels")}
                    className="h-7 w-24 rounded-md border border-(--color-border) bg-(--color-popup) px-2 font-mono text-xs outline-none text-(--color-foreground) placeholder:text-(--color-faint) focus:border-(--color-accent)"
                  />
                  <button
                    type="button"
                    onClick={addEffort}
                    disabled={effortDraft.trim() === "" || efforts.includes(effortDraft.trim())}
                    aria-label={t("settings.models.dialog.addLevel")}
                    title={t("settings.models.dialog.addLevel")}
                    className="grid h-7 w-7 cursor-pointer place-items-center rounded-md border border-(--color-border) text-(--color-muted) hover:bg-(--color-hover) hover:text-(--color-foreground) disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <Plus size={12} />
                  </button>
                </div>
                <span className="mt-1 block text-xs text-(--color-faint)">{t("settings.models.dialog.reasoningLevels.hint")}</span>
              </div>

              <div>
                <span className={label}>{t("settings.models.dialog.paramMap")}</span>
                <textarea
                  value={paramMapText}
                  onChange={(event) => setParamMapText(event.target.value)}
                  placeholder={t("settings.models.dialog.paramMap.placeholder")}
                  rows={2}
                  aria-label={t("settings.models.dialog.paramMap")}
                  spellCheck={false}
                  className={`${field} resize-y font-mono text-xs ${paramMapError ? "border-(--color-tool-err)" : ""}`}
                />
                {paramMapError && (
                  <span className="mt-1 block text-xs text-(--color-tool-err)" data-testid="param-map-error">
                    {t("settings.models.dialog.paramMap.invalid")}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="h-8 cursor-pointer rounded-md border border-(--color-border) px-3 text-(--color-muted) hover:bg-(--color-hover) hover:text-(--color-foreground)"
          >
            {t("settings.models.dialog.reset")}
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="h-8 cursor-pointer rounded-md border border-(--color-border) px-3 text-(--color-muted) hover:bg-(--color-hover) hover:text-(--color-foreground)"
          >
            {t("settings.dialog.cancel")}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={id.trim() === "" || paramMapError}
            className="h-8 cursor-pointer rounded-md bg-(--color-brand) px-3 text-(--color-inverse) transition-opacity hover:opacity-80 disabled:opacity-30"
          >
            {t("settings.models.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
