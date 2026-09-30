/**
 * define-schema.test.ts
 *
 * Verifies schema-level metadata emitted by the high-level field/table DSL.
 * Database behavior is covered by ReactiveDB tests.
 */

import { describe, expect, test } from 'bun:test';
import {
  GUARDIAN_TABLE_REFERENCES,
  defineSchema,
  defineTable,
  field,
  getGuardianAnchorRequirements,
  getGuardianTableReferences,
  hasGuardianTableReferences,
  inspectGuardianReferenceSchema,
  schema,
} from './index';
import type { InferInsert, InferRow, InsertInput } from './index';

describe('natural identity schema metadata', () => {
  test('required booleans remain required in validation and SQL metadata', () => {
    const flags = defineTable('flags', {
      enabled: field.boolean({ required: true, defaultValue: false }),
    });

    expect(flags.schema.fields.get('enabled')?.required).toBe(true);
    expect(flags.serverTable.enabled).toBe('integer not null default 0');
    expect(flags.clientTable._booleanFields).toEqual(['enabled']);
    expect(flags.schema.validate({}).success).toBe(false);
    expect(flags.schema.validate({ enabled: false }).success).toBe(true);

    const logicalRow: InferRow<typeof flags> = { id: 'flag-1', enabled: true };
    expect(logicalRow.enabled).toBe(true);

    // @ts-expect-error field.boolean() exposes a logical boolean, not SQLite's integer encoding.
    const invalidLogicalRow: InferRow<typeof flags> = { id: 'flag-2', enabled: 1 };
    void invalidLogicalRow;
  });

  test('insert input omits only the generated primary key', () => {
    const accounts = defineTable('accounts', {
      name: field.text({ required: true }),
    }, { pk: 'account_id' });

    type Account = InferRow<typeof accounts>;
    const inferred: InferInsert<typeof accounts> = { name: 'Acme' };
    const reusable: InsertInput<Account> = { name: 'Globex' };
    const explicit: InsertInput<Account> = { account_id: 'acct-1', name: 'Initech' };

    expect([inferred.name, reusable.name, explicit.account_id]).toEqual([
      'Acme',
      'Globex',
      'acct-1',
    ]);

    // @ts-expect-error non-primary-key fields keep their requiredness.
    const missingName: InsertInput<Account> = {};
    void missingName;
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

  test('emits immutable server-only Guardian reference metadata and foreign keys', () => {
    const tasks = defineTable('tasks', {
      title: field.text({ required: true }),
      created_by_user_id: field.guardianUser(),
      assigned_membership_id: field.guardianMembership(),
    }, { pk: 'task_id' });

    expect(tasks.serverTable.created_by_user_id).toBe(
      'text references users(user_id) on delete restrict not null',
    );
    expect(tasks.serverTable.assigned_membership_id).toBe(
      'text references tenant_memberships(membership_id) on delete restrict not null',
    );
    expect(tasks.guardianReferences).toEqual([
      {
        field: 'created_by_user_id',
        kind: 'user',
        table: 'users',
        column: 'user_id',
        onDelete: 'restrict',
      },
      {
        field: 'assigned_membership_id',
        kind: 'membership',
        table: 'tenant_memberships',
        column: 'membership_id',
        onDelete: 'restrict',
      },
    ]);
    expect(getGuardianTableReferences(tasks.serverTable)).toEqual(tasks.guardianReferences);
    expect(getGuardianAnchorRequirements(tasks.serverTable)).toEqual(['user', 'membership']);
    expect(tasks.guardianAnchorRequirements).toEqual(['user', 'membership']);
    expect(hasGuardianTableReferences(tasks.serverTable)).toBe(true);
    expect(Object.isFrozen(tasks.guardianReferences)).toBe(true);
    expect(Object.isFrozen(getGuardianTableReferences(tasks.serverTable))).toBe(true);
    expect(Object.getOwnPropertyDescriptor(
      tasks.serverTable,
      GUARDIAN_TABLE_REFERENCES,
    )?.enumerable).toBe(false);
    expect(Reflect.ownKeys(tasks.clientTable)).not.toContain(GUARDIAN_TABLE_REFERENCES);
    expect(JSON.stringify(tasks.serverTable)).not.toContain('guardian-table-references');
  });

  test('a membership reference implies both canonical Guardian anchors', () => {
    const assignments = defineTable('assignments', {
      membership_id: field.guardianMembership({ required: false }),
    });

    expect(assignments.schema.guardianAnchorRequirements).toEqual(['user', 'membership']);
    expect(assignments.serverTable.membership_id).toBe(
      'text references tenant_memberships(membership_id) on delete restrict',
    );
    expect(assignments.schema.validate({}).success).toBe(true);
  });

  test('detects Guardian metadata whose declared SQL was weakened or retargeted', () => {
    for (const invalidDefinition of [
      'text not null',
      'text references users(user_id) on delete cascade not null',
      'text references tenant_memberships(membership_id) on delete restrict not null',
    ]) {
      const tasks = defineTable('tasks', {
        owner_user_id: field.guardianUser(),
      }, { pk: 'task_id' });
      tasks.serverTable.owner_user_id = invalidDefinition;

      expect(inspectGuardianReferenceSchema(tasks.serverTable)).toEqual([
        expect.objectContaining({
          code: 'invalid-column-definition',
          field: 'owner_user_id',
          kind: 'user',
        }),
      ]);
    }
  });
});
