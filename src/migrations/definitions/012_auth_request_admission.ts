/** Add durable, pseudonymous public-auth admission accounting. */

import type { Database } from 'bun:sqlite';
import { defineAuthRequestAdmissionTables } from '../../auth/auth-request-admission-schema';
import type { ReactiveDB } from '../../sync/reactive-db';
import type { Migration } from '../types';

export const migration: Migration = {
  version: '012',
  description: 'Durable public authentication request admission',
  safety: 'safe',

  up(db: Database) {
    defineAuthRequestAdmissionTables(db as unknown as ReactiveDB);
  },
};
