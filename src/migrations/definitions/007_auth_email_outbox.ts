/** Add the durable, privacy-safe auth email delivery outbox. */

import type { Database } from 'bun:sqlite';
import {
  createAuthEmailOutboxSchemaV007 as createAuthEmailOutboxSchema,
} from './007_auth_email_outbox_schema';
import type { Migration } from '../migrator';

export const migration: Migration = {
  version: '007',
  description: 'Durable auth email delivery outbox',
  safety: 'safe',

  up(db: Database) {
    createAuthEmailOutboxSchema((sql) => db.run(sql));
  },
};
