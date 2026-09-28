/** Add durable append-only authorization/control-plane audit storage. */

import type { Database } from 'bun:sqlite';
import { defineAuthAuditTables } from '../../auth/auth-audit-schema';
import type { ReactiveDB } from '../../sync/reactive-db';
import type { Migration } from '../types';

export const migration: Migration = {
  version: '018',
  description: 'Durable authorization and control-plane audit events',
  safety: 'safe',

  up(db: Database) {
    defineAuthAuditTables(db as unknown as ReactiveDB);
  },
};
