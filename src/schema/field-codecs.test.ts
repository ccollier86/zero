/**
 * field-codecs.test.ts
 *
 * Verifies schema field value conversion between UI values and ReactiveDB row
 * values for structured fields.
 */

import { describe, expect, test } from 'bun:test';
import { defineTable } from './define-schema';
import { field } from './field-types';

const profileTable = defineTable('profiles', {
  active: field.boolean({ defaultValue: true }),
  roles: field.multiSelect([
    { label: 'Admin', value: 'admin' },
    { label: 'User', value: 'user' },
  ]),
  tags: field.tags(),
  window: field.dateRange(),
  settings: field.json(),
  teams: field.combobox([
    { label: 'Red', value: 'red' },
    { label: 'Blue', value: 'blue' },
  ], { multiple: true }),
});

describe('schema field codecs', () => {
  test('encodes UI values into ReactiveDB row values', () => {
    const encoded = profileTable.schema.encodeRow({
      active: true,
      roles: ['admin', 'user'],
      tags: ['vip'],
      window: ['2026-01-01', '2026-01-31'],
      settings: { theme: 'dark' },
      teams: ['red'],
    });

    expect(encoded.active).toBe(1);
    expect(encoded.roles).toBe('["admin","user"]');
    expect(encoded.tags).toBe('["vip"]');
    expect(encoded.window).toBe('["2026-01-01","2026-01-31"]');
    expect(encoded.settings).toBe('{"theme":"dark"}');
    expect(encoded.teams).toBe('["red"]');
  });

  test('decodes ReactiveDB row values into UI values', () => {
    const decoded = profileTable.schema.decodeRow({
      active: 0,
      roles: '["admin"]',
      tags: '["vip","beta"]',
      window: '["2026-02-01","2026-02-28"]',
      settings: '{"theme":"light"}',
      teams: '["blue"]',
    });

    expect(decoded.active).toBe(false);
    expect(decoded.roles).toEqual(['admin']);
    expect(decoded.tags).toEqual(['vip', 'beta']);
    expect(decoded.window).toEqual(['2026-02-01', '2026-02-28']);
    expect(decoded.settings).toEqual({ theme: 'light' });
    expect(decoded.teams).toEqual(['blue']);
  });
});
