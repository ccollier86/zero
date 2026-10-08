/** Public local-draft contracts; committing an editor is not a server save. */
import type * as React from 'react';

export type JsonEditorCommitResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

export interface JsonEditorHandle<T = unknown> {
  /** Validate/apply an open local edit and return the complete document. No external writes. */
  commit(): JsonEditorCommitResult<T>;
  startTextEdit(): void;
  /** Explicitly discard an open local edit, including its retained raw text. */
  cancel(): void;
}

export interface JsonEditorProps<T = unknown> {
  readonly value: T;
  readonly onChange: (value: T) => void;
  /** Validate/normalize the complete local document on explicit commit. Draft changes may be incomplete. */
  readonly validate?: (value: unknown) => T;
  readonly disabled?: boolean;
  readonly label?: string;
  readonly rootName?: string;
  readonly collapse?: boolean | number;
  readonly className?: string;
  /** Self owns a bounded viewport; parent uses its enclosing scroll region. */
  readonly scrollMode?: 'self' | 'parent';
  /** Compact text drafts suit anchored value editing; full documents retain the default roomy editor. */
  readonly density?: 'default' | 'compact';
  /** Optional parent-owned unfinished JSON buffer, separate from the last admitted object. */
  readonly rawTextDraft?: string | null;
  readonly onRawTextDraftChange?: (value: string | null) => void;
  readonly onEditingChange?: (editing: boolean) => void;
  readonly editorRef?: React.Ref<JsonEditorHandle<T>>;
}
