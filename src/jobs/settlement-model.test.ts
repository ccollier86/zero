/** Native MEMORY domains and retained-obligation accounting only. No claim
 * about physical enqueue/provider completion is inferred from fixture receipts. */
import { expect, test } from 'bun:test';
import { defineDatabaseRealm, runDatabaseRealmCommand, type DatabaseWriteCommandContext } from '../databases/database-realm';
import { changeJobOccurrenceWork } from './realm-capacity';
import { JOB_SETTLEMENT_CURRENT_TABLES, JOB_SETTLEMENT_KEYS, JOB_SETTLEMENT_USAGE_TABLE } from './realm-settlement-schema';
import { JOB_SETTLEMENT_MIGRATION } from './realm-settlement-migration';
import { initializeJobSourceSettlement, refreshJobSourceSettlement, refreshJobScheduleSettlement, refreshJobOccurrenceSettlement,
  jobOccurrenceSettlementWeight, jobScheduleSettlementWeight, readJobSettlementSnapshot } from './settlement-model';
import { jobOccurrenceId } from './model';
import { memoryCapacityFixture, capacityDue, capacityIdentity, capacityNow } from './test-support/memory-capacity-fixture';

function fixture() {
  const f = memoryCapacityFixture();
  try {
    if (!f.db.hasTable('_jobs_settlement_state')) {
      f.raw.transaction(() => JOB_SETTLEMENT_MIGRATION.up(f.raw))();
      for (const [table, schema] of Object.entries(JOB_SETTLEMENT_CURRENT_TABLES)) f.db.defineTable(table, schema);
    }
    let selected: ((context: DatabaseWriteCommandContext) => void) | null = null;
    const realm = defineDatabaseRealm({ name: 'synthetic.jobs.settlement-model', version: '1', tables: JOB_SETTLEMENT_CURRENT_TABLES,
      commands: { 'synthetic.transition': context => { if (!selected) throw new Error('Synthetic command missing.'); selected(context); return { ...readJobSettlementSnapshot(context.db) }; } } });
    return { ...f, run(action: (context: DatabaseWriteCommandContext) => void) {
      selected = action;
      try { return runDatabaseRealmCommand(realm, f.db, 'synthetic.transition', null); } finally { selected = null; }
    } };
  } catch (error) { f.close(); throw error; }
}

test('closed weighting distinguishes real outstanding facts, actor pause/cancel controls and retained history', () => {
  for (const state of ['pending', 'claimed', 'blocked']) expect(jobOccurrenceSettlementWeight(state)).toBe(2);
  expect(jobOccurrenceSettlementWeight('dispatched')).toBe(1);
  for (const state of ['terminal', 'cancelled']) expect(jobOccurrenceSettlementWeight(state)).toBe(0);
  for (const state of [null, undefined, 'completed', 'unknown', '']) expect(() => jobOccurrenceSettlementWeight(state)).toThrow();
  expect(jobScheduleSettlementWeight('active', 1, false)).toBe(2);
  expect(jobScheduleSettlementWeight('paused', 1, false)).toBe(1);
  expect(jobScheduleSettlementWeight('cancelled', 1, false)).toBe(0);
  expect(jobScheduleSettlementWeight('active', 0, false)).toBe(0);
  expect(jobScheduleSettlementWeight('active', 1, true)).toBe(1);
  expect(() => jobScheduleSettlementWeight('paused', 1, true)).toThrow();
});

test('source control, all-generation claim, dispatch and terminal facts charge/release exactly once', () => {
  const f = fixture(); try {
    expect(readJobSettlementSnapshot(f.raw)).toEqual({ transportUnits: 1, actorControlUnits: 0, sourceControlUnits: 1 });
    f.create('unknown');
    expect(readJobSettlementSnapshot(f.db)).toEqual({ transportUnits: 2, actorControlUnits: 0, sourceControlUnits: 2 });
    f.materialize('unknown'); f.claim('unknown');
    expect(readJobSettlementSnapshot(f.db)).toEqual({ transportUnits: 4, actorControlUnits: 0, sourceControlUnits: 2 });
    f.dispatch('unknown');
    expect(readJobSettlementSnapshot(f.db)).toEqual({ transportUnits: 3, actorControlUnits: 0, sourceControlUnits: 2 });
    f.dispatch('unknown'); expect(readJobSettlementSnapshot(f.db).transportUnits).toBe(3);
    f.complete('unknown');
    expect(readJobSettlementSnapshot(f.db)).toEqual({ transportUnits: 1, actorControlUnits: 0, sourceControlUnits: 1 });
    f.complete('unknown'); expect(readJobSettlementSnapshot(f.db).transportUnits).toBe(1);
    f.command('jobs.source.retire', { identity: capacityIdentity, expectedRevision: 1, requestId: 'retire-original', now: capacityNow });
    expect(readJobSettlementSnapshot(f.db)).toEqual({ transportUnits: 0, actorControlUnits: 0, sourceControlUnits: 0 });
  } finally { f.close(); }
});

test('source cancellation and retirement do not erase unknown occurrence obligations from an earlier generation', () => {
  const f = fixture(); try {
    f.create('old'); f.materialize('old'); f.claim('old'); f.replace('old'); f.cancel('old', 2);
    expect(readJobSettlementSnapshot(f.db)).toEqual({ transportUnits: 3, actorControlUnits: 0, sourceControlUnits: 1 });
    f.command('jobs.source.retire', { identity: capacityIdentity, expectedRevision: 1, requestId: 'retire', now: capacityNow });
    expect(readJobSettlementSnapshot(f.db)).toEqual({ transportUnits: 2, actorControlUnits: 0, sourceControlUnits: 0 });
    f.run(context => { refreshJobScheduleSettlement(context, 'old'); refreshJobSourceSettlement(context, f.sourceId); });
    expect(readJobSettlementSnapshot(f.db).transportUnits).toBe(2);
  } finally { f.close(); }
});

test('an actor with unknown work reserves separate pause and cancel controls without releasing its occurrence facts', () => {
  const f = fixture(); try {
    const actor = { scopeId: 'application', userId: 'synthetic-user', principal: 'synthetic-session', manageAll: false };
    const { source: _source, ...base } = f.admission('actor-unknown');
    f.command('jobs.schedule.create', { actor, requestId: 'create-actor', now: capacityNow,
      admission: { ...base, actorId: actor.userId, principal: actor.principal, runAs: 'actor' },
      seal: { authorityJson: 'SYNTHETIC_ACTOR', authorityMac: '6'.repeat(64) } });
    f.materialize('actor-unknown'); f.claim('actor-unknown');
    expect(readJobSettlementSnapshot(f.db)).toEqual({ transportUnits: 5, actorControlUnits: 2, sourceControlUnits: 1 });
    f.command('jobs.schedule.change', { actor, requestId: 'pause-actor', id: 'actor-unknown', expectedRevision: 1, action: 'pause', now: capacityNow });
    expect(readJobSettlementSnapshot(f.db)).toEqual({ transportUnits: 4, actorControlUnits: 1, sourceControlUnits: 1 });
    f.command('jobs.schedule.change', { actor, requestId: 'cancel-actor', id: 'actor-unknown', expectedRevision: 2, action: 'cancel', now: capacityNow });
    expect(readJobSettlementSnapshot(f.db)).toEqual({ transportUnits: 3, actorControlUnits: 0, sourceControlUnits: 1 });
    expect(f.work('actor-unknown')).toMatchObject({ occupied: 1, open_occurrences: 1 });
  } finally { f.close(); }
});

test('late native command rejection rolls back canonical terminal state, work release and obligation deltas together', () => {
  const f = fixture(); try {
    f.create('rollback'); f.materialize('rollback'); f.claim('rollback'); f.dispatch('rollback');
    const id = jobOccurrenceId('rollback', 1, capacityDue), before = f.raw.serialize(), sequence = f.db.currentSeq;
    expect(() => f.run(context => {
      const row = context.db.get('_jobs_occurrences', id)!;
      context.db.update('_jobs_occurrences', id, { state: 'terminal', terminal_status: 'completed', updated_at: capacityDue + 1 });
      changeJobOccurrenceWork(context, row as never, 'terminal');
      refreshJobOccurrenceSettlement(context, id); refreshJobScheduleSettlement(context, 'rollback');
      expect(readJobSettlementSnapshot(context.db).transportUnits).toBe(1);
      throw new Error('Synthetic late rollback.');
    })).toThrow('Synthetic late rollback');
    expect(f.raw.serialize()).toEqual(before); expect(f.db.currentSeq).toBe(sequence);
    expect(f.db.get('_jobs_occurrences', id)!.state).toBe('dispatched');
    expect(readJobSettlementSnapshot(f.db)).toEqual({ transportUnits: 3, actorControlUnits: 0, sourceControlUnits: 2 });
  } finally { f.close(); }
});

test('aggregate projection is frozen, exactly three PK reads, and refuses missing/corrupt counters without mutation', () => {
  const f = fixture(); try {
    const keys: string[] = [], before = f.raw.serialize();
    const snapshot = readJobSettlementSnapshot({ get(table, id) {
      expect(table).toBe(JOB_SETTLEMENT_USAGE_TABLE); keys.push(String(id)); return f.db.get(table, id);
    } });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(keys).toEqual([JOB_SETTLEMENT_KEYS.transport, JOB_SETTLEMENT_KEYS.actorControl, JOB_SETTLEMENT_KEYS.sourceControl]);
    expect(f.raw.serialize()).toEqual(before);
    expect(() => readJobSettlementSnapshot({ get() { return null; } })).toThrow();
    expect(() => readJobSettlementSnapshot({ get(_table, id) { return { id, count: id === JOB_SETTLEMENT_KEYS.transport ? 0 : 1 }; } })).toThrow();
    expect(() => f.run(context => initializeJobSourceSettlement(context, f.sourceId))).toThrow();
    expect(f.raw.serialize()).toEqual(before);
  } finally { f.close(); }
});

test('native SQL guards retain membership identities and reject units inconsistent with the actual parent', () => {
  const f = fixture(); try {
    expect(() => f.raw.run('UPDATE _jobs_source_settlement SET units=0')).toThrow();
    expect(() => f.raw.run('DELETE FROM _jobs_settlement_usage')).toThrow();
    expect(() => f.raw.run('INSERT OR REPLACE INTO _jobs_settlement_usage SELECT * FROM _jobs_settlement_usage')).toThrow();
    expect(() => f.raw.run('UPDATE _jobs_settlement_state SET version=5')).toThrow();
    expect(readJobSettlementSnapshot(f.db)).toEqual({ transportUnits: 1, actorControlUnits: 0, sourceControlUnits: 1 });
  } finally { f.close(); }
});
