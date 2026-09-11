import { useCallback, useEffect, useState } from "react";
import type { MemoryFileInfo, MemoryIpcApi, MemoryTarget, MemoryWorkspace } from "../../../shared/memoryIpc";

export function useMemoryFiles(api: MemoryIpcApi | undefined, initialWorkspace?: string) {
  const [target, setTarget] = useState<MemoryTarget>(initialWorkspace || null);
  const [workspaces, setWorkspaces] = useState<MemoryWorkspace[]>([]);
  const [files, setFiles] = useState<MemoryFileInfo[]>([]);
  const [loading, setLoading] = useState(!!api);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    if (!api) return;
    let current = true;
    setLoading(true);
    setError(null);
    setFiles([]);
    void Promise.all([api.memoryWorkspaces(), api.memoryFiles(target)]).then(([projects, items]) => {
      if (!current) return;
      setWorkspaces(projects);
      setFiles(items);
    }).catch((cause) => {
      if (current) setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [api, target, revision]);
  return { target, setTarget, workspaces, files, loading, error, refresh };
}
