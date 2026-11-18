/** Historical 002 inputs and current declarations. Do not change the 001/002 migration bindings in later upgrades. */
import type { TableSchema } from '../sync/types';
import { JOB_TABLES } from './realm-schema';

export const JOB_SOURCE_TABLES: Record<string, TableSchema> = {
  _jobs_sources: {
    id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', identity_json: 'TEXT NOT NULL', identity_hash: 'TEXT NOT NULL',
    current_generation: 'INTEGER NOT NULL CHECK(current_generation>0)', revision: 'INTEGER NOT NULL CHECK(revision>0)',
    state: "TEXT NOT NULL CHECK(state IN ('active','retired'))", created_at: 'INTEGER NOT NULL', updated_at: 'INTEGER NOT NULL',
  },
  _jobs_source_policies: {
    id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', source_id: 'TEXT NOT NULL REFERENCES _jobs_sources(id)',
    generation: 'INTEGER NOT NULL CHECK(generation>0)', contract_json: 'TEXT NOT NULL', digest: 'TEXT NOT NULL', created_at: 'INTEGER NOT NULL',
  },
  _jobs_source_intents: {
    id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', source_id: 'TEXT NOT NULL REFERENCES _jobs_sources(id)',
    policy_generation: 'INTEGER NOT NULL CHECK(policy_generation>0)', digest: 'TEXT NOT NULL', result_json: 'TEXT NOT NULL', created_at: 'INTEGER NOT NULL',
  },
};

export const JOB_SOURCE_SCHEDULE_TABLE: TableSchema = {
  ...JOB_TABLES.job_schedules,
  actor_id: 'TEXT', principal: 'TEXT', updated_by: 'TEXT',
  source_id: "TEXT REFERENCES _jobs_sources(id) CHECK((source_id IS NULL AND actor_id IS NOT NULL AND principal IS NOT NULL AND updated_by IS NOT NULL) OR (source_id IS NOT NULL AND actor_id IS NULL AND principal IS NULL AND updated_by IS NULL AND run_as='service'))",
};

export const CURRENT_JOB_TABLES: Record<string, TableSchema> = {
  ...JOB_TABLES,
  job_schedules: JOB_SOURCE_SCHEDULE_TABLE,
  ...JOB_SOURCE_TABLES,
};

for (const table of Object.values(JOB_SOURCE_TABLES)) Object.freeze(table);
Object.freeze(JOB_SOURCE_TABLES);
Object.freeze(JOB_SOURCE_SCHEDULE_TABLE);
Object.freeze(CURRENT_JOB_TABLES);
