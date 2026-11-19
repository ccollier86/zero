/** Additive 004: explicit preparation derives finite settlement obligations.
 * Original history, transport keys, counters and 001–003 closures are untouched. */
import type { Database, Statement } from 'bun:sqlite';
import type { Migration } from '../migrations/migrator';
import { diffSchemaSnapshots } from '../migrations/schema-diff';
import { inspectDatabaseSchema } from '../migrations/schema-inspector';
import { snapshotDeclaredTables } from '../migrations/schema-snapshot';
import { quoteSqlIdentifier } from '../sync/identity';
import { JOB_SETTLEMENT_TABLES, JOB_SETTLEMENT_SOURCE_TABLE as SOURCES, JOB_SETTLEMENT_SCHEDULE_TABLE as SCHEDULES,
  JOB_SETTLEMENT_OCCURRENCE_TABLE as OCCURRENCES, JOB_SETTLEMENT_USAGE_TABLE as USAGE, JOB_SETTLEMENT_STATE_TABLE as STATE } from './realm-settlement-schema';
import { jobHash } from './validation';
import { jobSourceId, normalizeJobSourceIdentity } from './source-model';

export const JOB_SETTLEMENT_MIGRATION: Migration = Object.freeze({
  version: '004', description: 'Native all-generation settlement obligations and control headroom', safety: 'safe',
  up(database: Database) {
    if (!database.inTransaction) throw new Error('Jobs settlement migration requires its managed transaction.');
    const one = <T>(sql: string, ...args: string[]): T | null => {
      const statement = database.prepare<T, string[]>(sql);
      try { return statement.get(...args); } finally { statement.finalize(); }
    };
    if (one<{ foreign_keys: number }>('PRAGMA foreign_keys')?.foreign_keys !== 1) throw new Error('Jobs settlement migration requires foreign-key enforcement.');
    const invalid = () => { throw new Error('Jobs settlement cannot admit inconsistent retained working state.'); };
    if (one('PRAGMA foreign_key_check')) invalid();
    const badSource = one(`SELECT 1 FROM _jobs_sources s LEFT JOIN _jobs_owner p ON p.id='application' AND p.scope_id=s.scope_id
      WHERE p.id IS NULL OR s.state NOT IN ('active','retired') LIMIT 1`);
    const badSchedule = one(`SELECT 1 FROM job_schedules s
      LEFT JOIN _jobs_owner p ON p.id='application' AND p.scope_id=s.scope_id
      LEFT JOIN _jobs_schedule_work w ON w.id=s.id
      LEFT JOIN _jobs_cursors c ON c.id=s.id
      LEFT JOIN _jobs_sources x ON x.id=s.source_id AND x.scope_id=s.scope_id
      LEFT JOIN (SELECT schedule_id,scope_id,count(*) n FROM _jobs_occurrences WHERE state IN ('pending','claimed','dispatched','blocked')
        GROUP BY schedule_id,scope_id) o ON o.schedule_id=s.id AND o.scope_id=s.scope_id
      WHERE p.id IS NULL OR w.id IS NULL OR c.id IS NULL OR w.scope_id<>s.scope_id OR c.scope_id<>s.scope_id
        OR w.source_id IS NOT s.source_id OR s.control NOT IN ('active','paused','cancelled')
        OR s.source_id IS NOT NULL AND (x.id IS NULL OR s.control='paused')
        OR w.open_occurrences<>COALESCE(o.n,0)
        OR w.occupied<>CASE WHEN c.next_due_at IS NOT NULL OR COALESCE(o.n,0)>0 THEN 1 ELSE 0 END LIMIT 1`);
    const badOccurrence = one(`SELECT 1 FROM _jobs_occurrences o LEFT JOIN job_schedules s ON s.id=o.schedule_id
      LEFT JOIN _jobs_admissions a ON a.id=o.admission_id
      WHERE s.id IS NULL OR a.id IS NULL OR o.scope_id<>s.scope_id OR a.scope_id<>o.scope_id
        OR a.schedule_id<>o.schedule_id OR a.generation<>o.generation OR o.generation>s.generation
        OR o.state NOT IN ('pending','claimed','dispatched','blocked','terminal','cancelled')
        OR (o.workflow_id IS NULL)<>(o.receipt_json IS NULL) LIMIT 1`);
    const badWork = one(`SELECT 1 FROM _jobs_schedule_work w LEFT JOIN job_schedules s ON s.id=w.id WHERE s.id IS NULL LIMIT 1`);
    const badUsage = one(`SELECT 1 FROM _jobs_work_usage u WHERE
      u.id NOT IN ('schedules','occurrences') AND NOT EXISTS(SELECT 1 FROM _jobs_sources s WHERE u.id='source:'||s.id)
      OR typeof(u.count)<>'integer' OR u.count<0 LIMIT 1`);
    const count = (sql: string) => one<{ n: number }>(sql)!.n;
    if (badSource || badSchedule || badOccurrence || badWork || badUsage
      || count('SELECT count(*) n FROM _jobs_work_usage') !== count('SELECT count(*)+2 n FROM _jobs_sources')
      || !one(`SELECT 1 FROM _jobs_work_usage WHERE id='schedules' AND count=(SELECT COALESCE(sum(occupied),0) FROM _jobs_schedule_work)`)
      || !one(`SELECT 1 FROM _jobs_work_usage WHERE id='occurrences' AND count=(SELECT COALESCE(sum(open_occurrences),0) FROM _jobs_schedule_work)`)
      || one(`SELECT 1 FROM _jobs_sources s LEFT JOIN _jobs_work_usage u ON u.id='source:'||s.id WHERE u.id IS NULL
        OR u.count<>(SELECT COALESCE(sum(occupied),0) FROM _jobs_schedule_work w WHERE w.source_id=s.id AND w.scope_id=s.scope_id) LIMIT 1`)) invalid();
    // 003 validated history at its installation, not forever. Do not bless
    // subsequently corrupted monotonic counters when 004 policy will use them.
    const retained = (id: string) => {
      const row = one<{ count: number }>('SELECT count FROM _jobs_usage WHERE id=?', id);
      if (row && (!Number.isSafeInteger(row.count) || row.count < 0)) invalid();
      return row?.count ?? 0;
    };
    if (retained('schedules') !== count('SELECT count(*) n FROM job_schedules')
      || retained('occurrences') !== count('SELECT count(*) n FROM _jobs_occurrences')
      || retained('sources') !== count('SELECT count(*) n FROM _jobs_sources')
      || retained('source-policies') !== count('SELECT count(*) n FROM _jobs_source_policies')
      || retained('actorRecoveryIntents') !== 0
      || retained('intents') + retained('sourceRecoveryIntents') !== count('SELECT (SELECT count(*) FROM _jobs_intents)+(SELECT count(*) FROM _jobs_source_intents) n')) invalid();
    const sources = database.prepare<{ id: string; scope_id: string; identity_hash: string; identity_json: string }, []>('SELECT id,scope_id,identity_hash,identity_json FROM _jobs_sources');
    try {
      for (const source of sources.iterate()) {
        const identity = normalizeJobSourceIdentity(JSON.parse(source.identity_json));
        if (source.id !== jobSourceId(identity) || source.scope_id !== identity.scopeId || source.identity_hash !== jobHash(identity)
          || retained('source:' + source.identity_hash) !== one<{ n: number }>('SELECT count(*) n FROM job_schedules WHERE source_id=? AND scope_id=?', source.id, source.scope_id)!.n) invalid();
      }
    } finally { sources.finalize(); }
    const owners = database.prepare<{ scope_id: string; actor_id: string; n: number }, []>('SELECT scope_id,actor_id,count(*) n FROM job_schedules WHERE source_id IS NULL GROUP BY scope_id,actor_id');
    try { for (const owner of owners.iterate()) if (retained('owner:' + jobHash([owner.scope_id, owner.actor_id])) !== owner.n) invalid(); }
    finally { owners.finalize(); }

    for (const [name, columns] of Object.entries(JOB_SETTLEMENT_TABLES)) database.run('CREATE TABLE IF NOT EXISTS ' + quoteSqlIdentifier(name)
      + '(' + Object.entries(columns).map(([column, definition]) => quoteSqlIdentifier(column) + ' ' + definition).join(',') + ')');
    // Runtime preparation can define declared tables before this migration.
    // Accept only exact empty declarations, not silent repair/adoption.
    const statements: Statement[] = [];
    let actual: ReturnType<typeof inspectDatabaseSchema>;
    try { actual = inspectDatabaseSchema({ prepare(sql: string) { const statement = database.prepare(sql); statements.push(statement); return statement; } } as Database); }
    finally { for (const statement of statements.reverse()) statement.finalize(); }
    const expected = snapshotDeclaredTables(JOB_SETTLEMENT_TABLES);
    const selected = { tables: Object.fromEntries(Object.keys(expected.tables).filter(table => Object.hasOwn(actual.tables, table))
      .map(table => [table, actual.tables[table]!])) };
    if (diffSchemaSnapshots(expected, selected).length || Object.keys(expected.tables).some(table =>
      JSON.stringify(actual.tables[table]?.columnOrder) !== JSON.stringify(expected.tables[table]!.columnOrder))) invalid();
    for (const table of Object.keys(JOB_SETTLEMENT_TABLES)) if (one('SELECT 1 FROM ' + quoteSqlIdentifier(table) + ' LIMIT 1')) invalid();

    database.run(`INSERT INTO ${SOURCES}(id,scope_id,units) SELECT id,scope_id,CASE WHEN state='active' THEN 1 ELSE 0 END FROM _jobs_sources`);
    database.run(`INSERT INTO ${SCHEDULES}(id,scope_id,source_id,units)
      SELECT s.id,s.scope_id,s.source_id,CASE WHEN w.occupied=0 OR s.control='cancelled' THEN 0
        WHEN s.source_id IS NOT NULL OR s.control='paused' THEN 1 ELSE 2 END
      FROM job_schedules s JOIN _jobs_schedule_work w ON w.id=s.id AND w.scope_id=s.scope_id`);
    database.run(`INSERT INTO ${OCCURRENCES}(id,scope_id,schedule_id,units)
      SELECT id,scope_id,schedule_id,CASE WHEN state IN ('pending','claimed','blocked') THEN 2 WHEN state='dispatched' THEN 1 ELSE 0 END FROM _jobs_occurrences`);
    database.run(`INSERT INTO ${USAGE}(id,count) SELECT 'transport',
      (SELECT COALESCE(sum(units),0) FROM ${SOURCES})+(SELECT COALESCE(sum(units),0) FROM ${SCHEDULES})+(SELECT COALESCE(sum(units),0) FROM ${OCCURRENCES})`);
    database.run(`INSERT INTO ${USAGE}(id,count) SELECT 'actor-control',COALESCE(sum(units),0) FROM ${SCHEDULES} WHERE source_id IS NULL`);
    database.run(`INSERT INTO ${USAGE}(id,count) SELECT 'source-control',(SELECT COALESCE(sum(units),0) FROM ${SOURCES})
      +(SELECT COALESCE(sum(units),0) FROM ${SCHEDULES} WHERE source_id IS NOT NULL)`);
    database.run(`INSERT INTO ${STATE}(id,version) VALUES('application',4)`);
    if (count(`SELECT count(*) n FROM ${SOURCES}`) !== count('SELECT count(*) n FROM _jobs_sources')
      || count(`SELECT count(*) n FROM ${SCHEDULES}`) !== count('SELECT count(*) n FROM job_schedules')
      || count(`SELECT count(*) n FROM ${OCCURRENCES}`) !== count('SELECT count(*) n FROM _jobs_occurrences')) invalid();

    for (const table of Object.keys(JOB_SETTLEMENT_TABLES)) {
      database.run(`CREATE TRIGGER ${table}_retain BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Private job settlement evidence must be retained'); END`);
      database.run(`CREATE TRIGGER ${table}_no_replace BEFORE INSERT ON ${table} WHEN EXISTS(SELECT 1 FROM ${table} WHERE id=NEW.id)
        BEGIN SELECT RAISE(ABORT,'Private job settlement identity cannot be replaced'); END`);
      database.run(`CREATE TRIGGER ${table}_identity BEFORE UPDATE OF id ON ${table} WHEN OLD.id IS NOT NEW.id
        BEGIN SELECT RAISE(ABORT,'Private job settlement identity is immutable'); END`);
    }
    database.run(`CREATE TRIGGER jobs_settlement_state_immutable BEFORE UPDATE ON ${STATE} BEGIN SELECT RAISE(ABORT,'Private job settlement version is immutable'); END`);
    for (const [table, predicate, identity] of [
      [SOURCES, `EXISTS(SELECT 1 FROM _jobs_sources s WHERE s.id=NEW.id AND s.scope_id=NEW.scope_id AND NEW.units=(s.state='active'))`, 'scope_id'],
      [SCHEDULES, `EXISTS(SELECT 1 FROM job_schedules s JOIN _jobs_schedule_work w ON w.id=s.id AND w.scope_id=s.scope_id
        WHERE s.id=NEW.id AND s.scope_id=NEW.scope_id AND s.source_id IS NEW.source_id AND NEW.units=CASE
          WHEN w.occupied=0 OR s.control='cancelled' THEN 0 WHEN s.source_id IS NOT NULL OR s.control='paused' THEN 1 ELSE 2 END)`, 'scope_id,source_id'],
      [OCCURRENCES, `EXISTS(SELECT 1 FROM _jobs_occurrences o WHERE o.id=NEW.id AND o.scope_id=NEW.scope_id AND o.schedule_id=NEW.schedule_id
        AND NEW.units=CASE WHEN o.state IN ('pending','claimed','blocked') THEN 2 WHEN o.state='dispatched' THEN 1 ELSE 0 END)`, 'scope_id,schedule_id'],
    ] as const) {
      for (const action of ['INSERT', 'UPDATE']) database.run(`CREATE TRIGGER ${table}_parent_${action.toLowerCase()} BEFORE ${action} ON ${table}
        WHEN NOT (${predicate}) BEGIN SELECT RAISE(ABORT,'Private job settlement parent is inconsistent'); END`);
      database.run(`CREATE TRIGGER ${table}_owner_identity BEFORE UPDATE OF ${identity} ON ${table} WHEN `
        + identity.split(',').map(field => `OLD.${field} IS NOT NEW.${field}`).join(' OR ')
        + " BEGIN SELECT RAISE(ABORT,'Private job settlement owner is immutable'); END");
    }
  },
});
