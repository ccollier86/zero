/** Local visual schema drafts and canonical column conversion; no persistence or transport. */
import {
  DATA_STUDIO_SCHEMA_VERSION,
  type DataStudioColumn,
  type DataStudioColumnType,
  type DataStudioSchema,
  type DataStudioTable,
} from '../../data-studio/data-studio-contracts';
import {
  normalizeDataStudioSchema,
  normalizeDataStudioValueForColumn,
} from '../../data-studio/data-studio-codec';
import { dataStudioValueDraft, parseDataStudioValueDraft } from './data-studio-value';
import { createDataStudioOperationId } from '../../frontend/client/data-studio-mutation';

export type DataStudioDefaultMode = 'none' | 'null' | 'value';

export interface DataStudioEditableColumn {
  readonly columnId: string;
  readonly key: string;
  readonly label: string;
  readonly type: DataStudioColumnType;
  readonly required: boolean;
  readonly description: string;
  readonly defaultMode: DataStudioDefaultMode;
  readonly defaultDraft: string;
  /** Existing API keys never follow later label edits implicitly. */
  readonly persisted: boolean;
}

export function dataStudioEditableColumns(
  table?: DataStudioTable | null,
): DataStudioEditableColumn[] {
  return table?.schema.columns.map((column) => editableDataStudioColumn(column, true))
    ?? [newDataStudioEditableColumn(0)];
}

export function newDataStudioEditableColumn(index: number): DataStudioEditableColumn {
  const suffix = createDataStudioOperationId();
  return {
    columnId: `column_${suffix}`,
    key: index === 0 ? 'name' : `field_${index + 1}`,
    label: index === 0 ? 'Name' : `Field ${index + 1}`,
    type: 'text',
    required: false,
    description: '',
    defaultMode: 'none',
    defaultDraft: initialDataStudioDefaultDraft('text'),
    persisted: false,
  };
}

export function dataStudioColumnLabelPatch(
  column: DataStudioEditableColumn,
  label: string,
): Pick<DataStudioEditableColumn, 'label'> & Partial<Pick<DataStudioEditableColumn, 'key'>> {
  return {
    label,
    ...(!column.persisted && (!column.key || column.key === normalizeDataStudioKey(column.label))
      ? { key: normalizeDataStudioKey(label) }
      : {}),
  };
}

export function moveDataStudioEditableColumn(
  columns: readonly DataStudioEditableColumn[],
  index: number,
  direction: -1 | 1,
): DataStudioEditableColumn[] {
  const target = index + direction;
  if (index < 0 || index >= columns.length || target < 0 || target >= columns.length) {
    return [...columns];
  }
  const next = [...columns];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

export function buildDataStudioSchema(
  columns: readonly DataStudioEditableColumn[],
): DataStudioSchema {
  const keys = new Set<string>();
  const normalized = columns.map((column, index): DataStudioColumn => {
    const key = normalizeDataStudioKey(column.key);
    const label = column.label.trim();
    if (!key || !label) throw new Error(`Column ${index + 1} needs a label and key.`);
    if (key === 'constructor' || key === 'prototype' || key === '__proto__') {
      throw new Error(`Column key “${key}” is reserved.`);
    }
    if (keys.has(key)) throw new Error(`Column key “${key}” is duplicated.`);
    keys.add(key);
    const base: DataStudioColumn = {
      columnId: column.columnId,
      key,
      label,
      type: column.type,
      required: column.required,
      ...(column.description.trim() ? { description: column.description.trim() } : {}),
    };
    if (column.defaultMode === 'none') return base;
    const candidate = column.defaultMode === 'null'
      ? null
      : parseDefaultDraft(column, base);
    return {
      ...base,
      defaultValue: normalizeDataStudioValueForColumn(base, candidate),
    };
  });
  return normalizeDataStudioSchema({ version: DATA_STUDIO_SCHEMA_VERSION, columns: normalized });
}

function parseDefaultDraft(
  column: DataStudioEditableColumn,
  normalizedColumn: DataStudioColumn,
) {
  if (column.type !== 'text' && column.type !== 'boolean'
    && column.defaultDraft.trim() === '') {
    throw new Error(`${column.label} requires a default value or the Null mode.`);
  }
  if (column.type !== 'boolean') {
    return parseDataStudioValueDraft(column.defaultDraft, normalizedColumn);
  }
  if (column.defaultDraft === 'true') return true;
  if (column.defaultDraft === 'false') return false;
  throw new Error(`${column.label} requires a boolean default.`);
}

export function initialDataStudioDefaultDraft(type: DataStudioColumnType): string {
  if (type === 'number') return '0';
  if (type === 'boolean') return 'false';
  if (type === 'json') return '{}';
  return '';
}

export function normalizeDataStudioKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .replace(/^[^a-z]+/u, '')
    .slice(0, 64);
}

export function editableDataStudioColumn(
  column: DataStudioColumn,
  persisted = true,
): DataStudioEditableColumn {
  const hasDefault = Object.hasOwn(column, 'defaultValue');
  const defaultMode: DataStudioDefaultMode = !hasDefault
    ? 'none'
    : column.defaultValue === null
      ? 'null'
      : 'value';
  return {
    columnId: column.columnId,
    key: column.key,
    label: column.label,
    type: column.type,
    required: column.required,
    description: column.description ?? '',
    defaultMode,
    defaultDraft: defaultMode === 'value'
      ? dataStudioValueDraft(column.defaultValue, column)
      : initialDataStudioDefaultDraft(column.type),
    persisted,
  };
}
