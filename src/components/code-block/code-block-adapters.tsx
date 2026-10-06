'use client';
/** Compact/server/Markdown adapters reuse the same block instead of separate UI engines. */
import * as React from 'react';
import { CodeBlock } from './code-block';
import { CodeBlockCopyButton } from './code-block-copy';
import { CodeBlockContent, CodeBlockHeader, CodeBlockTitle } from './code-block-parts';
import { readCodeBlockMetadata, normalizeStartLine } from './code-block-metadata';
import type { CodeBlockProps } from './code-block.types';

/** Copyable headerless command/snippet, matching the upstream inline-block composition. */
export function CodeBlockInline({ className, showLineNumbers = false, ...props }: CodeBlockProps) {
  return <CodeBlock header={false} showLineNumbers={showLineNumbers} {...props}
    className={['zero-code-block-inline', className].filter(Boolean).join(' ')} />;
}

/** Animated copy label block, built on Zero's morphing text and awaited clipboard helper. */
export function CodeBlockCopyText(props: React.ComponentProps<typeof CodeBlockCopyButton>) {
  return <CodeBlockCopyButton variant="morph" {...props} />;
}

export interface CodeBlockMarkdownProps extends CodeBlockProps { code: string; }
/** Render a compiled Markdown fence; this adapter never parses/evaluates MDX or HTML. */
export function CodeBlockMarkdown({ meta, filename, ...props }: CodeBlockMarkdownProps) {
  const metadata = readCodeBlockMetadata({ meta }, 0);
  return <CodeBlock showLineNumbers={metadata.lineNumbers} {...props} language={props.language ?? 'text'}
    meta={meta} filename={filename ?? metadata.title ?? props.language ?? 'Code'} />;
}

export interface CodeBlockPreProps extends React.ComponentProps<'pre'> {
  'data-language'?: string;
  'data-title'?: string;
  copyButton?: boolean;
  wrapperClassName?: string;
  showLineNumbers?: boolean;
  startLine?: number;
  wordWrap?: boolean;
}
/** Adapter for trusted React/rehype pre trees, without a dependency on an MDX runtime. */
export function CodeBlockPre({ children, className, wrapperClassName, copyButton = true, showLineNumbers, startLine = 1, wordWrap,
  'data-language': language, 'data-title': title, ...props }: CodeBlockPreProps) {
  const source = reactCodeText(children);
  const numberedChildren = numberCodeLines(children, { current: normalizeStartLine(startLine) });
  return <CodeBlock code={source} language={language ?? 'text'} filename={title ?? language ?? 'Code'}
    copyButton={copyButton} className={wrapperClassName}
    showLineNumbers={showLineNumbers ?? Boolean(className?.includes('shiki-line-numbers'))}
    wordWrap={wordWrap ?? Boolean(className?.includes('shiki-word-wrap'))}>
    <CodeBlockHeader><CodeBlockTitle>{title ?? language ?? 'Code'}</CodeBlockTitle>
      {copyButton ? <CodeBlockCopyButton /> : null}</CodeBlockHeader>
    <CodeBlockContent><div className="zero-code-block-highlight">
      <pre className={['shiki', className].filter(Boolean).join(' ')} data-language={language} data-title={title} {...props}>{numberedChildren}</pre>
    </div></CodeBlockContent>
  </CodeBlock>;
}

function numberCodeLines(node: React.ReactNode, counter: { current: number }): React.ReactNode {
  if (Array.isArray(node)) return React.Children.map(node, child => numberCodeLines(child, counter));
  if (!React.isValidElement<{ className?: string; children?: React.ReactNode; 'data-line-number'?: number }>(node)) return node;
  const number = node.props.className?.split(' ').includes('line') ? counter.current++ : undefined;
  return React.cloneElement(node, { ...(number ? { 'data-line-number': node.props['data-line-number'] ?? number } : {}),
    children: numberCodeLines(node.props.children, counter) });
}

/** Extract source from a trusted pre tree, excluding decorative gutter/anchor nodes. */
function reactCodeText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) {
    const lineNodes = node.filter(item => React.isValidElement<{ className?: string }>(item) && item.props.className?.split(' ').includes('line'));
    if (lineNodes.length && node.every(item => lineNodes.includes(item) || typeof item === 'string' && !item.trim())) return lineNodes.map(reactCodeText).join('\n');
    return node.map(reactCodeText).join('');
  }
  if (!React.isValidElement<{ children?: React.ReactNode; className?: string; 'aria-hidden'?: boolean | 'true' }>(node)) return '';
  if (node.props['aria-hidden'] === true || node.props['aria-hidden'] === 'true' || node.props.className?.includes('zero-code-line-anchor')) return '';
  return reactCodeText(node.props.children);
}
