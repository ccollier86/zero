import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { defineNotificationTables } from '../notifications/notification.plugin';
import { defineRoomTables } from '../rooms/room.plugin';
import { defineStorageTables } from '../storage/storage-service';
import { createReactiveDB } from '../sync/reactive-db';
import { defineWorkflowTables } from '../workflows/workflow.plugin';
import { migrations } from './index';
import { Migrator } from './migrator';

const TABLES = [
  'notifications',
  'notification_receipts',
  'workflow_instances',
  'workflow_steps',
  'workflow_events',
  'rooms',
  'room_members',
  'storage_drives',
  'storage_objects',
  '_storage_permissions',
] as const;

const TENANT_INDEXES = [
  'idx_notification_receipts_tenant_user',
  'idx_notifications_tenant',
  'idx_room_members_tenant_user',
  'idx_rooms_tenant',
  'idx_storage_drives_tenant',
  'idx_storage_objects_tenant_drive',
  'idx_storage_permissions_tenant_drive',
  'idx_workflow_events_tenant_instance',
  'idx_workflow_instances_tenant',
  'idx_workflow_steps_tenant_instance',
];

test('migration 008 matches runtime built-in tenant discriminators and preserves legacy rows', () => {
  const migratedDb = new Database(':memory:');
  const migrator = new Migrator({
    database: migratedDb,
    dbPath: ':memory:',
    migrations,
    createBackups: false,
    log: () => {},
  });
  const runtimeDb = new Database(':memory:');
  const reactive = createReactiveDB({ database: runtimeDb });

  try {
    migrator.run('007');
    seedLegacyRows(migratedDb);
    expect(migrator.run('008')).toEqual(['008']);

    defineNotificationTables(reactive);
    defineRoomTables(reactive);
    defineWorkflowTables(reactive);
    defineStorageTables(reactive);

    expect(tenantShape(migratedDb)).toEqual(tenantShape(runtimeDb));
    expect(tenantIndexNames(migratedDb)).toEqual(TENANT_INDEXES);
    expect(TABLES.every((table) => columns(migratedDb, table).includes('tenant_id')))
      .toBe(true);
    expect(migratedDb.query(
      `SELECT
        (SELECT tenant_id FROM notifications WHERE notification_id = 'legacy-notification') AS notification,
        (SELECT tenant_id FROM rooms WHERE room_id = 'legacy-room') AS room,
        (SELECT tenant_id FROM workflow_instances WHERE instance_id = 'legacy-workflow') AS workflow,
        (SELECT tenant_id FROM storage_drives WHERE drive_id = 'legacy-drive') AS drive`,
    ).get()).toEqual({
      notification: null,
      room: null,
      workflow: null,
      drive: null,
    });
  } finally {
    reactive.dispose();
    migrator.dispose();
    runtimeDb.close();
    migratedDb.close();
  }
});

function tenantShape(db: Database) {
  return Object.fromEntries(TABLES.map((table) => {
    const tenantColumn = (db.query(`PRAGMA table_info(${table})`).all() as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }>).find((column) => column.name === 'tenant_id');
    return [table, {
      tenantColumn: tenantColumn && {
        name: tenantColumn.name,
        type: tenantColumn.type,
        notnull: tenantColumn.notnull,
        default: tenantColumn.dflt_value,
      },
      tenantIndexes: (db.query(`PRAGMA index_list(${table})`).all() as Array<{ name: string }>)
        .map((index) => index.name)
        .filter((name) => name.includes('tenant'))
        .sort(),
    }];
  }));
}

function tenantIndexNames(db: Database): string[] {
  const placeholders = TABLES.map(() => '?').join(',');
  return (db.query(
    `SELECT name FROM sqlite_master
     WHERE type = 'index' AND tbl_name IN (${placeholders}) AND name LIKE '%tenant%'
     ORDER BY name`,
  ).all(...TABLES) as Array<{ name: string }>).map((row) => row.name);
}

function columns(db: Database, table: string): string[] {
  return (db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
    .map((row) => row.name);
}

function seedLegacyRows(db: Database): void {
  db.run(`INSERT INTO notifications (
    notification_id, title, created_at
  ) VALUES ('legacy-notification', 'Legacy', 1)`);
  db.run(`INSERT INTO rooms (
    room_id, name, created_by, created_at
  ) VALUES ('legacy-room', 'Legacy', 'legacy-user', 1)`);
  db.run(`INSERT INTO workflow_instances (
    instance_id, definition_id, name, created_at, updated_at
  ) VALUES ('legacy-workflow', 'legacy-definition', 'Legacy', '1', '1')`);
  db.run(`INSERT INTO storage_drives (
    drive_id, name, created_at
  ) VALUES ('legacy-drive', 'Legacy', 1)`);
}
