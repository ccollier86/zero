/** Additive 004. Settlement obligations are not provider delivery or unlimited storage. */
import type { TableSchema } from '../sync/types';
import { JOB_CAPACITY_CURRENT_TABLES } from './realm-capacity-schema';

export const JOB_SETTLEMENT_SOURCE_TABLE = '_jobs_source_settlement';
export const JOB_SETTLEMENT_SCHEDULE_TABLE = '_jobs_schedule_settlement';
export const JOB_SETTLEMENT_OCCURRENCE_TABLE = '_jobs_occurrence_settlement';
export const JOB_SETTLEMENT_USAGE_TABLE = '_jobs_settlement_usage';
export const JOB_SETTLEMENT_STATE_TABLE = '_jobs_settlement_state';
export const JOB_SETTLEMENT_KEYS = Object.freeze({ transport: 'transport', actorControl: 'actor-control', sourceControl: 'source-control' });
const unit = (max: number) => `INTEGER NOT NULL CHECK(typeof(units)='integer' AND units BETWEEN 0 AND ${max})`;
export const JOB_SETTLEMENT_TABLES: Readonly<Record<string, TableSchema>> = Object.freeze({
  [JOB_SETTLEMENT_SOURCE_TABLE]: Object.freeze({ id: 'TEXT PRIMARY KEY REFERENCES _jobs_sources(id)', scope_id: 'TEXT NOT NULL', units: unit(1) }),
  [JOB_SETTLEMENT_SCHEDULE_TABLE]: Object.freeze({ id: 'TEXT PRIMARY KEY REFERENCES job_schedules(id)', scope_id: 'TEXT NOT NULL',
    source_id: 'TEXT REFERENCES _jobs_sources(id)', units: unit(2) }),
  [JOB_SETTLEMENT_OCCURRENCE_TABLE]: Object.freeze({ id: 'TEXT PRIMARY KEY REFERENCES _jobs_occurrences(id)', scope_id: 'TEXT NOT NULL',
    schedule_id: 'TEXT NOT NULL REFERENCES job_schedules(id)', units: unit(2) }),
  [JOB_SETTLEMENT_USAGE_TABLE]: Object.freeze({ id: "TEXT PRIMARY KEY CHECK(id IN ('transport','actor-control','source-control'))",
    count: "INTEGER NOT NULL CHECK(typeof(count)='integer' AND count BETWEEN 0 AND 9007199254740991)" }),
  [JOB_SETTLEMENT_STATE_TABLE]: Object.freeze({ id: "TEXT PRIMARY KEY CHECK(id='application')", version: "INTEGER NOT NULL CHECK(typeof(version)='integer' AND version=4)" }),
});
export const JOB_SETTLEMENT_CURRENT_TABLES: Readonly<Record<string, TableSchema>> = Object.freeze({ ...JOB_CAPACITY_CURRENT_TABLES, ...JOB_SETTLEMENT_TABLES });
