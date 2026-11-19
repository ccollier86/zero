/** Immutable additive 003: derive working occupancy without rewriting history. */
import type { Migration } from '../migrations/migrator';
import type { Database } from 'bun:sqlite';
import { quoteSqlIdentifier } from '../sync/identity';
import { JOB_CAPACITY_TABLES } from './realm-capacity-schema';
import { jobHash, jobInteger } from './validation';
import { jobSourceId, normalizeJobSourceIdentity } from './source-model';

export const JOB_CAPACITY_MIGRATION: Migration = Object.freeze({
  version: '003', description: 'Transactional working schedules and all-generation occurrences alongside retained history', safety: 'safe',
  up(database: Database) {
    // Migrator owns the atomic surrounding transaction, including backfill.
    if (!database.inTransaction) throw new Error('Jobs working capacity migration requires its managed transaction.');
    const read = <T>(sql: string, ...args: string[]): T | null => {
      const statement = database.prepare<T, string[]>(sql);
      try { return statement.get(...args); } finally { statement.finalize(); }
    };
    if (read<{ foreign_keys: number }>('PRAGMA foreign_keys')?.foreign_keys !== 1) throw new Error('Jobs working capacity migration requires foreign-key enforcement.');
    const count = (sql: string, ...args: string[]) => Number(read<{ n: number }>(sql, ...args)!.n);
    const usage = database.prepare<{ count: number }, string>('SELECT count FROM _jobs_usage WHERE id=?');
    try {
      const retained = (id: string) => { const row = usage.get(id); return row ? jobInteger(row.count) : 0; };
      const exact = (id: string, actual: number) => { if (retained(id) !== actual) throw new Error('Jobs historical capacity accounting is inconsistent.'); };
      const badSchedule = read(`SELECT 1 FROM job_schedules s LEFT JOIN _jobs_cursors c ON c.id=s.id
        LEFT JOIN _jobs_admissions a ON a.schedule_id=s.id AND a.generation=s.generation
        LEFT JOIN _jobs_owner owner ON owner.id='application' AND owner.scope_id=s.scope_id
        LEFT JOIN _jobs_sources source ON source.id=s.source_id AND source.scope_id=s.scope_id
        WHERE c.id IS NULL OR c.scope_id<>s.scope_id OR a.id IS NULL OR a.scope_id<>s.scope_id
          OR owner.id IS NULL OR (s.source_id IS NOT NULL AND source.id IS NULL) LIMIT 1`);
      const badOccurrence = read(`SELECT 1 FROM _jobs_occurrences o LEFT JOIN job_schedules s ON s.id=o.schedule_id
        LEFT JOIN _jobs_admissions a ON a.id=o.admission_id
        WHERE s.id IS NULL OR o.scope_id<>s.scope_id OR a.id IS NULL OR a.scope_id<>o.scope_id
          OR a.schedule_id<>o.schedule_id OR a.generation<>o.generation OR o.generation>s.generation
          OR o.state NOT IN ('pending','claimed','dispatched','blocked','terminal','cancelled')
          OR (o.workflow_id IS NULL)<>(o.receipt_json IS NULL) LIMIT 1`);
      const badSource = read(`SELECT 1 FROM _jobs_sources s LEFT JOIN _jobs_owner owner ON owner.id='application' AND owner.scope_id=s.scope_id
        LEFT JOIN _jobs_source_policies p ON p.source_id=s.id AND p.generation=s.current_generation
        WHERE owner.id IS NULL OR p.id IS NULL OR p.scope_id<>s.scope_id LIMIT 1`);
      if (badSchedule || badOccurrence || badSource || read('PRAGMA foreign_key_check')) throw new Error('Jobs working capacity cannot admit inconsistent historical ownership.');
      exact('schedules', count('SELECT count(*) n FROM job_schedules'));
      exact('occurrences', count('SELECT count(*) n FROM _jobs_occurrences'));
      exact('sources', count('SELECT count(*) n FROM _jobs_sources'));
      exact('source-policies', count('SELECT count(*) n FROM _jobs_source_policies'));
      if (retained('intents') + retained('sourceRecoveryIntents') !== count('SELECT (SELECT count(*) FROM _jobs_intents)+(SELECT count(*) FROM _jobs_source_intents) n')) throw new Error('Jobs historical receipt accounting is inconsistent.');
      const sources = database.prepare<{ id: string; identity_json: string; identity_hash: string; scope_id: string }, []>('SELECT id,identity_json,identity_hash,scope_id FROM _jobs_sources');
      try {
        for (const source of sources.iterate()) {
          const identity = normalizeJobSourceIdentity(JSON.parse(source.identity_json));
          if (jobSourceId(identity) !== source.id || jobHash(identity) !== source.identity_hash || identity.scopeId !== source.scope_id) throw new Error('Jobs historical source identity is inconsistent.');
          exact('source:' + source.identity_hash, count('SELECT count(*) n FROM job_schedules WHERE scope_id=? AND source_id=?', source.scope_id, source.id));
        }
      } finally { sources.finalize(); }
      for (const [table, schema] of Object.entries(JOB_CAPACITY_TABLES)) database.run('CREATE TABLE ' + quoteSqlIdentifier(table) + ' ('
        + Object.entries(schema).map(([name, definition]) => quoteSqlIdentifier(name) + ' ' + definition).join(',') + ')');
      database.run(`INSERT INTO _jobs_schedule_work(id,scope_id,source_id,open_occurrences,occupied)
        SELECT s.id,s.scope_id,s.source_id,COALESCE(o.n,0),CASE WHEN c.next_due_at IS NOT NULL OR COALESCE(o.n,0)>0 THEN 1 ELSE 0 END
        FROM job_schedules s JOIN _jobs_cursors c ON c.id=s.id AND c.scope_id=s.scope_id
        LEFT JOIN (SELECT schedule_id,scope_id,count(*) n FROM _jobs_occurrences
          WHERE state IN ('pending','claimed','dispatched','blocked') GROUP BY schedule_id,scope_id) o ON o.schedule_id=s.id AND o.scope_id=s.scope_id`);
      database.run("INSERT INTO _jobs_work_usage(id,count) SELECT 'schedules',COALESCE(sum(occupied),0) FROM _jobs_schedule_work");
      database.run("INSERT INTO _jobs_work_usage(id,count) SELECT 'occurrences',COALESCE(sum(open_occurrences),0) FROM _jobs_schedule_work");
      database.run(`INSERT INTO _jobs_work_usage(id,count) SELECT 'source:'||source.id,COALESCE(sum(work.occupied),0)
        FROM _jobs_sources source LEFT JOIN _jobs_schedule_work work ON work.source_id=source.id GROUP BY source.id`);
      if (count('SELECT count(*) n FROM _jobs_schedule_work') !== count('SELECT count(*) n FROM job_schedules')
        || count("SELECT count(*) n FROM _jobs_work_usage WHERE id='schedules' AND count=(SELECT COALESCE(sum(occupied),0) FROM _jobs_schedule_work)") !== 1
        || count("SELECT count(*) n FROM _jobs_work_usage WHERE id='occurrences' AND count=(SELECT COALESCE(sum(open_occurrences),0) FROM _jobs_schedule_work)") !== 1) throw new Error('Jobs working capacity backfill could not be verified.');
      for (const table of Object.keys(JOB_CAPACITY_TABLES)) {
        database.run(`CREATE TRIGGER ${table}_retain BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Private job working membership must be retained'); END`);
        database.run(`CREATE TRIGGER ${table}_no_replace BEFORE INSERT ON ${table} WHEN EXISTS(SELECT 1 FROM ${table} WHERE id=NEW.id)
          BEGIN SELECT RAISE(ABORT,'Private job working identity cannot be replaced'); END`);
        database.run(`CREATE TRIGGER ${table}_identity BEFORE UPDATE OF id ON ${table} WHEN OLD.id IS NOT NEW.id
          BEGIN SELECT RAISE(ABORT,'Private job working identity is immutable'); END`);
      }
      database.run(`CREATE TRIGGER jobs_work_parent BEFORE INSERT ON _jobs_schedule_work WHEN NOT EXISTS(
        SELECT 1 FROM job_schedules s WHERE s.id=NEW.id AND s.scope_id=NEW.scope_id AND s.source_id IS NEW.source_id)
        BEGIN SELECT RAISE(ABORT,'Private job working ownership is inconsistent'); END`);
      database.run(`CREATE TRIGGER jobs_work_owner_identity BEFORE UPDATE OF scope_id,source_id ON _jobs_schedule_work
        WHEN OLD.scope_id IS NOT NEW.scope_id OR OLD.source_id IS NOT NEW.source_id
        BEGIN SELECT RAISE(ABORT,'Private job working ownership is immutable'); END`);
      database.run(`CREATE TRIGGER jobs_work_closed BEFORE UPDATE ON _jobs_schedule_work WHEN NEW.occupied=0 AND (
        NEW.open_occurrences<>0 OR EXISTS(SELECT 1 FROM _jobs_cursors c WHERE c.id=NEW.id AND c.next_due_at IS NOT NULL)
        OR EXISTS(SELECT 1 FROM _jobs_occurrences o WHERE o.scope_id=NEW.scope_id AND o.schedule_id=NEW.id AND o.state IN ('pending','claimed','dispatched','blocked')))
        BEGIN SELECT RAISE(ABORT,'Private job working closure is inconsistent'); END`);
    } finally { usage.finalize(); }
  },
});
