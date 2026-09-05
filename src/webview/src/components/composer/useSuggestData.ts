// 补全数据钩子：token 激活（enabled）且缓存根过期时拉目录；弹层完全关闭即
// 失效缓存（下次打开重拉——文件清单怕陈旧，技能顺带同语义）；技能目录另挂
// plugins:changed 失效（开发态插件热更即时反映）。桥缺失（测试/纯浏览器）
// 降级为空表不拉取、不 loading。
import { useEffect, useState } from "react";
import type { SkillInfo } from "../../../../shared/ipc";
import { api, hasBridge } from "../../lib/ipc";

interface CatalogCache<T> {
  root: string;
  items: T[];
}

/** 技能目录（skills:list；root 为空 = 仅用户根技能）。 */
export function useSkillCatalog(enabled: boolean, root: string): { items: SkillInfo[]; loading: boolean } {
  const [cache, setCache] = useState<CatalogCache<SkillInfo> | null>(null);
  const fresh = cache !== null && cache.root === root;
  // 弹层关闭即失效：下次打开重拉。
  useEffect(() => {
    if (!enabled) setCache(null);
  }, [enabled]);
  // 插件热更失效（开发态即时反映新装/移除的技能插件）。
  useEffect(() => {
    if (!hasBridge()) return;
    return api.onPluginsChanged(() => setCache(null));
  }, []);
  useEffect(() => {
    if (!enabled || !hasBridge() || fresh) return;
    let cancelled = false;
    void api
      .listSkills(root)
      .then((items) => {
        if (!cancelled) setCache({ root, items: items ?? [] });
      })
      .catch(() => {
        if (!cancelled) setCache({ root, items: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, root, fresh]);
  return { items: fresh ? cache.items : [], loading: enabled && !fresh && hasBridge() };
}

/** 工作区文件清单（workspace:list-files；无根不拉取、不 loading）。 */
export function useWorkspaceFileList(enabled: boolean, root: string): { items: string[]; loading: boolean } {
  const trimmed = root.trim();
  const effective = enabled && trimmed !== "";
  const [cache, setCache] = useState<CatalogCache<string> | null>(null);
  const fresh = cache !== null && cache.root === trimmed;
  useEffect(() => {
    if (!effective) setCache(null);
  }, [effective]);
  useEffect(() => {
    if (!effective || !hasBridge() || fresh) return;
    let cancelled = false;
    void api
      .listWorkspaceFiles(trimmed)
      .then((items) => {
        if (!cancelled) setCache({ root: trimmed, items: items ?? [] });
      })
      .catch(() => {
        if (!cancelled) setCache({ root: trimmed, items: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [effective, trimmed, fresh]);
  return { items: fresh ? cache.items : [], loading: effective && !fresh && hasBridge() };
}
