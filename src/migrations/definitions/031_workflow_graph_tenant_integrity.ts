/** Upgrade released workflow graph tables to tenant-safe observable relations. */

import type { Database } from 'bun:sqlite';
import type { Migration } from '../migrator';
import {
  upgradeWorkflowGraphTenantIntegrity,
} from './031_workflow_graph_integrity_schema';

export const migration: Migration = {
  version: '031',
  description: 'Workflow graph tenant integrity and observable relations',
  safety: 'guarded',
  backupRequired: true,

  up(db: Database) {
    upgradeWorkflowGraphTenantIntegrity(db);
  },
};
