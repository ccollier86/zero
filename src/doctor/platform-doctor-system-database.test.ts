import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { IdentityProjectionOutboxStore } from '../auth/identity-projection-outbox-store';
import { installAuthAuthorityRevision } from '../auth/auth-authority-revision';
import { defineAuthTables } from '../auth/auth-schema';
import {
  defineIdentityAnchorTables,
  IDENTITY_PROJECTION_INSTALLATION_TABLE,
  IDENTITY_PROJECTION_OUTBOX_TABLE,
  IDENTITY_PROJECTION_RECEIPTS_TABLE,
  IDENTITY_PROJECTION_TARGETS_TABLE,
} from '../auth/identity-projection-schema';
import { defineDatabaseRealm } from '../databases';
import { createPlatformSQLiteService } from '../persistence';
import { adminOnly, defineResource } from '../resources';
import { defineTable, field } from '../schema';
import { createReactiveDB } from '../sync/reactive-db';
import { runPlatformDoctor } from './platform-doctor';
import { checkProjectionTargetSummary } from './platform-doctor-identity-projection-summary';
import {
  createPlatformDoctorFindingSink,
  type PlatformDoctorFinding,
} from './platform-doctor-contracts';

describe('platform doctor system database', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0).reverse()) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('reports app/system path collisions with a targeted finding', () => {
    const report = runPlatformDoctor({
      db: { mode: 'file', path: './data/shared.db' },
      systemDb: { mode: 'file', path: './DATA/SHARED.DB' },
      tables: {},
      auth: false,
    });

    expect(report.findings).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'database.system.overlaps_application',
      path: 'systemDb',
    }));

    const fenceCollision = runPlatformDoctor({
      db: { mode: 'file', path: './data/system.db.authority-fence.sqlite' },
      systemDb: { mode: 'file', path: './data/system.db' },
      tables: {},
      auth: false,
    });
    expect(fenceCollision.findings).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'database.system.overlaps_application',
      path: 'systemDb',
    }));
  });

  test('fails production authority on ephemeral or hot system durability', () => {
    for (const mode of ['ephemeral', 'hot'] as const) {
      const report = runPlatformDoctor({
        db: { mode: 'ephemeral' },
        systemDb: mode === 'hot'
          ? { mode, path: './data/system.db', snapshotPath: './data/system.snapshot.db' }
          : { mode },
        tables: {},
        auth: true,
        email: false,
      }, { env: { NODE_ENV: 'production' } });
      expect(report.findings).toContainEqual(expect.objectContaining({
        severity: 'error',
        code: mode === 'hot'
          ? 'database.system.hot_authority_production'
          : 'database.system.ephemeral_authority_production',
      }));
    }
  });

  test('validates declarative Guardian projection prerequisites', () => {
    const userTable = defineTable('work_items', {
      owner_user_id: field.guardianUser(),
    }, { pk: 'work_item_id' });
    const membershipTable = defineTable('assignments', {
      membership_id: field.guardianMembership(),
    }, { pk: 'assignment_id' });

    const disabled = runPlatformDoctor({
      db: { mode: 'ephemeral' },
      tables: { work_items: userTable },
      auth: false,
    });
    expect(hasFinding(disabled, 'database.identity_projection.requires_auth')).toBe(true);

    const single = runPlatformDoctor({
      db: { mode: 'ephemeral' },
      tables: { assignments: membershipTable },
      auth: true,
      email: false,
    });
    expect(hasFinding(
      single,
      'database.identity_projection.membership_requires_multi',
    )).toBe(true);

    const multi = runPlatformDoctor({
      db: { mode: 'ephemeral' },
      tables: { assignments: membershipTable },
      auth: { tenancy: 'multi' },
      email: false,
    });
    expect(hasFinding(multi, 'database.identity_projection.configured')).toBe(true);

    const drifted = defineTable('drifted_items', {
      owner_user_id: field.guardianUser(),
    }, { pk: 'work_item_id' });
    drifted.serverTable.owner_user_id = 'text not null';
    const invalidDeclaration = runPlatformDoctor({
      db: { mode: 'ephemeral' },
      tables: { drifted_items: drifted },
      auth: true,
      email: false,
    });
    expect(invalidDeclaration.findings).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'database.identity_projection.reference_schema_invalid',
      path: 'tables.drifted_items.owner_user_id',
    }));
  });

  test('does not require physical-tenant anchors in the shared app database', () => {
    const root = createRoot();
    const appPath = join(root, 'app.db');
    new Database(appPath).close();
    const tenantTable = defineTable('work_items', {
      owner_user_id: field.guardianUser(),
    }, { pk: 'work_item_id' });

    const report = runPlatformDoctor({
      db: { mode: 'file', path: './app.db' },
      systemDb: { mode: 'file', path: './system.db' },
      tables: { work_items: tenantTable },
      auth: { tenancy: 'multi' },
      email: false,
      databaseTopology: {
        mode: 'multiple',
        rootDirectory: './tenant-databases',
        realm: defineDatabaseRealm({
          name: 'doctor-projection-tenants',
          version: '1',
          tables: { work_items: tenantTable.serverTable },
        }),
        actors: {
          launch: { kind: 'source', entrypoint: import.meta.path },
        },
        tenantIsolation: 'tenant-database',
      },
      resources: [defineResource({
        table: tenantTable,
        exposure: 'http',
        realm: 'tenant',
        policy: adminOnly(),
      })],
    }, { projectRoot: root, usageAudit: false });

    expect(hasFinding(
      report,
      'database.identity_projection.anchor_schema_missing',
    )).toBe(false);
    expect(report.findings.find((finding) =>
      finding.code === 'database.identity_projection.configured')?.message)
      .toContain('physical-tenant reference');
  });

  test('reports a drifted application Guardian foreign key read-only', () => {
    const root = createRoot();
    const appPath = join(root, 'app.db');
    const application = createReactiveDB({ mode: 'file', path: appPath });
    defineIdentityAnchorTables(application);
    application.exec(`
      CREATE TABLE work_items (
        work_item_id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL
          REFERENCES users(user_id) ON DELETE CASCADE
      );
    `);
    application.dispose();
    const userTable = defineTable('work_items', {
      owner_user_id: field.guardianUser(),
    }, { pk: 'work_item_id' });

    const report = runPlatformDoctor({
      db: { mode: 'file', path: './app.db' },
      systemDb: { mode: 'file', path: './system.db' },
      tables: { work_items: userTable },
      auth: true,
      email: false,
    }, { projectRoot: root, usageAudit: false });

    expect(report.findings).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'database.identity_projection.reference_storage_invalid',
      path: 'tables.work_items.owner_user_id',
    }));
  });

  test('inspects an existing app database for legacy combined state read-only', () => {
    const root = createRoot();
    const appPath = join(root, 'app.db');
    const database = new Database(appPath);
    database.run('CREATE TABLE _auth_sessions (session_id TEXT PRIMARY KEY)');
    database.close();

    const report = runPlatformDoctor({
      db: { mode: 'file', path: './app.db' },
      systemDb: { mode: 'file', path: './system.db' },
      tables: {},
      auth: false,
    }, { projectRoot: root, usageAudit: false });

    expect(report.findings).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'database.system.legacy_combined_layout',
      path: 'db',
    }));
    const verifier = new Database(appPath, { readonly: true });
    expect(verifier.query(
      "SELECT name FROM sqlite_master WHERE name = '_auth_sessions'",
    ).get()).toBeTruthy();
    verifier.close();
  });

  test('rejects malformed always-installed membership anchors for user-only references', () => {
    const root = createRoot();
    const appPath = join(root, 'app.db');
    const database = new Database(appPath);
    database.run('CREATE TABLE users (user_id TEXT PRIMARY KEY)');
    database.run(`
      CREATE TABLE tenant_memberships (
        membership_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        profile_email TEXT
      )
    `);
    database.run(`
      CREATE TABLE _zero_identity_projection_state (
        singleton INTEGER PRIMARY KEY,
        status TEXT NOT NULL
      )
    `);
    database.close();
    const userTable = defineTable('assignments', {
      owner_user_id: field.guardianUser(),
    }, { pk: 'assignment_id' });

    const report = runPlatformDoctor({
      db: { mode: 'file', path: './app.db' },
      systemDb: { mode: 'file', path: './system.db' },
      tables: { assignments: userTable },
      auth: true,
      email: false,
    }, { projectRoot: root, usageAudit: false });

    expect(report.findings).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'database.identity_projection.anchor_schema_invalid',
      path: 'db',
    }));
    expect(report.ok).toBe(false);
  });

  test('rejects projection receipt tables without the replay uniqueness contract', () => {
    const root = createRoot();
    const appPath = join(root, 'app.db');
    const application = createReactiveDB({ mode: 'file', path: appPath });
    defineIdentityAnchorTables(application);
    application.exec(`
      DROP TABLE ${IDENTITY_PROJECTION_RECEIPTS_TABLE};
      CREATE TABLE ${IDENTITY_PROJECTION_RECEIPTS_TABLE} (
        event_id TEXT PRIMARY KEY,
        target_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        anchor_fingerprint TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
    `);
    expect(() => defineIdentityAnchorTables(application)).toThrow(expect.objectContaining({
      code: 'IDENTITY_PROJECTION_SCHEMA_INVALID',
    }));
    application.dispose();
    const userTable = defineTable('work_items', {
      owner_user_id: field.guardianUser(),
    }, { pk: 'work_item_id' });

    const report = runPlatformDoctor({
      db: { mode: 'file', path: './app.db' },
      systemDb: { mode: 'file', path: './system.db' },
      tables: { work_items: userTable },
      auth: true,
      email: false,
    }, { projectRoot: root, usageAudit: false });

    expect(report.findings).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'database.identity_projection.anchor_schema_invalid',
      path: 'db',
    }));
    expect(report.ok).toBe(false);
  });

  test('reports incompatible system projection schema without leaking file details', () => {
    const root = createRoot();
    const privateSegment = 'private-customer-path';
    const appPath = join(root, 'app.db');
    const systemPath = join(root, `${privateSegment}.db`);
    new Database(appPath).close();
    const system = new Database(systemPath);
    system.run(`
      CREATE TABLE ${IDENTITY_PROJECTION_INSTALLATION_TABLE} (
        singleton INTEGER PRIMARY KEY,
        installation_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
    system.run(`
      CREATE TABLE ${IDENTITY_PROJECTION_TARGETS_TABLE} (
        target_id TEXT PRIMARY KEY,
        status TEXT NOT NULL
      )
    `);
    system.run(`
      CREATE TABLE ${IDENTITY_PROJECTION_OUTBOX_TABLE} (
        target_id TEXT NOT NULL,
        status TEXT NOT NULL
      )
    `);
    system.close();
    const systemRuntime = createReactiveDB({ mode: 'file', path: systemPath });
    expect(() => new IdentityProjectionOutboxStore(systemRuntime)).toThrow(
      expect.objectContaining({ code: 'IDENTITY_PROJECTION_SCHEMA_INVALID' }),
    );
    systemRuntime.dispose();
    const userTable = defineTable('work_items', {
      owner_user_id: field.guardianUser(),
    }, { pk: 'work_item_id' });

    const report = runPlatformDoctor({
      db: { mode: 'file', path: './app.db' },
      systemDb: { mode: 'file', path: `./${privateSegment}.db` },
      tables: { work_items: userTable },
      auth: true,
      email: false,
    }, { projectRoot: root, usageAudit: false });

    expect(report.findings).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'database.identity_projection.system_schema_invalid',
      path: 'systemDb',
    }));
    const serializedFinding = JSON.stringify(report.findings.find((finding) =>
      finding.code === 'database.identity_projection.system_schema_invalid'));
    expect(serializedFinding).not.toContain(privateSegment);
    expect(serializedFinding).not.toContain(root);
  });

  test('fails closed on a wrong same-name Guardian authority trigger without leaking SQL', () => {
    const root = createRoot();
    const appPath = join(root, 'app.db');
    const systemPath = join(root, 'system.db');
    const privateMarker = 'private-trigger-payload';
    new Database(appPath).close();
    const system = createReactiveDB({ mode: 'file', path: systemPath });
    defineAuthTables(system);
    installAuthAuthorityRevision(system);
    system.exec(`
      DROP TRIGGER trg_zero_authority_users_update_v2;
      CREATE TRIGGER trg_zero_authority_users_update_v2
      AFTER UPDATE OF role ON users
      BEGIN
        SELECT '${privateMarker}';
      END;
    `);
    system.dispose();

    const report = runPlatformDoctor({
      db: { mode: 'file', path: './app.db' },
      systemDb: { mode: 'file', path: './system.db' },
      tables: {},
      auth: true,
      email: false,
    }, { projectRoot: root, usageAudit: false });

    expect(report.findings).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'auth.authority_revision.schema_invalid',
      path: 'systemDb',
    }));
    expect(report.ok).toBe(false);
    expect(JSON.stringify(report.findings)).not.toContain(privateMarker);
    expect(JSON.stringify(report.findings)).not.toContain('UPDATE OF role');
  });

  test('fails closed instead of reporting ready for invalid target state values', () => {
    const system = new Database(':memory:');
    system.exec(`
      CREATE TABLE ${IDENTITY_PROJECTION_TARGETS_TABLE} (
        target_id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        status TEXT NOT NULL,
        next_sequence INTEGER NOT NULL,
        acknowledged_sequence INTEGER NOT NULL
      );
      CREATE TABLE ${IDENTITY_PROJECTION_OUTBOX_TABLE} (status TEXT NOT NULL);
      INSERT INTO ${IDENTITY_PROJECTION_TARGETS_TABLE} (
        target_id, scope, status, next_sequence, acknowledged_sequence
      ) VALUES ('opaque-target', 'tenant', 'unknown', 1, 0);
    `);
    const findings: PlatformDoctorFinding[] = [];
    try {
      checkProjectionTargetSummary(
        system,
        createPlatformDoctorFindingSink(findings),
        {
          referenceCount: 1,
          applicationReferenceCount: 0,
          tenantReferenceCount: 1,
        },
      );
    } finally {
      system.close();
    }

    expect(findings).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'database.identity_projection.targets_invalid',
      path: 'systemDb',
    }));
    expect(findings.some((finding) =>
      finding.code === 'database.identity_projection.targets_ready')).toBe(false);
    expect(JSON.stringify(findings)).not.toContain('opaque-target');
  });

  test('reports application and Fabric projection readiness by target scope', () => {
    const root = createRoot();
    const appPath = join(root, 'app.db');
    const systemPath = join(root, 'system.db');
    const application = createReactiveDB({ mode: 'file', path: appPath });
    defineIdentityAnchorTables(application);
    application.exec(`
      INSERT INTO _zero_identity_projection_state (
        singleton, installation_id, target_id, status, watermark, updated_at
      ) VALUES (1, 'installation', 'application', 'ready', 0, 1);
    `);
    application.dispose();

    const system = createReactiveDB({ mode: 'file', path: systemPath });
    const outbox = new IdentityProjectionOutboxStore(system, {
      createInstallationId: () => 'installation',
    });
    outbox.registerTarget('application', 'application');
    outbox.registerTarget('tenant-one', 'tenant');
    system.prepare(`
      UPDATE ${IDENTITY_PROJECTION_TARGETS_TABLE}
      SET status = 'ready'
    `).run();
    system.dispose();

    const applicationTable = defineTable('shared_notes', {
      owner_user_id: field.guardianUser(),
    }, { pk: 'note_id' });
    const tenantTable = defineTable('work_items', {
      owner_user_id: field.guardianUser(),
    }, { pk: 'work_item_id' });
    const report = runPlatformDoctor({
      db: { mode: 'file', path: './app.db' },
      systemDb: { mode: 'file', path: './system.db' },
      tables: {
        shared_notes: applicationTable,
        work_items: tenantTable,
      },
      auth: { tenancy: 'multi' },
      email: false,
      databaseTopology: {
        mode: 'multiple',
        rootDirectory: './tenant-databases',
        realm: defineDatabaseRealm({
          name: 'doctor-projection-scope-summary',
          version: '1',
          tables: { work_items: tenantTable.serverTable },
        }),
        actors: {
          launch: { kind: 'source', entrypoint: import.meta.path },
        },
        tenantIsolation: 'tenant-database',
      },
      resources: [defineResource({
        table: tenantTable,
        exposure: 'http',
        realm: 'tenant',
        policy: adminOnly(),
      })],
    }, { projectRoot: root, usageAudit: false });

    const ready = report.findings.find((finding) =>
      finding.code === 'database.identity_projection.targets_ready');
    expect(ready).toMatchObject({ severity: 'info', path: 'systemDb' });
    expect(ready?.message).toContain('application 1/1');
    expect(ready?.message).toContain('tenant 1/1');
  });

  test('fails closed on a cross-installation application projection binding', () => {
    const root = createRoot();
    const appPath = join(root, 'app.db');
    const systemPath = join(root, 'system.db');
    const privateApplicationBinding = 'private-application-installation';
    const privateSystemBinding = 'private-system-installation';
    const application = createReactiveDB({ mode: 'file', path: appPath });
    defineIdentityAnchorTables(application);
    application.prepare(`
      INSERT INTO _zero_identity_projection_state (
        singleton, installation_id, target_id, status, watermark, updated_at
      ) VALUES (1, ?, 'application', 'ready', 0, 1)
    `).run(privateApplicationBinding);
    application.dispose();

    const system = createReactiveDB({ mode: 'file', path: systemPath });
    const outbox = new IdentityProjectionOutboxStore(system, {
      createInstallationId: () => privateSystemBinding,
    });
    outbox.registerTarget('application', 'application');
    system.prepare(`
      UPDATE ${IDENTITY_PROJECTION_TARGETS_TABLE}
      SET status = 'ready'
    `).run();
    system.dispose();
    const userTable = defineTable('work_items', {
      owner_user_id: field.guardianUser(),
    }, { pk: 'work_item_id' });

    const report = runPlatformDoctor({
      db: { mode: 'file', path: './app.db' },
      systemDb: { mode: 'file', path: './system.db' },
      tables: { work_items: userTable },
      auth: true,
      email: false,
    }, { projectRoot: root, usageAudit: false });

    expect(report.findings).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'database.identity_projection.application_installation_mismatch',
      path: 'db',
    }));
    const serialized = JSON.stringify(report.findings);
    expect(serialized).not.toContain(privateApplicationBinding);
    expect(serialized).not.toContain(privateSystemBinding);
  });

  test('contains inspection failures from caller-supplied SQLite handles', () => {
    const root = createRoot();
    const application = createPlatformSQLiteService({
      mode: 'ephemeral',
      emitTelemetry: false,
    });
    const system = createPlatformSQLiteService({
      mode: 'ephemeral',
      emitTelemetry: false,
    });
    system.close();
    const userTable = defineTable('work_items', {
      owner_user_id: field.guardianUser(),
    }, { pk: 'work_item_id' });
    try {
      const report = runPlatformDoctor({
        db: { sqlite: application },
        systemDb: { sqlite: system },
        tables: { work_items: userTable },
        auth: true,
        email: false,
      }, { projectRoot: root, usageAudit: false });

      expect(report.findings).toContainEqual(expect.objectContaining({
        severity: 'warning',
        code: 'database.system.file_inspection_unavailable',
        path: 'systemDb',
      }));
      expect(JSON.stringify(report.findings)).not.toContain('database is closed');
    } finally {
      application.close();
    }
  });

  test('inspects caller-owned raw application database handles without closing them', () => {
    const root = createRoot();
    const application = new Database(':memory:');
    application.run('CREATE TABLE _auth_sessions (session_id TEXT PRIMARY KEY)');
    try {
      const report = runPlatformDoctor({
        db: { database: application },
        systemDb: { mode: 'ephemeral' },
        tables: {},
        auth: false,
      }, { projectRoot: root, usageAudit: false });

      expect(report.findings).toContainEqual(expect.objectContaining({
        severity: 'error',
        code: 'database.system.legacy_combined_layout',
        path: 'db',
      }));
      expect(application.query(
        "SELECT name FROM sqlite_master WHERE name = '_auth_sessions'",
      ).get()).toBeTruthy();
    } finally {
      application.close();
    }
  });

  test('detects filesystem aliases between the two pinned planes', () => {
    const root = createRoot();
    const real = join(root, 'real');
    const alias = join(root, 'alias');
    mkdirSync(real);
    symlinkSync(real, alias, 'dir');

    const report = runPlatformDoctor({
      db: { mode: 'file', path: './real/app.db' },
      systemDb: { mode: 'file', path: './alias/app.db' },
      tables: {},
      auth: false,
    }, { projectRoot: root, usageAudit: false });

    expect(hasFinding(
      report,
      'database.system.filesystem_alias_collision',
    )).toBe(true);
  });

  function createRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'zero-doctor-system-db-'));
    roots.push(root);
    return root;
  }
});

function hasFinding(
  report: ReturnType<typeof runPlatformDoctor>,
  code: string,
): boolean {
  return report.findings.some((finding) => finding.code === code);
}
