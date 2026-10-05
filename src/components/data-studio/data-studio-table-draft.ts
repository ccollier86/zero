/** Pure opening snapshots, dirty comparisons and schema-impact summaries; no UI or writes. */
import type { DataStudioSchema, DataStudioTable } from '../../data-studio/data-studio-contracts';
import { DATA_STUDIO_MAX_COLUMNS } from '../../data-studio/data-studio-contracts';
import { dataStudioEditableColumns, newDataStudioEditableColumn, type DataStudioEditableColumn } from './data-studio-schema-draft';

export interface DataStudioTableDraft {
  readonly name: string;
  readonly key: string;
  readonly description: string;
  readonly columns: readonly DataStudioEditableColumn[];
}

export function dataStudioTableOpeningDraft(table?: DataStudioTable | null, addColumn = false, maxColumns = DATA_STUDIO_MAX_COLUMNS): DataStudioTableDraft {
  const columns = dataStudioEditableColumns(table);
  if (addColumn && columns.length < dataStudioUiColumnLimit(maxColumns)) columns.push(nextDataStudioDraftColumn(columns));
  return { name: table?.name ?? '', key: table?.key ?? '', description: table?.description ?? '', columns };
}

export function dataStudioUiColumnLimit(value: number | undefined): number {
  if (value === undefined) return DATA_STUDIO_MAX_COLUMNS;
  return Number.isFinite(value) ? Math.max(0, Math.min(DATA_STUDIO_MAX_COLUMNS, Math.floor(value))) : 0;
}

export function nextDataStudioDraftColumn(columns: readonly DataStudioEditableColumn[]) {
  const keys = new Set(columns.map(column => column.key));
  let index = columns.length;
  while (keys.has(index === 0 ? 'name' : 'field_' + (index + 1))) index++;
  return newDataStudioEditableColumn(index);
}

/** Semantic presentation ignores code formatting, but never erases an invalid draft. */
export function dataStudioDraftSignature(name: string, key: string, description: string, schema: unknown) {
  return JSON.stringify([name, key, description, schema]);
}

export function dataStudioSchemaImpact(previous: DataStudioSchema | undefined, next: DataStudioSchema): string[] {
  if (!previous) return [];
  const impact: string[] = [];
  for (const column of previous.columns) {
    const changed = next.columns.find(item => item.columnId === column.columnId);
    if (!changed) impact.push(`Remove “${column.label}” (${column.key}).`);
    else {
      if (column.key !== changed.key) impact.push(`Rename field key ${column.key} → ${changed.key}; existing callers must be updated.`);
      if (column.type !== changed.type) impact.push(`Change “${column.label}” from ${column.type} to ${changed.type}.`);
      if (!column.required && changed.required) impact.push(`Require a value for “${column.label}”.`);
    }
  }
  return impact;
}
