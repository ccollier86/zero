'use client';
/** Backward-compatible convenience surface and additive, fully composable CodeBlock. */
import * as React from 'react';
import { Tabs } from 'radix-ui';
import { CodeBlockContext } from './code-block-context';
import { CodeBlockRoot, CodeBlockHeader, CodeBlockGroup, CodeBlockContent } from './code-block-parts';
import { CodeBlockFiles, normalizeCodeBlockFiles } from './code-block-files';
import { CodeBlockCode } from './code-block-code';
import { CodeBlockCopyButton } from './code-block-copy';
import { readCodeBlockMetadata } from './code-block-metadata';
import type { CodeBlockFile, CodeBlockProps } from './code-block.types';

/** Existing code/files usage stays valid; children replace only the ready-made composition. */
export function CodeBlock({ files, code, language = 'tsx', filename, defaultFileId,
  activeFileId: controlledId, showLineNumbers = true, copyButton = true, minLines, theme,
  onFileChange, onCopy, onHighlightError, className, headerClassName, viewportClassName,
  contentKey, contentClassName, highlighted, highlightOnClient, meta, highlightLines, highlightWords,
  annotations, lineAnchors, startLine, wordWrap, transformers, transformerIdentity, actions, header = true,
  copyVariant = 'icon', children, ...props }: CodeBlockProps) {
  const normalizedFiles = React.useMemo(() => normalizeCodeBlockFiles({ files, code, language, filename, meta, highlighted }),
    [files, code, language, filename, meta, highlighted]);
  const [localId, setLocalId] = React.useState(() => defaultFileId ?? normalizedFiles[0]!.id);
  const requestedId = controlledId ?? localId;
  const file = normalizedFiles.find(item => item.id === requestedId) ?? normalizedFiles[0]!;
  const selectFile = React.useCallback((next: CodeBlockFile) => {
    if (controlledId === undefined) setLocalId(next.id);
    onFileChange?.(next);
  }, [controlledId, onFileChange]);
  const repairedId = React.useRef<string | undefined>(undefined);
  React.useEffect(() => {
    if (normalizedFiles.some(item => item.id === requestedId)) { repairedId.current = undefined; return; }
    if (controlledId === undefined) setLocalId(file.id);
    if (repairedId.current !== requestedId) { repairedId.current = requestedId; onFileChange?.(file); }
  }, [normalizedFiles, requestedId, controlledId, file, onFileChange]);
  const id = React.useId();
  const options = React.useMemo(() => ({ theme, meta: file.meta ?? meta, highlightLines, highlightWords,
    annotations, lineAnchors, showLineNumbers, startLine, wordWrap, transformers, transformerIdentity,
  }), [theme, file.meta, meta, highlightLines, highlightWords, annotations, lineAnchors, showLineNumbers, startLine, wordWrap, transformers, transformerIdentity]);
  const metadata = readCodeBlockMetadata(options, 0);
  const context = React.useMemo(() => ({ file, files: normalizedFiles, selectFile, options,
    highlighted: file.highlighted ?? highlighted, highlightOnClient, onCopy, onHighlightError,
    tabId: (fileId: string) => `${id}-tab-${encodeURIComponent(fileId)}`, panelId: `${id}-panel`,
  }), [file, normalizedFiles, selectFile, options, highlighted, highlightOnClient, onCopy, onHighlightError, id]);
  return <CodeBlockContext.Provider value={context}>
    <Tabs.Root asChild value={file.id} onValueChange={next => {
      const selected = normalizedFiles.find(item => item.id === next); if (selected) selectFile(selected);
    }}>
      <CodeBlockRoot className={className} showLineNumbers={metadata.lineNumbers} wordWrap={metadata.wordWrap} {...props}>
        {children ?? <>
          {header ? <CodeBlockHeader className={headerClassName}>
            <CodeBlockFiles />
            <CodeBlockGroup className="zero-code-block-actions">
              <span className="zero-code-block-language">{file.language}</span>{actions}
              {copyButton ? <CodeBlockCopyButton variant={copyVariant} /> : null}
            </CodeBlockGroup>
          </CodeBlockHeader> : null}
          <Tabs.Content asChild forceMount value={file.id} id={context.panelId}
            aria-labelledby={normalizedFiles.length > 1 ? context.tabId(file.id) : undefined}>
            <CodeBlockContent className={viewportClassName} minLines={minLines}>
              {!header && copyButton ? <CodeBlockCopyButton variant={copyVariant} className="zero-code-block-inline-copy" /> : null}
              <CodeBlockCode key={contentKey} className={contentClassName} />
            </CodeBlockContent>
          </Tabs.Content>
        </>}
      </CodeBlockRoot>
    </Tabs.Root>
  </CodeBlockContext.Provider>;
}
