import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';

import { defineResource } from './resource-definition';
import {
  defineResourceFields,
  projectResourceRow,
  validateResourceClientWriteFields,
} from './resource-field-access';
import { authenticatedOnly } from './resource-policy-helpers';
import { buildResourceListQueryPlan } from './resource-query';
import { validateResourceDefinitions } from './resource-registry';

describe('resource field access contract', () => {
  test('normalizes and deeply freezes fail-closed allow-lists', () => {
    const fields = defineResourceFields({
      read: ['id', 'title'],
      create: ['title'],
    });

    expect(fields).toEqual({
      read: ['id', 'title'],
      create: ['title'],
      update: [],
      filter: ['id', 'title'],
      sort: ['id', 'title'],
    });
    expect(Object.isFrozen(fields)).toBe(true);
    expect(Object.values(fields).every(Object.isFrozen)).toBe(true);

    expect(() => defineResourceFields({
      read: ['id'],
      filter: ['secret'],
    })).toThrow('must also be listed in fields.read');
    expect(() => defineResourceFields({
      read: ['id', 'id'],
    })).toThrow('Duplicate resource fields.read');
  });

  test('projects output and rejects protected raw input while allowing protocol fields', () => {
    const fields = defineResourceFields({
      read: ['id', 'title'],
      create: ['title'],
      update: ['title'],
    });
    expect(projectResourceRow({
      id: 'row-1',
      title: 'Visible',
      secret: 'Hidden',
    }, fields)).toEqual({ id: 'row-1', title: 'Visible' });

    expect(validateResourceClientWriteFields(
      { id: 'row-1', title: 'Allowed' },
      fields,
      'create',
      'documents',
      ['id'],
    )).toBeNull();
    expect(validateResourceClientWriteFields(
      { secret: 'Denied' },
      fields,
      'update',
      'documents',
    )).toMatchObject({
      status: 400,
      code: 'resource-field-not-writable',
    });
  });

  test('validates schema fields, stable public identity, and server-owned realms', () => {
    const base = {
      tables: {
        documents: {
          id: 'text primary key',
          tenant_id: 'text not null',
          title: 'text not null',
        },
      },
      authConfig: { userProperties: {} },
      tenancyMode: 'multi' as const,
    };
    const issues = validateResourceDefinitions([defineResource({
      table: 'documents',
      exposure: 'all',
      realm: 'tenant',
      fields: {
        read: ['title', 'missing'],
        create: ['tenant_id'],
        update: ['id'],
      },
      policy: authenticatedOnly(),
    })], base);

    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'resource-field-unknown',
      'resource-field-primary-key-unreadable',
      'resource-field-primary-key-mutable',
      'resource-field-realm-client-writable',
    ]));
  });

  test('selects only readable columns while keeping hidden policy columns internal', () => {
    const plan = buildResourceListQueryPlan({
      table: 'documents',
      columns: ['id', 'title', 'owner_id', 'secret'],
      selectColumns: ['id', 'title'],
      filterColumns: ['id', 'title'],
      sortColumns: ['title'],
      constraints: [{
        type: 'field',
        field: 'owner_id',
        operator: 'eq',
        value: 'owner-1',
      }],
      query: { filter: 'title:contains:hello', order: 'title', dir: 'asc' },
    });

    expect(plan).toEqual(expect.objectContaining({
      sql: 'SELECT "id", "title" FROM "documents" WHERE "title" LIKE ? ESCAPE \'\\\' AND (typeof("owner_id") = typeof(?) AND "owner_id" COLLATE BINARY IS ?) ORDER BY "title" ASC LIMIT ? OFFSET ?',
      params: ['%hello%', 'owner-1', 'owner-1'],
    }));

    const hiddenFilter = buildResourceListQueryPlan({
      table: 'documents',
      columns: ['id', 'title', 'secret'],
      filterColumns: ['id', 'title'],
      query: { filter: 'secret:eq:value' },
    });
    expect(hiddenFilter).toMatchObject({ status: 400 });

    const hiddenSort = buildResourceListQueryPlan({
      table: 'documents',
      columns: ['id', 'title', 'secret'],
      sortColumns: ['id', 'title'],
      query: { order: 'secret' },
    });
    expect(hiddenSort).toMatchObject({ status: 400 });
  });

  test('keeps server policy equality exact without changing caller filter semantics', () => {
    const db = new Database(':memory:');
    try {
      db.run(`
        CREATE TABLE documents (
          id TEXT PRIMARY KEY,
          owner_id TEXT COLLATE NOCASE NOT NULL,
          affinity_value NUMERIC,
          enabled BLOB
        )
      `);
      const insert = db.prepare(
        'INSERT INTO documents (id, owner_id, affinity_value, enabled) VALUES (?, ?, ?, ?)',
      );
      insert.run('exact', 'user-1', 'not-numeric', 1);
      insert.run('case-variant', 'USER-1', 'not-numeric', '1');
      insert.run('boolean-text', 'other', 'not-numeric', 'true');
      insert.run('boolean-case', 'other', 'not-numeric', 'TRUE');
      insert.run('affinity-coerced', 'other', '1', 0);

      const ownerPlan = buildResourceListQueryPlan({
        table: 'documents',
        columns: ['id', 'owner_id', 'affinity_value', 'enabled'],
        constraints: [{
          type: 'field',
          field: 'owner_id',
          operator: 'eq',
          value: 'user-1',
        }],
        query: { order: 'id', dir: 'asc' },
      });
      if ('error' in ownerPlan) throw new Error(ownerPlan.error);
      expect(db.query(ownerPlan.sql).all(
        ...ownerPlan.params,
        ownerPlan.limit,
        ownerPlan.offset,
      )).toEqual([expect.objectContaining({ id: 'exact' })]);

      const affinityPlan = buildResourceListQueryPlan({
        table: 'documents',
        columns: ['id', 'owner_id', 'affinity_value', 'enabled'],
        constraints: [{
          type: 'field',
          field: 'affinity_value',
          operator: 'eq',
          value: '1',
        }],
      });
      if ('error' in affinityPlan) throw new Error(affinityPlan.error);
      expect(db.query(affinityPlan.sql).all(
        ...affinityPlan.params,
        affinityPlan.limit,
        affinityPlan.offset,
      )).toEqual([]);

      const booleanPlan = buildResourceListQueryPlan({
        table: 'documents',
        columns: ['id', 'owner_id', 'affinity_value', 'enabled'],
        constraints: [{
          type: 'field',
          field: 'enabled',
          operator: 'eq',
          value: true,
        }],
        query: { order: 'id', dir: 'asc' },
      });
      if ('error' in booleanPlan) throw new Error(booleanPlan.error);
      expect(db.query(booleanPlan.sql).all(
        ...booleanPlan.params,
        booleanPlan.limit,
        booleanPlan.offset,
      ).map((row) => (row as { id: string }).id)).toEqual([
        'boolean-text',
        'case-variant',
        'exact',
      ]);

      const callerFilterPlan = buildResourceListQueryPlan({
        table: 'documents',
        columns: ['id', 'owner_id', 'affinity_value', 'enabled'],
        query: { filter: 'owner_id:user-1', order: 'id', dir: 'asc' },
      });
      if ('error' in callerFilterPlan) throw new Error(callerFilterPlan.error);
      expect(db.query(callerFilterPlan.sql).all(
        ...callerFilterPlan.params,
        callerFilterPlan.limit,
        callerFilterPlan.offset,
      ).map((row) => (row as { id: string }).id)).toEqual([
        'case-variant',
        'exact',
      ]);
    } finally {
      db.close();
    }
  });
});
