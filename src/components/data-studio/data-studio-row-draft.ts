/**
 * data-studio-row-draft.ts
 *
 * Owns immutable create-record drafts keyed by stable column IDs and bounded
 * domain validation. It does not submit requests, resolve authority or render
 * controls; untouched defaults remain omitted from the application payload.
 */
import type { DataStudioColumn, DataStudioSchema, DataStudioTable, DataStudioValue } from '../../frontend/client/data-studio-client';
import { normalizeDataStudioSchema, normalizeDataStudioValueForColumn } from '../../data-studio/data-studio-codec';
import { DataStudioError } from '../../data-studio/data-studio-error';
import { DATA_STUDIO_MAX_ROW_VALUES_BYTES, DATA_STUDIO_MAX_VALUE_BYTES } from '../../data-studio/data-studio-contracts';
import { dataStudioValueDraft } from './data-studio-value';
import { parseDataStudioTemporalDraft } from './data-studio-temporal-value';

/** A field retains raw input until submit; touched distinguishes omission from an explicit value. */
export interface DataStudioRowDraftField { readonly raw: string; readonly touched: boolean }
export type DataStudioRowDraft = Readonly<Record<string, DataStudioRowDraftField>>;

/** Opening schema is detached so a background cache update cannot rewrite the form. */
export interface DataStudioRowOpening {
  readonly tableId: string;
  readonly schemaRevision: number;
  readonly schema: DataStudioSchema;
  readonly schemaKey: string;
  readonly initial: DataStudioRowDraft;
}

/** Capture one table/schema lifetime and its visible server defaults. */
export function createDataStudioRowOpening(table: DataStudioTable): DataStudioRowOpening {
  const schema = normalizeDataStudioSchema(table.schema);
  const fields: Record<string, DataStudioRowDraftField> = Object.create(null);
  for (const column of schema.columns) {
    const raw = Object.hasOwn(column, 'defaultValue')
      ? column.type === 'boolean' ? String(column.defaultValue) : dataStudioValueDraft(column.defaultValue, column)
      : '';
    fields[column.columnId] = Object.freeze({ raw, touched: false });
  }
  return Object.freeze({ tableId: table.tableId, schemaRevision: table.schemaRevision, schema,
    schemaKey: dataStudioRowSchemaKey(table), initial: Object.freeze(fields) });
}

/** Metadata/row-count changes do not invalidate the form; any schema change does. */
export function dataStudioRowSchemaKey(table: DataStudioTable): string {
  return JSON.stringify([table.schemaRevision, table.schema]);
}

/** Apply one immediate field edit without losing another edit from the same React batch. */
export function updateDataStudioRowDraft(draft: DataStudioRowDraft, columnId: string, raw: string): DataStudioRowDraft {
  if (!Object.hasOwn(draft, columnId)) throw new TypeError('Cannot edit an unknown Data Studio field.');
  return Object.freeze(Object.assign(Object.create(null), draft, { [columnId]: Object.freeze({ raw, touched: true }) }));
}

/** Whether closing would lose an explicit value rather than merely a displayed default. */
export function isDataStudioRowDraftDirty(opening: DataStudioRowOpening, draft: DataStudioRowDraft): boolean {
  return opening.schema.columns.some(column => draft[column.columnId].raw !== opening.initial[column.columnId].raw
    || draft[column.columnId].touched && !Object.hasOwn(column, 'defaultValue'));
}

export interface DataStudioRowDraftResult {
  readonly values: Readonly<Record<string, DataStudioValue>> | null;
  readonly errors: Readonly<Record<string, string>>;
  readonly error: string | null;
}

/** Validate every touched field, keeping required/default omission and explicit false/null distinct. */
export function buildDataStudioRowDraft(opening: DataStudioRowOpening, draft: DataStudioRowDraft): DataStudioRowDraftResult {
  const values: Record<string, DataStudioValue> = Object.create(null);
  const errors: Record<string, string> = Object.create(null);
  for (const column of opening.schema.columns) {
    const entry = draft[column.columnId];
    if (!entry.touched) {
      if (column.required && !Object.hasOwn(column, 'defaultValue')) errors[column.columnId] = requiredMessage(column);
      continue;
    }
    try { values[column.key] = normalizeDataStudioValueForColumn(column, parseField(entry.raw, column)); }
    catch (cause) { errors[column.columnId] = fieldError(column, cause); }
  }
  if (Object.keys(errors).length) return { values: null, errors: Object.freeze(errors), error: 'Review the highlighted fields.' };
  if (new TextEncoder().encode(JSON.stringify(values)).byteLength > DATA_STUDIO_MAX_ROW_VALUES_BYTES) {
    return { values: null, errors: Object.freeze(errors), error: 'This record is too large. Shorten its text or JSON values.' };
  }
  return { values: Object.freeze(values), errors: Object.freeze(errors), error: null };
}

function parseField(raw: string, column: DataStudioColumn): unknown {
  if (new TextEncoder().encode(raw).byteLength > DATA_STUDIO_MAX_VALUE_BYTES) {
    throw new DataStudioError('DATA_STUDIO_LIMIT_EXCEEDED', 'Field input exceeds its byte limit.');
  }
  if (column.type === 'text') return raw;
  if (raw.trim() === '') return null;
  if (column.type === 'boolean') {
    if (raw === 'null') return null;
    if (raw !== 'true' && raw !== 'false') throw new TypeError('Invalid boolean draft.');
    return raw === 'true';
  }
  if (column.type === 'number') {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(raw.trim())) throw new TypeError('Invalid number draft.');
    return Number(raw);
  }
  if (column.type === 'date' || column.type === 'datetime') return parseDataStudioTemporalDraft(raw, column.type);
  return JSON.parse(raw);
}

function requiredMessage(column: DataStudioColumn): string {
  return column.type === 'boolean' ? 'Choose True or False.' : column.type === 'date' ? 'Choose a date.'
    : column.type === 'datetime' ? 'Choose a date and time.' : 'Provide a value for this required field.';
}

function fieldError(column: DataStudioColumn, cause: unknown): string {
  if (cause instanceof DataStudioError && cause.code === 'DATA_STUDIO_LIMIT_EXCEEDED') return 'This value exceeds the supported size or nesting limits.';
  if (column.type === 'number') return 'Enter a finite number, such as 12.5.';
  if (column.type === 'boolean') return requiredMessage(column);
  if (column.type === 'date') return 'Choose a valid calendar date.';
  if (column.type === 'datetime') return 'Choose a valid date and time.';
  if (column.type === 'json') {
    if (cause instanceof SyntaxError) return 'Enter valid JSON.';
    return column.required ? 'Use an ordinary JSON value other than null; unsupported object keys are not allowed.'
      : 'Use ordinary JSON data without unsupported object keys, or clear the field.';
  }
  return 'Provide a valid value for this field.';
}
