/** Side-effect-free Fabric realm shared by the parent and actor processes. */

import { defineDatabaseRealm } from '@zero/framework/server';

import { tenantServerTables } from './schema';

export const guardianFabricTenantRealm = defineDatabaseRealm({
  name: 'guardian-fabric-proof-tenant-data',
  version: '2',
  tables: tenantServerTables,
  migrations: [{
    version: '001_task_guardian_reference_indexes',
    description: 'Index task ownership and assignment Guardian references',
    up(database) {
      // Realm migrations run before ReactiveDB verifies/initializes declared
      // tables, so a fresh tenant needs the same table shape before its
      // non-unique ownership indexes can be created.
      database.exec(`
        CREATE TABLE IF NOT EXISTS tasks (
          task_id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          created_by_user_id TEXT NOT NULL
            REFERENCES users(user_id) ON DELETE RESTRICT,
          assigned_membership_id TEXT NOT NULL
            REFERENCES tenant_memberships(membership_id) ON DELETE RESTRICT
        );
        CREATE INDEX IF NOT EXISTS idx_tasks_created_by_user_id
          ON tasks(created_by_user_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_assigned_membership_id
          ON tasks(assigned_membership_id);
      `);
    },
    down(database) {
      database.exec(`
        DROP INDEX IF EXISTS idx_tasks_assigned_membership_id;
        DROP INDEX IF EXISTS idx_tasks_created_by_user_id;
      `);
    },
  }],
});
