/** Append-only SYSTEM foundation for explicit contact provenance and durable challenges. */
import type { Migration } from '../types';
import { USER_CONTACT_SCHEMA_OBJECTS, inspectUserContactSchema, widenContactEmailOutbox } from './041_guardian_user_contacts_schema';
import type { ReactiveDB } from '../../sync/reactive-db';

export const migration: Migration = {
  version: '041', description: 'Guardian contact possession proofs and challenges',
  safety: 'safe', backupRequired: false,
  up(db) {
    const adapter = { prepare: (sql: string) => db.query(sql), exec: (sql: string) => db.exec(sql) } as Pick<ReactiveDB, 'prepare' | 'exec'>;
    if (inspectUserContactSchema(adapter) === 'invalid') throw new Error('Guardian contact schema is incompatible; resolve the SYSTEM schema collision before migrating');
    widenContactEmailOutbox(adapter);
    for (const object of USER_CONTACT_SCHEMA_OBJECTS) db.exec(object.sql);
    if (inspectUserContactSchema(adapter) !== 'ready') throw new Error('Guardian contact schema installation failed');
  },
};
