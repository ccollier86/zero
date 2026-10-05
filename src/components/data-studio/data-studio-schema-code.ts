/** Structured code-draft admission using the existing closed Data Studio codecs. */
import {
  DATA_STUDIO_MAX_COLUMNS, type DataStudioSchema,
} from '../../data-studio/data-studio-contracts';
import { normalizeDataStudioSchema } from '../../data-studio/data-studio-codec';
import { normalizeDataStudioColumn } from '../../data-studio/data-studio-schema-codec';

export interface DataStudioSchemaDraftError {
  readonly path: string;
  readonly message: string;
}
export type DataStudioSchemaCodeResult =
  | { readonly ok: true; readonly schema: DataStudioSchema }
  | { readonly ok: false; readonly error: DataStudioSchemaDraftError };

/** Parse a local buffer without replacing it; diagnostics contain no raw record/default values. */
export function parseDataStudioSchemaCode(text: string): DataStudioSchemaCodeResult {
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch {
    return { ok: false, error: { path: '$', message: 'Invalid JSON. Check commas, quotes and matching braces.' } };
  }
  try { return { ok: true, schema: normalizeDataStudioSchema(parsed) }; }
  catch {
    return { ok: false, error: diagnoseSchema(parsed) };
  }
}

function diagnoseSchema(value: unknown): DataStudioSchemaDraftError {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return error('$', 'Use a schema object with version and columns.');
  }
  const schema = value as Record<string, unknown>;
  const extra = Object.keys(schema).find(key => !['version', 'columns'].includes(key));
  if (extra) return error('$.' + extra, 'This property is not part of DataStudioSchema.');
  if (schema.version !== 1) return error('$.version', 'The supported schema version is 1.');
  if (!Array.isArray(schema.columns)) return error('$.columns', 'Columns must be an ordered array.');
  if (schema.columns.length > DATA_STUDIO_MAX_COLUMNS) return error('$.columns', 'Use at most 128 columns.');
  const ids = new Set<string>(), keys = new Set<string>();
  for (const [index, candidate] of schema.columns.entries()) {
    const path = '$.columns[' + index + ']';
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return error(path, 'Use a column object.');
    const column = candidate as Record<string, unknown>;
    const unknown = Object.keys(column).find(key => !['columnId', 'key', 'label', 'type', 'required', 'description', 'defaultValue'].includes(key));
    if (unknown) return error(path + '.' + unknown, 'This column property is not supported.');
    try {
      const normalized = normalizeDataStudioColumn(column);
      const folded = normalized.columnId.toLowerCase();
      if (ids.has(folded)) return error(path + '.columnId', 'Column IDs must be unique; preserve existing IDs.');
      if (keys.has(normalized.key)) return error(path + '.key', 'Machine keys must be unique.');
      ids.add(folded); keys.add(normalized.key);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'The column is invalid.';
      const field = /column id/i.test(message) ? 'columnId'
        : /column key/i.test(message) ? 'key'
          : /label/i.test(message) ? 'label'
            : /column type/i.test(message) ? 'type'
              : /required flag/i.test(message) ? 'required'
                : /description/i.test(message) ? 'description' : 'defaultValue';
      return error(path + '.' + field, message);
    }
  }
  return error('$', 'The schema exceeds its format or byte limits.');
}

function error(path: string, message: string): DataStudioSchemaDraftError { return { path, message }; }
