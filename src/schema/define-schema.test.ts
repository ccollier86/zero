/**
 * define-schema.test.ts
 *
 * Verifies schema-level metadata emitted by the high-level field/table DSL.
 * Database behavior is covered by ReactiveDB tests.
 */

import { describe, expect, test } from 'bun:test';
import { defineSchema, defineTable, field, schema } from './index';

describe('natural identity schema metadata', () => {
  test('required booleans remain required in validation and SQL metadata', () => {
    const flags = defineTable('flags', {
      enabled: field.boolean({ required: true, defaultValue: false }),
    });

    expect(flags.schema.fields.get('enabled')?.required).toBe(true);
    expect(flags.serverTable.enabled).toBe('integer not null default 0');
    expect(flags.schema.validate({}).success).toBe(false);
    expect(flags.schema.validate({ enabled: false }).success).toBe(true);
  });

  test('defineTable emits server and client identity metadata', () => {
    const memberships = defineTable('memberships', {
      team_id: field.text({ required: true }),
      user_id: field.text({ required: true }),
      role: field.text(),
    }, {
      pk: 'membership_id',
      identity: ['team_id', 'user_id'],
    });

    expect(memberships.schema.identity).toEqual(['team_id', 'user_id']);
    expect(memberships.serverTable._identity).toEqual(['team_id', 'user_id']);
    expect(memberships.clientTable._identity).toEqual(['team_id', 'user_id']);
    expect(memberships.serverTable.membership_id).toBe('text primary key');
    expect(memberships.clientTable.membership_id).toBe('text');
  });

  test('schema() preserves per-table identity metadata', () => {
    const db = schema({
      memberships: {
        fields: {
          team_id: field.text({ required: true }),
          user_id: field.text({ required: true }),
        },
        pk: 'membership_id',
        identity: ['team_id', 'user_id'],
      },
    });

    expect(db.definitions.memberships.identity).toEqual(['team_id', 'user_id']);
    expect(db.serverTables.memberships._identity).toEqual(['team_id', 'user_id']);
    expect(db.clientTables.memberships._identity).toEqual(['team_id', 'user_id']);
  });

  test('rejects identity fields that are unknown, duplicated, or primary keys', () => {
    expect(() => defineSchema({
      team_id: field.text(),
    }, {
      identity: ['missing'],
    })).toThrow('is not defined in table fields');

    expect(() => defineSchema({
      team_id: field.text(),
    }, {
      identity: ['team_id', 'team_id'],
    })).toThrow('Duplicate identity field "team_id"');

    expect(() => defineSchema({
      id: field.text(),
      team_id: field.text(),
    }, {
      pk: 'id',
      identity: ['id'],
    })).toThrow('cannot be the primary key');
  });
});
