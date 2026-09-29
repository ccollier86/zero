/** Add durable, pseudonymous public-auth admission accounting. */

import type { Database } from 'bun:sqlite';
import type { ReactiveDB } from '../../sync/reactive-db';
import type { Migration } from '../types';
import { defineAuthRequestAdmissionTables } from './012_auth_request_admission_schema';

export const migration: Migration = {
  version: '012',
  description: 'Durable public authentication request admission',
  safety: 'safe',

  up(db: Database) {
    defineAuthRequestAdmissionTables(db as unknown as ReactiveDB);
  },
};
