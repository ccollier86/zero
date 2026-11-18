/** Fixed private Fabric realm. Pure import: no main app, database, provider, timer or actor is started. */
import { defineDatabaseRealm, type DatabaseReadQueryHandler } from '../databases/database-realm';
import { quoteSqlIdentifier } from '../sync/identity';
import { JobsError } from './error';
import { JOB_TABLES } from './realm-schema';
import { bindJobOwner, changeJobSchedule, createJobSchedule } from './realm-control';
import { blockJobOccurrence, claimJobOccurrence, completeJobOccurrence, materializeJobOccurrences, receiveJobDispatch, blockJobCursor, deferJobOccurrenceClaim } from './realm-dispatch';
import { dueJobSchedules, listJobOccurrences, listJobSchedules, pendingJobOccurrences, readJobDispatchContext, readJobIntent, readJobOwner, readJobSchedule, readJobScheduleContext, dispatchedJobOccurrences, readJobWake } from './realm-queries';
import { withJobCommitHints } from './commit-hints';
import { CURRENT_JOB_TABLES } from './realm-source-schema';
import { JOB_SOURCE_MIGRATION } from './realm-source-migration';
import { registerJobSource, retireJobSource, createSourceJobSchedule, changeSourceJobSchedule } from './realm-source-control';
import { getJobSource, readSourceJobSchedule, readSourceJobIntent, readJobSourceDispatch, readSourceJobExecution } from './realm-source-queries';

function query(handler: (context: Parameters<DatabaseReadQueryHandler>[0], input: unknown) => unknown): DatabaseReadQueryHandler {
  return (context, input) => {
    try { return { ok: true, value: handler(context, input) } as never; }
    catch (error) { if (error instanceof JobsError) return { ok: false, code: error.code, status: error.status }; throw error; }
  };
}
export const jobsRealm = defineDatabaseRealm({
  name: 'zero-jobs', version: '2', tables: CURRENT_JOB_TABLES,
  migrations: [{ version: '001', description: 'Private scheduling ownership, immutable admissions, permanent intents and fenced occurrence handoffs', safety: 'safe', up(database) {
    for (const [table, columns] of Object.entries(JOB_TABLES)) database.run('CREATE TABLE ' + quoteSqlIdentifier(table) + ' (' + Object.entries(columns).map(([name, definition]) => quoteSqlIdentifier(name) + ' ' + definition).join(',') + ')');
    for (const sql of [
      'CREATE INDEX jobs_schedule_page ON job_schedules(scope_id,created_at DESC,id DESC)',
      'CREATE INDEX jobs_schedule_owner_page ON job_schedules(scope_id,actor_id,created_at DESC,id DESC)',
      'CREATE INDEX jobs_schedule_control_page ON job_schedules(scope_id,control,created_at DESC,id DESC)',
      'CREATE INDEX jobs_schedule_owner_control_page ON job_schedules(scope_id,actor_id,control,created_at DESC,id DESC)',
      'CREATE UNIQUE INDEX jobs_admission_generation ON _jobs_admissions(schedule_id,generation)',
      'CREATE INDEX jobs_due ON _jobs_cursors(scope_id,next_due_at,id) WHERE blocked_code IS NULL',
      'CREATE UNIQUE INDEX jobs_occurrence_identity ON _jobs_occurrences(schedule_id,generation,scheduled_at)',
      'CREATE INDEX jobs_occurrence_page ON _jobs_occurrences(scope_id,schedule_id,scheduled_at DESC,id DESC)',
      'CREATE INDEX jobs_occurrence_overlap ON _jobs_occurrences(scope_id,schedule_id,state,generation,scheduled_at DESC,id DESC)',
      'CREATE INDEX jobs_occurrence_pending ON _jobs_occurrences(scope_id,state,scheduled_at,id)',
      'CREATE INDEX jobs_occurrence_claims ON _jobs_occurrences(scope_id,state,lease_until,scheduled_at,id)',
      'CREATE INDEX jobs_occurrence_workflow ON _jobs_occurrences(scope_id,state,workflow_id)',
    ]) database.run(sql);
    for (const table of ['_jobs_owner', '_jobs_admissions', '_jobs_intents']) for (const operation of ['UPDATE', 'DELETE']) {
      database.run(`CREATE TRIGGER ${table}_${operation.toLowerCase()} BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT,'Private job evidence is immutable'); END`);
    }
    // REPLACE can delete a conflicting row without ordinary DELETE triggers
    // unless recursive_triggers is enabled. Reject replacement at INSERT too;
    // do not depend on connection flags for immutable retained evidence.
    for (const table of ['_jobs_owner', 'job_schedules', '_jobs_admissions', '_jobs_intents', '_jobs_occurrences']) {
      const duplicate = `id=NEW.id` + (table === '_jobs_admissions' ? ' OR (schedule_id=NEW.schedule_id AND generation=NEW.generation)'
        : table === '_jobs_occurrences' ? ' OR (schedule_id=NEW.schedule_id AND generation=NEW.generation AND scheduled_at=NEW.scheduled_at)' : '');
      database.run(`CREATE TRIGGER ${table}_no_replace BEFORE INSERT ON ${table} WHEN EXISTS(SELECT 1 FROM ${table} WHERE ${duplicate}) BEGIN SELECT RAISE(ABORT,'Private job identity cannot be replaced'); END`);
    }
    for (const table of ['job_schedules', '_jobs_occurrences']) database.run(`CREATE TRIGGER ${table}_retain BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Private job history must be retained'); END`);
    for (const table of ['job_schedules', '_jobs_admissions', '_jobs_cursors', '_jobs_occurrences', '_jobs_intents']) {
      database.run(`CREATE TRIGGER ${table}_scope BEFORE INSERT ON ${table} WHEN NOT EXISTS(SELECT 1 FROM _jobs_owner WHERE id='application' AND scope_id=NEW.scope_id) BEGIN SELECT RAISE(ABORT,'Private job scope is inconsistent'); END`);
      database.run(`CREATE TRIGGER ${table}_scope_update BEFORE UPDATE OF id,scope_id ON ${table} WHEN OLD.id IS NOT NEW.id OR OLD.scope_id IS NOT NEW.scope_id BEGIN SELECT RAISE(ABORT,'Private job identity is immutable'); END`);
    }
    database.run(`CREATE TRIGGER jobs_schedule_identity BEFORE UPDATE OF actor_id,principal,run_as,created_at ON job_schedules
      WHEN OLD.actor_id IS NOT NEW.actor_id OR OLD.principal IS NOT NEW.principal OR OLD.run_as IS NOT NEW.run_as OR OLD.created_at IS NOT NEW.created_at
      BEGIN SELECT RAISE(ABORT,'Private schedule ownership is immutable'); END`);
    database.run(`CREATE TRIGGER jobs_schedule_revision BEFORE UPDATE ON job_schedules
      WHEN NEW.revision<>OLD.revision+1 OR NEW.generation<OLD.generation OR NEW.generation>OLD.generation+1 OR OLD.control='cancelled'
      BEGIN SELECT RAISE(ABORT,'Private schedule revision is inconsistent'); END`);
    for (const table of ['_jobs_admissions', '_jobs_occurrences']) database.run(`CREATE TRIGGER ${table}_parent BEFORE INSERT ON ${table}
      WHEN NOT EXISTS(SELECT 1 FROM job_schedules WHERE id=NEW.schedule_id AND scope_id=NEW.scope_id)
      BEGIN SELECT RAISE(ABORT,'Private job parent is inconsistent'); END`);
    database.run(`CREATE TRIGGER jobs_occurrence_admission BEFORE INSERT ON _jobs_occurrences
      WHEN NOT EXISTS(SELECT 1 FROM _jobs_admissions WHERE id=NEW.admission_id AND schedule_id=NEW.schedule_id AND scope_id=NEW.scope_id AND generation=NEW.generation)
      BEGIN SELECT RAISE(ABORT,'Private occurrence admission is inconsistent'); END`);
    database.run(`CREATE TRIGGER jobs_occurrence_identity BEFORE UPDATE OF schedule_id,admission_id,generation,scheduled_at,created_at ON _jobs_occurrences
      WHEN OLD.schedule_id IS NOT NEW.schedule_id OR OLD.admission_id IS NOT NEW.admission_id OR OLD.generation IS NOT NEW.generation OR OLD.scheduled_at IS NOT NEW.scheduled_at OR OLD.created_at IS NOT NEW.created_at
      BEGIN SELECT RAISE(ABORT,'Private occurrence identity is immutable'); END`);
    database.run(`CREATE TRIGGER jobs_occurrence_receipt BEFORE UPDATE OF workflow_id,receipt_json ON _jobs_occurrences
      WHEN OLD.receipt_json IS NOT NULL AND (OLD.receipt_json IS NOT NEW.receipt_json OR OLD.workflow_id IS NOT NEW.workflow_id)
      BEGIN SELECT RAISE(ABORT,'Private dispatch receipt is immutable'); END`);
    database.run(`CREATE TRIGGER jobs_occurrence_stage BEFORE UPDATE ON _jobs_occurrences WHEN NOT(
      (OLD.state='pending' AND NEW.state IN ('claimed','terminal','cancelled')) OR (OLD.state='claimed' AND NEW.state IN ('claimed','dispatched','blocked')) OR
      (OLD.state='dispatched' AND NEW.state='terminal')) BEGIN SELECT RAISE(ABORT,'Private occurrence stage is inconsistent'); END`);
  } }, JOB_SOURCE_MIGRATION],
  commands: withJobCommitHints({ 'jobs.owner.bind': bindJobOwner, 'jobs.schedule.create': createJobSchedule, 'jobs.schedule.change': changeJobSchedule,
    'jobs.materialize': materializeJobOccurrences, 'jobs.claim': claimJobOccurrence, 'jobs.claim.defer': deferJobOccurrenceClaim, 'jobs.dispatch': receiveJobDispatch,
    'jobs.block': blockJobOccurrence, 'jobs.complete': completeJobOccurrence, 'jobs.cursor.block': blockJobCursor,
    'jobs.source.register': registerJobSource, 'jobs.source.retire': retireJobSource,
    'jobs.source.schedule.create': createSourceJobSchedule, 'jobs.source.schedule.change': changeSourceJobSchedule }),
  queries: { 'jobs.owner.check': query(readJobOwner), 'jobs.schedule': query(readJobSchedule), 'jobs.schedules': query(listJobSchedules), 'jobs.receipt': query(readJobIntent), 'jobs.occurrences': query(listJobOccurrences),
    'jobs.due': query(dueJobSchedules), 'jobs.pending': query(pendingJobOccurrences), 'jobs.context': query(readJobDispatchContext),
    'jobs.schedule.context': query(readJobScheduleContext), 'jobs.dispatched': query(dispatchedJobOccurrences), 'jobs.wake': query(readJobWake),
    'jobs.source': query(getJobSource), 'jobs.source.schedule': query(readSourceJobSchedule),
    'jobs.source.receipt': query(readSourceJobIntent), 'jobs.source.dispatch': query(readJobSourceDispatch),
    'jobs.source.execution': query(readSourceJobExecution) },
});
