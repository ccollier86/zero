/** Native memory-only catalog qualification; no physical fixtures, actors or output. */
import { Database, type SQLQueryBindings } from 'bun:sqlite';
import { expect, spyOn, test } from 'bun:test';
import type { DatabaseSerializableValue } from '../databases/database-operations';
import { createDatabaseReadQuerySession, withDatabaseReadQuerySession } from '../databases/database-read-query-capability';
import { runDatabaseRealmCommand, runDatabaseRealmQuery } from '../databases/database-realm';
import { createReactiveDB } from '../sync/reactive-db';
import type { CalendarActor } from './contracts';
import { CalendarError, readCalendarRejection, type CalendarErrorCode } from './error';
import { calendarRealm } from './realm';
import { CALENDAR_LIMITS } from './realm-model';
import { calendarHash, calendarJson } from './validation';

const owner: CalendarActor = { scopeId: 'tenant:synthetic-types', userId: 'owner', principal: 'owner-session', manageAll: false, createOwn: true };
const manager: CalendarActor = { ...owner, userId: 'manager', principal: 'manager-session', manageAll: true };
const reader: CalendarActor = { ...owner, userId: 'reader', principal: 'reader-session', createOwn: false };
const fields = { label: 'PRIVATE_TYPE', durationMinutes: 60, bufferBeforeMinutes: 5, bufferAfterMinutes: 10, colorKey: 'type:blue', active: true };
function fixture() {
  const db = createReactiveDB({ mode: 'memory' });
  try {
    const raw = db.getRawDatabase(); raw.run('PRAGMA temp_store=MEMORY');
    for (const [name, schema] of Object.entries(calendarRealm.tables)) db.defineTable(name, schema);
    for (const migration of calendarRealm.migrations) migration.up(raw);
    const command = (name: string, input: unknown): any => (runDatabaseRealmCommand(calendarRealm, db, 'calendar.' + name, input as DatabaseSerializableValue) as any).value;
    const plans: { sql: string; detail: string; rows: number }[] = [];
    const query = (name: string, input: unknown, recordPlans = false): any => {
      const copy = Database.deserialize(raw.serialize(), { readonly: true, strict: true }), prepare = copy.prepare.bind(copy);
      const observer = recordPlans ? spyOn(copy, 'prepare').mockImplementation(<TRow, TParams extends SQLQueryBindings | SQLQueryBindings[]>(sql: string, parameters?: TParams) => {
        const statement = prepare<TRow, TParams>(sql, parameters);
        return new Proxy(statement, { get(target, key) {
          const member = Reflect.get(target, key);
          if (key === 'all' && sql.includes('FROM calendar_types')) return (...params: never[]) => {
            const result = member.apply(target, params), explain = prepare('EXPLAIN QUERY PLAN ' + sql);
            try { plans.push({ sql, detail: (explain.all(...params) as { detail: string }[]).map(row => row.detail).join('\n'), rows: result.length }); }
            finally { explain.finalize(); }
            return result;
          };
          return typeof member === 'function' ? member.bind(target) : member;
        } });
      }) : null;
      try {
        copy.run('PRAGMA temp_store=MEMORY');
        return withDatabaseReadQuerySession(createDatabaseReadQuerySession(copy), context => runDatabaseRealmQuery(calendarRealm, context, 'calendar.' + name, input as DatabaseSerializableValue));
      } finally { observer?.mockRestore(); copy.close(); }
    };
    command('owner.bind', { ownerId: 'synthetic-owner', scopeId: owner.scopeId });
    const resource = (id = 'person', resourceOwner: string | null = owner.userId) => command('resource.create', { actor: manager, requestId: 'resource-' + id,
      id, label: 'PRIVATE_RESOURCE_' + id, kind: resourceOwner ? 'person' : 'room', ownerId: resourceOwner, timeZone: 'UTC' });
    const type = (id = 'type', overrides: Record<string, unknown> = {}) => command('type.create', { actor: manager, requestId: 'type-' + id, id, ...fields, ...overrides });
    const replace = (id = 'type', overrides: Record<string, unknown> = {}) => command('type.replace', { actor: manager, requestId: 'replace-' + id + '-' + db.currentSeq,
      id, expectedRevision: db.get('calendar_types', id)!.revision, ...fields, ...overrides });
    const policy = (id: string, mode: string, typeIds: string[], overrides: Record<string, unknown> = {}) => command('resource.types', { actor: manager,
      requestId: 'policy-' + id + '-' + db.currentSeq, id, expectedRevision: db.get('calendar_resources', id)!.revision, mode, typeIds, ...overrides });
    const grant = (id: string, grants: string[], subject = reader) => command('resource.grant', { actor: manager, requestId: 'grant-' + id + '-' + db.currentSeq,
      id, expectedRevision: db.get('calendar_resources', id)!.revision, userId: subject.userId, grants });
    const snapshot = () => Object.fromEntries(Object.keys(calendarRealm.tables).map(table => [table, raw.query(`SELECT * FROM ${table} ORDER BY id`).all()]));
    return { db, raw, command, query, plans, resource, type, replace, policy, grant, snapshot, close: () => db.dispose() };
  } catch (error) { db.dispose(); throw error; }
}
function rejects(run: () => unknown, code: CalendarErrorCode): void {
  try { run(); throw new Error('Expected calendar rejection'); }
  catch (error) { expect((error instanceof CalendarError ? error : readCalendarRejection(error))?.code).toBe(code); }
}

test('catalog is empty by default and full type replacement preserves immutable historical interpretation', () => {
  const f = fixture();
  try {
    expect(f.query('types', { actor: manager })).toEqual({ items: [], truncated: false, nextAfter: null });
    const create = { actor: manager, id: 'type', requestId: 'create', label: 'PRIVATE_ORIGINAL', durationMinutes: 60 };
    const receipt = f.command('type.create', create), seq = f.db.currentSeq;
    expect(f.command('type.create', create)).toEqual(receipt); expect(f.db.currentSeq).toBe(seq);
    expect(f.query('type', { actor: manager, id: 'type' })).toEqual({ id: 'type', revision: 1, label: 'PRIVATE_ORIGINAL', durationMinutes: 60, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, colorKey: null, active: true });
    rejects(() => f.command('type.create', { ...create, label: 'changed' }), 'CALENDAR_INTENT_CONFLICT');
    rejects(() => f.command('type.create', { ...create, requestId: 'duplicate' }), 'CALENDAR_INTENT_CONFLICT');
    rejects(() => f.replace('type', { expectedRevision: 2 }), 'CALENDAR_REVISION_CONFLICT');
    const change = { actor: manager, id: 'type', requestId: 'change', expectedRevision: 1, ...fields, label: 'PRIVATE_RENAMED', active: false };
    const accepted = f.command('type.replace', change), changedSeq = f.db.currentSeq;
    expect(accepted).toEqual({ requestId: 'change', operation: 'type.updated', id: 'type', revision: 2, changed: true });
    expect(f.command('type.replace', change)).toEqual(accepted); expect(f.db.currentSeq).toBe(changedSeq);
    expect(f.command('type.replace', { ...change, requestId: 'noop', expectedRevision: 2 })).toMatchObject({ revision: 2, changed: false });
    expect(f.raw.query('SELECT type_revision,label,duration_minutes,buffer_before,buffer_after,color_key,active FROM _calendar_type_history ORDER BY type_revision').all()).toEqual([
      { type_revision: 1, label: 'PRIVATE_ORIGINAL', duration_minutes: 60, buffer_before: 0, buffer_after: 0, color_key: null, active: 1 },
      { type_revision: 2, label: 'PRIVATE_RENAMED', duration_minutes: 60, buffer_before: 5, buffer_after: 10, color_key: 'type:blue', active: 0 },
    ]);
    expect(f.db.list('_calendar_type_receipts')).toHaveLength(3); expect(f.db.list('_calendar_type_effect_intents')).toHaveLength(2);
    expect(f.query('receipt', { actor: manager, requestId: 'change' })).toEqual(accepted);
    expect(JSON.stringify(accepted)).not.toContain('PRIVATE');
  } finally { f.close(); }
});

test('only global managers may write catalogs or admission policies; direct type reads and replay stay manager-only', () => {
  const f = fixture();
  try {
    f.resource(); f.type(); f.grant('person', ['manage']);
    for (const actor of [owner, reader]) {
      rejects(() => f.type('denied', { actor }), 'CALENDAR_FORBIDDEN');
      rejects(() => f.replace('type', { actor }), 'CALENDAR_FORBIDDEN');
      rejects(() => f.policy('person', 'required', ['type'], { actor }), 'CALENDAR_FORBIDDEN');
      rejects(() => f.query('type', { actor, id: 'type' }), 'CALENDAR_FORBIDDEN');
      rejects(() => f.query('type', { actor, id: 'missing' }), 'CALENDAR_FORBIDDEN');
    }
    const accepted = f.policy('person', 'required', ['type'], { requestId: 'policy' });
    const demoted = { ...manager, manageAll: false };
    rejects(() => f.query('receipt', { actor: demoted, requestId: 'type-type' }), 'CALENDAR_FORBIDDEN');
    rejects(() => f.query('receipt', { actor: demoted, requestId: 'policy' }), 'CALENDAR_FORBIDDEN');
    rejects(() => f.policy('person', 'required', ['type'], { actor: demoted, requestId: 'policy', expectedRevision: 2 }), 'CALENDAR_FORBIDDEN');
    expect(f.query('receipt', { actor: manager, requestId: 'policy' })).toEqual(accepted);
  } finally { f.close(); }
});

test('list selection is explicit, intersects all current policies before LIMIT, and never admits busy-only rights', () => {
  const f = fixture();
  try {
    f.resource('first'); f.resource('second', null); f.resource('unrestricted');
    for (const id of ['a-hidden', 'b-common', 'c-first', 'd-common', 'z-inactive']) f.type(id, { active: id !== 'z-inactive' });
    f.policy('first', 'optional', ['b-common', 'c-first', 'd-common']); f.policy('second', 'required', ['a-hidden', 'b-common', 'd-common']);
    expect(f.query('types', { actor: manager }).items).toHaveLength(5);
    for (const actor of [manager, owner, reader]) expect(f.query('types', { actor, resourceIds: [] })).toEqual({ items: [], truncated: false, nextAfter: null });
    for (const actor of [owner, reader]) expect(f.query('types', { actor })).toEqual({ items: [], truncated: false, nextAfter: null });
    f.grant('first', ['busy']); f.grant('second', ['book']);
    rejects(() => f.query('types', { actor: reader, resourceIds: ['first', 'second'], limit: 1 }), 'CALENDAR_NOT_FOUND');
    rejects(() => f.query('resourceTypes', { actor: reader, id: 'first' }), 'CALENDAR_NOT_FOUND');
    for (const right of ['details', 'book', 'manage']) {
      f.grant('first', [right]);
      const page = f.query('types', { actor: reader, resourceIds: ['first', 'second'], limit: 1 });
      expect(page.items.map((value: any) => value.id)).toEqual(['b-common']); expect(page.truncated).toBe(true); expect(page.nextAfter).toBe('b-common');
      expect(f.query('types', { actor: reader, resourceIds: ['first', 'second'], limit: 1, after: page.nextAfter }).items.map((value: any) => value.id)).toEqual(['d-common']);
      expect(f.query('resourceTypes', { actor: reader, id: 'first' })).toMatchObject({ mode: 'optional', typeIds: ['b-common', 'c-first', 'd-common'] });
      expect(JSON.stringify(page)).not.toContain('PRIVATE_RESOURCE'); expect(JSON.stringify(page)).not.toContain('resourceId');
    }
    expect(f.query('types', { actor: owner, resourceIds: ['unrestricted'] }).items.map((value: any) => value.id)).toEqual(['a-hidden', 'b-common', 'c-first', 'd-common']);
    rejects(() => f.query('types', { actor: owner, resourceIds: ['first', 'second'], limit: 1 }), 'CALENDAR_NOT_FOUND');
    f.grant('first', []); rejects(() => f.query('types', { actor: reader, resourceIds: ['first', 'second'] }), 'CALENDAR_NOT_FOUND');
  } finally { f.close(); }
});

test('resource policies preserve inactive members, revision/no-op truth, deliberate closed modes and immutable history', () => {
  const f = fixture();
  try {
    f.resource(); f.resource('other'); f.type('a'); f.type('b');
    expect(f.query('resourceTypes', { actor: owner, id: 'person' })).toEqual({ resourceId: 'person', resourceRevision: 1, mode: 'unrestricted', typeIds: [] });
    expect(f.policy('person', 'unrestricted', [])).toMatchObject({ revision: 1, changed: false });
    const intent = { actor: manager, id: 'person', requestId: 'policy', expectedRevision: 1, mode: 'optional', typeIds: ['b', 'a'] };
    const accepted = f.command('resource.types', intent), seq = f.db.currentSeq;
    expect(accepted).toMatchObject({ revision: 2, operation: 'resource.types-changed', changed: true });
    expect(f.command('resource.types', { ...intent, typeIds: ['a', 'b'] })).toEqual(accepted); expect(f.db.currentSeq).toBe(seq);
    rejects(() => f.command('resource.types', { ...intent, mode: 'required' }), 'CALENDAR_INTENT_CONFLICT');
    expect(f.policy('person', 'optional', ['a', 'b'])).toMatchObject({ revision: 2, changed: false });
    f.replace('a', { active: false });
    f.policy('person', 'required', ['a']);
    expect(f.query('resourceTypes', { actor: owner, id: 'person' }).typeIds).toEqual(['a']);
    expect(f.query('types', { actor: owner, resourceIds: ['person'] }).items).toEqual([]);
    rejects(() => f.policy('other', 'optional', ['a']), 'CALENDAR_NOT_FOUND');
    f.policy('person', 'required', []);
    expect(f.query('resourceTypes', { actor: owner, id: 'person' })).toMatchObject({ mode: 'required', typeIds: [] });
    rejects(() => f.policy('person', 'required', ['a']), 'CALENDAR_NOT_FOUND');
    f.policy('person', 'optional', []); f.policy('person', 'unrestricted', []);
    expect(f.db.list('_calendar_resource_type_history')).toHaveLength(5);
    expect(f.db.list('_calendar_resource_type_members')).toHaveLength(3);
    expect(f.db.get('calendar_resources', 'person')!.revision).toBe(6);
    expect(f.db.get('calendar_types', 'a')!.revision).toBe(2);
  } finally { f.close(); }
});

test('strict complete fields, ASCII color keys and bounded selectors reject without consuming any state', () => {
  const f = fixture();
  try {
    f.resource(); f.type();
    const before = f.snapshot(), seq = f.db.currentSeq;
    const invalid = [ { durationMinutes: 0 }, { durationMinutes: 44_641 }, { durationMinutes: 1.5 }, { bufferBeforeMinutes: -1 }, { bufferAfterMinutes: 1_441 },
      { active: 1 }, { label: '' }, { label: 'x'.repeat(257) }, { colorKey: '' }, { colorKey: '-bad' }, { colorKey: 'é' }, { colorKey: 'a'.repeat(65) }, { colorKey: '#fff' } ];
    for (const change of invalid) rejects(() => f.type('invalid', change), 'CALENDAR_INPUT_INVALID');
    for (const key of Object.keys(fields)) {
      const input: Record<string, unknown> = { actor: manager, id: 'type', requestId: 'replace-invalid', expectedRevision: 1, ...fields }; delete input[key];
      rejects(() => f.command('type.replace', input), 'CALENDAR_INPUT_INVALID');
    }
    for (const policy of [{ mode: 'unrestricted', typeIds: ['type'] }, { mode: 'closed', typeIds: [] }, { mode: 'required', typeIds: ['type', 'type'] },
      { mode: 'optional', typeIds: Array.from({ length: 17 }, (_, i) => 'type-' + i) }]) rejects(() => f.policy('person', policy.mode, policy.typeIds), 'CALENDAR_INPUT_INVALID');
    for (const change of [{ limit: 101 }, { after: '' }, { resourceIds: ['person', 'person'] }, { resourceIds: Array.from({ length: 17 }, (_, i) => 'resource-' + i) }, { scopeId: 'application' }]) rejects(() => f.query('types', { actor: manager, ...change }), 'CALENDAR_INPUT_INVALID');
    expect(f.snapshot()).toEqual(before); expect(f.db.currentSeq).toBe(seq);
    f.type('bounds', { durationMinutes: 44_640, bufferBeforeMinutes: 1_440, bufferAfterMinutes: 1_440, colorKey: 'a'.repeat(64) });
  } finally { f.close(); }
});

test('catalog/history/policy/receipt budgets and late SQL failures roll back every source fact and identity', () => {
  for (const key of ['types', 'typeHistory', 'resourceTypeHistory', 'receipts'] as const) {
    const f = fixture();
    try {
      f.resource(); f.type();
      const row = f.db.get('_calendar_usage', key);
      if (row) f.db.update('_calendar_usage', key, { count: CALENDAR_LIMITS[key] }); else f.db.createStrict('_calendar_usage', { id: key, count: CALENDAR_LIMITS[key] });
      const before = f.snapshot(), seq = f.db.currentSeq;
      rejects(() => key === 'resourceTypeHistory' ? f.policy('person', 'required', ['type']) : key === 'typeHistory' ? f.replace('type', { label: 'changed' }) : f.type('new'), 'CALENDAR_CAPACITY');
      expect(f.snapshot()).toEqual(before); expect(f.db.currentSeq).toBe(seq);
    } finally { f.close(); }
  }
  const f = fixture();
  try {
    f.resource(); f.type(); f.policy('person', 'optional', ['type']);
    f.raw.run("CREATE TRIGGER synthetic_type_policy_late BEFORE INSERT ON _calendar_resource_type_members BEGIN SELECT RAISE(ABORT,'synthetic late failure'); END");
    const before = f.snapshot(), seq = f.db.currentSeq;
    expect(() => f.policy('person', 'required', ['type'])).toThrow(); expect(f.snapshot()).toEqual(before); expect(f.db.currentSeq).toBe(seq);
    f.raw.run('DROP TRIGGER synthetic_type_policy_late');
    expect(f.policy('person', 'required', ['type'])).toMatchObject({ revision: 3, changed: true });
  } finally { f.close(); }
});

test('retained evidence rejects deletion, replacement, rewind, cross-scope members and membership appended after sealing', () => {
  const f = fixture();
  try {
    f.resource(); f.type(); f.policy('person', 'required', ['type']);
    for (const table of ['calendar_types', '_calendar_type_history', '_calendar_resource_type_history', '_calendar_resource_type_members', '_calendar_resource_types', '_calendar_type_receipts', '_calendar_type_effect_intents']) {
      expect(() => f.raw.run(`DELETE FROM ${table}`)).toThrow();
      expect(() => f.raw.run(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table} LIMIT 1`)).toThrow();
    }
    for (const table of ['_calendar_type_history', '_calendar_resource_type_history', '_calendar_resource_type_members', '_calendar_type_receipts', '_calendar_type_effect_intents']) expect(() => f.raw.run(`UPDATE ${table} SET id=id`)).toThrow();
    expect(() => f.raw.run('UPDATE calendar_types SET revision=revision')).toThrow();
    expect(() => f.raw.run('UPDATE calendar_types SET revision=revision+1')).toThrow();
    expect(() => f.raw.run('UPDATE _calendar_resource_types SET resource_revision=resource_revision')).toThrow();
    expect(() => f.db.createStrict('_calendar_resource_type_members', { id: 'late', scope_id: owner.scopeId, resource_id: 'person', resource_revision: 2, type_id: 'type' })).toThrow();
    expect(() => f.db.createStrict('_calendar_type_history', { id: 'scope', scope_id: 'tenant:other', type_id: 'evil', type_revision: 1,
      label: 'evil', duration_minutes: 1, buffer_before: 0, buffer_after: 0, color_key: null, active: 1 })).toThrow();
    expect(f.raw.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { f.close(); }
});

test('the fifth receipt store shares every legacy request namespace in both insertion directions', () => {
  const f = fixture();
  try {
    f.resource(); f.type();
    const timed = { startAt: '2030-01-01T10:00:00.000Z', endAt: '2030-01-01T11:00:00.000Z', timeZone: 'UTC', resourceIds: ['person'] };
    f.command('block.create', { actor: manager, id: 'block', requestId: 'block', title: 'PRIVATE_BLOCK', ...timed });
    f.command('hold.acquire', { actor: manager, id: 'hold', requestId: 'hold', ...timed, startAt: '2030-01-01T12:00:00.000Z', endAt: '2030-01-01T13:00:00.000Z' });
    f.command('location.create', { actor: manager, id: 'location', requestId: 'location', label: 'PRIVATE_LOCATION' });
    const legacy = [['_calendar_receipts', 'resource', 'person'], ['_calendar_block_receipts', 'block', 'block'], ['_calendar_hold_receipts', 'hold', 'hold'], ['_calendar_location_receipts', 'location', 'location']] as const;
    for (const [table, kind, target] of legacy) {
      const original = f.db.list('_calendar_type_receipts')[0]!;
      // Different IDs prove the cross-family principal/request constraint, not
      // merely a primary-key collision or a missing parent in another family.
      expect(() => f.db.createStrict(table, { ...original, id: 'collision-' + kind, target_kind: kind, target_id: target })).toThrow('request identity cannot be reused');
      const prior = f.db.list(table)[0]!;
      expect(() => f.db.createStrict('_calendar_type_receipts', { ...prior, id: 'reverse-' + kind, target_kind: 'type', target_id: 'type', required_right: 'manage' })).toThrow('request identity cannot be reused');
    }
    const requestId = 'type-type', id = calendarHash([owner.scopeId, manager.principal, requestId]);
    expect(f.db.get('_calendar_type_receipts', id)!.target_kind).toBe('type');
    expect(f.db.get('_calendar_type_effect_intents', id)!.target_kind).toBe('type');
    expect(f.db.list('_calendar_effect_intents').every(row => row.target_kind === 'resource')).toBe(true);
  } finally { f.close(); }
});

test('any accepted resource generation seals late policy history, members and pointers without changing canonical writes', () => {
  const f = fixture();
  try {
    f.resource(); f.type(); f.grant('person', ['book']);
    const before = f.snapshot(), seq = f.db.currentSeq;
    expect(() => f.db.createStrict('_calendar_resource_type_history', { id: 'late-history', scope_id: owner.scopeId,
      resource_id: 'person', resource_revision: 2, mode: 'required', type_ids_json: '[]' })).toThrow('Private type policy revision is inconsistent');
    expect(f.snapshot()).toEqual(before); expect(f.db.currentSeq).toBe(seq);
    // Exercise member/pointer guards independently: an in-progress synthetic
    // generation is structurally valid until a source effect seals that exact
    // resource revision. The entire probe rolls back on the expected failure.
    for (const target of ['member', 'pointer']) {
      const probe = f.raw.transaction(() => {
        f.raw.run('UPDATE calendar_resources SET revision=3 WHERE id=?', ['person']);
        f.db.createStrict('_calendar_resource_type_history', { id: 'probe-history', scope_id: owner.scopeId, resource_id: 'person', resource_revision: 3,
          mode: 'required', type_ids_json: target === 'member' ? '["type"]' : '[]' });
        f.db.createStrict('_calendar_receipts', { id: 'probe-seal', scope_id: owner.scopeId, principal: manager.principal, request_id: 'probe-seal', digest: calendarHash(['synthetic']),
          result_json: calendarJson({ requestId: 'probe-seal', operation: 'resource.grant-changed', id: 'person', revision: 3, changed: true }), target_kind: 'resource', target_id: 'person', required_right: 'manage' });
        f.db.createStrict('_calendar_effect_intents', { id: 'probe-seal', scope_id: owner.scopeId, receipt_id: 'probe-seal', operation: 'resource.grant-changed', target_kind: 'resource', target_id: 'person', revision: 3 });
        if (target === 'member') f.db.createStrict('_calendar_resource_type_members', { id: 'late-member', scope_id: owner.scopeId, resource_id: 'person', resource_revision: 3, type_id: 'type' });
        else f.db.createStrict('_calendar_resource_types', { id: 'person', scope_id: owner.scopeId, resource_id: 'person', resource_revision: 3 });
      });
      expect(() => probe()).toThrow(target === 'member' ? 'Private type policy membership is inconsistent' : 'Private type policy history is inconsistent');
      expect(f.snapshot()).toEqual(before); expect(f.db.currentSeq).toBe(seq);
    }
    expect(f.policy('person', 'required', ['type'])).toMatchObject({ revision: 3, changed: true });
  } finally { f.close(); }
});

test('current-policy intersection uses bounded indexed current pointers after 1000 retained policy revisions', () => {
  const f = fixture();
  try {
    f.resource(); f.resource('second'); f.type('a-retired'); f.type('b-current'); f.type('c-visible'); f.policy('person', 'required', ['a-retired']);
    f.policy('second', 'optional', ['b-current', 'c-visible']);
    // Populate synthetic retained policy history without receipts or generated
    // fixtures, then seal each revision through the real SQL parent guards.
    const scope = owner.scopeId;
    for (let revision = 3; revision <= 1002; revision++) {
      f.raw.run('UPDATE calendar_resources SET revision=? WHERE id=?', [revision, 'person']);
      const ids = ['b-current', 'c-visible'];
      f.raw.run('INSERT INTO _calendar_resource_type_history(id,scope_id,resource_id,resource_revision,mode,type_ids_json) VALUES(?,?,?,?,?,?)', [calendarHash([scope, 'person', revision]), scope, 'person', revision, 'required', calendarJson(ids)]);
      for (const id of ids) f.raw.run('INSERT INTO _calendar_resource_type_members(id,scope_id,resource_id,resource_revision,type_id) VALUES(?,?,?,?,?)', [calendarHash([scope, 'person', revision, id]), scope, 'person', revision, id]);
      f.raw.run('UPDATE _calendar_resource_types SET resource_revision=? WHERE id=?', [revision, 'person']);
    }
    const page = f.query('types', { actor: owner, resourceIds: ['person', 'second'], limit: 1 }, true);
    expect(page.items.map((row: any) => row.id)).toEqual(['b-current']); expect(page).toMatchObject({ truncated: true, nextAfter: 'b-current' });
    expect(f.query('types', { actor: owner, resourceIds: ['person', 'second'], limit: 1, after: page.nextAfter }, true).items.map((row: any) => row.id)).toEqual(['c-visible']);
    expect(f.plans).toHaveLength(2);
    for (const plan of f.plans) {
      expect(plan.detail).toContain('calendar_type_catalog'); expect(plan.detail).toContain('calendar_resource_types_identity');
      expect(plan.detail).toContain('calendar_resource_type_history_identity'); expect(plan.detail).toContain('calendar_resource_type_member_identity');
      expect(plan.detail).not.toMatch(/SCAN (?:policy|m|p)(?:\s|$)/); expect(plan.rows).toBeLessThanOrEqual(2);
    }
  } finally { f.close(); }
});
