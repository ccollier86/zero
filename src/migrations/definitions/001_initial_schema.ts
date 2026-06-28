/**
 * 001_initial_schema.ts
 *
 * Baseline migration — creates all tables matching the actual plugin
 * defineTable() and db.exec() calls across auth, notifications,
 * workflows, rooms, and storage.
 *
 * Source of truth for each section:
 *   - Auth:          src/auth/auth.plugin.ts (defineAuthTables)
 *   - Notifications: src/notifications/notification.plugin.ts
 *   - Workflows:     src/workflows/workflow.plugin.ts
 *   - Rooms:         src/rooms/room.plugin.ts
 *   - Storage:       src/storage/storage-service.ts
 *
 * For existing databases, this is a no-op (IF NOT EXISTS).
 * For fresh databases, this creates the full schema in one transaction.
 */

import type { Database } from 'bun:sqlite';
import type { Migration } from '../migrator';

export const migration: Migration = {
  version: '001',
  description: 'Baseline schema — auth, notifications, workflows, rooms, storage',
  safety: 'safe',
  downSafety: 'destructive',

  up(db: Database) {
    db.run('PRAGMA foreign_keys = ON');

    // ─── Auth (src/auth/auth.plugin.ts) ──────────────────────────────────
    //
    // users is defined via db.defineTable() — plugins still call defineTable
    // at runtime to register prepared statements, but the migration ensures
    // the table exists before any plugin code runs.

    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        user_id    TEXT PRIMARY KEY,
        username   TEXT UNIQUE NOT NULL,
        email      TEXT UNIQUE NOT NULL,
        first_name TEXT,
        last_name  TEXT,
        role       TEXT NOT NULL DEFAULT 'user',
        status     TEXT NOT NULL DEFAULT 'active',
        password_change_required INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS user_properties (
        user_id TEXT NOT NULL,
        key     TEXT NOT NULL,
        value   TEXT,
        PRIMARY KEY (user_id, key),
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS _credentials (
        user_id       TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS _refresh_tokens (
        token_id   TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        revoked_at INTEGER,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON _refresh_tokens(token_hash)');
    db.run('CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON _refresh_tokens(user_id)');

    db.run(`
      CREATE TABLE IF NOT EXISTS _auth_action_tokens (
        token_id    TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL,
        type        TEXT NOT NULL,
        token_hash  TEXT NOT NULL,
        expires_at  INTEGER NOT NULL,
        consumed_at INTEGER,
        created_at  INTEGER NOT NULL,
        created_by  TEXT,
        metadata    TEXT,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_auth_action_tokens_hash ON _auth_action_tokens(token_hash)');
    db.run('CREATE INDEX IF NOT EXISTS idx_auth_action_tokens_user ON _auth_action_tokens(user_id)');

    db.run(`
      CREATE TABLE IF NOT EXISTS _auth_config (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    // ─── Notifications (src/notifications/notification.plugin.ts) ────────

    db.run(`
      CREATE TABLE IF NOT EXISTS notifications (
        notification_id TEXT PRIMARY KEY,
        type            TEXT NOT NULL DEFAULT 'info',
        priority        TEXT NOT NULL DEFAULT 'normal',
        title           TEXT NOT NULL,
        body            TEXT,
        target_type     TEXT NOT NULL DEFAULT 'all',
        target_value    TEXT,
        sender_id       TEXT,
        action_url      TEXT,
        metadata        TEXT,
        created_at      INTEGER NOT NULL,
        expires_at      INTEGER
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS notification_receipts (
        receipt_id      TEXT PRIMARY KEY,
        notification_id TEXT NOT NULL,
        user_id         TEXT NOT NULL,
        seen_at         INTEGER,
        read_at         INTEGER,
        dismissed_at    INTEGER
      )
    `);

    db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_receipt_notif_user ON notification_receipts(notification_id, user_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_receipt_user ON notification_receipts(user_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_receipt_notif ON notification_receipts(notification_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_notif_target ON notifications(target_type)');
    db.run('CREATE INDEX IF NOT EXISTS idx_notif_created ON notifications(created_at)');

    // ─── Workflows (src/workflows/workflow.plugin.ts) ────────────────────

    db.run(`
      CREATE TABLE IF NOT EXISTS workflow_definitions (
        definition_id TEXT PRIMARY KEY,
        name          TEXT UNIQUE NOT NULL,
        version       INTEGER NOT NULL DEFAULT 1,
        steps_json    TEXT NOT NULL,
        input_schema  TEXT,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS workflow_instances (
        instance_id   TEXT PRIMARY KEY,
        definition_id TEXT NOT NULL,
        name          TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'pending',
        current_step  INTEGER NOT NULL DEFAULT 0,
        input         TEXT,
        output        TEXT,
        error         TEXT,
        started_by    TEXT,
        steps_json    TEXT,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL,
        completed_at  TEXT
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS workflow_steps (
        step_id      TEXT PRIMARY KEY,
        instance_id  TEXT NOT NULL,
        step_index   INTEGER NOT NULL,
        step_name    TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'pending',
        input        TEXT,
        output       TEXT,
        error        TEXT,
        retries      INTEGER NOT NULL DEFAULT 0,
        max_retries  INTEGER NOT NULL DEFAULT 3,
        retry_at     TEXT,
        wait_event   TEXT,
        timeout_at   TEXT,
        started_at   TEXT,
        completed_at TEXT,
        created_at   TEXT NOT NULL
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS workflow_events (
        event_id    TEXT PRIMARY KEY,
        instance_id TEXT NOT NULL,
        event_name  TEXT NOT NULL,
        payload     TEXT,
        sent_by     TEXT,
        created_at  TEXT NOT NULL
      )
    `);

    // ─── Rooms (src/rooms/room.plugin.ts) ────────────────────────────────

    db.run(`
      CREATE TABLE IF NOT EXISTS rooms (
        room_id     TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        type        TEXT NOT NULL DEFAULT 'default',
        created_by  TEXT NOT NULL,
        metadata    TEXT,
        max_members INTEGER NOT NULL DEFAULT 100,
        created_at  INTEGER NOT NULL
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS room_members (
        member_id TEXT PRIMARY KEY,
        room_id   TEXT NOT NULL,
        user_id   TEXT NOT NULL,
        role      TEXT NOT NULL DEFAULT 'member',
        joined_at INTEGER NOT NULL,
        metadata  TEXT
      )
    `);

    db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_room_member_unique ON room_members(room_id, user_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_room_members_room ON room_members(room_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_room_members_user ON room_members(user_id)');

    // ─── Storage (src/storage/storage-service.ts) ────────────────────────

    db.run(`
      CREATE TABLE IF NOT EXISTS storage_drives (
        drive_id            TEXT PRIMARY KEY,
        name                TEXT NOT NULL,
        owner_id            TEXT,
        max_size_bytes      INTEGER NOT NULL DEFAULT 0,
        max_file_size_bytes INTEGER NOT NULL DEFAULT 0,
        allowed_mime_types  TEXT NOT NULL DEFAULT '*',
        public              INTEGER NOT NULL DEFAULT 0,
        created_at          INTEGER NOT NULL
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS storage_objects (
        object_id  TEXT PRIMARY KEY,
        drive_id   TEXT NOT NULL,
        parent_id  TEXT,
        name       TEXT NOT NULL,
        path       TEXT NOT NULL,
        type       TEXT NOT NULL,
        mime_type  TEXT,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        checksum   TEXT,
        public     INTEGER NOT NULL DEFAULT 0,
        metadata   TEXT NOT NULL DEFAULT '{}',
        created_by TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS _storage_blobs (
        checksum   TEXT PRIMARY KEY,
        size_bytes INTEGER NOT NULL,
        ref_count  INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS _storage_permissions (
        permission_id TEXT PRIMARY KEY,
        drive_id      TEXT NOT NULL,
        object_id     TEXT,
        grant_type    TEXT NOT NULL,
        grant_key     TEXT,
        grant_value   TEXT NOT NULL,
        permission    TEXT NOT NULL,
        created_at    INTEGER NOT NULL
      )
    `);

    db.run('CREATE INDEX IF NOT EXISTS idx_storage_perms_drive ON _storage_permissions(drive_id)');
    db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_storage_objects_drive_path ON storage_objects(drive_id, path)');
    db.run('CREATE INDEX IF NOT EXISTS idx_storage_objects_parent ON storage_objects(drive_id, parent_id)');
  },

  down(db: Database) {
    // Reverse order — drop indexes implicitly with tables
    db.run('DROP TABLE IF EXISTS _storage_permissions');
    db.run('DROP TABLE IF EXISTS _storage_blobs');
    db.run('DROP TABLE IF EXISTS storage_objects');
    db.run('DROP TABLE IF EXISTS storage_drives');
    db.run('DROP TABLE IF EXISTS room_members');
    db.run('DROP TABLE IF EXISTS rooms');
    db.run('DROP TABLE IF EXISTS workflow_events');
    db.run('DROP TABLE IF EXISTS workflow_steps');
    db.run('DROP TABLE IF EXISTS workflow_instances');
    db.run('DROP TABLE IF EXISTS workflow_definitions');
    db.run('DROP TABLE IF EXISTS notification_receipts');
    db.run('DROP TABLE IF EXISTS notifications');
    db.run('DROP TABLE IF EXISTS _auth_config');
    db.run('DROP TABLE IF EXISTS _auth_action_tokens');
    db.run('DROP TABLE IF EXISTS _refresh_tokens');
    db.run('DROP TABLE IF EXISTS _credentials');
    db.run('DROP TABLE IF EXISTS user_properties');
    db.run('DROP TABLE IF EXISTS users');
  },
};
