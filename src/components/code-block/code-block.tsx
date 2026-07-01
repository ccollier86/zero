'use client';

/**
 * code-block.tsx
 *
 * Renders Zero's public CodeBlock component. This file owns code block UI,
 * file-tab state, and copy actions only; highlighting and fallback HTML are
 * delegated to code-block-highlight.ts.
 */

import * as React from 'react';

import { ZeroIcon } from '@/components/animate-ui/icons/zero-icon';
import { Button } from '@/components/ui/button';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { cn } from '@/lib/utils';

import { OBS_CODES } from '../../observability/codes';
import { emitFrontendCode } from '../../frontend/client/observability';
import {
  buildFallbackCodeBlockHtml,
  highlightCodeBlockHtml,
} from './code-block-highlight';
import type { CodeBlockFile, CodeBlockProps } from './code-block.types';

const DEFAULT_CODE_FILE: CodeBlockFile = {
  id: 'main',
  filename: 'example.ts',
  language: 'ts',
  code: '',
};

const DEFAULT_THEME = {
  light: 'github-light',
  dark: 'github-dark-default',
} as const;
const CODE_BLOCK_LINE_HEIGHT_REM = 1.421875;
const CODE_BLOCK_VERTICAL_PADDING_REM = 2;

/** Render a tokenized, copyable public code block with optional file tabs. */
export function CodeBlock({
  files,
  code,
  language = 'tsx',
  filename,
  defaultFileId,
  activeFileId: controlledActiveFileId,
  showLineNumbers = true,
  copyButton = true,
  minLines,
  theme = DEFAULT_THEME,
  onFileChange,
  onCopy,
  onHighlightError,
  className,
  headerClassName,
  viewportClassName,
  contentKey,
  contentClassName,
  ...props
}: CodeBlockProps) {
  const normalizedFiles = React.useMemo(
    () => normalizeCodeFiles(files, { code, language, filename }),
    [code, filename, files, language],
  );
  const [uncontrolledActiveFileId, setUncontrolledActiveFileId] = React.useState(
    () => defaultFileId ?? normalizedFiles[0]?.id ?? DEFAULT_CODE_FILE.id,
  );
  const activeFileId = controlledActiveFileId ?? uncontrolledActiveFileId;
  const activeFile = normalizedFiles.find((file) => file.id === activeFileId)
    ?? normalizedFiles[0]
    ?? DEFAULT_CODE_FILE;
  const [highlightedHtml, setHighlightedHtml] = React.useState(() =>
    buildFallbackCodeBlockHtml(activeFile.code),
  );
  const { copied, copy } = useCopyToClipboard({ timeoutMs: 1600 });
  const stableMinLines = normalizeMinLines(minLines);
  const viewportStyle = stableMinLines
    ? ({
        minHeight: `${(stableMinLines * CODE_BLOCK_LINE_HEIGHT_REM) + CODE_BLOCK_VERTICAL_PADDING_REM}rem`,
      } satisfies React.CSSProperties)
    : undefined;

  React.useEffect(() => {
    if (normalizedFiles.some((file) => file.id === activeFileId)) return;
    const firstFile = normalizedFiles[0] ?? DEFAULT_CODE_FILE;
    if (!controlledActiveFileId) setUncontrolledActiveFileId(firstFile.id);
    onFileChange?.(firstFile);
  }, [activeFileId, controlledActiveFileId, normalizedFiles, onFileChange]);

  React.useEffect(() => {
    let cancelled = false;
    const fallbackHtml = buildFallbackCodeBlockHtml(activeFile.code);
    setHighlightedHtml(fallbackHtml);

    highlightCodeBlockHtml(activeFile.code, activeFile.language, theme)
      .then((html) => {
        if (!cancelled) setHighlightedHtml(html);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setHighlightedHtml(fallbackHtml);
          onHighlightError?.(error, activeFile);
          emitFrontendCode(OBS_CODES.FRONTEND_CODE_HIGHLIGHT_FAILED, {
            error,
            metadata: {
              filename: activeFile.filename,
              language: activeFile.language,
            },
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeFile, onHighlightError, theme]);

  const handleFileSelect = React.useCallback(
    (file: CodeBlockFile) => {
      if (!controlledActiveFileId) setUncontrolledActiveFileId(file.id);
      onFileChange?.(file);
    },
    [controlledActiveFileId, onFileChange],
  );

  const handleCopy = React.useCallback(async () => {
    const copiedSuccessfully = await copy(activeFile.code);
    if (copiedSuccessfully) {
      onCopy?.(activeFile);
      return;
    }

    emitFrontendCode(OBS_CODES.FRONTEND_COPY_FAILED, {
      metadata: {
        filename: activeFile.filename,
        language: activeFile.language,
        hasContent: activeFile.code.length > 0,
      },
    });
  }, [activeFile, copy, onCopy]);

  return (
    <div
      data-zero-surface="public"
      data-line-numbers={showLineNumbers ? 'true' : 'false'}
      className={cn(
        'zero-code-block overflow-hidden rounded-lg border border-public-border bg-public-surface text-public-surface-foreground shadow-[var(--public-shadow-floating)]',
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          'flex min-h-12 items-center justify-between gap-3 border-b border-public-border bg-public-muted/55 px-3',
          headerClassName,
        )}
      >
        <CodeBlockFileTabs
          files={normalizedFiles}
          activeFile={activeFile}
          onSelect={handleFileSelect}
        />
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden rounded-md border border-public-border bg-public-glass px-2 py-1 text-[0.7rem] font-medium uppercase tracking-[0.12em] text-public-muted-foreground sm:inline-flex">
            {activeFile.language}
          </span>
          {copyButton ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={copied ? 'Code copied' : 'Copy code'}
              className="text-public-muted-foreground hover:bg-public-accent-soft hover:text-public-foreground focus-visible:ring-public-ring"
              onClick={handleCopy}
            >
              <ZeroIcon name={copied ? 'check' : 'copy'} className="size-4" />
            </Button>
          ) : null}
        </div>
      </div>

      <div
        className={cn(
          'relative max-h-[34rem] overflow-auto bg-public-background/70',
          viewportClassName,
        )}
        style={viewportStyle}
      >
        <div
          key={contentKey}
          className={cn('min-w-full py-4', contentClassName)}
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />
      </div>
    </div>
  );
}

function normalizeMinLines(minLines: number | undefined): number | undefined {
  if (typeof minLines !== 'number' || !Number.isFinite(minLines)) return undefined;
  return Math.max(1, Math.floor(minLines));
}

interface CodeBlockFileTabsProps {
  files: readonly CodeBlockFile[];
  activeFile: CodeBlockFile;
  onSelect: (file: CodeBlockFile) => void;
}

function CodeBlockFileTabs({ files, activeFile, onSelect }: CodeBlockFileTabsProps) {
  if (files.length <= 1) {
    return (
      <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-public-foreground">
        <ZeroIcon name="terminal" className="size-4 shrink-0 text-public-accent" aria-hidden />
        <span className="truncate">{activeFile.filename ?? activeFile.label ?? activeFile.language}</span>
      </div>
    );
  }

  return (
    <div
      role="tablist"
      aria-label="Code files"
      className="-ml-1 flex min-w-0 items-center gap-1 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {files.map((file) => {
        const active = file.id === activeFile.id;

        return (
          <button
            key={file.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={cn(
              'inline-flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-public-ring',
              active
                ? 'bg-public-surface text-public-foreground shadow-sm'
                : 'text-public-muted-foreground hover:bg-public-accent-soft hover:text-public-foreground',
            )}
            onClick={() => onSelect(file)}
          >
            <ZeroIcon name="terminal" className="size-4" aria-hidden />
            <span>{file.label ?? file.filename ?? file.language}</span>
          </button>
        );
      })}
    </div>
  );
}

function normalizeCodeFiles(
  files: CodeBlockProps['files'],
  singleFile: {
    code?: string;
    language?: string;
    filename?: string;
  },
): CodeBlockFile[] {
  if (files && files.length > 0) {
    return files.map((file, index) => ({
      ...file,
      id: file.id || `file-${index + 1}`,
      language: file.language || 'text',
      code: file.code ?? '',
    }));
  }

  return [
    {
      id: DEFAULT_CODE_FILE.id,
      filename: singleFile.filename ?? DEFAULT_CODE_FILE.filename,
      language: singleFile.language || DEFAULT_CODE_FILE.language,
      code: singleFile.code ?? '',
    },
  ];
}
