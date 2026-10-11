/** Source-format facade contracts. Persistence remains application-owned; supplied .env text is never evaluated or loaded. */
import type { JsonDocumentEditorHandle, JsonDocumentEditorProps, JsonDocumentValue } from './json-document.types';

export type DocumentFormat = 'json' | 'yaml' | 'toml' | 'env';
export interface DocumentSourceChange { readonly format: DocumentFormat; readonly text: string; readonly value: JsonDocumentValue }
export type DocumentParseResult = { readonly ok: true; readonly value: JsonDocumentValue }
  | { readonly ok: false; readonly message: string; readonly offset: number; readonly line: number; readonly column: number; readonly length: number };
export type DocumentEditorHandle = JsonDocumentEditorHandle;
/** Supply a value, a source file, or both (which must agree). Source includes comments and is authoritative for file saves. */
export interface DocumentEditorProps extends Omit<JsonDocumentEditorProps, 'value' | 'onChange'> {
  readonly value?: JsonDocumentValue;
  readonly onChange?: (value: JsonDocumentValue) => void;
}
