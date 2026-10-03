import type {
  DataStudioColumn,
  DataStudioTable,
  DataStudioValue,
} from '../../frontend/client/data-studio-client';
import { DATA_STUDIO_MAX_PAGE_SIZE } from '../../data-studio/data-studio-operation-contracts';

/** Format a typed cell without collapsing null into a misleading string. */
export function formatDataStudioValue(
  value: DataStudioValue | undefined,
  column?: Pick<DataStudioColumn, 'type'>,
): string {
  if (value === undefined) return '';
  if (value === null) return 'null';
  if (column?.type === 'boolean') return value === true ? 'True' : 'False';
  if (column?.type === 'json' || typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

/** Format the value used by a native inline editor. */
export function dataStudioValueDraft(
  value: DataStudioValue | undefined,
  column: DataStudioColumn,
): string {
  if (value == null) return '';
  if (column.type === 'json') return JSON.stringify(value);
  if (column.type === 'datetime' && typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      const local = new Date(parsed.getTime() - (parsed.getTimezoneOffset() * 60_000));
      // Data Studio canonicalizes datetimes to millisecond precision. Keep
      // that precision visible so an intentional minute/hour edit does not
      // silently zero seconds and milliseconds that the user never changed.
      return local.toISOString().slice(0, 23);
    }
  }
  return String(value);
}

/** Parse one editor draft into the exact JSON-safe domain value. */
export function parseDataStudioValueDraft(
  draft: string,
  column: DataStudioColumn,
): DataStudioValue {
  switch (column.type) {
    case 'text':
      return draft;
    case 'number': {
      if (draft.trim() === '') {
        if (column.required) throw new Error(`${column.label} requires a number.`);
        return null;
      }
      const number = Number(draft);
      if (!Number.isFinite(number)) throw new Error(`${column.label} requires a finite number.`);
      return number;
    }
    case 'boolean':
      return draft === 'true';
    case 'date':
      if (!draft) {
        if (!column.required) return null;
        throw new Error(`${column.label} requires a date.`);
      }
      return draft;
    case 'datetime': {
      if (!draft && !column.required) return null;
      const date = new Date(draft);
      if (Number.isNaN(date.getTime())) throw new Error(`${column.label} requires a date and time.`);
      return date.toISOString();
    }
    case 'json':
      if (draft.trim() === '' && !column.required) return null;
      try {
        return JSON.parse(draft) as DataStudioValue;
      } catch {
        throw new Error(`${column.label} requires valid JSON.`);
      }
  }
}

/** Generate browser/API usage—not raw SQL—for the inspector's Code tab. */
export function dataStudioCodeExample(table: DataStudioTable): string {
  const typeLines = table.schema.columns.map((column) => {
    const optional = column.required ? '' : '?';
    return `  ${safeProperty(column.key)}${optional}: ${typescriptType(column)};`;
  });
  return [
    `// ${table.name}`,
    `export interface ${pascalCase(table.key)}Record {`,
    ...typeLines,
    '}',
    '',
    `const page = await client.dataStudio.listRows(${JSON.stringify(table.tableId)}, {`,
    `  limit: ${DATA_STUDIO_MAX_PAGE_SIZE},`,
    '  offset: 0,',
    '});',
  ].join('\n');
}

function typescriptType(column: DataStudioColumn): string {
  switch (column.type) {
    case 'text':
    case 'date':
    case 'datetime':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'json':
      return 'DataStudioValue';
  }
}

function safeProperty(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(key) ? key : JSON.stringify(key);
}

function pascalCase(value: string): string {
  const result = value
    .split(/[^A-Za-z0-9]+/u)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join('');
  return /^[A-Za-z_$]/u.test(result) ? result || 'DataStudio' : `DataStudio${result}`;
}
