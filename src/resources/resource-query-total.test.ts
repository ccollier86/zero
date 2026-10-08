/** Verifies opt-in aggregates reuse validated resource predicates without changing legacy list plans. */
import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { buildResourceListQueryPlan } from './resource-query';

describe('resource list exact-total SQL plan', () => {
  test('keeps the legacy plan unchanged until total is explicitly requested', () => {
    const options = { table: 'documents', columns: ['id', 'title'] };
    const legacy = buildResourceListQueryPlan(options);
    expect(legacy).toEqual({
      sql: 'SELECT * FROM "documents" LIMIT ? OFFSET ?', params: [], limit: 100, offset: 0,
    });
    expect(buildResourceListQueryPlan({ ...options, includeTotal: false })).toEqual(legacy);
    expect(buildResourceListQueryPlan({ ...options, includeTotal: true })).toMatchObject({
      countSql: 'SELECT COUNT(*) AS total FROM "documents"', params: [],
    });
  });

  test('counts the exact same authorized predicate with no sort, projection or pagination effect', () => {
    const plan = buildResourceListQueryPlan({
      table: 'documents', columns: ['id', 'title', 'tenant_id', 'owner_id'],
      selectColumns: [], filterColumns: ['id', 'title'], sortColumns: ['id'],
      constraints: [
        { type: 'field', field: 'tenant_id', operator: 'eq', value: 'tenant-a' },
        { type: 'field', field: 'owner_id', operator: 'eq', value: 'owner-1' },
      ],
      query: { search: 'report', searchField: ['title'], sort: ['id:desc'], limit: 1, offset: 2 },
      includeTotal: true,
    });
    expect(plan).not.toHaveProperty('error');
    if ('error' in plan) throw new Error(plan.error);
    expect(plan.countSql).toBe('SELECT COUNT(*) AS total FROM "documents" WHERE ("title" LIKE ? ESCAPE \'\\\') AND (typeof("tenant_id") = typeof(?) AND "tenant_id" COLLATE BINARY IS ?) AND (typeof("owner_id") = typeof(?) AND "owner_id" COLLATE BINARY IS ?)');
    expect(plan.params).toEqual(['%report%', 'tenant-a', 'tenant-a', 'owner-1', 'owner-1']);
    const db = new Database(':memory:');
    try {
      db.exec('CREATE TABLE documents (id TEXT PRIMARY KEY, title TEXT, tenant_id TEXT, owner_id TEXT)');
      const insert = db.prepare('INSERT INTO documents VALUES (?,?,?,?)');
      try {
        insert.run('a', 'Report one', 'tenant-a', 'owner-1');
        insert.run('b', 'Report two', 'tenant-a', 'owner-1');
        insert.run('c', 'Report different owner', 'tenant-a', 'owner-2');
        insert.run('d', 'Report different tenant', 'tenant-b', 'owner-1');
        insert.run('e', 'Not matching', 'tenant-a', 'owner-1');
      } finally { insert.finalize(); }
      const count = db.prepare(plan.countSql!);
      const page = db.prepare(plan.sql);
      try {
        expect(count.get(...plan.params)).toEqual({ total: 2 });
        expect(page.all(...plan.params, plan.limit, plan.offset)).toEqual([]);
      } finally { count.finalize(); page.finalize(); }
    } finally { db.close(); }
    expect(buildResourceListQueryPlan({
      table: 'documents', columns: ['id', 'title', 'owner_id'],
      filterColumns: ['id', 'title'], query: { filter: 'owner_id:owner-2' }, includeTotal: true,
    })).toMatchObject({ status: 400 });
  });
});
