'use client';

/** Owns one visual/code schema draft; invalid buffers never become admitted schemas. */
import { useCallback, useState } from 'react';
import type { DataStudioSchema } from '../../data-studio/data-studio-contracts';
import {
  buildDataStudioSchema, editableDataStudioColumn,
  type DataStudioEditableColumn,
} from './data-studio-schema-draft';
import { parseDataStudioSchemaCode, type DataStudioSchemaDraftError } from './data-studio-schema-code';

export type DataStudioSchemaEditorMode = 'visual' | 'json';

export function useDataStudioSchemaDraft(initial: readonly DataStudioEditableColumn[]) {
  const [columns, setColumns] = useState<DataStudioEditableColumn[]>(() => [...initial]);
  const [mode, setMode] = useState<DataStudioSchemaEditorMode>('visual');
  const [code, setCode] = useState('');
  const [jsonValue, setJsonValue] = useState<unknown>(null);
  const [rawTextDraft, setRawTextDraft] = useState<string | null>(null);
  const [jsonEditing, setJsonEditing] = useState(false);
  const [error, setError] = useState<DataStudioSchemaDraftError | null>(null);
  const [selectedId, selectColumn] = useState<string | null>(initial[0]?.columnId ?? null);
  const [persistedIds, setPersistedIds] = useState(() => new Set(initial.filter(column => column.persisted).map(column => column.columnId)));

  const reset = useCallback((next: readonly DataStudioEditableColumn[]) => {
    setColumns([...next]); setMode('visual'); setCode(''); setError(null);
    setJsonValue(null); setRawTextDraft(null); setJsonEditing(false);
    selectColumn(next[0]?.columnId ?? null);
    setPersistedIds(new Set(next.filter(column => column.persisted).map(column => column.columnId)));
  }, []);

  const readSchema = useCallback((candidate?: unknown): DataStudioSchema | null => {
    if (mode === 'json') {
      const result = parseDataStudioSchemaCode(candidate === undefined ? code : JSON.stringify(candidate));
      if (!result.ok) { setError(result.error); return null; }
      setError(null); return result.schema;
    }
    try { const schema = buildDataStudioSchema(columns); setError(null); return schema; }
    catch (cause) {
      setError({ path: '$.columns', message: cause instanceof Error ? cause.message : 'Review the field settings.' });
      return null;
    }
  }, [code, columns, mode]);

  const changeMode = useCallback((next: DataStudioSchemaEditorMode, candidate?: unknown) => {
    if (next === mode) return true;
    const schema = readSchema(candidate);
    if (!schema) return false;
    if (next === 'json') { setCode(JSON.stringify(schema, null, 2)); setJsonValue(schema); }
    else {
      const converted = schema.columns.map(column => editableDataStudioColumn(column, persistedIds.has(column.columnId)));
      setColumns(converted);
      if (!converted.some(column => column.columnId === selectedId)) selectColumn(converted[0]?.columnId ?? null);
    }
    setRawTextDraft(null); setJsonEditing(false); setMode(next); return true;
  }, [mode, persistedIds, readSchema, selectedId]);

  const changeCode = useCallback((text: string) => {
    setCode(text); setRawTextDraft(text);
    const result = parseDataStudioSchemaCode(text);
    setError(result.ok ? null : result.error);
  }, []);

  const changeJson = useCallback((value: unknown) => {
    setJsonValue(value); setCode(JSON.stringify(value, null, 2)); setRawTextDraft(null);
    const result = parseDataStudioSchemaCode(JSON.stringify(value));
    setError(result.ok ? null : result.error);
  }, []);
  const restoreJsonText = useCallback(() => {
    setRawTextDraft(null); setCode(JSON.stringify(jsonValue, null, 2));
    const result = parseDataStudioSchemaCode(JSON.stringify(jsonValue));
    setError(result.ok ? null : result.error);
  }, [jsonValue]);

  return { columns, setColumns, mode, changeMode, code, changeCode, jsonValue, changeJson,
    rawTextDraft, restoreJsonText, jsonEditing, setJsonEditing, error, readSchema, selectedId, selectColumn, reset };
}
