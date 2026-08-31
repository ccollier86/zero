/** Add the durable, privacy-safe auth email delivery outbox. */

import type { Database } from 'bun:sqlite';
import { createAuthEmailOutboxSchema } from '../../auth/auth-email-outbox-schema';
import type { Migration } from '../migrator';

export const migration: Migration = {
  version: '007',
  description: 'Durable auth email delivery outbox',
  safety: 'safe',

  up(db: Database) {
    createAuthEmailOutboxSchema((sql) => db.run(sql));
  },
};
