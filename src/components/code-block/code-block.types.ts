'use client';

/**
 * code-block.types.ts
 *
 * Defines the public CodeBlock component contracts. This file owns type shapes
 * only; syntax highlighting, clipboard behavior, and rendering live in sibling
 * modules.
 */

import type * as React from 'react';
import type { ShikiTransformer } from 'shiki';

/** Presentation and trusted highlighter options shared by browser and server. */
export interface CodeBlockHighlightOptions {
  theme?: CodeBlockTheme;
  /** Fence metadata: title/filename, prefix, lineNumbers/showLineNumbers, wrap, {1,3-5}, /word/. */
  meta?: string;
  highlightLines?: readonly number[];
  /** Additional literal words, deduplicated with fence words; never executable regexes. */
  highlightWords?: readonly string[];
  /** Enable Shiki's [!code highlight], [!code ++/--], and [!code focus] markers. */
  annotations?: boolean;
  /** A document-unique prefix for real keyboard-accessible line links. */
  lineAnchors?: string;
  showLineNumbers?: boolean;
  startLine?: number;
  wordWrap?: boolean;
  /** Trusted code only: additional transformers may change generated HTML. */
  transformers?: readonly ShikiTransformer[];
  /** Stable versioned custom-transformer configuration identity for portable prepared HTML. Update when behavior changes. */
  transformerIdentity?: string;
}

/** Output from Zero's highlighter; pass only trusted framework-generated results. */
export interface CodeBlockHighlightResult {
  code: string;
  language: string;
  html: string;
  /** Non-security fingerprint rejects stale pre-highlighted content. */
  key: string;
  /** Explicit publisher identity for prepared custom-transformer HTML serialized across runtimes. */
  transformerIdentity?: string;
}

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
  meta?: string;
  highlighted?: CodeBlockHighlightResult;
}

/** Theme names passed to Shiki. */
export interface CodeBlockTheme {
  /** Theme used by light mode. */
  light: string;
  /** Theme used by dark mode. */
  dark: string;
}

export interface CodeBlockProps extends Omit<React.ComponentProps<'div'>, 'onCopy'>, CodeBlockHighlightOptions {
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
  /** Server-generated highlight output for this source and these options. */
  highlighted?: CodeBlockHighlightResult;
  /** false keeps escaped source without loading Shiki in the browser. */
  highlightOnClient?: boolean;
  /** Optional tools beside the copy action. */
  actions?: React.ReactNode;
  /** Hide the header for compact snippets. */
  header?: boolean;
  copyVariant?: 'icon' | 'text' | 'morph';
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

export interface CodeBlockCodeProps extends Omit<React.ComponentProps<'div'>, 'children'>, CodeBlockHighlightOptions {
  code?: string;
  language?: string;
  highlighted?: CodeBlockHighlightResult;
  highlightOnClient?: boolean;
  onHighlightError?: (error: unknown) => void;
}

export interface CodeBlockCopyButtonProps extends Omit<React.ComponentProps<'button'>, 'onCopy'> {
  content?: string;
  variant?: 'icon' | 'text' | 'morph';
  size?: 'xs' | 'sm';
  iconSize?: number;
  resetAfterMs?: number;
  copyLabel?: string;
  copiedLabel?: string;
  onCopy?: (content: string) => void;
  onCopyError?: (error: Error) => void;
}

export type CodeBlockPackageManagerName = 'bun' | 'npm' | 'pnpm' | 'yarn';
export interface CodeBlockPackageManagerOptions {
  value?: CodeBlockPackageManagerName;
  defaultValue?: CodeBlockPackageManagerName;
  onValueChange?: (value: CodeBlockPackageManagerName) => void;
  /** Opt-in shared browser preference; false never accesses local storage. */
  persist?: boolean | string;
}
export interface CodeBlockPackageManagerProps extends Omit<CodeBlockProps, 'code' | 'files' | 'language' | 'onFileChange' | 'defaultValue'>, CodeBlockPackageManagerOptions {
  command: string;
  type?: 'install' | 'dlx' | 'run';
  mode?: 'tabs' | 'select';
  managers?: readonly CodeBlockPackageManagerName[];
}
