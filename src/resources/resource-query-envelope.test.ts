/** Complete query admission and trusted-schema policy validation on both read planes. */
import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { DATABASE_OPERATION_MAX_STRING_BYTES } from '../databases/database-operations';
import { MemoryEventStore } from '../observability';
import { defineResource } from './resource-definition';
import { anyOf, customPolicy, evaluateResourcePolicy } from './resource-policy';
import type { ResourceDataConstraint, ResourcePolicyContext } from './resource-policy-types';
import { normalizeResourceDataConstraints } from './resource-policy-output-validation';
import { buildResourceListFindPlan, buildResourceListQueryPlan, type ResourceListQueryPlanOptions } from './resource-query';
import { createResourceRegistry } from './resource-registry';
import { ResourceSyncPolicyService } from './resource-sync-policy';

const columns = ['id', 'title', '_access_groups_json'];
const base: ResourceListQueryPlanOptions = { table: 'documents', columns };
const scalar = (value: string): ResourceDataConstraint => ({ type: 'field', field: 'title', operator: 'eq', value });
const planners = [buildResourceListQueryPlan, buildResourceListFindPlan];
const sink = new MemoryEventStore();
const observability = { sink, store: sink, config: { console: false, store: sink } };

describe('resource complete query envelope', () => {
  test('admits policy and caller fragments together under the canonical byte budget', () => {
    const constraints = Array.from({ length: 4 }, (_, index) => scalar('x'.repeat(
      DATABASE_OPERATION_MAX_STRING_BYTES - (index === 3 ? 2_000 : 0),
    )));
    expect(() => normalizeResourceDataConstraints(constraints)).not.toThrow();
    const query = { filter: `id:eq:${'y'.repeat(4_090)}`, sort: ['title:asc'], limit: 20 };
    for (const planner of planners) {
      expect(planner({ ...base, constraints })).not.toHaveProperty('error');
      expect(planner({ ...base, query })).not.toHaveProperty('error');
      expect(planner({ ...base, constraints, query })).toMatchObject({
        status: 400, error: 'Resource query payload exceeds canonical database bounds or contains non-canonical values.',
      });
      const smaller = [...constraints.slice(0, 3), scalar('x'.repeat(DATABASE_OPERATION_MAX_STRING_BYTES - 10_000))];
      expect(planner({ ...base, constraints: smaller, query })).not.toHaveProperty('error');
    }
  });

  test('counts the FIND envelope depth, not only the standalone constraint tree', () => {
    let constraint = scalar('allowed');
    for (let index = 0; index < 7; index++) constraint = { type: 'allOf', constraints: [constraint] };
    expect(() => normalizeResourceDataConstraints([constraint])).not.toThrow();
    for (const planner of planners) expect(planner({ ...base, constraints: [constraint] })).toMatchObject({ status: 400 });
    const shallower = constraint.type === 'field' ? constraint : constraint.constraints[0]!;
    for (const planner of planners) expect(planner({ ...base, constraints: [shallower] })).not.toHaveProperty('error');
  });

  test('rejects noncanonical caller strings and numbers consistently without exposing values', () => {
    for (const query of [
      { filter: 'title:eq:private\ud800value' },
      { search: 'private\ud800value', searchField: ['title'] },
      { offset: -0 },
    ]) {
      for (const planner of planners) {
        const result = planner({ ...base, query });
        expect(result).toMatchObject({ status: 400 });
        if ('error' in result) expect(result.error).not.toContain('private');
      }
    }
    for (const planner of planners) {
      expect(planner({ ...base, query: { filter: 'title:eq:-0' } })).not.toHaveProperty('error');
      expect(planner({ ...base, constraints: [scalar('private\ud800value')] })).toMatchObject({ status: 500 });
    }
  });

  test('preserves empty SQL projections and configured default-database page caps', () => {
    const plan = buildResourceListQueryPlan({ ...base, selectColumns: [], maxLimit: 2_000, query: { limit: 1_500 } });
    expect(plan).not.toHaveProperty('error');
    if ('error' in plan) throw new Error(plan.error);
    expect(plan.limit).toBe(1_500);
    expect(plan.sql).toStartWith('SELECT 1 AS "__zero_empty"');
    const db = new Database(':memory:');
    try {
      db.exec('CREATE TABLE documents (id TEXT PRIMARY KEY, title TEXT, _access_groups_json TEXT); INSERT INTO documents VALUES (\'a\', \'Visible\', \'["A"]\')');
      expect(db.query(plan.sql).all(...plan.params, plan.limit, plan.offset)).toEqual([{ __zero_empty: 1 }]);
    } finally { db.close(); }
    expect(buildResourceListFindPlan({ ...base, maxLimit: 2_000, query: { limit: 1_500 } })).toMatchObject({ status: 400 });
  });
});

describe('resource trusted column admission', () => {
  const unknown = customPolicy(() => ({ allowed: true, constraints: [{
    type: 'allOf' as const, constraints: [{ type: 'field' as const, field: 'not_a_column', operator: 'arrayOverlaps' as const, value: ['A'] }],
  }] }));
  const policy = anyOf(customPolicy(() => true), unknown);
  const createRegistry = (activePolicy = policy) => createResourceRegistry({
    resources: [defineResource({ table: 'documents', realm: 'global', exposure: 'all',
      fields: { read: ['id', 'title'], update: ['title'] }, policy: activePolicy })],
    tables: { documents: { id: 'TEXT PRIMARY KEY', title: 'TEXT', _access_groups_json: 'TEXT' } },
    authConfig: { userProperties: {} }, observability,
  });

  test('unknown columns cannot hide inside an unconstrained OR branch for any action', async () => {
    const resource = createRegistry().getByTable('documents')!;
    for (const action of ['list', 'get', 'create', 'update', 'delete'] as const) {
      const context: ResourcePolicyContext = { action, user: null, resource,
        row: { id: 'a', title: 'Visible', not_a_column: '["A"]' }, authConfig: { userProperties: {} } };
      expect(await evaluateResourcePolicy(policy, context)).toMatchObject({
        allowed: false, reason: 'policy-invalid', status: 500,
        message: 'Resource policy constraint references an unknown table column.',
      });
    }
    // Standalone callers with no trusted catalog retain the old, explicit contract.
    expect(await evaluateResourcePolicy(policy, { action: 'list', user: null,
      resource: { table: 'documents', primaryKey: 'id' }, authConfig: { userProperties: {} } })).toMatchObject({ allowed: true });
  });

  test('Sync cannot make a table readable or mutate it with a masked invalid branch', async () => {
    const service = new ResourceSyncPolicyService({ registry: createRegistry(), authConfig: { userProperties: {} } });
    const access = await service.resolveTableAccess({ tableNames: ['documents'], authContext: null });
    expect(access.readableTables.has('documents')).toBeFalse();
    expect(access.rowFilters?.has('documents')).toBeFalse();
    for (const op of ['UPDATE', 'DELETE'] as const) {
      const result = await service.authorizeMutation({ table: 'documents', op, rowId: 'a',
        row: op === 'UPDATE' ? { title: 'Changed' } : undefined, authContext: null,
        loadRow: () => ({ id: 'a', title: 'Visible', not_a_column: '["A"]' }) });
      expect(result).toMatchObject({ ok: false, code: 'policy-invalid' });
    }
  });

  test('registered catalogs are immutable snapshots and include hidden server policy columns', async () => {
    const table = { id: 'TEXT PRIMARY KEY', title: 'TEXT', _access_groups_json: 'TEXT' };
    const valid = customPolicy(() => ({ allowed: true, constraints: [{
      type: 'field' as const, field: '_access_groups_json', operator: 'arrayOverlaps' as const, value: ['A'],
    }] }));
    const registry = createResourceRegistry({ resources: [defineResource({ table: 'documents', realm: 'global', exposure: 'all',
      fields: { read: ['id', 'title'] }, policy: valid })], tables: { documents: table }, authConfig: { userProperties: {} }, observability });
    const resource = registry.getByTable('documents')!;
    expect(resource.columns).toEqual(columns);
    expect(Object.isFrozen(resource.columns)).toBeTrue();
    Object.assign(table, { later: 'TEXT' });
    delete (table as Partial<typeof table>)._access_groups_json;
    expect(resource.columns).toEqual(columns);
    expect(await evaluateResourcePolicy(valid, { action: 'get', user: null, resource,
      row: { id: 'a', title: 'Visible', _access_groups_json: '["A"]' }, authConfig: { userProperties: {} } })).toMatchObject({ allowed: true });
    const access = await new ResourceSyncPolicyService({ registry, authConfig: { userProperties: {} } })
      .resolveTableAccess({ tableNames: ['documents'], authContext: null });
    const row = { id: 'a', title: 'Visible', _access_groups_json: '["A"]' };
    expect(access.rowFilters?.get('documents')?.matches(row)).toBeTrue();
    expect(access.rowProjectors?.get('documents')?.project(row)).toEqual({ id: 'a', title: 'Visible' });
  });

  test('legacy mutable authored groups remain type-compatible and detach before freezing', async () => {
    const group: ResourceDataConstraint = { type: 'anyOf', constraints: [] };
    group.constraints.push(scalar('one'));
    const resource = createRegistry().getByTable('documents')!;
    const decision = await evaluateResourcePolicy(customPolicy(() => ({ allowed: true, constraints: [group] })),
      { action: 'list', user: null, resource, authConfig: { userProperties: {} } });
    group.constraints.push(scalar('two'));
    expect(group.constraints).toHaveLength(2);
    expect((decision.constraints?.[0] as typeof group).constraints).toHaveLength(1);
    expect(Object.isFrozen((decision.constraints?.[0] as typeof group).constraints)).toBeTrue();
  });
});
