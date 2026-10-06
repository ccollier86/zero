import { describe, expect, test } from 'bun:test';
import type { DataStudioColumn, DataStudioTable } from '../../frontend/client/data-studio-client';
import { DATA_STUDIO_MAX_VALUE_BYTES } from '../../data-studio/data-studio-contracts';
import { buildDataStudioRowDraft, createDataStudioRowOpening, dataStudioRowSchemaKey,
  isDataStudioRowDraftDirty, updateDataStudioRowDraft } from './data-studio-row-draft';

function table(columns: readonly DataStudioColumn[]): DataStudioTable {
  return { tableId: 'contacts', key: 'contacts', name: 'Contacts', description: '', status: 'active',
    schema: { version: 1, columns }, schemaRevision: 3, revision: 4, rowCount: 0, createdAt: 1, updatedAt: 1 };
}
function column(type: DataStudioColumn['type'], overrides: Partial<DataStudioColumn> = {}): DataStudioColumn {
  return { columnId: 'field-id', key: 'field_key', label: 'Field', type, required: false, ...overrides };
}

describe('Data Studio create-record drafts', () => {
  test('detaches the opening schema and keys drafts by column ID, not display label or machine key', () => {
    const source = table([column('text', { defaultValue: 'Initial' })]);
    const opening = createDataStudioRowOpening(source);
    const next = updateDataStudioRowDraft(opening.initial, 'field-id', 'Ada');
    expect(opening.schema).not.toBe(source.schema);
    expect(Object.isFrozen(opening.schema.columns[0])).toBe(true);
    expect(Object.isFrozen(next)).toBe(true);
    expect(next['field-id']).toEqual({ raw: 'Ada', touched: true });
    expect(opening.initial['field-id']).toEqual({ raw: 'Initial', touched: false });
    expect(buildDataStudioRowDraft(opening, next).values).toEqual({ field_key: 'Ada' });
    expect(() => updateDataStudioRowDraft(next, 'field_key', 'wrong owner')).toThrow();
  });

  test('omits untouched defaults and optional values while requiring a value without a default', () => {
    const opening = createDataStudioRowOpening(table([
      column('text', { columnId: 'name', key: 'name', required: true }),
      column('boolean', { columnId: 'flag', key: 'flag', required: true, defaultValue: false }),
      column('number', { columnId: 'score', key: 'score', defaultValue: 0 }),
      column('text', { columnId: 'note', key: 'note' }),
    ]));
    expect(opening.initial.flag.raw).toBe('false');
    expect(opening.initial.score.raw).toBe('0');
    expect(buildDataStudioRowDraft(opening, opening.initial).errors).toEqual({ name: 'Provide a value for this required field.' });
    const draft = updateDataStudioRowDraft(opening.initial, 'name', 'Ada');
    expect(buildDataStudioRowDraft(opening, draft).values).toEqual({ name: 'Ada' });
    expect(isDataStudioRowDraftDirty(opening, opening.initial)).toBe(false);
  });

  test('distinguishes explicit empty text, zero, false and null from omission', () => {
    const opening = createDataStudioRowOpening(table([
      column('text', { columnId: 'text', key: 'text' }),
      column('number', { columnId: 'number', key: 'number', defaultValue: 2 }),
      column('boolean', { columnId: 'bool', key: 'bool', defaultValue: true }),
      column('json', { columnId: 'json', key: 'json' }),
    ]));
    let draft = updateDataStudioRowDraft(opening.initial, 'text', '');
    draft = updateDataStudioRowDraft(draft, 'number', '0');
    draft = updateDataStudioRowDraft(draft, 'bool', 'false');
    draft = updateDataStudioRowDraft(draft, 'json', 'null');
    expect(buildDataStudioRowDraft(opening, draft).values).toEqual({ text: '', number: 0, bool: false, json: null });
    expect(isDataStudioRowDraftDirty(opening, draft)).toBe(true);
  });

  test('accepts a touched empty required text but rejects required null values', () => {
    const text = createDataStudioRowOpening(table([column('text', { required: true })]));
    expect(buildDataStudioRowDraft(text, updateDataStudioRowDraft(text.initial, 'field-id', '')).values).toEqual({ field_key: '' });
    for (const type of ['number', 'boolean', 'json', 'date', 'datetime'] as const) {
      const opening = createDataStudioRowOpening(table([column(type, { required: true })]));
      const result = buildDataStudioRowDraft(opening, updateDataStudioRowDraft(opening.initial, 'field-id', ''));
      expect(result.values).toBeNull();
      expect(Object.hasOwn(result.errors, 'field-id')).toBe(true);
    }
  });

  test('validates finite decimal syntax without losing incompatible typed text', () => {
    const opening = createDataStudioRowOpening(table([column('number')]));
    for (const raw of ['-', 'NaN', 'Infinity', '0x20', '1e', '1e999']) {
      const draft = updateDataStudioRowDraft(opening.initial, 'field-id', raw);
      expect(buildDataStudioRowDraft(opening, draft).values).toBeNull();
      expect(draft['field-id'].raw).toBe(raw);
    }
    for (const [raw, value] of [['.5', 0.5], ['-2.3e2', -230], ['+0', 0]] as const) {
      expect(buildDataStudioRowDraft(opening, updateDataStudioRowDraft(opening.initial, 'field-id', raw)).values).toEqual({ field_key: value });
    }
  });

  test('rejects malformed and unsafe JSON with actionable, content-free messages', () => {
    const opening = createDataStudioRowOpening(table([column('json')]));
    const malformed = buildDataStudioRowDraft(opening, updateDataStudioRowDraft(opening.initial, 'field-id', '{private-payload'));
    expect(malformed.errors['field-id']).toBe('Enter valid JSON.');
    const unsafe = buildDataStudioRowDraft(opening, updateDataStudioRowDraft(opening.initial, 'field-id', '{"__proto__":{"private":"payload"}}'));
    expect(unsafe.values).toBeNull();
    expect(unsafe.errors['field-id']).toContain('unsupported object keys');
    expect(JSON.stringify(unsafe)).not.toContain('private');
    const result = buildDataStudioRowDraft(opening, updateDataStudioRowDraft(opening.initial, 'field-id', '{"safe":{"value":1}}'));
    expect(Object.isFrozen(result.values?.field_key)).toBe(true);
    expect(result.values).toEqual({ field_key: { safe: { value: 1 } } });
  });

  test('validates calendar dates and exact local datetime precision', () => {
    const opening = createDataStudioRowOpening(table([
      column('date', { columnId: 'date', key: 'date' }),
      column('datetime', { columnId: 'time', key: 'time' }),
    ]));
    let draft = updateDataStudioRowDraft(opening.initial, 'date', '2026-02-29');
    expect(buildDataStudioRowDraft(opening, draft).errors.date).toBe('Choose a valid calendar date.');
    draft = updateDataStudioRowDraft(draft, 'date', '2028-02-29');
    draft = updateDataStudioRowDraft(draft, 'time', '2026-10-05T12:34:56.789');
    const values = buildDataStudioRowDraft(opening, draft).values;
    expect(values?.date).toBe('2028-02-29');
    expect(values?.time).toBe(new Date(2026, 9, 5, 12, 34, 56, 789).toISOString());
    expect(String(values?.time)).toEndWith(':56.789Z');
    draft = updateDataStudioRowDraft(draft, 'time', '2026-10-05T24:00');
    expect(buildDataStudioRowDraft(opening, draft).values).toBeNull();
  });

  test('keeps revision/schema changes distinct from ordinary table metadata refreshes', () => {
    const source = table([column('text')]);
    const key = dataStudioRowSchemaKey(source);
    expect(dataStudioRowSchemaKey({ ...source, name: 'Renamed', rowCount: 12, revision: 50, updatedAt: 20 })).toBe(key);
    expect(dataStudioRowSchemaKey({ ...source, schemaRevision: 4 })).not.toBe(key);
    expect(dataStudioRowSchemaKey({ ...source, schema: { ...source.schema, columns: [column('text', { key: 'renamed' })] } })).not.toBe(key);
  });

  test('bounds individual raw fields and complete records before sending values', () => {
    const text = createDataStudioRowOpening(table([column('text')]));
    const oversized = updateDataStudioRowDraft(text.initial, 'field-id', 'a'.repeat(DATA_STUDIO_MAX_VALUE_BYTES + 1));
    expect(buildDataStudioRowDraft(text, oversized).errors['field-id']).toContain('size or nesting limits');
    const columns = Array.from({ length: 5 }, (_, index) => column('text', { columnId: `field-${index}`, key: `value_${index}` }));
    const opening = createDataStudioRowOpening(table(columns));
    let draft = opening.initial;
    for (const field of columns) draft = updateDataStudioRowDraft(draft, field.columnId, 'a'.repeat(60_000));
    const result = buildDataStudioRowDraft(opening, draft);
    expect(result.values).toBeNull();
    expect(result.error).toContain('record is too large');
  });
});
