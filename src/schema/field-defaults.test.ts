/** Independent runtime checks for field blanks, defaults and storage codecs. */

import { describe, expect, test } from 'bun:test';
import { defineSchema } from './define-schema';
import { field, type FieldDef } from './field-types';
import { createReactiveDB } from '../sync/reactive-db';
import { validateSyncMutation } from '../sync/sync-mutation-validation';
import { SYNC_TABLE_MUTATION_VALIDATOR, type Row } from '../sync/types';

const choices = [{ label: 'Active', value: 'active' }, { label: 'Paused', value: 'paused' }];
const strings: Array<{ name: string; make(required: boolean): FieldDef; valid: string; invalid?: string }> = [
  { name: 'text', make: (required) => field.text({ required, minLength: 3 }), valid: 'Valid', invalid: 'x' },
  { name: 'textarea', make: (required) => field.textarea({ required, minLength: 3 }), valid: 'Valid', invalid: 'x' },
  { name: 'email', make: (required) => field.email({ required }), valid: 'synthetic@example.test', invalid: 'not-email' },
  { name: 'url', make: (required) => field.url({ required }), valid: 'https://example.test/path', invalid: 'not-url' },
  { name: 'password', make: (required) => field.password({ required, minLength: 8 }), valid: 'synthetic-password', invalid: 'short' },
  { name: 'date', make: (required) => field.date({ required }), valid: '2026-10-05', invalid: 'not-date' },
  { name: 'datetime', make: (required) => field.datetime({ required }), valid: '2026-10-05T12:00:00.000Z', invalid: 'not-timestamp' },
  { name: 'select', make: (required) => field.select(choices, { required }), valid: 'active', invalid: 'unknown' },
  { name: 'enum', make: (required) => field.enum(['active', 'paused'], { required }), valid: 'active', invalid: 'unknown' },
  { name: 'combobox', make: (required) => field.combobox(choices, { required }), valid: 'active', invalid: 'unknown' },
];

describe('optional formatted/choice field blanks', () => {
  for (const example of strings) {
    test(`${example.name} accepts optional blank/omission but preserves nonblank validation`, () => {
      const schema = defineSchema({ value: example.make(false) });
      expect(schema.validate({ value: '' }).success).toBe(true);
      expect(schema.validate({}).success).toBe(true);
      expect(schema.validate({ value: example.valid }).success).toBe(true);
      if (example.invalid) expect(schema.validate({ value: example.invalid }).success).toBe(false);
      expect(schema.validate(schema.getDefaults()).success).toBe(true);
    });

    test(`${example.name} rejects required blank and omission`, () => {
      const schema = defineSchema({ value: example.make(true) });
      expect(schema.validate({ value: '' }).success).toBe(false);
      expect(schema.validate({}).success).toBe(false);
      expect(schema.validate({ value: example.valid }).success).toBe(true);
    });
  }
});

describe('structured logical defaults and wire codecs', () => {
  const schema = defineSchema({
    selected: field.multiSelect(choices),
    tags: field.tags(),
    teams: field.combobox(choices, { multiple: true }),
    window: field.dateRange(),
    settings: field.json(),
    enabled: field.boolean(),
    count: field.number(),
  });
  const expected = { selected: [], tags: [], teams: [], window: ['', ''], settings: null, enabled: false, count: 0 };

  test('descriptor defaults are logical values accepted by the same schema', () => {
    expect(schema.getDefaults()).toEqual(expected);
    expect(schema.validate(schema.getDefaults()).success).toBe(true);
    const omitted = schema.validate({});
    expect(omitted.success).toBe(true);
    if (omitted.success) expect(schema.getDefaults()).toEqual(omitted.output);
  });

  test('neutral structured defaults round-trip through existing wire codecs', () => {
    const wire = schema.encodeRow(schema.getDefaults());
    expect(wire).toEqual({ selected: '[]', tags: '[]', teams: '[]', window: '["",""]', settings: 'null', enabled: 0, count: 0 });
    expect(schema.decodeRow(wire)).toEqual(expected);
  });

  test('required structured fields reject their empty logical representations', () => {
    const required = defineSchema({
      selected: field.multiSelect(choices, { required: true }),
      tags: field.tags({ required: true }),
      teams: field.combobox(choices, { multiple: true, required: true }),
      window: field.dateRange({ required: true }),
      settings: field.json({ required: true }),
    });
    expect(required.validate({ selected: [], tags: [], teams: [], window: ['', ''], settings: null }).success).toBe(false);
    expect(required.validate({ selected: ['active'], tags: ['synthetic'], teams: ['paused'], window: ['2026-10-01', '2026-10-05'], settings: {} }).success).toBe(true);
  });

  test('required false and numeric zero remain valid values, not empty fields', () => {
    const primitives = defineSchema({ enabled: field.boolean({ required: true }), count: field.number({ required: true }) });
    expect(primitives.validate({ enabled: false, count: 0 }).success).toBe(true);
  });
});

describe('explicit defaults and Guardian attribution', () => {
  test('explicit valid defaults agree between omitted validation and generated forms', () => {
    const schema = defineSchema({
      email: field.email({ defaultValue: 'synthetic@example.test' }),
      url: field.url({ defaultValue: 'https://example.test' }),
      password: field.password({ defaultValue: 'synthetic-password' }),
      date: field.date({ defaultValue: '2026-10-05' }),
      choice: field.select(choices, { defaultValue: 'active' }),
      tags: field.tags({ defaultValue: ['synthetic'] }),
      settings: field.json({ defaultValue: { active: true } }),
    });
    const defaults = schema.getDefaults();
    const omitted = schema.validate({});
    expect(omitted.success).toBe(true);
    if (omitted.success) expect(defaults).toEqual(omitted.output);
    expect(schema.decodeRow(schema.encodeRow(defaults))).toEqual(defaults);
  });

  test('absent optional Guardian references remain omitted rather than invented blank IDs', () => {
    const schema = defineSchema({ owner: field.guardianUser({ required: false }), membership: field.guardianMembership({ required: false }) });
    expect(schema.validate({}).success).toBe(true);
    expect(schema.validate({ owner: '', membership: '' }).success).toBe(false);
    expect(schema.validate({ owner: 'user-synthetic', membership: 'membership-synthetic' }).success).toBe(true);
    expect(schema.getDefaults()).toEqual({});
    expect(schema.encodeRow(schema.getDefaults())).toEqual({});
  });

  test('required Guardian references reject omission and blank identities', () => {
    const schema = defineSchema({ owner: field.guardianUser(), membership: field.guardianMembership() });
    expect(schema.validate({}).success).toBe(false);
    expect(schema.validate({ owner: '', membership: '' }).success).toBe(false);
  });

  test('numeric constraints never silently accept an out-of-range zero', () => {
    const schema = defineSchema({ value: field.number({ min: 1 }) });
    expect(schema.validate({ value: 0 }).success).toBe(false);
    expect(schema.validate({ value: 1 }).success).toBe(true);
  });

  test('untouched optional constrained numbers are omitted without inventing a minimum', () => {
    const schema = defineSchema({ value: field.number({ min: 1 }) });
    expect(schema.getDefaults()).toEqual({});
    expect(schema.validate({}).success).toBe(true);
    expect(schema.encodeRow(schema.getDefaults())).toEqual({});
    expect(defineSchema({ value: field.number() }).getDefaults()).toEqual({ value: 0 });
    expect(defineSchema({ value: field.number({ min: 1, defaultValue: 3 }) }).getDefaults()).toEqual({ value: 3 });
  });

  test('explicit optional numeric clears survive JSON transport, validation, SQLite and change delivery', () => {
    const schema = defineSchema({ count: field.number({ min: 1 }) });
    const table = schema.toTableSchema();
    const db = createReactiveDB({ mode: 'memory' });
    try {
      db.defineTable('numeric_defaults', table);
      db.insert('numeric_defaults', { id: 'synthetic-row', count: 2 });
      const changes: Array<Row | null | undefined> = [];
      db.onChange((change) => changes.push(change.row));
      const partial = JSON.parse(JSON.stringify(schema.encodeRow({ count: null }))) as Row;
      expect(partial).toEqual({ count: null });
      const validated = validateSyncMutation(db, 'numeric_defaults', 'UPDATE', 'synthetic-row', partial, table[SYNC_TABLE_MUTATION_VALIDATOR]);
      expect(validated.ok).toBe(true);
      if (!validated.ok || !validated.row) throw new Error('Expected the explicit optional clear to validate.');
      expect(validated.row).toEqual({ count: null });
      db.update('numeric_defaults', 'synthetic-row', validated.row);
      expect(db.get('numeric_defaults', 'synthetic-row')?.count).toBeNull();
      expect(changes.at(-1)?.count).toBeNull();
      expect(schema.decodeRow(db.get('numeric_defaults', 'synthetic-row')!).count).toBeNull();
      expect(schema.validate({ count: 0 }).success).toBe(false);
    } finally { db.dispose(); }
  });

  test('required numeric columns reject explicit null without altering the stored value', () => {
    const schema = defineSchema({ count: field.number({ required: true, min: 1 }) });
    const table = schema.toTableSchema();
    const db = createReactiveDB({ mode: 'memory' });
    try {
      db.defineTable('required_numeric', table);
      db.insert('required_numeric', { id: 'synthetic-row', count: 2 });
      expect(schema.validate({ count: null }).success).toBe(false);
      const result = validateSyncMutation(db, 'required_numeric', 'UPDATE', 'synthetic-row', { count: null }, table[SYNC_TABLE_MUTATION_VALIDATOR]);
      expect(result.ok).toBe(false);
      expect(db.get('required_numeric', 'synthetic-row')?.count).toBe(2);
    } finally { db.dispose(); }
  });
});

describe('optional SQL NULL preservation', () => {
  test('optional scalar/choice SQL nulls survive live mutation validation and SQLite reads', () => {
    const definitions = Object.fromEntries(strings.map((example) => [example.name, example.make(false)]));
    const schema = defineSchema(definitions);
    const table = schema.toTableSchema();
    const values = Object.fromEntries(strings.map((example) => [example.name, example.valid]));
    const cleared = Object.fromEntries(strings.map((example) => [example.name, null]));
    expect(schema.validate(values).success).toBe(true);
    expect(schema.validate(cleared).success).toBe(true);
    const db = createReactiveDB({ mode: 'memory' });
    try {
      db.defineTable('nullable_scalars', table);
      db.insert('nullable_scalars', { id: 'synthetic-row', ...schema.encodeRow(values) });
      const partial = JSON.parse(JSON.stringify(schema.encodeRow(cleared))) as Row;
      const result = validateSyncMutation(db, 'nullable_scalars', 'UPDATE', 'synthetic-row', partial, table[SYNC_TABLE_MUTATION_VALIDATOR]);
      expect(result.ok).toBe(true);
      if (!result.ok || !result.row) throw new Error('Expected optional scalar clears to validate.');
      expect(result.row).toEqual(cleared);
      db.update('nullable_scalars', 'synthetic-row', result.row);
      const stored = db.get('nullable_scalars', 'synthetic-row')!;
      const decoded = schema.decodeRow(stored);
      for (const example of strings) {
        expect(stored[example.name]).toBeNull();
        expect(decoded[example.name]).toBeNull();
        expect(defineSchema({ value: example.make(true) }).validate({ value: null }).success).toBe(false);
      }
    } finally { db.dispose(); }
  });

  test('optional Guardian references clear to SQL null, never a fabricated empty anchor', () => {
    const schema = defineSchema({ owner: field.guardianUser({ required: false }), membership: field.guardianMembership({ required: false }) });
    const table = schema.toTableSchema();
    const db = createReactiveDB({ mode: 'memory' });
    try {
      // Synthetic local ID-only anchors, not canonical authentication records.
      db.defineTable('users', { user_id: 'text primary key' });
      db.defineTable('tenant_memberships', { membership_id: 'text primary key', user_id: 'text references users(user_id) not null' });
      db.defineTable('attributed_records', table);
      db.insert('users', { user_id: 'synthetic-user' });
      db.insert('tenant_memberships', { membership_id: 'synthetic-member', user_id: 'synthetic-user' });
      db.insert('attributed_records', { id: 'synthetic-row', owner: 'synthetic-user', membership: 'synthetic-member' });
      const clear = JSON.parse(JSON.stringify(schema.encodeRow({ owner: null, membership: null }))) as Row;
      expect(clear).toEqual({ owner: null, membership: null });
      const result = validateSyncMutation(db, 'attributed_records', 'UPDATE', 'synthetic-row', clear, table[SYNC_TABLE_MUTATION_VALIDATOR]);
      expect(result.ok).toBe(true);
      if (!result.ok || !result.row) throw new Error('Expected optional Guardian reference clears to validate.');
      db.update('attributed_records', 'synthetic-row', result.row);
      expect(schema.decodeRow(db.get('attributed_records', 'synthetic-row')!)).toMatchObject({ owner: null, membership: null });
      expect(schema.validate({ owner: '', membership: '' }).success).toBe(false);
      expect(defineSchema({ owner: field.guardianUser() }).validate({ owner: null }).success).toBe(false);
    } finally { db.dispose(); }
  });
});
