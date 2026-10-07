/** Immutable, additive SYSTEM profile completion purpose and enrollment ledger. */
import type { Migration } from '../types';
import type { ReactiveDB } from '../../sync/reactive-db';
import { PROFILE_COMPLETION_SCHEMA, inspectProfileCompletionSchema } from './043_guardian_profile_completion_schema';
export const migration: Migration = {
  version: '043', description: 'Guardian required profile completion continuations', safety: 'safe', backupRequired: false,
  up(db) {
    const adapter = { prepare: (sql: string) => db.query(sql) } as Pick<ReactiveDB, 'prepare'>;
    if (inspectProfileCompletionSchema(adapter) === 'invalid') throw new Error('Guardian completion schema is incompatible; resolve the SYSTEM schema collision before migrating');
    for (const object of PROFILE_COMPLETION_SCHEMA) db.exec(object.sql);
    if (inspectProfileCompletionSchema(adapter) !== 'ready') throw new Error('Guardian completion schema installation failed');
  },
};
