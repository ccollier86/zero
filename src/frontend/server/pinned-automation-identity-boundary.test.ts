import { describe, expect, test } from 'bun:test';

import { defineAuthTables } from '../../auth/auth-schema';
import { defineDatabaseAutomations } from '../../database-automations/database-automations';
import { DatabaseAutomationRuntime } from '../../database-automations/database-automation-runtime';
import { defineDatabaseFunction } from '../../database-automations/database-function';
import { defineDatabaseTrigger } from '../../database-automations/database-trigger';
import type { DatabaseTransactionFunctionCapability } from '../../database-automations/database-transaction-function-capability';
import type { DatabaseTriggerFunctionInput } from '../../database-automations/database-trigger-input';
import { DatabaseRuntime } from '../../databases/database-runtime';
import { createPlatformSQLiteService } from '../../persistence';
import { defineTable, field } from '../../schema';
import { createAppIdentityProjectionRuntime } from './identity-projection-runtime';

/** Genuine pinned projection composition, entirely in synthetic ephemeral DBs. */
describe('pinned automation Guardian anchor boundary', () => {
  for (const [operation, mutate] of [
    ['create', (db: DatabaseTransactionFunctionCapability) => db.createStrict('users', { user_id: 'fabricated' })],
    ['update', (db: DatabaseTransactionFunctionCapability) => db.update('users', 'canonical', { user_id: 'fabricated' })],
    ['delete', (db: DatabaseTransactionFunctionCapability) => db.delete('users', 'canonical')],
    ['nested-delete', (db: DatabaseTransactionFunctionCapability) => db.transaction((nested) => nested.delete('users', 'canonical'))],
  ] as const) {
    test(`rejects ${operation} through the registered transaction capability`, async () => {
      const records = defineTable('records', {
        owner_user_id: field.guardianUser(),
      }, { pk: 'record_id' });
      const system = DatabaseRuntime.open({
        id: 'synthetic-system', role: 'system', ownsSQLite: true,
        sqlite: createPlatformSQLiteService({ mode: 'ephemeral', emitTelemetry: false }),
      });
      const application = DatabaseRuntime.open({
        id: 'synthetic-application', role: 'default', ownsSQLite: true,
        sqlite: createPlatformSQLiteService({ mode: 'ephemeral', emitTelemetry: false }),
      });
      let automations: DatabaseAutomationRuntime | undefined;
      try {
        defineAuthTables(system.db);
        system.db.prepare(`
          INSERT INTO users (user_id, username, email, role, status, created_at)
          VALUES ('canonical', 'synthetic', 'synthetic@example.test', 'user', 'active', 1)
        `).run();
        const projection = createAppIdentityProjectionRuntime({
          systemDB: system.db, applicationDB: application.db,
          tables: { records: records.serverTable },
          tenancyMode: 'single', getDatabaseManager: () => null,
          emitCode: () => ({}) as never,
        });
        expect(projection).not.toBeNull();
        // Managed startup installs projection before Sync registers app tables.
        application.db.defineTable('records', records.serverTable);
        await projection!.lifecycle.initialize?.();
        // The managed store has installed/projected anchors, but intentionally
        // does not register them as app ReactiveDB CRUD tables.
        expect(application.db.prepare('SELECT user_id FROM users').all())
          .toEqual([{ user_id: 'canonical' }]);
        expect(() => application.db.get('users', 'canonical'))
          .toThrow("Table 'users' is not defined");

        const action = defineDatabaseFunction<DatabaseTriggerFunctionInput, void, DatabaseTransactionFunctionCapability>({
          name: 'records.anchor-mutation', version: 1, mode: 'transaction',
          handler: ({ transaction }) => { mutate(transaction); },
        });
        const registry = defineDatabaseAutomations({
          functions: [action],
          triggers: [defineDatabaseTrigger({
            name: 'records.created', version: 1, table: 'records',
            after: { insert: true }, run: action,
          })],
        });
        // Exact pinned runtime options used by managed composition; there is
        // deliberately no fabricated registration or readOnlyTables override.
        automations = new DatabaseAutomationRuntime({
          db: application.db, registry, realmName: 'application',
          realmFingerprint: registry.fingerprint, storageMode: 'ephemeral',
          outbox: { enabled: false },
        });
        expect(() => application.db.createStrict('records', {
          record_id: 'must-rollback', owner_user_id: 'canonical',
        })).toThrow(expect.objectContaining({
          code: 'DATABASE_EXECUTOR_FAILED', outcome: 'not-committed', retryable: false,
        }));
        expect(application.db.get('records', 'must-rollback')).toBeNull();
        expect(application.db.prepare('SELECT user_id FROM users').all())
          .toEqual([{ user_id: 'canonical' }]);
        expect(system.db.prepare('SELECT user_id, role FROM users').all())
          .toEqual([{ user_id: 'canonical', role: 'user' }]);
      } finally {
        automations?.close();
        application.close();
        system.close();
      }
    });
  }
});
