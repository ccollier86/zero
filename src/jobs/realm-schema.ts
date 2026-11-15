/** Private Fabric state. Only semantic schedule-control rows are ordinary tracked records; ticks/claims stay private. */
import type { TableSchema } from '../sync/types';
export const JOB_TABLES: Record<string, TableSchema> = {
  _jobs_owner: { id: "TEXT PRIMARY KEY CHECK(id='application')", owner_id: 'TEXT NOT NULL', scope_id: 'TEXT NOT NULL' },
  job_schedules: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', actor_id: 'TEXT NOT NULL', principal: 'TEXT NOT NULL', definition_name: 'TEXT NOT NULL', definition_version: 'TEXT NOT NULL',
    run_as: "TEXT NOT NULL CHECK(run_as IN ('actor','service'))", updated_by: 'TEXT NOT NULL', control: "TEXT NOT NULL CHECK(control IN ('active','paused','cancelled'))", revision: 'INTEGER NOT NULL CHECK(revision>0)', generation: 'INTEGER NOT NULL CHECK(generation>0)', created_at: 'INTEGER NOT NULL', updated_at: 'INTEGER NOT NULL' },
  _jobs_admissions: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', schedule_id: 'TEXT NOT NULL REFERENCES job_schedules(id)', generation: 'INTEGER NOT NULL CHECK(generation>0)', command_json: 'TEXT NOT NULL', digest: 'TEXT NOT NULL', authority_json: 'TEXT NOT NULL', authority_mac: 'TEXT NOT NULL' },
  _jobs_cursors: { id: 'TEXT PRIMARY KEY REFERENCES job_schedules(id)', scope_id: 'TEXT NOT NULL', next_due_at: 'INTEGER', skipped: 'INTEGER NOT NULL CHECK(skipped IN (0,1))', blocked_code: 'TEXT' },
  _jobs_occurrences: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', schedule_id: 'TEXT NOT NULL REFERENCES job_schedules(id)', admission_id: 'TEXT NOT NULL REFERENCES _jobs_admissions(id)', generation: 'INTEGER NOT NULL CHECK(generation>0)', scheduled_at: 'INTEGER NOT NULL',
    state: "TEXT NOT NULL CHECK(state IN ('pending','claimed','dispatched','terminal','blocked','cancelled'))", lease_nonce: 'TEXT', lease_until: 'INTEGER', lease_generation: 'INTEGER NOT NULL CHECK(lease_generation>=0)', workflow_id: 'TEXT', receipt_json: 'TEXT', terminal_status: 'TEXT', error_code: 'TEXT', created_at: 'INTEGER NOT NULL', updated_at: 'INTEGER NOT NULL' },
  _jobs_intents: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', principal: 'TEXT NOT NULL', digest: 'TEXT NOT NULL', result_json: 'TEXT NOT NULL', created_at: 'INTEGER NOT NULL' },
  _jobs_usage: { id: 'TEXT PRIMARY KEY', count: 'INTEGER NOT NULL CHECK(count>=0)' },
};
// The migration closure uses the same definitions as realm admission. Neither may drift after import.
for (const table of Object.values(JOB_TABLES)) Object.freeze(table);
Object.freeze(JOB_TABLES);
