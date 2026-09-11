import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { MemoryIpcApi, MemoryTarget } from "../../../../shared/memoryIpc";

export function MemoryPreview({ api, target, name, t, onClose }: {
  api: MemoryIpcApi; target: MemoryTarget; name: string; t: (key: string) => string; onClose: () => void;
}): React.JSX.Element {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    void api.memoryReadFile(target, name).then((file) => {
      if (current) setContent(file.content);
    }).catch((cause) => { if (current) setError(String(cause)); });
    return () => { current = false; };
  }, [api, target, name]);
  return <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-(--color-markdown-table-backdrop)" />
      <Dialog.Content className="modal-in fixed top-1/2 left-1/2 z-50 flex max-h-[80vh] w-[min(800px,90vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-(--radius-pop) border border-(--color-border) bg-(--color-popup) p-5 shadow-(--shadow-pop)">
        <div className="flex items-center gap-3"><Dialog.Title className="min-w-0 flex-1 truncate font-semibold text-(--color-foreground-strong)">{name}</Dialog.Title><Dialog.Close aria-label={t("settings.memory.close")} className="grid size-7 place-items-center rounded-md text-(--color-muted) hover:bg-(--color-hover) focus-visible:outline-2 focus-visible:outline-(--color-accent)"><X size={16} /></Dialog.Close></div>
        <Dialog.Description className="mt-1 text-(--color-muted)">{t("settings.memory.previewDesc")}</Dialog.Description>
        {error ? <p role="alert" className="mt-4 text-(--color-tool-err)">{error}</p> : content === null ? <p role="status" className="mt-4 text-(--color-muted)">{t("settings.memory.loading")}</p> : <pre className="scrollbar-thin mt-4 min-h-0 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-(--color-background) p-4 font-mono text-[13px] leading-relaxed text-(--color-foreground)">{content}</pre>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
