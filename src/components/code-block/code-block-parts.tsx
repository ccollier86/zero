'use client';
/** Composable pheralb-style block surfaces, using Zero's tokens and icon primitive. */
import * as React from 'react';
import { ZeroIcon, type ZeroIconProps } from '../animate-ui/icons/zero-icon';
import { cn } from '../../lib/utils';
import { useCodeBlockContext } from './code-block-context';

export interface CodeBlockRootProps extends React.ComponentProps<'div'> {
  showLineNumbers?: boolean;
  wordWrap?: boolean;
}

/** Unopinionated shell for custom headers/content, or use CodeBlock for ready-made UI. */
export function CodeBlockRoot({ className, showLineNumbers, wordWrap, ...props }: CodeBlockRootProps) {
  return <div data-zero-surface="public" data-line-numbers={showLineNumbers ? 'true' : 'false'}
    data-word-wrap={wordWrap ? 'true' : 'false'} className={cn('zero-code-block', className)} {...props} />;
}
export type CodeBlockHeaderProps = React.ComponentProps<'div'>;
export function CodeBlockHeader({ className, ...props }: CodeBlockHeaderProps) {
  return <div className={cn('zero-code-block-header', className)} {...props} />;
}
export type CodeBlockGroupProps = React.ComponentProps<'div'>;
export function CodeBlockGroup({ className, ...props }: CodeBlockGroupProps) {
  return <div className={cn('zero-code-block-group', className)} {...props} />;
}
export type CodeBlockTitleProps = React.ComponentProps<'span'>;
export function CodeBlockTitle({ children, className, ...props }: CodeBlockTitleProps) {
  const context = useCodeBlockContext();
  return <span className={cn('zero-code-block-title', className)} {...props}>
    {children ?? context?.file.label ?? context?.file.filename ?? context?.file.language}
  </span>;
}
export interface CodeBlockIconProps extends Omit<React.ComponentProps<'span'>, 'children'> {
  language?: string;
  icon?: React.ReactNode;
  iconName?: ZeroIconProps['name'];
}
export function CodeBlockIcon({ className, language, icon, iconName = 'terminal', ...props }: CodeBlockIconProps) {
  const context = useCodeBlockContext();
  return <span aria-hidden="true" data-language={language ?? context?.file.language}
    className={cn('zero-code-block-icon', className)} {...props}>
    {icon ?? <ZeroIcon name={iconName} />}
  </span>;
}
export interface CodeBlockContentProps extends React.ComponentProps<'div'> { minLines?: number; }
/** A bounded scroll viewport; its surrounding toolbar does not scroll away. */
export function CodeBlockContent({ className, minLines, style, ...props }: CodeBlockContentProps) {
  const normalized = minLines && Number.isFinite(minLines) ? Math.max(1, Math.floor(minLines)) : undefined;
  return <div className={cn('zero-code-block-viewport', className)} style={{
    ...(normalized ? { minHeight: `calc(var(--zero-code-font-size) * var(--zero-code-line-height) * ${normalized} + var(--zero-code-padding-block) * 2)` } : {}),
    ...style,
  }} {...props} />;
}
