/** Add private Storage Studio ownership, operation, quota, and job sidecars. */

import type { Database } from 'bun:sqlite';
import type { Migration } from '../types';

export const migration: Migration = {
  version: '034',
  description: 'Storage Studio control-plane foundation',
  safety: 'safe',
  backupRequired: false,

  up(db: Database) {
    // Keep v034 self-contained. Runtime schema repair may evolve, but an
    // already-applied numbered migration must remain byte-identical forever.
    db.exec(`
      CREATE TABLE IF NOT EXISTS _storage_drive_profiles (
        drive_id                  TEXT PRIMARY KEY,
        drive_key                 TEXT COLLATE NOCASE NOT NULL
                                  CHECK (drive_key = lower(trim(drive_key))
                                    AND length(drive_key) BETWEEN 1 AND 100
                                    AND substr(drive_key, 1, 1) GLOB '[a-z]'
                                    AND drive_key NOT GLOB '*[^a-z0-9_-]*'),
        owner_kind                TEXT NOT NULL
                                  CHECK (owner_kind IN ('application','organization','user')),
        owner_id                  TEXT NOT NULL
                                  CHECK (owner_id = trim(owner_id)
                                    AND length(owner_id) BETWEEN 1 AND 256),
        scope_kind                TEXT NOT NULL
                                  CHECK (scope_kind IN ('application','tenant')),
        scope_id                  TEXT NOT NULL
                                  CHECK (scope_id = trim(scope_id)
                                    AND length(scope_id) BETWEEN 1 AND 256),
        lifecycle                 TEXT NOT NULL DEFAULT 'provisioning'
                                  CHECK (lifecycle IN ('provisioning','ready','degraded','suspended','deleting','deleted','restoring','failed')),
        revision                  INTEGER NOT NULL DEFAULT 1
                                  CHECK (typeof(revision) = 'integer' AND revision >= 1),
        provider                  TEXT NOT NULL
                                  CHECK (provider = lower(trim(provider))
                                    AND length(provider) BETWEEN 1 AND 64
                                    AND substr(provider, 1, 1) GLOB '[a-z]'
                                    AND provider NOT GLOB '*[^a-z0-9_-]*'),
        provider_namespace        TEXT NOT NULL
                                  CHECK (provider_namespace = trim(provider_namespace)
                                    AND length(provider_namespace) BETWEEN 1 AND 512),
        isolation_mode            TEXT NOT NULL
                                  CHECK (isolation_mode IN ('shared-cas','tenant-namespace','drive-namespace')),
        generation                INTEGER NOT NULL DEFAULT 1
                                  CHECK (typeof(generation) = 'integer' AND generation >= 1),
        created_by_user_id        TEXT NOT NULL,
        created_by_membership_id  TEXT,
        updated_by_user_id        TEXT NOT NULL,
        updated_by_membership_id  TEXT,
        created_at                INTEGER NOT NULL
                                  CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
        updated_at                INTEGER NOT NULL
                                  CHECK (typeof(updated_at) = 'integer' AND updated_at >= created_at),
        ready_at                  INTEGER,
        degraded_at               INTEGER,
        suspended_at              INTEGER,
        deleting_at               INTEGER,
        deleted_at                INTEGER,
        restoring_at              INTEGER,
        failed_at                 INTEGER,
        failure_code              TEXT CHECK (failure_code IS NULL OR length(failure_code) BETWEEN 1 AND 100),
        FOREIGN KEY (drive_id) REFERENCES storage_drives(drive_id) ON DELETE CASCADE,
        FOREIGN KEY (created_by_user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
        FOREIGN KEY (created_by_membership_id) REFERENCES _auth_tenant_memberships(membership_id) ON DELETE SET NULL,
        FOREIGN KEY (updated_by_user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
        FOREIGN KEY (updated_by_membership_id) REFERENCES _auth_tenant_memberships(membership_id) ON DELETE SET NULL,
        UNIQUE (scope_kind, scope_id, owner_kind, owner_id, drive_key),
        CHECK (
          (owner_kind = 'application'
            AND owner_id = 'application'
            AND scope_kind = 'application'
            AND scope_id = 'application')
          OR (owner_kind = 'organization'
            AND scope_kind = 'tenant'
            AND owner_id = scope_id)
          OR (owner_kind = 'user'
            AND ((scope_kind = 'application' AND scope_id = 'application')
              OR scope_kind = 'tenant'))
        ),
        CHECK (ready_at IS NULL OR (typeof(ready_at) = 'integer' AND ready_at >= created_at)),
        CHECK (degraded_at IS NULL OR (typeof(degraded_at) = 'integer' AND degraded_at >= created_at)),
        CHECK (suspended_at IS NULL OR (typeof(suspended_at) = 'integer' AND suspended_at >= created_at)),
        CHECK (deleting_at IS NULL OR (typeof(deleting_at) = 'integer' AND deleting_at >= created_at)),
        CHECK (deleted_at IS NULL OR (typeof(deleted_at) = 'integer' AND deleted_at >= created_at)),
        CHECK (restoring_at IS NULL OR (typeof(restoring_at) = 'integer' AND restoring_at >= created_at)),
        CHECK (failed_at IS NULL OR (typeof(failed_at) = 'integer' AND failed_at >= created_at)),
        CHECK (lifecycle <> 'ready' OR ready_at IS NOT NULL),
        CHECK (lifecycle <> 'degraded' OR (degraded_at IS NOT NULL AND failure_code IS NOT NULL)),
        CHECK (lifecycle <> 'suspended' OR suspended_at IS NOT NULL),
        CHECK (lifecycle <> 'deleting' OR deleting_at IS NOT NULL),
        CHECK (lifecycle <> 'deleted' OR deleted_at IS NOT NULL),
        CHECK (lifecycle <> 'restoring' OR restoring_at IS NOT NULL),
        CHECK (lifecycle <> 'failed' OR (failed_at IS NOT NULL AND failure_code IS NOT NULL))
      );
      CREATE INDEX IF NOT EXISTS idx_storage_drive_profiles_scope_lifecycle
        ON _storage_drive_profiles(scope_kind, scope_id, lifecycle, drive_key);
      CREATE INDEX IF NOT EXISTS idx_storage_drive_profiles_owner_lifecycle
        ON _storage_drive_profiles(owner_kind, owner_id, lifecycle, drive_key);
      CREATE INDEX IF NOT EXISTS idx_storage_drive_profiles_provider_namespace
        ON _storage_drive_profiles(provider, provider_namespace, generation);
      CREATE TRIGGER IF NOT EXISTS trg_storage_drive_profile_identity_immutable
        BEFORE UPDATE OF drive_id, drive_key, scope_kind, scope_id,
          created_by_user_id, created_by_membership_id, created_at
        ON _storage_drive_profiles
        BEGIN
          SELECT RAISE(ABORT, 'storage drive profile identity is immutable');
        END;
      CREATE TRIGGER IF NOT EXISTS trg_storage_drive_profile_revision_monotonic
        BEFORE UPDATE ON _storage_drive_profiles
        WHEN NEW.revision <> OLD.revision + 1
          OR NEW.generation < OLD.generation
          OR NEW.generation > OLD.generation + 1
          OR NEW.updated_at < OLD.updated_at
        BEGIN
          SELECT RAISE(ABORT, 'storage drive profile revision is invalid');
        END;

      CREATE TABLE IF NOT EXISTS _storage_studio_operations (
        operation_id              TEXT PRIMARY KEY,
        idempotency_key           TEXT NOT NULL
                                  CHECK (length(idempotency_key) BETWEEN 1 AND 200),
        operation_kind            TEXT NOT NULL
                                  CHECK (operation_kind IN ('provision','update','delete','restore','transfer','suspend','resume','reconcile')),
        scope_kind                TEXT NOT NULL
                                  CHECK (scope_kind IN ('application','tenant')),
        scope_id                  TEXT NOT NULL
                                  CHECK (scope_id = trim(scope_id)
                                    AND length(scope_id) BETWEEN 1 AND 256),
        actor_user_id             TEXT NOT NULL,
        actor_membership_id       TEXT,
        request_hash              TEXT NOT NULL
                                  CHECK (length(request_hash) = 64
                                    AND request_hash = lower(request_hash)
                                    AND request_hash NOT GLOB '*[^0-9a-f]*'),
        status                    TEXT NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending','succeeded','failed','outcome_unknown')),
        drive_id                  TEXT,
        profile_revision          INTEGER
                                  CHECK (profile_revision IS NULL OR
                                    (typeof(profile_revision) = 'integer' AND profile_revision >= 1)),
        error_code                TEXT CHECK (error_code IS NULL OR length(error_code) BETWEEN 1 AND 100),
        created_at                INTEGER NOT NULL
                                  CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
        updated_at                INTEGER NOT NULL
                                  CHECK (typeof(updated_at) = 'integer' AND updated_at >= created_at),
        completed_at              INTEGER,
        expires_at                INTEGER NOT NULL
                                  CHECK (typeof(expires_at) = 'integer' AND expires_at > created_at),
        FOREIGN KEY (actor_user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
        FOREIGN KEY (actor_membership_id) REFERENCES _auth_tenant_memberships(membership_id) ON DELETE SET NULL,
        FOREIGN KEY (drive_id) REFERENCES storage_drives(drive_id) ON DELETE SET NULL,
        UNIQUE (scope_kind, scope_id, actor_user_id, operation_kind, idempotency_key),
        CHECK ((scope_kind = 'application' AND scope_id = 'application')
          OR (scope_kind = 'tenant' AND scope_id <> 'application')),
        CHECK (completed_at IS NULL OR
          (typeof(completed_at) = 'integer' AND completed_at >= created_at)),
        CHECK ((status = 'pending' AND completed_at IS NULL AND error_code IS NULL)
          OR (status = 'succeeded' AND completed_at IS NOT NULL AND error_code IS NULL)
          OR (status IN ('failed','outcome_unknown')
            AND completed_at IS NOT NULL AND error_code IS NOT NULL))
      );
      CREATE INDEX IF NOT EXISTS idx_storage_studio_operations_scope_status
        ON _storage_studio_operations(scope_kind, scope_id, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_storage_studio_operations_expiry
        ON _storage_studio_operations(expires_at, operation_id);

      CREATE TABLE IF NOT EXISTS _storage_quota_reservations (
        reservation_id            TEXT PRIMARY KEY,
        drive_id                  TEXT NOT NULL,
        operation_id              TEXT,
        reserved_bytes            INTEGER NOT NULL DEFAULT 0
                                  CHECK (typeof(reserved_bytes) = 'integer' AND reserved_bytes >= 0),
        reserved_objects          INTEGER NOT NULL DEFAULT 0
                                  CHECK (typeof(reserved_objects) = 'integer' AND reserved_objects >= 0),
        status                    TEXT NOT NULL DEFAULT 'active'
                                  CHECK (status IN ('active','committed','released','expired')),
        generation                INTEGER NOT NULL
                                  CHECK (typeof(generation) = 'integer' AND generation >= 1),
        created_at                INTEGER NOT NULL
                                  CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
        expires_at                INTEGER NOT NULL
                                  CHECK (typeof(expires_at) = 'integer' AND expires_at > created_at),
        settled_at                INTEGER,
        FOREIGN KEY (drive_id) REFERENCES storage_drives(drive_id) ON DELETE CASCADE,
        FOREIGN KEY (operation_id) REFERENCES _storage_studio_operations(operation_id) ON DELETE SET NULL,
        CHECK (reserved_bytes > 0 OR reserved_objects > 0),
        CHECK ((status = 'active' AND settled_at IS NULL)
          OR (status <> 'active' AND typeof(settled_at) = 'integer' AND settled_at >= created_at))
      );
      CREATE INDEX IF NOT EXISTS idx_storage_quota_reservations_drive_active
        ON _storage_quota_reservations(drive_id, expires_at, reservation_id)
        WHERE status = 'active';
      CREATE INDEX IF NOT EXISTS idx_storage_quota_reservations_expiry
        ON _storage_quota_reservations(expires_at, reservation_id)
        WHERE status = 'active';

      CREATE TABLE IF NOT EXISTS _storage_jobs (
        job_id                     TEXT PRIMARY KEY,
        operation_id               TEXT,
        drive_id                   TEXT NOT NULL,
        job_kind                   TEXT NOT NULL
                                   CHECK (job_kind IN ('provision','delete','restore','transfer','reconcile','cleanup')),
        status                     TEXT NOT NULL DEFAULT 'queued'
                                   CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
        generation                 INTEGER NOT NULL
                                   CHECK (typeof(generation) = 'integer' AND generation >= 1),
        attempt_count              INTEGER NOT NULL DEFAULT 0
                                   CHECK (typeof(attempt_count) = 'integer' AND attempt_count >= 0),
        max_attempts               INTEGER NOT NULL DEFAULT 5
                                   CHECK (typeof(max_attempts) = 'integer' AND max_attempts >= 1),
        available_at               INTEGER NOT NULL
                                   CHECK (typeof(available_at) = 'integer' AND available_at >= 0),
        lease_owner                TEXT,
        lease_expires_at           INTEGER,
        failure_code               TEXT CHECK (failure_code IS NULL OR length(failure_code) BETWEEN 1 AND 100),
        created_at                 INTEGER NOT NULL
                                   CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
        updated_at                 INTEGER NOT NULL
                                   CHECK (typeof(updated_at) = 'integer' AND updated_at >= created_at),
        completed_at               INTEGER,
        FOREIGN KEY (operation_id) REFERENCES _storage_studio_operations(operation_id) ON DELETE SET NULL,
        FOREIGN KEY (drive_id) REFERENCES storage_drives(drive_id) ON DELETE CASCADE,
        UNIQUE (operation_id, job_kind, generation),
        CHECK ((lease_owner IS NULL AND lease_expires_at IS NULL)
          OR (status = 'running' AND lease_owner IS NOT NULL
            AND typeof(lease_expires_at) = 'integer' AND lease_expires_at > updated_at)),
        CHECK (completed_at IS NULL OR
          (typeof(completed_at) = 'integer' AND completed_at >= created_at)),
        CHECK ((status IN ('queued','running') AND completed_at IS NULL)
          OR (status IN ('succeeded','failed','cancelled') AND completed_at IS NOT NULL)),
        CHECK (status <> 'failed' OR failure_code IS NOT NULL)
      );
      CREATE INDEX IF NOT EXISTS idx_storage_jobs_claim
        ON _storage_jobs(status, available_at, job_id);
      CREATE INDEX IF NOT EXISTS idx_storage_jobs_drive_status
        ON _storage_jobs(drive_id, status, created_at DESC);
    `);
  },
};
