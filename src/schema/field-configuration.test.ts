/** Declaration admission uses value-free stable errors, not deferred form failures. */

import { describe, expect, test } from 'bun:test';
import * as v from 'valibot';
import { field, SchemaConfigurationError, type FieldType } from './index';

const choices = [{ label: 'Active', value: 'active' }];

describe('configured field defaults', () => {
  const invalid: Array<{ type: FieldType; make(): unknown }> = [
    { type: 'text', make: () => field.text({ minLength: 5, defaultValue: 'bad' }) },
    { type: 'textarea', make: () => field.textarea({ maxLength: 3, defaultValue: 'too-long' }) },
    { type: 'email', make: () => field.email({ defaultValue: 'not-an-email' }) },
    { type: 'url', make: () => field.url({ defaultValue: 'not-a-url' }) },
    { type: 'password', make: () => field.password({ defaultValue: 'short' }) },
    { type: 'date', make: () => field.date({ defaultValue: 'not-a-date' }) },
    { type: 'datetime', make: () => field.datetime({ defaultValue: 'not-a-timestamp' }) },
    { type: 'number', make: () => field.number({ min: 1, defaultValue: 0 }) },
    { type: 'number', make: () => field.number({ integer: true, defaultValue: 1.5 }) },
    { type: 'select', make: () => field.select(choices, { defaultValue: 'unknown' }) },
    { type: 'enum', make: () => field.enum(['active'], { defaultValue: 'unknown' }) },
    { type: 'multiSelect', make: () => field.multiSelect(choices, { defaultValue: ['unknown'] }) },
    { type: 'combobox', make: () => field.combobox(choices, { defaultValue: ['active'] }) },
    { type: 'combobox', make: () => field.combobox(choices, { multiple: true, defaultValue: 'active' }) },
    { type: 'combobox', make: () => field.combobox(choices, { multiple: true, defaultValue: null }) },
    { type: 'tags', make: () => field.tags({ required: true, defaultValue: [] }) },
    { type: 'json', make: () => field.json({ required: true, defaultValue: null }) },
  ];

  for (const [index, example] of invalid.entries()) {
    test(`rejects invalid ${example.type} default ${index + 1} at construction`, () => {
      try {
        example.make();
        throw new Error('Expected an invalid declaration to fail.');
      } catch (error) {
        expect(error).toBeInstanceOf(SchemaConfigurationError);
        if (!(error instanceof SchemaConfigurationError)) throw error;
        expect(error.code).toBe('SCHEMA_DEFAULT_INVALID');
        expect(error.fieldType).toBe(example.type);
        expect(error.message).toBe(`Invalid default value for ${example.type} field.`);
        expect(Object.keys(error).sort()).toEqual(['code', 'fieldType', 'name']);
      }
    });
  }

  test('explicit null defaults preserve optional scalar absence, but not required fields', () => {
    const optional = [field.text({ defaultValue: null }), field.email({ defaultValue: null }), field.number({ min: 1, defaultValue: null }), field.enum(['active'], { defaultValue: null })];
    for (const declaration of optional) expect(v.parse(declaration._schema, undefined)).toBeNull();
    expect(() => field.text({ required: true, defaultValue: null })).toThrow(SchemaConfigurationError);
    expect(() => field.number({ required: true, defaultValue: null })).toThrow(SchemaConfigurationError);
  });

  test('required fields do not silently become optional because a valid default exists', () => {
    const declaration = field.password({ required: true, defaultValue: 'synthetic-password' });
    expect(v.safeParse(declaration._schema, undefined).success).toBe(false);
    expect(v.safeParse(declaration._schema, 'synthetic-password').success).toBe(true);
  });

  for (const type of ['text', 'textarea', 'password'] as const) {
    test(`${type} enforces an explicitly configured zero maximum length`, () => {
      const declaration = field[type]({ maxLength: 0 });
      expect(v.safeParse(declaration._schema, '').success).toBe(true);
      expect(v.safeParse(declaration._schema, 'nonempty').success).toBe(false);
      expect(() => field[type]({ maxLength: 0, defaultValue: 'nonempty' })).toThrow(SchemaConfigurationError);
      const required = field[type]({ required: true, maxLength: 0 });
      expect(v.safeParse(required._schema, '').success).toBe(false);
    });
  }
});
