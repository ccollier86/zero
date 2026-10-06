'use client';
/** Controlled/uncontrolled file state and accessible Zero file-tab composition. */
import * as React from 'react';
import { Tabs } from 'radix-ui';
import { cn } from '../../lib/utils';
import { CodeBlockIcon } from './code-block-parts';
import { useCodeBlockContext } from './code-block-context';
import type { CodeBlockFile, CodeBlockProps } from './code-block.types';
import { readCodeBlockMetadata } from './code-block-metadata';

export function normalizeCodeBlockFiles(props: Pick<CodeBlockProps, 'files' | 'code' | 'language' | 'filename' | 'meta' | 'highlighted'>): readonly CodeBlockFile[] {
  if (props.files?.length) return props.files.map((file, index) => ({ ...file,
    filename: file.filename ?? readCodeBlockMetadata({ meta: file.meta ?? props.meta }, 0).title,
    id: file.id || `file-${index + 1}`, language: file.language || 'text', code: file.code ?? '',
  }));
  return [{ id: 'main', filename: props.filename ?? readCodeBlockMetadata({ meta: props.meta }, 0).title ?? 'example.ts', language: props.language ?? 'tsx',
    code: props.code ?? '', meta: props.meta, highlighted: props.highlighted }];
}

/** File tabs use Radix's established arrows/Home/End/RTL and roving focus behavior. */
export function CodeBlockFiles({ className, ...props }: React.ComponentProps<'div'>) {
  const context = useCodeBlockContext();
  if (!context) return null;
  if (context.files.length === 1) return <div className={cn('zero-code-block-group', className)} {...props}>
    <CodeBlockIcon /><span className="zero-code-block-title">{context.file.label ?? context.file.filename ?? context.file.language}</span>
  </div>;
  return <Tabs.List aria-label="Code files" className={cn('zero-code-block-files', className)} {...props}>
    {context.files.map(file => <Tabs.Trigger key={file.id} value={file.id} id={context.tabId(file.id)}
      aria-controls={context.panelId} className="zero-code-block-file-tab">
      <CodeBlockIcon language={file.language} /><span>{file.label ?? file.filename ?? file.language}</span>
    </Tabs.Trigger>)}
  </Tabs.List>;
}
