import { MarkdownView, type CodeAppearance } from "./MarkdownView";
import { codeFence, languageForFilePath, prepareFileContent } from "./fileCode";

export function FileCodeView({
  source,
  filePath,
  code,
  numbered = false,
  bounded = false,
}: {
  source: string;
  filePath?: string;
  code?: CodeAppearance;
  /** The file-read tool prefixes each source line with `number + tab`. */
  numbered?: boolean;
  /** Inline tool previews stay compact; dock file tabs use their own scroll area. */
  bounded?: boolean;
}): React.JSX.Element {
  const prepared = prepareFileContent(source, numbered);
  if (numbered && !prepared.numbered) {
    return (
      <pre className={`scrollbar-thin overflow-auto rounded-(--radius-pop) bg-(--color-surface) p-2 font-mono code-text whitespace-pre text-(--color-foreground) ${bounded ? "max-h-60" : ""}`}>
        {source}
      </pre>
    );
  }

  const markdown = codeFence(
    prepared.code,
    languageForFilePath(filePath),
    prepared.startLine,
  );
  return (
    <div className={`file-code-view ${bounded ? "file-code-view-bounded" : ""}`}>
      <MarkdownView source={markdown} code={code} controls={false} />
      {prepared.note && (
        <pre className="file-code-note font-mono code-text whitespace-pre-wrap text-(--color-faint)">
          {prepared.note}
        </pre>
      )}
    </div>
  );
}
