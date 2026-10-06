/** Serializable public-only documentation content, shared by every reader projection. */
export type DocsNodeType = 'root' | 'text' | 'paragraph' | 'heading' | 'emphasis' | 'strong' | 'delete'
  | 'inlineCode' | 'code' | 'link' | 'image' | 'blockquote' | 'list' | 'listItem' | 'thematicBreak' | 'break'
  | 'table' | 'tableRow' | 'tableCell' | 'callout' | 'footnoteDefinition' | 'footnoteReference';
export interface DocsCodeOptions {
  readonly language?: string;
  readonly meta?: string;
  readonly title?: string;
  readonly lineNumbers?: boolean;
  readonly startLine?: number;
  readonly highlightLines?: readonly number[];
}
/** An allowlisted AST: HTML is text, links are admitted URLs, and code is never executable. */
export interface DocsNode {
  readonly type: DocsNodeType;
  readonly children?: readonly DocsNode[];
  readonly value?: string;
  readonly depth?: number;
  readonly id?: string;
  readonly url?: string;
  readonly title?: string;
  readonly alt?: string;
  readonly ordered?: boolean;
  readonly start?: number;
  readonly checked?: boolean | null;
  readonly align?: readonly ('left' | 'right' | 'center' | null)[];
  readonly tone?: 'note' | 'tip' | 'warning' | 'danger';
  readonly identifier?: string;
  /** Stable within this immutable page snapshot; points to a visible search passage. */
  readonly searchId?: string;
  readonly code?: DocsCodeOptions;
}
export interface DocsHeading { readonly id: string; readonly text: string; readonly depth: number }
/** Public text and section context extracted from one renderable, admitted AST block. */
export interface DocsPassage {
  readonly id: string;
  readonly text: string;
  readonly headingId?: string;
  readonly sectionPath: readonly string[];
}
export interface DocsPage {
  readonly sourcePath: string | null;
  readonly route: string;
  readonly title: string;
  readonly titleHeadingId?: string;
  readonly description: string;
  readonly semanticId?: string;
  readonly navigation: { readonly label: string; readonly order?: number; readonly hidden: boolean };
  readonly searchable: boolean;
  readonly headings: readonly DocsHeading[];
  readonly body: DocsNode;
  readonly markdown: string;
  readonly text: string;
  /** Compiler-owned; older hand-authored snapshots may omit this additive projection. */
  readonly passages?: readonly DocsPassage[];
  readonly hash: string;
  readonly assets: readonly string[];
  readonly generated: boolean;
  readonly metadata: Readonly<Record<string, unknown>>;
}
export interface DocsAsset {
  readonly id: string;
  readonly sourcePath: string;
  readonly route: string;
  readonly hash: string;
  readonly mime: string;
  readonly size: number;
}
export interface DocsNavigationEntry {
  readonly type: 'page' | 'group';
  readonly label: string;
  readonly route: string;
  readonly children?: readonly DocsNavigationEntry[];
}
export interface DocsManifest {
  readonly version: 1;
  readonly basePath: string;
  readonly hash: string;
  readonly pages: readonly DocsPage[];
  readonly assets: readonly DocsAsset[];
  readonly navigation: readonly DocsNavigationEntry[];
  readonly redirects: readonly { readonly from: string; readonly to: string }[];
}
export interface DocsCompilerLimits {
  readonly maxDocuments?: number;
  readonly maxDocumentBytes?: number;
  readonly maxFrontmatterBytes?: number;
  readonly maxAssetBytes?: number;
  readonly maxTotalBytes?: number;
}
export interface CompileDocsContentOptions {
  /** Already resolved against the immutable application configuration root. */
  readonly contentDir: string;
  readonly basePath?: string;
  readonly mode?: 'development' | 'production';
  readonly exclusions?: readonly string[];
  readonly include?: readonly string[];
  readonly ignoreFile?: string | false;
  readonly allowEmpty?: boolean;
  readonly limits?: DocsCompilerLimits;
  readonly emit?: (event: DocsCompilerEvent) => void;
}
export interface DocsCompilerEvent {
  readonly code: 'DOCS_CONTENT_COMPILED' | 'DOCS_CONTENT_FAILED';
  readonly metadata: { readonly pages: number; readonly assets: number; readonly diagnostics: number };
}
export interface DocsDiagnostic {
  readonly code: DocsContentErrorCode;
  readonly sourcePath?: string;
  readonly line?: number;
  readonly column?: number;
  readonly field?: string;
  readonly message: string;
}
export type DocsContentErrorCode = 'DOCS_CONFIG_INVALID' | 'DOCS_SOURCE_INVALID' | 'DOCS_METADATA_INVALID'
  | 'DOCS_MARKDOWN_INVALID' | 'DOCS_ROUTE_CONFLICT' | 'DOCS_LINK_INVALID' | 'DOCS_ASSET_INVALID'
  | 'DOCS_IGNORE_INVALID' | 'DOCS_LIMIT_EXCEEDED' | 'DOCS_COLLECTION_EMPTY';
