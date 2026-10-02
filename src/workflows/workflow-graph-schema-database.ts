/**
 * workflow-graph-schema-database.ts
 *
 * Defines the narrow database surface consumed by runtime workflow schema
 * installation. It owns no DDL, migration policy, or compatibility checks.
 */

import type { ReactiveDB } from '../sync/reactive-db';

/** Minimal SQLite surface required by workflow runtime schema installation. */
export type WorkflowSchemaDatabase = Pick<ReactiveDB, 'exec' | 'prepare'>;
