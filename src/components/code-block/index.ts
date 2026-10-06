/**
 * index.ts
 *
 * Public Zero export for CodeBlock. This barrel owns import stability only;
 * implementation and contracts live in sibling files.
 */

export { CodeBlock } from './code-block';
export { CodeBlockRoot, CodeBlockHeader, CodeBlockGroup, CodeBlockTitle, CodeBlockIcon, CodeBlockContent } from './code-block-parts';
export type { CodeBlockRootProps, CodeBlockHeaderProps, CodeBlockGroupProps, CodeBlockTitleProps, CodeBlockIconProps, CodeBlockContentProps } from './code-block-parts';
export { CodeBlockCode, CodeBlockCode as CodeBlockClient } from './code-block-code';
export { CodeBlockFiles } from './code-block-files';
export { CodeBlockCopyButton } from './code-block-copy';
export { CodeBlockInline, CodeBlockCopyText, CodeBlockMarkdown, CodeBlockPre } from './code-block-adapters';
export type { CodeBlockMarkdownProps, CodeBlockPreProps } from './code-block-adapters';
export { CodeBlockPackageManager, CodeBlockPackageManagerSelector, getCodeBlockPackageCommand } from './code-block-package-manager';
export type { CodeBlockPackageManagerSelectorProps } from './code-block-package-manager';
export { useCodeBlockPackageManager, CODE_BLOCK_PACKAGE_MANAGERS } from './code-block-package-preference';
export { highlightCodeBlock, highlightCodeBlockHtml, buildFallbackCodeBlockHtml } from './code-block-highlight';
export { prepareCodeBlock } from './code-block-server';
export type { PrepareCodeBlockOptions } from './code-block-server';
export { readCodeBlockMetadata, parseCodeBlockLineRanges } from './code-block-metadata';
export type { CodeBlockMetadata } from './code-block-metadata';
export type { CodeBlockFile, CodeBlockProps, CodeBlockTheme, CodeBlockHighlightOptions, CodeBlockHighlightResult,
  CodeBlockCodeProps, CodeBlockCopyButtonProps, CodeBlockPackageManagerName,
  CodeBlockPackageManagerProps, CodeBlockPackageManagerOptions } from './code-block.types';
