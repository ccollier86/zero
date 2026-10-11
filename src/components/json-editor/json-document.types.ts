/** JSON-specific document contracts. Local admission and patch generation never perform transport or establish server authority. */
import type * as React from 'react';
import type { JsonEditorCommitResult } from './json-editor.types';
import type { DocumentFormat, DocumentSourceChange } from './document.types';

export type JsonDocumentValue = null | boolean | number | string | readonly JsonDocumentValue[] | { readonly [key: string]: JsonDocumentValue };
export type JsonDocumentPath = readonly (string | number)[];
export type JsonDocumentMode = 'tree' | 'code';
export type JsonDocumentPatch =
  | { readonly op: 'add' | 'replace'; readonly path: string; readonly value: JsonDocumentValue }
  | { readonly op: 'remove'; readonly path: string }
  | { readonly op: 'move'; readonly path: string; readonly from: string };
export interface JsonDocumentEdit {
  readonly kind: 'replace' | 'rename' | 'add' | 'remove' | 'code';
  readonly path: JsonDocumentPath;
  readonly previous: JsonDocumentValue;
  readonly next: JsonDocumentValue;
}
export interface JsonDocumentSaveContext { readonly signal: AbortSignal; readonly format: DocumentFormat; readonly text: string }
export interface JsonDocumentEditorHandle {
  /** Finish the active draft and validate the whole document. Does not acknowledge persistence. */
  commit(): JsonEditorCommitResult<JsonDocumentValue>;
  cancel(): void;
  startTextEdit(): void;
  setMode(mode: JsonDocumentMode): void;
  /** Convert the source representation without losing retained format-specific comments. Returns false on an incompatible conversion. */
  setFormat(format: DocumentFormat): boolean;
  undo(): void;
  redo(): void;
  expandAll(): void;
  collapseAll(): void;
  search(query: string): void;
  select(path: JsonDocumentPath): void;
  save(): Promise<boolean>;
  discard(): void;
  readonly patch: readonly JsonDocumentPatch[];
  readonly format: DocumentFormat;
  readonly text: string;
  readonly dirty: boolean;
  readonly valid: boolean;
}
/** Additive Tree/Code editor. Existing JsonEditor and Studio consumers retain their original contracts. */
export interface JsonDocumentEditorProps {
  readonly value: JsonDocumentValue;
  /** Supplied file text (never a path). Valid source must agree with value; malformed source remains repairable in Code. */
  readonly sourceText?: string;
  readonly format?: DocumentFormat;
  /** Observe valid local source, including comment-only edits and conversions. Not a persistence acknowledgement. */
  readonly onSourceChange?: (source: DocumentSourceChange) => void;
  /** Synchronously retain the local document; not a save callback. */
  readonly onChange: (value: JsonDocumentValue) => void;
  /** Change this key with document/tenant identity to retire history, drafts and pending feedback. */
  readonly documentKey?: string;
  readonly label?: string;
  readonly rootName?: string;
  readonly disabled?: boolean;
  readonly defaultMode?: JsonDocumentMode;
  readonly defaultExpandDepth?: number;
  readonly pageSize?: number;
  readonly maxHeight?: number;
  readonly density?: 'default' | 'compact';
  readonly scrollMode?: 'self' | 'parent';
  readonly scrollTreatment?: 'arc' | 'native';
  readonly className?: string;
  readonly style?: React.CSSProperties;
  /** Complete-document synchronous validation/normalization at commit and before save. */
  readonly validate?: (value: unknown) => JsonDocumentValue;
  /** Optional preflight on every structural/value/code edit, including additions/removals/renames. */
  readonly validateEdit?: (edit: JsonDocumentEdit) => string | null | undefined;
  /** Resolve only after the application's writer accepts this exact snapshot. No callback means no Save action. */
  readonly onSave?: (value: JsonDocumentValue, patch: readonly JsonDocumentPatch[], context: JsonDocumentSaveContext) => Promise<void>;
  readonly rawTextDraft?: string | null;
  readonly onRawTextDraftChange?: (text: string | null) => void;
  readonly onEditingChange?: (editing: boolean) => void;
  readonly editorRef?: React.Ref<JsonDocumentEditorHandle>;
}
