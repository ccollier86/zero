/** Add private sealed authority and execution leases for durable workflows. */

import type { Database } from 'bun:sqlite';
import type { ReactiveDB } from '../../sync/reactive-db';
import type { Migration } from '../types';
import {
  defineWorkflowExecutionAuthorityTables,
} from './014_workflow_execution_authority_schema';

export const migration: Migration = {
  version: '014',
  description: 'Sealed and revalidated durable workflow execution authority',
  safety: 'safe',

  up(db: Database) {
    defineWorkflowExecutionAuthorityTables(db as unknown as ReactiveDB);
  },
};
