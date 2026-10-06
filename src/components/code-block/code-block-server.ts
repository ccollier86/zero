/** Pure Bun/server preparation for synchronous React SSR and no-JavaScript readers. */
import { highlightCodeBlock, buildFallbackCodeBlockHtml } from './code-block-highlight';
import { codeBlockHighlightKey } from './code-block-metadata';
import { bindCodeBlockHighlightResult, snapshotCodeBlockHighlightOptions } from './code-block-highlight-identity';
import type { CodeBlockProps, CodeBlockFile, CodeBlockHighlightOptions, CodeBlockHighlightResult } from './code-block.types';
export type { CodeBlockProps, CodeBlockFile, CodeBlockHighlightOptions, CodeBlockHighlightResult } from './code-block.types';

export interface PrepareCodeBlockOptions {
  /** Opt-in for publishers that retain readable code when a language is unsupported. */
  fallbackOnError?: boolean;
  /** App-owned build/server logging boundary; no browser or global console calls. */
  onHighlightError?: (error: unknown, file: CodeBlockFile) => void | Promise<void>;
}

/** Pre-highlight all files once; the resulting ordinary props render synchronously in SSR. */
export async function prepareCodeBlock(props: CodeBlockProps, preparation: PrepareCodeBlockOptions = {}): Promise<CodeBlockProps> {
  const { theme, meta, highlightLines, highlightWords, annotations, lineAnchors,
    showLineNumbers = true, startLine, wordWrap, transformers, transformerIdentity } = props;
  const options = snapshotCodeBlockHighlightOptions({ theme, meta, highlightLines, highlightWords, annotations, lineAnchors, showLineNumbers, startLine, wordWrap, transformers, transformerIdentity });
  if (props.files?.length) return { ...props, files: await Promise.all(props.files.map(async original => {
    const file = Object.freeze({ ...original });
    return { ...file, highlighted: await prepareFile(file, { ...options, meta: file.meta ?? meta }, preparation) };
  })) };
  const file = { id: 'main', code: props.code ?? '', language: props.language ?? 'tsx', filename: props.filename };
  return { ...props, highlighted: await prepareFile(file, options, preparation) };
}

async function prepareFile(file: CodeBlockFile, options: CodeBlockHighlightOptions,
  preparation: PrepareCodeBlockOptions): Promise<CodeBlockHighlightResult> {
  try { return await highlightCodeBlock(file.code, file.language, options); }
  catch (error) {
    await preparation.onHighlightError?.(error, file);
    if (!preparation.fallbackOnError) throw error;
    return bindCodeBlockHighlightResult({ code: file.code, language: file.language.trim().toLowerCase() || 'text',
      html: buildFallbackCodeBlockHtml(file.code, options), key: codeBlockHighlightKey(file.code, file.language, options) }, options);
  }
}
