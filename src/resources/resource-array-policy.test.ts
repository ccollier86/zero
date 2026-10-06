/** Unit-level admission, SQL planning, composition and row enforcement for exact array policies. */
import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { DATABASE_OPERATION_MAX_STRING_BYTES } from '../databases/database-operations';
import { MemoryEventStore } from '../observability';
import { bindResourceObservabilityOwner } from './resource-observability';
import { defineResource } from './resource-definition';
import { createResourceRegistry } from './resource-registry';
import { ResourceSyncPolicyService } from './resource-sync-policy';
import { matchesResourceDataConstraints } from './resource-constraint-matcher';
import { normalizeResourceDataConstraints } from './resource-policy-output-validation';
import { allOf, anyOf, customPolicy, evaluateResourcePolicy } from './resource-policy';
import type { ResourceDataConstraint, ResourcePolicyContext } from './resource-policy';
import { buildResourceListFindPlan, buildResourceListQueryPlan } from './resource-query';

const columns = ['id', 'tenant_id', 'title', '_access_groups_json'];
const overlap = (value: readonly string[]): ResourceDataConstraint => ({
  type: 'field', field: '_access_groups_json', operator: 'arrayOverlaps', value,
});
const tenant: ResourceDataConstraint = { type: 'field', field: 'tenant_id', operator: 'eq', value: 'org-a' };
const fixtureResource = { table: 'documents', primaryKey: 'id' };
bindResourceObservabilityOwner(fixtureResource, {
  sink: { emit() {} }, store: null, config: { console: false, store: false },
});
const context = (input: Partial<ResourcePolicyContext> = {}): ResourcePolicyContext => ({
  action: 'list', user: null, resource: fixtureResource, authConfig: { userProperties: {} }, ...input,
});

describe('resource array authorization', () => {
  test('SQL filters before sorting/paging/counting and does not expose hidden policy fields', () => {
    const db = new Database(':memory:');
    try {
      db.exec('CREATE TABLE documents (id TEXT PRIMARY KEY, tenant_id TEXT, title TEXT, _access_groups_json TEXT COLLATE NOCASE)');
      const insert = db.query('INSERT INTO documents VALUES (?, ?, ?, ?)');
      for (const row of [
        ['hidden', 'org-a', '01 Hidden', '["B"]'],
        ['a', 'org-a', '02 Visible', '["A"]'],
        ['ab', 'org-a', '03 Visible', '["B","A","A"]'],
        ['empty', 'org-a', '04 Hidden', '[]'],
        ['foreign', 'org-b', '05 Visible', '["A"]'],
      ]) insert.run(...row);
      const input = { table: 'documents', columns, selectColumns: ['id', 'title'], filterColumns: ['title'], sortColumns: ['title'],
        constraints: [tenant, overlap(['A', 'A'])], query: { search: 'Visible', searchField: ['title'], sort: ['title:asc'], limit: 1, offset: 1 } };
      const plan = buildResourceListQueryPlan(input);
      expect(plan).not.toHaveProperty('error');
      if ('error' in plan) throw new Error(plan.error);
      expect(db.query(plan.sql).all(...plan.params, plan.limit, plan.offset)).toEqual([{ id: 'ab', title: '03 Visible' }]);
      const countSql = plan.sql.replace(/^SELECT .* FROM /u, 'SELECT count(*) AS total FROM ').replace(/ ORDER BY .* LIMIT \? OFFSET \?$/u, '');
      expect(db.query(countSql).get(...plan.params)).toEqual({ total: 2 });
      const widened = buildResourceListQueryPlan({ ...input, query: { filter: 'title:contains:Hidden' } });
      if ('error' in widened) throw new Error(widened.error);
      expect(db.query(widened.sql).all(...widened.params, widened.limit, widened.offset)).toEqual([]);
      const hiddenFilter = buildResourceListQueryPlan({ ...input, query: { filter: '_access_groups_json:contains:A' } });
      expect(hiddenFilter).toMatchObject({ status: 400 });
    } finally { db.close(); }
  });

  test('SQL and row evaluation agree for exact strings and deny the whole malformed retained shape', () => {
    const db = new Database(':memory:');
    const values: readonly unknown[] = [
      '["B","A"]', '["A","A"]', '[]', null, 'null', 'broken', '{}', '"A"', '1',
      '["A",1]', '["A",false]', '["A",null]', '["A",["B"]]', '["A",{}]', '["a"]', '["AB"]', '[""]',
      JSON.stringify(['quote"slash\\']), JSON.stringify(['nul\u0000tail']),
    ];
    try {
      db.exec('CREATE TABLE documents (id TEXT PRIMARY KEY, tenant_id TEXT, title TEXT, _access_groups_json TEXT COLLATE NOCASE)');
      values.forEach((value, index) => db.query('INSERT INTO documents VALUES (?, ?, ?, ?)').run(String(index), 'org-a', 'row', value as string | null));
      for (const permitted of [['A'], [''], ['quote"slash\\'], ['nul\u0000tail'], [], ['A', 'A']]) {
        const constraints = normalizeResourceDataConstraints([overlap(permitted)]);
        const plan = buildResourceListQueryPlan({ table: 'documents', columns, constraints, query: { sort: ['id:asc'] } });
        if ('error' in plan) throw new Error(plan.error);
        const actual = db.query(plan.sql).all(...plan.params, plan.limit, plan.offset).map(row => (row as { id: string }).id).sort();
        const expected = values.flatMap((value, index) => matchesResourceDataConstraints({ _access_groups_json: value }, constraints) ? [String(index)] : []).sort();
        expect(actual).toEqual(expected);
      }
      const constraints = normalizeResourceDataConstraints([overlap(['A'])]);
      expect(matchesResourceDataConstraints({ _access_groups_json: ['B', 'A'] }, constraints)).toBeTrue();
      expect(matchesResourceDataConstraints({ _access_groups_json: ['A', 1] }, constraints)).toBeFalse();
      expect(matchesResourceDataConstraints({}, constraints)).toBeFalse();
    } finally { db.close(); }
  });

  test('keeps overlap operators and group logic in the actor find plan with no scalar rewrite', () => {
    const constraints: ResourceDataConstraint[] = [{ type: 'allOf', constraints: [tenant, { type: 'anyOf', constraints: [overlap(['A']), overlap(['B'])] }] }];
    const result = buildResourceListFindPlan({ table: 'documents', columns, selectColumns: ['id', 'title'], constraints,
      query: { search: 'visible', searchField: ['title'], sort: ['title:desc'], limit: 10 } });
    expect(result).not.toHaveProperty('error');
    if ('error' in result) throw new Error(result.error);
    expect(result.input.filters).toEqual([
      { type: 'anyOf', filters: [{ type: 'field', field: 'title', operator: 'contains', value: 'visible' }] },
      { type: 'allOf', filters: [
        { type: 'field', field: 'tenant_id', operator: 'eq', value: 'org-a', match: 'exact' },
        { type: 'anyOf', filters: [
          { type: 'field', field: '_access_groups_json', operator: 'arrayOverlaps', value: ['A'] },
          { type: 'field', field: '_access_groups_json', operator: 'arrayOverlaps', value: ['B'] },
        ] },
      ] },
    ]);
    expect(result.input.select).toEqual(['id', 'title']);
  });

  test('enforces returned constraints for get/update/delete before client projection or mutation', async () => {
    const policy = customPolicy(() => ({ allowed: true, constraints: [overlap(['A'])] }));
    for (const action of ['get', 'update', 'delete'] as const) {
      expect(await evaluateResourcePolicy(policy, context({ action, row: { _access_groups_json: '["B","A"]' } }))).toMatchObject({ allowed: true });
      expect(await evaluateResourcePolicy(policy, context({ action, row: { _access_groups_json: '["B"]' } }))).toMatchObject({ allowed: false, status: 403 });
      expect(await evaluateResourcePolicy(policy, context({ action }))).toMatchObject({ allowed: false, status: 403 });
    }
    expect(await evaluateResourcePolicy(policy, context())).toMatchObject({ allowed: true, constraints: [overlap(['A'])] });
  });

  test('composes overlap and equality without broadening OR branches or tenant fences', async () => {
    const group = customPolicy(() => ({ allowed: true, constraints: [overlap(['A'])] }));
    const owner = customPolicy(() => ({ allowed: true, constraints: [{ type: 'field', field: 'owner_id', operator: 'eq', value: 'user-a' }] }));
    const organization = customPolicy(() => ({ allowed: true, constraints: [tenant] }));
    const policy = allOf(organization, anyOf(group, owner));
    expect(await evaluateResourcePolicy(policy, context({ action: 'get', row: { tenant_id: 'org-a', _access_groups_json: '["B"]', owner_id: 'user-a' } }))).toMatchObject({ allowed: true });
    expect(await evaluateResourcePolicy(policy, context({ action: 'get', row: { tenant_id: 'org-b', _access_groups_json: '["A"]', owner_id: 'user-a' } }))).toMatchObject({ allowed: false });
    expect(await evaluateResourcePolicy(policy, context({ action: 'get', row: { tenant_id: 'org-a', _access_groups_json: '["B"]', owner_id: 'user-b' } }))).toMatchObject({ allowed: false });
  });

  test('detaches and deeply freezes policy arrays before fingerprints and later row checks', async () => {
    const permitted = ['A'];
    const authored = [overlap(permitted)];
    const result = await evaluateResourcePolicy(customPolicy(() => ({ allowed: true, constraints: authored })), context());
    permitted.push('B'); authored.push(overlap(['B']));
    expect(result.constraints).toEqual([overlap(['A'])]);
    expect(Object.isFrozen(result.constraints)).toBeTrue();
    expect(Object.isFrozen(result.constraints?.[0])).toBeTrue();
    expect(Object.isFrozen((result.constraints?.[0] as { value: unknown }).value)).toBeTrue();
    expect(matchesResourceDataConstraints({ _access_groups_json: '["B"]' }, result.constraints!)).toBeFalse();
  });

  test('Sync composes immutable filters and private-field projection with authority fingerprints', async () => {
    let permitted = ['A'];
    const store = new MemoryEventStore();
    const registry = createResourceRegistry({
      resources: [defineResource({ table: 'documents', realm: 'global', exposure: 'sync',
        fields: { read: ['id', 'title'], update: ['title'] },
        policy: customPolicy(() => ({ allowed: true, constraints: [overlap(permitted)] })),
      })],
      tables: { documents: { id: 'TEXT PRIMARY KEY', title: 'TEXT', _access_groups_json: 'TEXT' } },
      authConfig: { userProperties: {} },
      observability: { sink: store, store, config: { console: false, store } },
    });
    const service = new ResourceSyncPolicyService({ registry, authConfig: { userProperties: {} } });
    const first = await service.resolveTableAccess({ tableNames: ['documents'], authContext: null });
    const row = { id: 'a', title: 'Visible', _access_groups_json: '["A"]' };
    expect(first.rowFilters?.get('documents')?.matches(row)).toBeTrue();
    expect(first.rowProjectors?.get('documents')?.project(row)).toEqual({ id: 'a', title: 'Visible' });
    permitted.push('B');
    expect(first.rowFilters?.get('documents')?.matches({ ...row, _access_groups_json: '["B"]' })).toBeFalse();
    permitted = ['B'];
    const narrowed = await service.resolveTableAccess({ tableNames: ['documents'], authContext: null });
    expect(narrowed.policyFingerprint).not.toBe(first.policyFingerprint);
    expect(narrowed.rowFilters?.get('documents')?.matches(row)).toBeFalse();
    expect(await service.authorizeMutation({ table: 'documents', op: 'DELETE', rowId: 'a', authContext: null, loadRow: () => row })).toMatchObject({ ok: false });
    expect(await service.authorizeMutation({ table: 'documents', op: 'UPDATE', rowId: 'b', row: { title: 'Changed' }, authContext: null,
      loadRow: () => ({ ...row, id: 'b', _access_groups_json: '["B"]' }) })).toMatchObject({ ok: true, expectedRow: { _access_groups_json: '["B"]' } });
    permitted = ['B', 1] as never;
    const invalid = await service.resolveTableAccess({ tableNames: ['documents'], authContext: null });
    expect(invalid.readableTables.has('documents')).toBeFalse();
  });

  test('invalid operators, values, groups and top-level shapes are safe configuration failures in both planners', async () => {
    const invalid: unknown[] = [null, {}, 'bad', [null],
      [{ type: 'field', field: '_access_groups_json', operator: 'ne', value: ['A'] }],
      [{ type: 'field', field: '_access_groups_json', operator: 'unknown', value: ['A'] }],
      [overlap(['A', 1] as never)], [overlap(Array.from({ length: 51 }, () => 'A'))], [overlap(['x'.repeat(1025)])],
      [{ type: 'field', field: '_access_groups_json', operator: 'arrayOverlaps', value: 'A' }],
      [{ type: 'field', field: 'id', operator: 'eq', value: [] }],
      [{ type: 'anyOf', constraints: [] }], [{ type: 'allOf', constraints: null }], [{ type: 'unknown', constraints: [overlap(['A'])] }],
    ];
    for (const constraints of invalid) {
      const input = { table: 'documents', columns, constraints: constraints as ResourceDataConstraint[] };
      expect(buildResourceListQueryPlan(input)).toMatchObject({ status: 500 });
      expect(buildResourceListFindPlan(input)).toMatchObject({ status: 500 });
      const policy = customPolicy(() => ({ allowed: true, constraints } as never));
      expect(await evaluateResourcePolicy(policy, context())).toMatchObject({ allowed: false, status: 500, reason: 'policy-invalid' });
      expect(await evaluateResourcePolicy(anyOf(customPolicy(() => true), policy), context())).toMatchObject({ allowed: false, status: 500, reason: 'policy-invalid' });
    }
  });

  test('never invokes getters or proxy traps while admitting hostile policy and row arrays', async () => {
    let reads = 0;
    const accessor = [{ type: 'field', field: '_access_groups_json', operator: 'arrayOverlaps', get value() { reads++; return ['A']; } }];
    const values = ['A']; Object.defineProperty(values, '0', { enumerable: true, get() { reads++; return 'A'; } });
    const constraints = [overlap(['A'])]; Object.defineProperty(constraints, '0', { enumerable: true, get() { reads++; return overlap(['A']); } });
    const extended = ['A'] as string[] & { extension?: string }; extended.extension = 'unsafe';
    for (const value of [accessor, [overlap(values)], constraints, [overlap(new Array(1))], [overlap(extended)],
      new Proxy([overlap(['A'])], { get() { reads++; return undefined; }, ownKeys() { reads++; return []; } })]) {
      expect(() => normalizeResourceDataConstraints(value)).toThrow();
    }
    const output = { get allowed() { reads++; return true; } };
    expect(await evaluateResourcePolicy(customPolicy(() => output as never), context())).toMatchObject({ reason: 'policy-invalid' });
    const row = { get _access_groups_json() { reads++; return ['A']; } };
    expect(matchesResourceDataConstraints(row, normalizeResourceDataConstraints([overlap(['A'])]))).toBeFalse();
    expect(reads).toBe(0);
  });

  test('rejects noncanonical scalar policies before SQL/Fabric planning or anyOf broadening', async () => {
    for (const value of [-0, '\ud800', '\udc00', 'x'.repeat(DATABASE_OPERATION_MAX_STRING_BYTES + 1)]) {
      const constraints: ResourceDataConstraint[] = [{
        type: 'field', field: 'title', operator: 'eq', value,
      }];
      expect(() => normalizeResourceDataConstraints(constraints))
        .toThrow('Resource equality constraints require a bounded canonical scalar value.');
      const input = { table: 'documents', columns, constraints };
      expect(buildResourceListQueryPlan(input)).toMatchObject({ status: 500 });
      expect(buildResourceListFindPlan(input)).toMatchObject({ status: 500 });
      const policy = customPolicy(() => ({ allowed: true, constraints }));
      expect(await evaluateResourcePolicy(policy, context()))
        .toMatchObject({ allowed: false, status: 500, reason: 'policy-invalid' });
      expect(await evaluateResourcePolicy(anyOf(customPolicy(() => true), policy), context()))
        .toMatchObject({ allowed: false, status: 500, reason: 'policy-invalid' });
    }
  });

  test('bounds the complete policy payload before SQL/Fabric/Sync or anyOf admission', async () => {
    const aggregate: ResourceDataConstraint[] = Array.from({ length: 4 }, () => ({
      type: 'field', field: 'title', operator: 'eq',
      value: 'x'.repeat(DATABASE_OPERATION_MAX_STRING_BYTES),
    }));
    let deep: ResourceDataConstraint = overlap(['A']);
    for (let index = 0; index < 8; index++) deep = { type: 'allOf', constraints: [deep] };
    for (const constraints of [aggregate, [deep]]) {
      expect(() => normalizeResourceDataConstraints(constraints))
        .toThrow('Resource policy constraint payload exceeds canonical database bounds.');
      const input = { table: 'documents', columns, constraints };
      expect(buildResourceListQueryPlan(input)).toMatchObject({ status: 500 });
      expect(buildResourceListFindPlan(input)).toMatchObject({ status: 500 });
      const policy = customPolicy(() => ({ allowed: true, constraints }));
      expect(await evaluateResourcePolicy(policy, context()))
        .toMatchObject({ allowed: false, status: 500, reason: 'policy-invalid' });
      expect(await evaluateResourcePolicy(anyOf(customPolicy(() => true), policy), context()))
        .toMatchObject({ allowed: false, status: 500, reason: 'policy-invalid' });
      const registry = createResourceRegistry({
        resources: [defineResource({ table: 'documents', realm: 'global', exposure: 'sync', policy })],
        tables: { documents: { id: 'TEXT PRIMARY KEY', title: 'TEXT', _access_groups_json: 'TEXT' } },
        authConfig: { userProperties: {} },
        observability: { sink: { emit() {} }, store: null, config: { console: false, store: false } },
      });
      const service = new ResourceSyncPolicyService({ registry, authConfig: { userProperties: {} } });
      expect((await service.resolveTableAccess({ tableNames: ['documents'], authContext: null }))
        .readableTables.has('documents')).toBeFalse();
    }
    expect(normalizeResourceDataConstraints([{ type: 'field', field: 'title', operator: 'eq',
      value: 'x'.repeat(DATABASE_OPERATION_MAX_STRING_BYTES) }])).toHaveLength(1);
  });

  test('bounds nodes, depth and parameters without coercing a malformed policy to allOf', () => {
    expect(() => normalizeResourceDataConstraints(Array.from({ length: 65 }, () => overlap([])))).toThrow();
    let nested: ResourceDataConstraint = overlap(['A']);
    for (let index = 0; index < 9; index++) nested = { type: 'anyOf', constraints: [nested] };
    expect(() => normalizeResourceDataConstraints([nested])).toThrow();
    expect(() => normalizeResourceDataConstraints(Array.from({ length: 6 }, () => overlap(Array.from({ length: 50 }, () => 'A'))))).toThrow();
    expect(normalizeResourceDataConstraints([overlap([])])).toEqual([overlap([])]);
  });

  test('bounds caller and policy predicates together identically on both database planes', () => {
    const constraints = Array.from({ length: 5 }, () => overlap(Array.from({ length: 50 }, () => 'A')));
    const valid = { table: 'documents', columns, constraints, query: { filter: Array.from({ length: 4 }, () => 'title:eq:A') } };
    expect(buildResourceListQueryPlan(valid)).not.toHaveProperty('error');
    expect(buildResourceListFindPlan(valid)).not.toHaveProperty('error');
    const invalid = { ...valid, query: { filter: Array.from({ length: 5 }, () => 'title:eq:A') } };
    expect(buildResourceListQueryPlan(invalid)).toMatchObject({ status: 400 });
    expect(buildResourceListFindPlan(invalid)).toMatchObject({ status: 400 });
    const tooManyNodes = { table: 'documents', columns, constraints: Array.from({ length: 64 }, () => overlap([])), query: { filter: 'title:eq:A' } };
    expect(buildResourceListQueryPlan(tooManyNodes)).toMatchObject({ status: 400 });
    expect(buildResourceListFindPlan(tooManyNodes)).toMatchObject({ status: 400 });
  });

  test('keeps scalar equality and canonical boolean representations intact', () => {
    for (const value of [true, 1, '1', 'true']) {
      expect(matchesResourceDataConstraints({ flag: value }, normalizeResourceDataConstraints([{ type: 'field', field: 'flag', operator: 'eq', value: true }]))).toBeTrue();
    }
    expect(matchesResourceDataConstraints({ owner: '1' }, normalizeResourceDataConstraints([{ type: 'field', field: 'owner', operator: 'eq', value: 1 }]))).toBeFalse();
    expect(matchesResourceDataConstraints({ owner: 'USER' }, normalizeResourceDataConstraints([{ type: 'field', field: 'owner', operator: 'eq', value: 'user' }]))).toBeFalse();
  });

  test('reports invalid configuration through the owning safe sink without scope values', async () => {
    const store = new MemoryEventStore();
    const resource = { table: 'documents', primaryKey: 'id' };
    bindResourceObservabilityOwner(resource, { sink: store, store, config: { console: false, store } });
    const secret = 'PRIVATE_GROUP_SCOPE_SENTINEL';
    const policy = customPolicy(() => ({ allowed: true, constraints: [overlap([secret, 1] as never)] }));
    const result = await evaluateResourcePolicy(policy, context({ resource }));
    expect(result).toMatchObject({ allowed: false, status: 500, reason: 'policy-invalid' });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(store.query().events.length).toBeGreaterThan(0);
    expect(JSON.stringify(store.query().events)).not.toContain(secret);
  });
});
