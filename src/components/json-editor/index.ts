/** Stable public facade for Zero's packaged JSON editor and local-draft handle. */
export { JsonEditor } from './json-editor';
export type { JsonEditorProps, JsonEditorHandle, JsonEditorCommitResult } from './json-editor.types';
export { JsonDocumentEditor, DocumentEditor } from './json-document-editor';
export type { JsonDocumentEditorProps, JsonDocumentEditorHandle, JsonDocumentValue, JsonDocumentPath, JsonDocumentMode,
  JsonDocumentPatch, JsonDocumentEdit, JsonDocumentSaveContext } from './json-document.types';
export { parseJsonDocument } from './json-document-source';
export type { JsonDocumentParseResult } from './json-document-source';
export { diffJsonDocument } from './json-document-model';
export { parseDocumentSource } from './document-source';
export type { DocumentEditorProps, DocumentEditorHandle, DocumentFormat, DocumentSourceChange, DocumentParseResult } from './document.types';
