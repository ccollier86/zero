'use client';
/** Race-safe code rendering with shared server/browser transforms and escaped fallback. */
import * as React from 'react';
import { cn } from '../../lib/utils';
import { OBS_CODES } from '../../observability/codes';
import { emitFrontendCode } from '../../frontend/client/observability';
import { buildFallbackCodeBlockHtml, highlightCodeBlock } from './code-block-highlight';
import { codeBlockHighlightKey, readCodeBlockMetadata } from './code-block-metadata';
import { useCodeBlockContext } from './code-block-context';
import { codeBlockHighlightBindingMatches, codeBlockHighlightLiveIdentity } from './code-block-highlight-identity';
import type { CodeBlockCodeProps, CodeBlockHighlightResult } from './code-block.types';

/** Standalone client highlighter, or a composable child that inherits its CodeBlock source. */
export function CodeBlockCode({ code: ownCode, language: ownLanguage, highlighted: ownHighlighted,
  highlightOnClient: ownClient, onHighlightError, className, theme, meta, highlightLines, highlightWords,
  annotations, lineAnchors, showLineNumbers, startLine, wordWrap, transformers, transformerIdentity, ...props }: CodeBlockCodeProps) {
  const context = useCodeBlockContext();
  const code = ownCode ?? context?.file.code ?? '', language = ownLanguage ?? context?.file.language ?? 'text';
  const options = React.useMemo(() => ({ ...context?.options,
    ...defined({ theme, meta, highlightLines, highlightWords, annotations, lineAnchors, showLineNumbers, startLine, wordWrap, transformers, transformerIdentity }),
  }), [context?.options, theme, meta, highlightLines, highlightWords, annotations, lineAnchors, showLineNumbers, startLine, wordWrap, transformers, transformerIdentity]);
  const key = codeBlockHighlightKey(code, language, options);
  const liveIdentity = codeBlockHighlightLiveIdentity(options);
  const provided = ownHighlighted ?? context?.highlighted;
  const matches = (value: CodeBlockHighlightResult | undefined) => value?.key === key && value.code === code
    && value.language === (language.trim().toLowerCase() || 'text') && codeBlockHighlightBindingMatches(value, options);
  const providedMatches = matches(provided);
  const [result, setResult] = React.useState<CodeBlockHighlightResult | undefined>(providedMatches ? provided : undefined);
  const onErrorRef = React.useRef(onHighlightError); onErrorRef.current = onHighlightError;
  const contextRef = React.useRef(context); contextRef.current = context;
  const client = ownClient ?? context?.highlightOnClient ?? true;
  React.useEffect(() => {
    if (!client || providedMatches) return;
    let disposed = false;
    void highlightCodeBlock(code, language, options).then(next => { if (!disposed) setResult(next); })
      .catch(error => {
        if (disposed) return;
        onErrorRef.current?.(error);
        const current = contextRef.current;
        if (current) current.onHighlightError?.(error, current.file);
        emitFrontendCode(OBS_CODES.FRONTEND_CODE_HIGHLIGHT_FAILED, { error, metadata: {
          filename: current?.file.filename, language,
        } });
      });
    return () => { disposed = true; };
  }, [code, language, options, key, liveIdentity, client, providedMatches]);
  const metadata = readCodeBlockMetadata(options, 0);
  const resultMatches = matches(result);
  const html = providedMatches && provided ? provided.html
    : resultMatches && result ? result.html : buildFallbackCodeBlockHtml(code, options);
  return <div className={cn('zero-code-block-highlight', className)} data-word-wrap={metadata.wordWrap ? 'true' : 'false'}
    data-line-numbers={metadata.lineNumbers ? 'true' : 'false'} {...props} dangerouslySetInnerHTML={{ __html: html }} />;
}

function defined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;
}
