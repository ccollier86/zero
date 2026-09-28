/**
 * Adds tenant discriminators to framework-owned service data.
 *
 * Existing rows remain NULL and retain their historical application scope in
 * single-tenant mode. Multi-tenant request and Sync paths require an exact
 * tenant id, so those legacy rows fail closed until an application performs an
 * explicit, domain-informed ownership migration.
 */

import type { Database } from 'bun:sqlite';
import type { Migration } from '../migrator';

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

const INDEXES = [
  ['idx_notifications_tenant', 'notifications', 'tenant_id'],
  ['idx_notification_receipts_tenant_user', 'notification_receipts', 'tenant_id, user_id'],
  ['idx_workflow_instances_tenant', 'workflow_instances', 'tenant_id'],
  ['idx_workflow_steps_tenant_instance', 'workflow_steps', 'tenant_id, instance_id'],
  ['idx_workflow_events_tenant_instance', 'workflow_events', 'tenant_id, instance_id'],
  ['idx_rooms_tenant', 'rooms', 'tenant_id'],
  ['idx_room_members_tenant_user', 'room_members', 'tenant_id, user_id'],
  ['idx_storage_drives_tenant', 'storage_drives', 'tenant_id'],
  ['idx_storage_objects_tenant_drive', 'storage_objects', 'tenant_id, drive_id'],
  ['idx_storage_permissions_tenant_drive', '_storage_permissions', 'tenant_id, drive_id'],
] as const;

export const migration: Migration = {
  version: '008',
  description: 'Tenant-scope Zero built-in service data',
  safety: 'safe',
  downSafety: 'destructive',

  up(db: Database) {
    for (const table of TABLES) ensureColumn(db, table, 'tenant_id', 'TEXT');
    for (const [name, table, columns] of INDEXES) {
      if (!tableExists(db, table)) continue;
      db.run(`CREATE INDEX IF NOT EXISTS ${name} ON ${table}(${columns})`);
    }
  },

  down(db: Database) {
    for (const [name] of [...INDEXES].reverse()) {
      db.run(`DROP INDEX IF EXISTS ${name}`);
    }
    for (const table of [...TABLES].reverse()) {
      if (!hasColumn(db, table, 'tenant_id')) continue;
      db.run(`ALTER TABLE ${table} DROP COLUMN tenant_id`);
    }
  },
};

function ensureColumn(
  db: Database,
  table: string,
  column: string,
  definition: string,
): void {
  if (!tableExists(db, table) || hasColumn(db, table, column)) return;
  db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function tableExists(db: Database, table: string): boolean {
  return Boolean(db.query(
    "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table));
}

function hasColumn(db: Database, table: string, column: string): boolean {
  if (!tableExists(db, table)) return false;
  return (db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
    .some((entry) => entry.name === column);
}
