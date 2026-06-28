/**
 * row-identity.test.ts
 *
 * Covers schema-aware primary-key helpers used by generated CRUD/table UI.
 */

import { describe, expect, test } from 'bun:test';
import { defineTable } from '../../schema/define-schema';
import { field } from '../../schema/field-types';
import type { InferRow } from '../../schema/infer';
import type { Row } from '../../sync/types';
import {
  ensureRowPrimaryKey,
  getRowPrimaryKey,
  requireRowPrimaryKey,
  stripRowPrimaryKey,
} from './row-identity';

describe('schema primary key metadata', () => {
  test('defineTable stores custom primary key on schema and table definitions', () => {
    const accounts = defineTable(
      'accounts',
      {
        name: field.text({ required: true }),
      },
      { pk: 'account_id' },
    );

    expect(accounts.schema.primaryKey).toBe('account_id');
    expect(accounts.serverTable.account_id).toBe('text primary key');
    expect(accounts.clientTable._pk).toBe('account_id');
    expect(accounts.clientTable.account_id).toBe('text');

    const typed: InferRow<typeof accounts> = {
      account_id: 'acct_1',
      name: 'Acme',
    };
    expect(typed.account_id).toBe('acct_1');
  });
});

describe('row identity helpers', () => {
  test('generates the schema primary key without inventing id', () => {
    const row = ensureRowPrimaryKey({ name: 'Acme' } as Row, 'account_id');

    expect(typeof row.account_id).toBe('string');
    expect(row.id).toBeUndefined();
    expect(getRowPrimaryKey(row, 'account_id')).toBe(String(row.account_id));
  });

  test('preserves existing primary keys and strips them from update partials', () => {
    const row = { account_id: 'acct_1', name: 'Acme' } as Row;

    expect(ensureRowPrimaryKey(row, 'account_id')).toBe(row);
    expect(stripRowPrimaryKey(row, 'account_id')).toEqual({ name: 'Acme' });
  });

  test('throws a clear error when an existing row has no primary key', () => {
    expect(() => requireRowPrimaryKey({ name: 'Missing' } as Row, 'account_id'))
      .toThrow('[data-table] Row is missing primary key "account_id".');
  });
});
