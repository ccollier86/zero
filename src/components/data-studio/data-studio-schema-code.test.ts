/** Exercises local JSON admission against the existing closed schema codec. */
import { describe, expect, test } from 'bun:test';
import { parseDataStudioSchemaCode } from './data-studio-schema-code';
import { newDataStudioEditableColumn } from './data-studio-schema-draft';
import type { DataStudioColumn, DataStudioSchema } from '../../data-studio/data-studio-contracts';

const column: DataStudioColumn = {
  columnId: 'column_name', key: 'name', label: 'Name', type: 'text', required: false,
};

describe('Data Studio schema code drafts', () => {
  test('preserves IDs, order and explicit false/zero/null defaults', () => {
    const schema: DataStudioSchema = {
      version: 1,
      columns: [column,
        { ...column, columnId: 'column_count', key: 'count', type: 'number', defaultValue: 0 },
        { ...column, columnId: 'column_active', key: 'active', type: 'boolean', defaultValue: false },
        { ...column, columnId: 'column_empty', key: 'empty', defaultValue: null },
      ],
    };
    const result = parseDataStudioSchemaCode(JSON.stringify(schema));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected a valid schema.');
    expect(result.schema).toEqual(schema);
    expect(Object.hasOwn(result.schema.columns[0]!, 'defaultValue')).toBe(false);
  });

  test('rejects malformed syntax and unsupported schema properties without a partial schema', () => {
    expect(parseDataStudioSchemaCode('{ "version": 1,')).toEqual({
      ok: false, error: { path: '$', message: 'Invalid JSON. Check commas, quotes and matching braces.' },
    });
    expect(parseDataStudioSchemaCode(JSON.stringify({ version: 1, columns: [column], sql: 'ignored' }))).toEqual({
      ok: false, error: { path: '$.sql', message: 'This property is not part of DataStudioSchema.' },
    });
    const invalid = parseDataStudioSchemaCode(JSON.stringify({ version: 1, columns: [{ ...column, enum: ['a'] }] }));
    expect(invalid.ok).toBe(false);
    if (invalid.ok) throw new Error('Expected a rejected schema.');
    expect(invalid.error.path).toBe('$.columns[0].enum');
  });

  test('points duplicate IDs and invalid defaults to their actual column', () => {
    const duplicate = parseDataStudioSchemaCode(JSON.stringify({ version: 1, columns: [column, { ...column, key: 'other' }] }));
    expect(duplicate.ok).toBe(false);
    if (duplicate.ok) throw new Error('Expected duplicate IDs to fail.');
    expect(duplicate.error.path).toBe('$.columns[1].columnId');

    const requiredNull = parseDataStudioSchemaCode(JSON.stringify({ version: 1, columns: [{ ...column, required: true, defaultValue: null }] }));
    expect(requiredNull.ok).toBe(false);
    if (requiredNull.ok) throw new Error('Expected a required-null default to fail.');
    expect(requiredNull.error.path).toBe('$.columns[0].defaultValue');
    expect(requiredNull.error.message).toMatch(/null/u);
  });

  test('generates distinct stable IDs even when columns are added in the same clock tick', () => {
    const columns = Array.from({ length: 100 }, () => newDataStudioEditableColumn(0));
    expect(new Set(columns.map(item => item.columnId)).size).toBe(100);
    expect(columns.every(item => /^column_[a-f0-9-]{36}$/u.test(item.columnId))).toBe(true);
  });
});
