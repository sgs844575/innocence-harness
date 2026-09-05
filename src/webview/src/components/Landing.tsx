// 落地页：淡化大 logo 水印 + 时间问候语 + 居中输入卡（项目/分支顶行）+ 快捷动作。
import { GitBranch } from "lucide-react";
import logoUrl from "../../../../logo.svg";
import type { AttachmentPart, HarnessSettings } from "../../../shared/ipc";
import { Composer, type ComposerDraft } from "./Composer";
import { ProjectPicker } from "./composer/ProjectPicker";
import { QuickActions } from "./QuickActions";
import { activeModelVision } from "../lib/modelVision";
import { greetingKeyForHour } from "../lib/time";
import type { RecentProject } from "../state/useSessions";

interface Props {
  t: (key: string) => string;
  appName: string;
  pendingProject: string;
  /** 落地态项目根的 Git 分支（null = 非仓库/未检测，隐藏分支胶囊）。 */
  branch: string | null;
  recentProjects: RecentProject[];
  onPickProject: (workspaceRoot: string) => void;
  onOpenProjectDir: () => void;
  settings: HarnessSettings | null;
  streaming: boolean;
  onPatchSettings: (patch: Partial<HarnessSettings>) => void;
  onSend: (text: string, attachments: AttachmentPart[]) => void;
  onStop: () => void;
  draft?: ComposerDraft;
  onQuickPick: (prompt: string) => void;
  onManageModels?: () => void;
}

export function Landing({
  t,
  appName,
  pendingProject,
  branch,
  recentProjects,
  onPickProject,
  onOpenProjectDir,
  settings,
  streaming,
  onPatchSettings,
  onSend,
  onStop,
  draft,
  onQuickPick,
  onManageModels,
}: Props): React.JSX.Element {
  return (
    <div className="relative flex h-full min-w-0 flex-1 flex-col">
      <img
        src={logoUrl}
        alt=""
        aria-hidden
        title={appName}
        className="watermark-logo pointer-events-none absolute left-1/2 top-[13%] w-[220px] -translate-x-1/2 select-none"
      />
      <div className="flex flex-1 items-center justify-center px-6 pb-24">
        <div className="w-full max-w-[720px]">
          <h1
            className="stagger-in mb-6 text-center text-[20px] font-medium text-(--color-foreground-strong)"
            style={{ "--i": 0 } as React.CSSProperties}
          >
            {t(greetingKeyForHour(new Date().getHours()))}
          </h1>
          <div className="stagger-in" style={{ "--i": 1 } as React.CSSProperties}>
            <Composer
              t={t}
              mode="landing"
              streaming={streaming}
              settings={settings}
              onPatchSettings={onPatchSettings}
              onSend={onSend}
              onStop={onStop}
              workspaceRoot={pendingProject}
              draft={draft}
              onManageModels={onManageModels}
              visionSupported={activeModelVision(settings)}
              header={
                <div className="flex items-center gap-1">
                  <ProjectPicker
                    t={t}
                    value={pendingProject}
                    recent={recentProjects}
                    onSelect={onPickProject}
                    onOpenProject={onOpenProjectDir}
                  />
                  {branch && (
                    <span className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-(--color-muted)">
                      <GitBranch size={13} />
                      <span className="font-mono text-(--color-foreground)">{branch}</span>
                    </span>
                  )}
                </div>
              }
            />
          </div>
          <QuickActions t={t} onPick={onQuickPick} />
        </div>
      </div>
    </div>
  );
}
