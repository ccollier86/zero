'use client';

/**
 * code-block.types.ts
 *
 * Defines the public CodeBlock component contracts. This file owns type shapes
 * only; syntax highlighting, clipboard behavior, and rendering live in sibling
 * modules.
 */

import type * as React from 'react';

/** One file/tab rendered by the public CodeBlock component. */
export interface CodeBlockFile {
  /** Stable id used for tab state and callbacks. */
  id: string;
  /** Display label shown in the header tab. Defaults to `filename`. */
  label?: React.ReactNode;
  /** Optional file name shown in the header. */
  filename?: string;
  /** Shiki language id. Use `text` for unhighlighted plain text. */
  language: string;
  /** Source code rendered in the block and copied by the copy action. */
  code: string;
}

/** Theme names passed to Shiki. */
export interface CodeBlockTheme {
  /** Theme used by light mode. */
  light: string;
  /** Theme used by dark mode. */
  dark: string;
}

export interface CodeBlockProps extends Omit<React.ComponentProps<'div'>, 'onCopy'> {
  /** Multi-file tab configuration. Takes precedence over `code`. */
  files?: readonly CodeBlockFile[];
  /** Source code for a single-file block. */
  code?: string;
  /** Language for a single-file block. */
  language?: string;
  /** File name for a single-file block. */
  filename?: string;
  /** Initial active file id when `files` contains multiple entries. */
  defaultFileId?: string;
  /** Controlled active file id for custom tab orchestration. */
  activeFileId?: string;
  /** Render line numbers beside code lines. */
  showLineNumbers?: boolean;
  /** Render the copy action in the header. */
  copyButton?: boolean;
  /** Minimum number of code rows reserved by the viewport for stable tab height. */
  minLines?: number;
  /** Shiki light/dark theme pair. */
  theme?: CodeBlockTheme;
  /** Called after the active file changes. */
  onFileChange?: (file: CodeBlockFile) => void;
  /** Called when copying succeeds. */
  onCopy?: (file: CodeBlockFile) => void;
  /** Called when Shiki cannot highlight and the block falls back to plain text. */
  onHighlightError?: (error: unknown, file: CodeBlockFile) => void;
  /** Header class override. */
  headerClassName?: string;
  /** Code viewport class override. */
  viewportClassName?: string;
  /** Optional key for the code content wrapper, useful for caller-owned transitions. */
  contentKey?: React.Key;
  /** Code content class override. */
  contentClassName?: string;
}
