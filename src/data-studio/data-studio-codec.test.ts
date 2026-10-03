/**
 * data-studio-codec.test.ts
 *
 * Exercises canonical schema, row, and cell-value boundaries without touching
 * persistence or transport code.
 */

import { describe, expect, test } from 'bun:test';
import {
  DATA_STUDIO_MAX_VALUE_DEPTH,
  DATA_STUDIO_SCHEMA_VERSION,
  encodeDataStudioCellValue,
  normalizeDataStudioRowValues,
  normalizeDataStudioSchema,
  normalizeDataStudioValue,
  normalizeDataStudioValueForColumn,
  parseDataStudioRowValues,
  parseDataStudioSchema,
  parseDataStudioValue,
  serializeDataStudioRowValues,
  serializeDataStudioSchema,
  serializeDataStudioValue,
  type DataStudioColumn,
  type DataStudioErrorCode,
  type DataStudioSchema,
} from './index';
import { DataStudioError } from './data-studio-error';

const TEXT_COLUMN: DataStudioColumn = Object.freeze({
  columnId: 'col_title',
  key: 'title',
  label: 'Title',
  type: 'text',
  required: true,
});

const SCHEMA: DataStudioSchema = Object.freeze({
  version: DATA_STUDIO_SCHEMA_VERSION,
  columns: Object.freeze([
    TEXT_COLUMN,
    Object.freeze({
      columnId: 'col_done',
      key: 'done',
      label: 'Done',
      type: 'boolean',
      required: false,
      defaultValue: false,
    }),
  ]),
});

describe('Data Studio schema codec', () => {
  test('normalizes closed schema documents and serializes deterministically', () => {
    const first = {
      columns: [{
        required: true,
        type: 'text',
        label: '  Title  ',
        key: 'title',
        columnId: 'col_title',
      }],
      version: 1,
    };
    const second = {
      version: 1,
      columns: [{
        columnId: 'col_title',
        key: 'title',
        label: 'Title',
        type: 'text',
        required: true,
      }],
    };

    const normalized = normalizeDataStudioSchema(first);
    expect(normalized.columns[0]?.label).toBe('Title');
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(normalized.columns)).toBe(true);
    expect(Object.isFrozen(normalized.columns[0])).toBe(true);
    expect(serializeDataStudioSchema(first)).toBe(serializeDataStudioSchema(second));
    expect(parseDataStudioSchema(serializeDataStudioSchema(first))).toEqual(normalized);
  });

  test('rejects unknown fields, duplicate ids/keys, and malformed schema JSON', () => {
    expectCode(() => normalizeDataStudioSchema({
      version: 1,
      columns: [],
      sql: 'drop table users',
    }), 'DATA_STUDIO_SCHEMA_INVALID');
    expectCode(() => normalizeDataStudioSchema({
      version: 1,
      columns: [
        TEXT_COLUMN,
        { ...TEXT_COLUMN, columnId: 'COL_TITLE', key: 'other' },
      ],
    }), 'DATA_STUDIO_SCHEMA_INVALID');
    expectCode(() => normalizeDataStudioSchema({
      version: 1,
      columns: [
        TEXT_COLUMN,
        { ...TEXT_COLUMN, columnId: 'col_other' },
      ],
    }), 'DATA_STUDIO_SCHEMA_INVALID');
    expectCode(() => parseDataStudioSchema('{'), 'DATA_STUDIO_SCHEMA_INVALID');
  });

  test('rejects reserved object keys before a schema can make rows unwritable', () => {
    for (const reserved of ['__proto__', 'prototype', 'constructor']) {
      expect(() => normalizeDataStudioSchema({
        version: 1,
        columns: [{
          columnId: 'column_1',
          key: reserved,
          label: 'Reserved',
          type: 'text',
          required: false,
        }],
      })).toThrow('Data Studio column key is invalid.');

      expect(() => normalizeDataStudioSchema({
        version: 1,
        columns: [{
          columnId: reserved,
          key: 'safe_key',
          label: 'Reserved',
          type: 'text',
          required: false,
        }],
      })).toThrow('Data Studio column id is invalid.');
    }
  });
});

describe('Data Studio value codec', () => {
  test('detaches, freezes, and canonically orders strict JSON data', () => {
    const source = { z: -0, a: { second: true, first: 'value' } };
    const normalized = normalizeDataStudioValue(source);

    expect(normalized).toEqual({ a: { first: 'value', second: true }, z: 0 });
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(serializeDataStudioValue(source)).toBe(
      '{"a":{"first":"value","second":true},"z":0}',
    );
    expect(parseDataStudioValue(serializeDataStudioValue(source))).toEqual(normalized);
    source.a.first = 'changed';
    expect((normalized as Record<string, unknown>).a).toEqual({
      first: 'value',
      second: true,
    });
  });

  test('rejects lossy, executable, cyclic, sparse, and over-deep values', () => {
    expectCode(() => normalizeDataStudioValue(Number.NaN), 'DATA_STUDIO_VALUE_INVALID');
    expectCode(() => normalizeDataStudioValue(undefined), 'DATA_STUDIO_VALUE_INVALID');
    expectCode(() => normalizeDataStudioValue(new Date()), 'DATA_STUDIO_VALUE_INVALID');

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expectCode(() => normalizeDataStudioValue(cyclic), 'DATA_STUDIO_VALUE_INVALID');

    const sparse = new Array(2);
    sparse[1] = 'present';
    expectCode(() => normalizeDataStudioValue(sparse), 'DATA_STUDIO_VALUE_INVALID');

    const accessor = Object.defineProperty({}, 'secret', {
      enumerable: true,
      get: () => 'must not execute',
    });
    expectCode(() => normalizeDataStudioValue(accessor), 'DATA_STUDIO_VALUE_INVALID');

    let nested: unknown = null;
    for (let depth = 0; depth <= DATA_STUDIO_MAX_VALUE_DEPTH; depth += 1) {
      nested = [nested];
    }
    expectCode(() => normalizeDataStudioValue(nested), 'DATA_STUDIO_LIMIT_EXCEEDED');
  });

  test('enforces logical column types and creates exclusive query projections', () => {
    expect(normalizeDataStudioValueForColumn(TEXT_COLUMN, 'hello')).toBe('hello');
    expectCode(
      () => normalizeDataStudioValueForColumn(TEXT_COLUMN, null),
      'DATA_STUDIO_VALUE_INVALID',
    );

    const datetime: DataStudioColumn = {
      columnId: 'col_when',
      key: 'when',
      label: 'When',
      type: 'datetime',
      required: true,
    };
    expect(normalizeDataStudioValueForColumn(
      datetime,
      '2026-10-02T14:30:00-04:00',
    )).toBe('2026-10-02T18:30:00.000Z');

    expect(encodeDataStudioCellValue(TEXT_COLUMN, 'hello')).toEqual({
      value: 'hello',
      valueJson: '"hello"',
      valueType: 'text',
      textValue: 'hello',
      numberValue: null,
      booleanValue: null,
    });
    expect(encodeDataStudioCellValue({
      columnId: 'col_score',
      key: 'score',
      label: 'Score',
      type: 'number',
      required: false,
    }, 2.5)).toMatchObject({
      valueType: 'number',
      textValue: null,
      numberValue: 2.5,
      booleanValue: null,
    });
  });
});

describe('Data Studio aggregate row codec', () => {
  test('materializes defaults and round-trips one complete canonical payload', () => {
    const values = normalizeDataStudioRowValues(SCHEMA, { col_title: 'Ship it' });
    expect(values).toEqual({ col_done: false, col_title: 'Ship it' });
    expect(Object.isFrozen(values)).toBe(true);

    const serialized = serializeDataStudioRowValues(SCHEMA, values);
    expect(serialized).toBe('{"col_done":false,"col_title":"Ship it"}');
    expect(parseDataStudioRowValues(SCHEMA, serialized)).toEqual(values);
  });

  test('rejects missing required and unknown logical columns', () => {
    expectCode(
      () => normalizeDataStudioRowValues(SCHEMA, {}),
      'DATA_STUDIO_VALUE_INVALID',
    );
    expectCode(
      () => normalizeDataStudioRowValues(SCHEMA, {
        col_title: 'Known',
        col_unknown: 'Unknown',
      }),
      'DATA_STUDIO_VALUE_INVALID',
    );
  });

  test('applies an aggregate bound independently of each valid cell bound', () => {
    const columns = Array.from({ length: 9 }, (_, index): DataStudioColumn => ({
      columnId: `col_${index}`,
      key: `field_${index}`,
      label: `Field ${index}`,
      type: 'text',
      required: true,
    }));
    const schema: DataStudioSchema = { version: 1, columns };
    const value = Object.fromEntries(columns.map((column) => [
      column.columnId,
      'x'.repeat(60 * 1024),
    ]));

    expectCode(
      () => serializeDataStudioRowValues(schema, value),
      'DATA_STUDIO_LIMIT_EXCEEDED',
    );
  });
});

function expectCode(operation: () => unknown, code: DataStudioErrorCode): void {
  try {
    operation();
    throw new Error('Expected a DataStudioError');
  } catch (error) {
    expect(error).toBeInstanceOf(DataStudioError);
    expect((error as DataStudioError).code).toBe(code);
  }
}
