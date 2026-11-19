/** Additive 003 declarations. Historical 001/002 maps remain immutable inputs. */
import type { TableSchema } from '../sync/types';
import { CURRENT_JOB_TABLES } from './realm-source-schema';

export const JOB_CAPACITY_TABLES: Record<string, TableSchema> = {
  _jobs_schedule_work: {
    id: 'TEXT PRIMARY KEY REFERENCES job_schedules(id)', scope_id: 'TEXT NOT NULL', source_id: 'TEXT REFERENCES _jobs_sources(id)',
    open_occurrences: "INTEGER NOT NULL CHECK(typeof(open_occurrences)='integer' AND open_occurrences BETWEEN 0 AND 9007199254740991)",
    occupied: 'INTEGER NOT NULL CHECK(occupied IN (0,1))',
  },
  _jobs_work_usage: {
    id: 'TEXT PRIMARY KEY', count: "INTEGER NOT NULL CHECK(typeof(count)='integer' AND count BETWEEN 0 AND 9007199254740991)",
  },
};
export const JOB_CAPACITY_CURRENT_TABLES: Record<string, TableSchema> = { ...CURRENT_JOB_TABLES, ...JOB_CAPACITY_TABLES };
for (const schema of Object.values(JOB_CAPACITY_TABLES)) Object.freeze(schema);
Object.freeze(JOB_CAPACITY_TABLES); Object.freeze(JOB_CAPACITY_CURRENT_TABLES);
