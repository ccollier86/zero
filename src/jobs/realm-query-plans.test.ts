/** Actual realm migration/queries on owned in-memory SQLite only; no actors, files, timers or ANALYZE. */
import { expect, test } from 'bun:test';
import { Database, type SQLQueryBindings } from 'bun:sqlite';
import type { DatabaseReadQueryContext } from '../databases/database-realm';
import { jobAdmissionDigest, jobAdmissionId, jobOccurrenceId, normalizeJobAdmission, type JobOccurrenceRow } from './model';
import { pendingJobOccurrences, dispatchedJobOccurrences } from './realm-queries';
import { jobsRealm } from './realm';

const now = Date.parse('2026-12-01T00:00:00Z');
type Occurrence = Pick<JobOccurrenceRow, 'id' | 'schedule_id' | 'scheduled_at'>;
type ScheduleOptions = { overlap?: 'allow' | 'queue-one'; control?: 'active' | 'paused' | 'cancelled'; generation?: number };

function fixture() {
  const database = new Database(':memory:');
  try {
    database.run('PRAGMA temp_store=MEMORY');
    database.run('PRAGMA foreign_keys=ON');
    for (const migration of jobsRealm.migrations) database.transaction(() => migration.up(database))();
    database.run("INSERT INTO _jobs_owner VALUES('application','synthetic-query-owner','application')");
    const statements: string[] = [];
    const context: DatabaseReadQueryContext = { database: {
      query<TRow, TParams extends SQLQueryBindings | SQLQueryBindings[]>(sql: string) {
        statements.push(sql); return database.query<TRow, TParams>(sql);
      },
      prepare<TRow, TParams extends SQLQueryBindings | SQLQueryBindings[]>(sql: string, params?: TParams) {
        statements.push(sql); return database.prepare<TRow, TParams>(sql, params);
      },
    } };
    const insertSchedule = database.query('INSERT INTO job_schedules (id,scope_id,actor_id,principal,definition_name,definition_version,run_as,updated_by,control,revision,generation,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
    const insertAdmission = database.query('INSERT INTO _jobs_admissions VALUES(?,?,?,?,?,?,?,?)');
    const insertOccurrence = database.query('INSERT INTO _jobs_occurrences VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    const addSchedule = (id: string, options: ScheduleOptions = {}) => {
      const generation = options.generation ?? 1;
      insertSchedule.run(id, 'application', 'synthetic-user', 'synthetic-session', 'synthetic.query', '1', 'actor',
        'synthetic-user', options.control ?? 'active', 1, generation, now - 1_000_000, now);
      for (let pin = 1; pin <= generation; pin++) {
        const admission = normalizeJobAdmission({ id, scopeId: 'application', actorId: 'synthetic-user', principal: 'synthetic-session',
          definition: 'synthetic.query', definitionVersion: '1', definitionHash: 'a'.repeat(64),
          workflow: { name: 'synthetic.query', version: 1, definitionId: 'synthetic-definition', versionId: 'synthetic-version', fingerprint: 'b'.repeat(64) },
          input: {}, timing: { kind: 'once', at: new Date(now).toISOString() }, overlap: options.overlap ?? 'allow', runAs: 'actor' });
        insertAdmission.run(jobAdmissionId(id, pin), 'application', id, pin, JSON.stringify(admission), jobAdmissionDigest(admission), '{}', 'synthetic-mac');
      }
    };
    const addOccurrence = (schedule: string, at: number, state: JobOccurrenceRow['state'], options: { leaseUntil?: number; generation?: number } = {}): Occurrence => {
      const generation = options.generation ?? 1, id = jobOccurrenceId(schedule, generation, at);
      const claimed = state === 'claimed', handedOff = state === 'dispatched' || state === 'terminal';
      insertOccurrence.run(id, 'application', schedule, jobAdmissionId(schedule, generation), generation, at, state,
        claimed ? 'synthetic-claim' : null, claimed ? options.leaseUntil ?? now + 60_000 : null, claimed ? 1 : 0,
        handedOff ? 'synthetic-workflow-' + id : null, handedOff ? '{}' : null, state === 'terminal' ? 'completed' : null, null, at, now);
      return { id, schedule_id: schedule, scheduled_at: at };
    };
    const pending = (limit = 32) => { statements.length = 0; return pendingJobOccurrences(context, { scopeId: 'application', now, limit }); };
    const dispatched = (limit = 32, after?: string) => { statements.length = 0; return dispatchedJobOccurrences(context, { scopeId: 'application', limit, ...(after ? { after } : {}) }); };
    const plans = (sql: string, params: SQLQueryBindings[]) => database.query<{ detail: string }, SQLQueryBindings[]>('EXPLAIN QUERY PLAN ' + sql).all(...params).map(row => row.detail).join('\n');
    return { database, statements, addSchedule, addOccurrence, pending, dispatched, plans,
      close() { database.close(true); } };
  } catch (error) { database.close(true); throw error; }
}

function projected(rows: Occurrence[]) { return rows.map(({ id, schedule_id }) => ({ id, schedule_id })); }
function ordered(rows: Occurrence[]) { return [...rows].sort((left, right) => left.scheduled_at - right.scheduled_at || left.id.localeCompare(right.id)); }

test('pending discovery seeks expired claims and pending states instead of retained history or future leases, without ANALYZE', () => {
  const f = fixture();
  try {
    f.addSchedule('bulk'); f.addSchedule('ready');
    f.database.transaction(() => {
      for (let i = 0; i < 45_000; i++) f.addOccurrence('bulk', now - 1_000_000 + i, 'terminal');
      for (let i = 0; i < 44_952; i++) f.addOccurrence('bulk', now - 900_000 + i, 'claimed', { leaseUntil: now + 60_000 });
    })();
    const expired = f.addOccurrence('ready', now - 2_000, 'claimed', { leaseUntil: now });
    const pending = f.addOccurrence('ready', now - 1_000, 'pending');
    expect(f.pending()).toEqual(projected([expired, pending]));
    const occurrenceQueries = f.statements.filter(sql => sql.includes('FROM _jobs_occurrences o'));
    expect(occurrenceQueries).toHaveLength(2);
    expect(f.plans(occurrenceQueries[0]!, ['application', now, 32])).toContain('jobs_occurrence_claims (scope_id=? AND state=? AND lease_until<?)');
    const pendingPlan = f.plans(occurrenceQueries[1]!, ['application', 31]);
    expect(pendingPlan).toContain('jobs_occurrence_pending (scope_id=? AND state=?)');
    expect(pendingPlan).not.toContain('TEMP B-TREE');
    expect(f.database.query("SELECT name FROM sqlite_master WHERE name='sqlite_stat1'").get()).toBeNull();
    f.database.run('UPDATE _jobs_occurrences SET lease_until=? WHERE id=?', [now + 1, expired.id]);
    f.database.run("UPDATE _jobs_occurrences SET state='terminal',terminal_status='expired' WHERE id=?", [pending.id]);
    expect(f.pending()).toEqual([]);
  } finally { f.close(); }
}, 30_000);

test('claimed-first discovery preserves scheduled-time/id fairness, inclusive expiry and remaining page capacity', () => {
  const f = fixture();
  try {
    for (const id of ['first', 'second', 'third']) f.addSchedule(id);
    const claims = [f.addOccurrence('first', now - 30, 'claimed', { leaseUntil: now }),
      f.addOccurrence('second', now - 30, 'claimed', { leaseUntil: now - 20 }),
      f.addOccurrence('third', now - 40, 'claimed', { leaseUntil: now - 1 })];
    const pending = [f.addOccurrence('first', now - 100, 'pending'), f.addOccurrence('second', now - 100, 'pending'),
      f.addOccurrence('third', now - 50, 'pending')];
    f.addOccurrence('third', now - 200, 'claimed', { leaseUntil: now + 1 });
    const expected = projected([...ordered(claims), ...ordered(pending)]);
    for (const limit of [1, 2, 3, 4, 6, 100]) expect(f.pending(limit)).toEqual(expected.slice(0, limit));
    expect(f.pending(2)).toHaveLength(2);
    expect(f.statements.filter(sql => sql.includes('FROM _jobs_occurrences o'))).toHaveLength(1);
  } finally { f.close(); }
});

test('queue-one pending waits behind claimed or dispatched work but stopped and replaced generations still retire', () => {
  const f = fixture();
  try {
    for (const [id, control] of [['active-claim', 'active'], ['active-dispatch', 'active'], ['paused', 'paused'], ['cancelled', 'cancelled']] as const) {
      f.addSchedule(id, { overlap: 'queue-one', control });
      f.addOccurrence(id, now - 200, id === 'active-dispatch' ? 'dispatched' : 'claimed');
    }
    f.addSchedule('replaced', { overlap: 'queue-one', generation: 2 });
    f.addOccurrence('replaced', now - 200, 'dispatched', { generation: 1 });
    f.addSchedule('unblocked', { overlap: 'queue-one' });
    const blocked = ['active-claim', 'active-dispatch'].map(id => f.addOccurrence(id, now - 100, 'pending'));
    const eligible = ['paused', 'cancelled', 'replaced', 'unblocked'].map(id => f.addOccurrence(id, now - 100, 'pending'));
    const actual = f.pending();
    expect(actual).toEqual(projected(ordered(eligible)));
    expect(actual.some(row => blocked.some(item => item.id === row.id))).toBe(false);
  } finally { f.close(); }
});

test('future claims and blocked queue-one rows yield an empty page without losing stopped-generation eligibility', () => {
  const f = fixture();
  try {
    f.addSchedule('waiting', { overlap: 'queue-one' });
    f.addOccurrence('waiting', now - 100, 'claimed', { leaseUntil: now + 1 });
    f.addOccurrence('waiting', now - 50, 'pending');
    expect(f.pending()).toEqual([]);
    f.database.run("UPDATE job_schedules SET control='paused',revision=revision+1 WHERE id='waiting'");
    expect(f.pending()).toHaveLength(1);
    f.database.run('UPDATE _jobs_occurrences SET lease_until=? WHERE state=\'claimed\'', [now]);
    expect(f.pending()).toHaveLength(2);
  } finally { f.close(); }
});

test('dispatched discovery seeks only the dispatched state and preserves lexicographic after pages through retained history', () => {
  const f = fixture();
  try {
    f.addSchedule('bulk'); f.addSchedule('running');
    f.database.transaction(() => {
      for (let i = 0; i < 10_000; i++) f.addOccurrence('bulk', now - 1_000_000 + i, 'terminal');
    })();
    const live = Array.from({ length: 7 }, (_, i) => f.addOccurrence('running', now - 100 + i, 'dispatched')).sort((a, b) => a.id.localeCompare(b.id));
    for (const after of ['', live[0]!.id, live[3]!.id, live.at(-1)!.id, 'occ_' + 'f'.repeat(64)]) {
      expect(f.dispatched(3, after)).toEqual(projected(live.filter(row => row.id > after).slice(0, 3)));
    }
    f.dispatched();
    const sql = f.statements.find(statement => statement.includes('FROM _jobs_occurrences'))!;
    const plan = f.plans(sql, ['application', '', 32]);
    expect(plan).toContain('jobs_occurrence_pending (scope_id=? AND state=?)');
    // Existing state-leading indexes avoid terminal history, but still sort live dispatched rows for the id cursor.
    expect(plan).toContain('TEMP B-TREE');
    expect(f.database.query("SELECT name FROM sqlite_master WHERE name='sqlite_stat1'").get()).toBeNull();
  } finally { f.close(); }
});
