/**
 * platform-doctor.test.ts
 *
 * Verifies app-level doctor findings without invoking the CLI. These tests
 * keep diagnostic policy separate from terminal presentation.
 */

import { describe, expect, test } from 'bun:test';
import {
  DATABASE_HOT_SHORTHAND_MAX_BYTES,
  createTenantDatabaseRef,
  defineDatabaseRealm,
} from '../databases';
import { runPlatformDoctor } from './platform-doctor';
import type { AppConfig } from '../frontend/server/types';
import {
  RESOURCE_DEFAULT_RECEIPT_MAX_KEYS,
  RESOURCE_DEFAULT_RECEIPT_MAX_RETAINED_BYTES,
  RESOURCE_DEFAULT_RECEIPT_RETAINED_LIMIT,
  adminOnly,
  allOf,
  anyOf,
  customPolicy,
  defineResource,
  metadataPolicy,
  ownerPolicy,
  readOnly,
} from '../resources';

describe('runPlatformDoctor', () => {
  test('accepts the multi/advanced runtime without a compatibility rewrite', () => {
    const report = runPlatformDoctor({
      db: { mode: ':memory:' },
      tables: {
        users: { id: 'text primary key' },
      },
      auth: {
        tenancy: 'multi',
        authorization: { mode: 'advanced' },
      },
      email: false,
    });

    expect(report.ok).toBe(false);
    expect(hasFinding(report, 'auth.tenancy.runtime_unsupported')).toBe(false);
    expect(hasFinding(report, 'auth.authorization.runtime_unsupported')).toBe(false);
    expect(hasFinding(report, 'resource.resource-managed-table-unclassified')).toBe(true);
    expect(hasFinding(report, 'auth.config.invalid')).toBe(false);
  });

  test('documents the runtime owner adoption guard for single/advanced upgrades', () => {
    const report = runPlatformDoctor({
      db: { mode: ':memory:' },
      tables: {},
      auth: { tenancy: 'single', authorization: { mode: 'advanced' } },
      email: false,
    });

    expect(hasFinding(report, 'auth.authorization.runtime_unsupported')).toBe(false);
    expect(hasFinding(report, 'auth.authorization.owner_adoption.runtime_guard')).toBe(true);
  });

  test('validates explicit tenant resource realms in multi mode', () => {
    const report = runPlatformDoctor({
      db: { mode: ':memory:' },
      tables: {
        documents: {
          document_id: 'text primary key',
          tenant_id: 'text not null',
          title: 'text not null',
        },
      },
      auth: { tenancy: 'multi' },
      email: false,
      resources: [
        defineResource({
          table: 'documents',
          exposure: 'http',
          realm: 'tenant',
          policy: adminOnly(),
        }),
      ],
    });

    expect(hasFinding(report, 'auth.tenancy.runtime_unsupported')).toBe(false);
    expect(hasFinding(report, 'resource.resource-realm-missing')).toBe(false);
    expect(hasFinding(report, 'resource.resource-exposure-missing')).toBe(false);
    expect(hasFinding(report, 'resource.resource-managed-table-unclassified')).toBe(false);
    expect(hasFinding(report, 'resource.tenant_field.index_guidance')).toBe(true);
  });

  test('understands physical tenant isolation without requiring tenant_id rows', () => {
    const tables = {
      documents: {
        document_id: 'text primary key',
        title: 'text not null',
      },
    };
    const report = runPlatformDoctor({
      db: { mode: ':memory:' },
      outDir: './dist',
      tables,
      auth: { tenancy: 'multi' },
      email: false,
      databaseTopology: {
        mode: 'multiple',
        rootDirectory: './data/tenant-databases',
        realm: defineDatabaseRealm({
          name: 'doctor-tenant-data',
          version: '1',
          tables,
        }),
        actors: {
          launch: { kind: 'source', entrypoint: import.meta.path },
        },
        tenantIsolation: 'tenant-database',
      },
      resources: [
        defineResource({
          table: 'documents',
          exposure: 'http',
          realm: 'tenant',
          policy: adminOnly(),
        }),
      ],
    });

    expect(hasFinding(report, 'config.invalid')).toBe(false);
    expect(hasFinding(report, 'resource.resource-tenant-field-missing')).toBe(false);
    expect(hasFinding(report, 'resource.tenant_field.index_guidance')).toBe(false);
    expect(hasFinding(report, 'database.topology.multiple_enabled')).toBe(true);
    expect(hasFinding(report, 'database.files.capacity_limit')).toBe(true);
    expect(hasFinding(report, 'database.tenant_isolation.physical')).toBe(true);
    expect(hasFinding(report, 'database.sync.actor_capacity_reserved')).toBe(true);
    expect(hasFinding(report, 'database.sync.actor_capacity_unreserved')).toBe(false);
    expect(hasFinding(report, 'database.sync.snapshot_transport_bounded')).toBe(true);
    expect(hasFinding(report, 'database.receipts.full_result_budget')).toBe(true);
    expect(hasFinding(report, 'database.receipts.permanent_key_capacity')).toBe(true);
    expect(hasFinding(report, 'resource.receipts.default_full_result_budget')).toBe(false);
    expect(hasFinding(report, 'resource.receipts.default_permanent_key_capacity')).toBe(false);
    expect(hasFinding(report, 'resource.tenant_database.physical_boundary')).toBe(true);
  });

  test('reports the shared default Resource receipt lifecycle from exported bounds', () => {
    const report = runPlatformDoctor({
      db: { mode: ':memory:' },
      tables: {
        notes: {
          id: 'text primary key',
          title: 'text not null',
        },
      },
      auth: false,
      email: false,
      resources: [
        defineResource({
          table: 'notes',
          exposure: 'http',
          actions: ['create'],
          policy: adminOnly(),
        }),
      ],
    });

    const retained = getFinding(report, 'resource.receipts.default_full_result_budget');
    expect(retained?.severity).toBe('info');
    expect(retained?.message).toContain(
      RESOURCE_DEFAULT_RECEIPT_RETAINED_LIMIT.toLocaleString('en-US'),
    );
    expect(retained?.message).toContain(
      `${RESOURCE_DEFAULT_RECEIPT_MAX_RETAINED_BYTES / (1024 * 1024)} MiB`,
    );
    expect(retained?.message).toContain(
      `${RESOURCE_DEFAULT_RECEIPT_MAX_RETAINED_BYTES.toLocaleString('en-US')} bytes`,
    );

    const permanent = getFinding(
      report,
      'resource.receipts.default_permanent_key_capacity',
    );
    expect(permanent?.severity).toBe('warning');
    expect(permanent?.message).toContain(
      RESOURCE_DEFAULT_RECEIPT_MAX_KEYS.toLocaleString('en-US'),
    );
    expect(permanent?.hint).toContain('database.receipt.compacted');
    expect(permanent?.hint).toContain('resource.receipt.capacity_exhausted');
  });

  test('keeps global mutations on the default receipt plane in physical tenant mode', () => {
    const tables = {
      documents: { id: 'text primary key' },
      catalog: { id: 'text primary key' },
    };
    const report = runPlatformDoctor({
      db: { mode: ':memory:' },
      outDir: './dist',
      tables,
      auth: { tenancy: 'multi' },
      email: false,
      databaseTopology: {
        mode: 'multiple',
        rootDirectory: './data/global-receipt-doctor',
        realm: defineDatabaseRealm({
          name: 'doctor-global-receipt',
          version: '1',
          tables,
        }),
        actors: {
          launch: { kind: 'source', entrypoint: import.meta.path },
        },
        tenantIsolation: 'tenant-database',
      },
      resources: [
        defineResource({
          table: 'documents',
          exposure: 'http',
          realm: 'tenant',
          actions: ['list', 'get'],
          policy: readOnly(),
        }),
        defineResource({
          table: 'catalog',
          exposure: 'http',
          realm: 'global',
          actions: ['create'],
          policy: adminOnly(),
        }),
      ],
    });

    expect(hasFinding(report, 'resource.receipts.default_full_result_budget')).toBe(true);
    expect(hasFinding(report, 'resource.receipts.default_permanent_key_capacity')).toBe(true);
  });

  test('does not claim a default receipt plane without a generated HTTP mutation', () => {
    const base = {
      db: { mode: ':memory:' as const },
      tables: { notes: { id: 'text primary key' } },
      auth: false as const,
      email: false as const,
    };
    const readOnlyReport = runPlatformDoctor({
      ...base,
      resources: [defineResource({
        table: 'notes',
        exposure: 'http',
        actions: ['list', 'get'],
        policy: readOnly(),
      })],
    });
    const internalReport = runPlatformDoctor({
      ...base,
      resources: [defineResource({
        table: 'notes',
        exposure: 'internal',
        actions: ['create'],
        policy: adminOnly(),
      })],
    });
    const routesDisabledReport = runPlatformDoctor({
      ...base,
      resourceRoutes: false,
      resources: [defineResource({
        table: 'notes',
        exposure: 'http',
        actions: ['create'],
        policy: adminOnly(),
      })],
    });

    for (const report of [readOnlyReport, internalReport, routesDisabledReport]) {
      expect(hasFinding(report, 'resource.receipts.default_full_result_budget')).toBe(false);
      expect(hasFinding(report, 'resource.receipts.default_permanent_key_capacity')).toBe(false);
    }
  });

  test('warns when persistent tenant Sync can pin every actor slot', () => {
    const tables = { notes: { id: 'text primary key' } };
    const report = runPlatformDoctor({
      db: { mode: ':memory:' },
      tables,
      auth: { tenancy: 'multi' },
      email: false,
      databaseTopology: {
        mode: 'multiple',
        rootDirectory: './data/unreserved-sync-doctor',
        realm: defineDatabaseRealm({
          name: 'doctor-unreserved-sync',
          version: '1',
          tables,
        }),
        actors: {
          launch: { kind: 'source', entrypoint: import.meta.path },
        },
        tenantIsolation: 'tenant-database',
        maxDatabases: 2,
        maxTenantSyncDatabases: 2,
      },
    });

    expect(hasFinding(report, 'database.sync.actor_capacity_reserved')).toBe(false);
    expect(hasFinding(report, 'database.sync.actor_capacity_unreserved')).toBe(true);
    expect(getFinding(
      report,
      'database.sync.actor_capacity_unreserved',
    )?.severity).toBe('warning');

    const oneSlot = runPlatformDoctor({
      db: { mode: ':memory:' },
      tables,
      auth: { tenancy: 'multi' },
      email: false,
      databaseTopology: {
        mode: 'multiple',
        rootDirectory: './data/one-slot-sync-doctor',
        realm: defineDatabaseRealm({
          name: 'doctor-one-slot-sync',
          version: '1',
          tables,
        }),
        actors: {
          launch: { kind: 'source', entrypoint: import.meta.path },
        },
        tenantIsolation: 'tenant-database',
        maxDatabases: 1,
      },
    });
    expect(getFinding(
      oneSlot,
      'database.sync.actor_capacity_unreserved',
    )?.message).toContain('one-slot topology');
  });

  test('rejects a multi-database root mixed with build or object-storage files', () => {
    const tables = { notes: { id: 'text primary key' } };
    const topology = {
      mode: 'multiple' as const,
      rootDirectory: './build',
      realm: defineDatabaseRealm({
        name: 'doctor-root-safety',
        version: '1',
        tables,
      }),
      actors: {
        launch: { kind: 'source' as const, entrypoint: import.meta.path },
      },
    };
    const buildOverlap = runPlatformDoctor({
      db: { mode: ':memory:' },
      outDir: './build/client',
      tables,
      auth: false,
      databaseTopology: topology,
    });
    const storageReuse = runPlatformDoctor({
      db: { mode: ':memory:' },
      outDir: './dist',
      storageDir: './build',
      tables,
      auth: false,
      databaseTopology: topology,
    });
    const storageTempOverlap = runPlatformDoctor({
      db: { mode: ':memory:' },
      outDir: './dist',
      storageDir: './.storage',
      tables,
      auth: false,
      databaseTopology: {
        ...topology,
        rootDirectory: './.storage/tmp/tenant-databases',
      },
    });
    const controlDatabaseOverlap = runPlatformDoctor({
      db: { mode: 'file', path: './data/tenant-databases/control.db' },
      outDir: './dist',
      tables,
      auth: false,
      databaseTopology: {
        ...topology,
        rootDirectory: './data/tenant-databases',
      },
    });
    const dedicatedStorageChild = runPlatformDoctor({
      db: { mode: ':memory:' },
      outDir: './dist',
      storageDir: './.storage',
      tables,
      auth: false,
      databaseTopology: {
        ...topology,
        rootDirectory: './.storage/databases',
      },
    });

    expect(hasFinding(buildOverlap, 'database.root.overlaps_build_output')).toBe(true);
    expect(hasFinding(storageReuse, 'database.root.reuses_storage_directory')).toBe(true);
    expect(hasFinding(storageTempOverlap, 'database.root.overlaps_storage_temp')).toBe(true);
    expect(hasFinding(controlDatabaseOverlap, 'database.root.overlaps_control_database')).toBe(true);
    expect(hasFinding(dedicatedStorageChild, 'database.root.reuses_storage_directory')).toBe(false);
    expect(hasFinding(dedicatedStorageChild, 'database.root.overlaps_storage_temp')).toBe(false);
    expect(hasFinding(dedicatedStorageChild, 'database.root.overlaps_storage_blobs')).toBe(false);
  });

  test('makes bounded hot placement, writer-only reads, and total image budget visible', () => {
    const tables = { notes: { id: 'text primary key' } };
    const report = runPlatformDoctor({
      db: { mode: ':memory:' },
      tables,
      auth: false,
      email: false,
      databaseTopology: {
        mode: 'multiple',
        rootDirectory: './data/hot-doctor',
        realm: defineDatabaseRealm({
          name: 'doctor-hot-placement',
          version: '1',
          tables,
        }),
        actors: {
          launch: { kind: 'source', entrypoint: import.meta.path },
        },
        placement: 'hot',
        maxDatabases: 3,
      },
    });

    expect(hasFinding(report, 'database.placement.hot_enabled')).toBe(true);
    expect(hasFinding(report, 'database.hot.on_write_durability')).toBe(true);
    expect(hasFinding(report, 'database.hot.readers_unavailable')).toBe(true);
    expect(hasFinding(report, 'database.hot.capacity_upper_bound')).toBe(true);
    expect(hasFinding(report, 'database.hot.periodic.accepted_loss_window')).toBe(false);
    expect(hasFinding(report, 'database.hot.final.accepted_loss_window')).toBe(false);
    const capacity = getFinding(report, 'database.hot.capacity_upper_bound');
    expect(capacity?.message).toContain(
      `${DATABASE_HOT_SHORTHAND_MAX_BYTES.toLocaleString('en-US')} bytes`,
    );
    expect(capacity?.message).toContain('201,326,592 bytes');
  });

  test('reports hybrid selection and warns about a periodic accepted-loss window', () => {
    const tables = { notes: { id: 'text primary key' } };
    const report = runPlatformDoctor({
      db: { mode: ':memory:' },
      tables,
      auth: false,
      email: false,
      databaseTopology: {
        mode: 'multiple',
        rootDirectory: './data/hybrid-doctor',
        realm: defineDatabaseRealm({
          name: 'doctor-hybrid-placement',
          version: '1',
          tables,
        }),
        actors: {
          launch: { kind: 'source', entrypoint: import.meta.path },
        },
        placement: {
          default: 'file',
          select: ({ databaseRef }) => databaseRef === createTenantDatabaseRef('hot-tenant')
            ? 'hot'
            : 'file',
          hot: {
            durability: 'periodic',
            maxBytes: 10_000_000,
            snapshotIntervalMs: 7_500,
          },
        },
        maxDatabases: 2,
      },
    });

    expect(hasFinding(report, 'database.placement.hybrid_enabled')).toBe(true);
    expect(hasFinding(report, 'database.placement.hot_enabled')).toBe(false);
    expect(hasFinding(report, 'database.hot.periodic.accepted_loss_window')).toBe(true);
    expect(hasFinding(report, 'database.hot.final.accepted_loss_window')).toBe(false);
    expect(getFinding(
      report,
      'database.hot.periodic.accepted_loss_window',
    )?.message).toContain('7500ms');
  });

  test('warns strongly for final-only durability and stays quiet for file placement', () => {
    const tables = { notes: { id: 'text primary key' } };
    const realm = defineDatabaseRealm({
      name: 'doctor-final-placement',
      version: '1',
      tables,
    });
    const topologyBase = {
      mode: 'multiple' as const,
      rootDirectory: './data/final-doctor',
      realm,
      actors: {
        launch: { kind: 'source' as const, entrypoint: import.meta.path },
      },
    };
    const finalReport = runPlatformDoctor({
      db: { mode: ':memory:' },
      tables,
      auth: false,
      email: false,
      databaseTopology: {
        ...topologyBase,
        placement: {
          default: 'hot',
          hot: { durability: 'final', maxBytes: 4_000_000 },
        },
      },
    });
    const fileReport = runPlatformDoctor({
      db: { mode: ':memory:' },
      tables,
      auth: false,
      email: false,
      databaseTopology: {
        ...topologyBase,
        placement: 'file',
      },
    });

    expect(hasFinding(finalReport, 'database.hot.final.accepted_loss_window')).toBe(true);
    expect(getFinding(
      finalReport,
      'database.hot.final.accepted_loss_window',
    )?.severity).toBe('warning');
    expect(hasFinding(fileReport, 'database.hot.readers_unavailable')).toBe(false);
    expect(hasFinding(fileReport, 'database.hot.capacity_upper_bound')).toBe(false);
    expect(hasFinding(fileReport, 'database.hot.final.accepted_loss_window')).toBe(false);
  });

  test('only treats a compound natural identity as tenant-leading when the realm field leads', () => {
    const config = (identity: string[]): AppConfig => ({
      db: { mode: ':memory:' },
      tables: {
        documents: {
          document_id: 'text primary key',
          tenant_id: 'text not null',
          slug: 'text not null',
          _identity: identity,
        },
      },
      auth: { tenancy: 'multi' },
      email: false,
      resources: [
        defineResource({
          table: 'documents',
          exposure: 'all',
          realm: 'tenant',
          policy: adminOnly(),
        }),
      ],
    });

    const trailing = runPlatformDoctor(config(['slug', 'tenant_id']));
    expect(hasFinding(trailing, 'resource.tenant_field.index_guidance')).toBe(true);

    const leading = runPlatformDoctor(config(['tenant_id', 'slug']));
    expect(hasFinding(leading, 'resource.tenant_field.index_guidance')).toBe(false);
  });

  test('diagnoses missing multi-mode exposure and sync-only lazy hydration conflicts', () => {
    const missing = runPlatformDoctor({
      db: { mode: ':memory:' },
      tables: {
        documents: {
          id: 'text primary key',
          tenant_id: 'text not null',
        },
      },
      auth: { tenancy: 'multi' },
      resources: [defineResource({
        table: 'documents',
        realm: 'tenant',
        policy: readOnly(),
      })],
    });
    expect(hasFinding(missing, 'resource.resource-exposure-missing')).toBe(true);

    const conflicting = runPlatformDoctor({
      db: { mode: ':memory:' },
      tables: {
        lazy_docs: {
          serverTable: { id: 'text primary key' },
          clientTable: { _pk: 'id', _sync: 'lazy' },
        },
        auto_docs: { id: 'text primary key' },
        full_docs: {
          serverTable: { id: 'text primary key' },
          clientTable: { _pk: 'id', _sync: 'full' },
        },
      },
      auth: false,
      resources: [
        defineResource({ table: 'lazy_docs', exposure: 'sync', policy: readOnly() }),
        defineResource({ table: 'auto_docs', exposure: 'sync', policy: readOnly() }),
        defineResource({ table: 'full_docs', exposure: 'sync', policy: readOnly() }),
      ],
    });
    expect(conflicting.findings.filter((finding) =>
      finding.code === 'resource.exposure.sync_lazy_requires_http'))
      .toHaveLength(2);
    expect(conflicting.findings.some((finding) =>
      finding.path === 'resources.full_docs.exposure'
      && finding.code === 'resource.exposure.sync_lazy_requires_http'))
      .toBe(false);
  });

  test('does not accept primary-key words inside quoted or commented schema text', () => {
    const report = runPlatformDoctor({
      db: { mode: ':memory:' },
      tables: {
        quoted: { id: "text default 'primary key'" },
        commented: { id: 'text /* PRIMARY KEY */' },
        bareCrComment: {
          id: 'text unique-- hidden through bare CR\rprimary key\n',
        },
        unicodeJoined: { id: 'text\u00a0primary key unique' },
        unicodeFolded: { id: 'text prımary key unique' },
      },
      auth: false,
    });

    expect(report.findings.filter((finding) =>
      finding.code === 'schema.primary_key.missing')).toHaveLength(5);
  });

  test('diagnoses column definitions that escape into table constraints', () => {
    const escaped = runPlatformDoctor({
      db: { mode: ':memory:' },
      tables: {
        records: {
          id: 'text',
          other: 'text unique, primary key (id, other)',
        },
      },
      auth: false,
    });
    expect(escaped.findings).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'schema.column_definition.not_isolated',
      path: 'tables.records.other',
    }));

    const nested = runPlatformDoctor({
      db: { mode: ':memory:' },
      tables: {
        records: {
          id: 'text primary key',
          amount: 'decimal(10, 2) check (amount in (1, 2, 3))',
        },
      },
      auth: false,
    });
    expect(nested.findings.some((finding) =>
      finding.code === 'schema.column_definition.not_isolated')).toBe(false);

    const ambiguousQuotedType = runPlatformDoctor({
      db: { mode: ':memory:' },
      tables: { records: { id: '"REAL" text primary key' } },
      auth: false,
    });
    expect(ambiguousQuotedType.findings).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'schema.column_definition.not_isolated',
      path: 'tables.records.id',
    }));
  });

  test('diagnoses unsupported sync primary-key affinities', () => {
    const report = runPlatformDoctor({
      db: { mode: ':memory:' },
      tables: {
        textKeys: { id: 'text primary key' },
        integerKeys: { id: 'integer primary key' },
        realKeys: { id: 'real primary key' },
        blobKeys: { id: 'blob primary key' },
        numericKeys: { id: 'numeric primary key' },
        typelessKeys: { id: 'primary key' },
      },
      auth: false,
    });

    const affinityFindings = report.findings.filter((finding) =>
      finding.code === 'schema.primary_key.unsupported_affinity');
    expect(affinityFindings.map((finding) => finding.path)).toEqual([
      'tables.realKeys.id',
      'tables.blobKeys.id',
      'tables.numericKeys.id',
      'tables.typelessKeys.id',
    ]);
    expect(affinityFindings.map((finding) => finding.message)).toEqual([
      expect.stringContaining('REAL affinity'),
      expect.stringContaining('BLOB affinity'),
      expect.stringContaining('NUMERIC affinity'),
      expect.stringContaining('TYPELESS affinity'),
    ]);
    expect(report.findings.some((finding) =>
      finding.path === 'tables.textKeys.id'
      || finding.path === 'tables.integerKeys.id')).toBe(false);
  });

  test('checks PDF executable paths and unsafe renderer policy', () => {
    const report = runPlatformDoctor({
      db: { mode: 'memory' },
      tables: {
        todos: { id: 'text primary key' },
      },
      pdf: {
        browser: {
          executablePath: '/definitely/missing/chromium',
          javaScriptEnabled: true,
        },
        resources: {
          remote: 'allow',
          blockPrivateNetworks: false,
        },
      },
    }, { env: {} });

    expect(hasFinding(report, 'pdf.browser.executable_missing')).toBe(true);
    expect(hasFinding(report, 'pdf.resources.remote_unrestricted')).toBe(true);
    expect(hasFinding(report, 'pdf.resources.private_network_allowed')).toBe(true);
    expect(hasFinding(report, 'pdf.browser.javascript_enabled')).toBe(true);
  });
  test('warns by default but only fails strict mode for warnings', () => {
    const config: AppConfig = {
      db: { mode: ':memory:' },
      tables: {
        todos: { id: 'text primary key', title: 'text not null' },
      },
      auth: true,
      email: false,
    };

    const relaxed = runPlatformDoctor(config, { env: {} });
    expect(relaxed.ok).toBe(true);
    expect(hasFinding(relaxed, 'auth.email.disabled')).toBe(true);
    expect(hasFinding(relaxed, 'sync.auth_policy.open_app_tables')).toBe(true);

    const strict = runPlatformDoctor(config, { env: {}, strict: true });
    expect(strict.ok).toBe(false);
  });

  test('diagnoses unsafe or inoperable installation bootstrap configuration', () => {
    const missing = runPlatformDoctor({
      db: { mode: 'memory' }, tables: {}, auth: true, email: false,
    });
    expect(hasFinding(missing, 'auth.bootstrap.secret_missing')).toBe(true);

    const publicBootstrap = runPlatformDoctor({
      db: { mode: 'memory' }, tables: {},
      auth: { bootstrap: 'public' }, email: false,
    });
    expect(hasFinding(publicBootstrap, 'auth.bootstrap.public')).toBe(true);

    const configured = runPlatformDoctor({
      db: { mode: 'memory' }, tables: {},
      auth: {
        bootstrap: {
          mode: 'secret',
          secret: 'doctor-bootstrap-secret-with-more-than-32-characters',
        },
      },
      email: false,
    });
    expect(hasFinding(configured, 'auth.bootstrap.secret_missing')).toBe(false);
    expect(hasFinding(configured, 'auth.bootstrap.public')).toBe(false);
  });

  test('requires durable strong storage capability signing in production', () => {
    const ephemeral = runPlatformDoctor({
      db: { mode: 'ephemeral' },
      tables: {},
      auth: true,
      email: false,
    }, { env: { NODE_ENV: 'production' } });
    expect(ephemeral.ok).toBe(false);
    expect(hasFinding(
      ephemeral,
      'storage.signing_secret.ephemeral_database',
    )).toBe(true);

    const durable = runPlatformDoctor({
      db: { mode: 'file', path: './data/doctor-storage.db' },
      tables: {},
      auth: true,
      email: false,
    }, { env: { NODE_ENV: 'production' } });
    expect(hasFinding(
      durable,
      'storage.signing_secret.ephemeral_database',
    )).toBe(false);

    const externallyManaged = runPlatformDoctor({
      db: { mode: 'ephemeral' },
      tables: {},
      auth: true,
      email: false,
    }, {
      env: {
        NODE_ENV: 'production',
        ZERO_STORAGE_SIGNING_SECRET: 'doctor-storage-secret-with-at-least-32-bytes',
      },
    });
    expect(hasFinding(
      externallyManaged,
      'storage.signing_secret.ephemeral_database',
    )).toBe(false);
    expect(hasFinding(externallyManaged, 'storage.signing_secret.weak')).toBe(false);

    const weak = runPlatformDoctor({
      db: { mode: 'file', path: './data/doctor-storage.db' },
      tables: {},
      auth: true,
      email: false,
      storage: { signingSecret: 'too-short' },
    }, { env: { NODE_ENV: 'production' } });
    expect(weak.ok).toBe(false);
    expect(hasFinding(weak, 'storage.signing_secret.weak')).toBe(true);
  });

  test('reports schema primary-key and natural-identity mistakes', () => {
    const report = runPlatformDoctor({
      db: { mode: ':memory:' },
      tables: {
        missingPk: { name: 'text not null' },
        tooManyPk: {
          left_id: 'text primary key',
          right_id: 'text primary key',
        },
        badIdentity: {
          membership_id: 'text primary key',
          team_id: 'text not null',
          _identity: ['team_id', 'missing', 'membership_id'],
        },
      },
      auth: false,
    });

    expect(report.ok).toBe(false);
    expect(hasFinding(report, 'schema.primary_key.missing')).toBe(true);
    expect(hasFinding(report, 'schema.primary_key.composite')).toBe(true);
    expect(hasFinding(report, 'schema.identity.missing_field')).toBe(true);
    expect(hasFinding(report, 'schema.identity.primary_key_field')).toBe(true);
  });

  test('checks account email readiness and Resend configuration', () => {
    const report = runPlatformDoctor({
      db: { mode: ':memory:' },
      app: {},
      tables: {
        users: { id: 'text primary key' },
      },
      auth: {
        accountEmails: {
          adminCreatedUser: true,
          passwordReset: true,
        },
      },
      email: {},
    }, { env: {} });

    expect(report.ok).toBe(true);
    expect(hasFinding(report, 'auth.email.public_url_missing')).toBe(true);
    expect(hasFinding(report, 'email.from_missing')).toBe(true);
    expect(hasFinding(report, 'email.resend_api_key_missing')).toBe(true);
  });

  test('reports strict auth config resolution failures through Doctor', () => {
    const rootTypo = runPlatformDoctor({
      db: { mode: ':memory:' },
      tables: {},
      auth: { tennacy: 'multi' } as never,
      email: false,
    });
    expect(rootTypo.ok).toBe(false);
    expect(rootTypo.findings).toContainEqual(expect.objectContaining({
      code: 'auth.config.invalid',
      message: expect.stringContaining('unsupported field "tennacy"'),
    }));

    const nestedTypo = runPlatformDoctor({
      db: { mode: ':memory:' },
      tables: {},
      auth: { registration: { mode: 'publci' } } as never,
      email: false,
    });
    expect(nestedTypo.ok).toBe(false);
    expect(nestedTypo.findings).toContainEqual(expect.objectContaining({
      code: 'auth.config.invalid',
      message: expect.stringContaining('Unsupported registration mode'),
    }));
  });

  test('checks required email-verification delivery and link readiness', () => {
    const auth = {
      account: { requireEmailVerification: true },
    };
    const noDelivery = runPlatformDoctor({
      db: { mode: ':memory:' }, tables: {}, auth,
      app: { publicUrl: 'https://app.example.test' },
      email: false,
    }, { env: {} });
    expect(noDelivery.ok).toBe(false);
    expect(hasFinding(
      noDelivery,
      'auth.email_verification.delivery_unavailable',
    )).toBe(true);
    expect(hasFinding(
      noDelivery,
      'auth.email_verification.public_url_missing',
    )).toBe(false);

    const noPublicUrl = runPlatformDoctor({
      db: { mode: ':memory:' }, tables: {}, auth,
      email: { from: 'Zero <zero@example.test>', provider: 'console' },
    }, { env: {} });
    expect(noPublicUrl.ok).toBe(false);
    expect(hasFinding(
      noPublicUrl,
      'auth.email_verification.delivery_unavailable',
    )).toBe(false);
    expect(hasFinding(
      noPublicUrl,
      'auth.email_verification.public_url_missing',
    )).toBe(true);

    const ready = runPlatformDoctor({
      db: { mode: ':memory:' }, tables: {},
      auth: {
        ...auth,
        branding: { publicUrl: 'https://accounts.example.test' },
      },
      email: { from: 'Zero <zero@example.test>', provider: 'console' },
    }, { env: {} });
    expect(hasFinding(
      ready,
      'auth.email_verification.delivery_unavailable',
    )).toBe(false);
    expect(hasFinding(
      ready,
      'auth.email_verification.public_url_missing',
    )).toBe(false);
  });

  test('checks operational methods when application policy requires MFA', () => {
    const requiredMfa = (methods: Array<'email' | 'totp'>) => ({
      mfa: { enabled: true, policy: 'required' as const, methods },
    });
    const emailUnavailable = runPlatformDoctor({
      db: { mode: ':memory:' }, tables: {},
      auth: requiredMfa(['email']), email: false,
    }, { env: {} });
    expect(emailUnavailable.ok).toBe(false);
    expect(emailUnavailable.findings).toContainEqual(expect.objectContaining({
      code: 'auth.mfa.email_delivery_unavailable',
      severity: 'error',
    }));

    const totpUnavailable = runPlatformDoctor({
      db: { mode: ':memory:' }, tables: {},
      auth: requiredMfa(['totp']), email: false,
    }, { env: {} });
    expect(totpUnavailable.ok).toBe(false);
    expect(totpUnavailable.findings).toContainEqual(expect.objectContaining({
      code: 'auth.mfa.totp_encryption_key_missing',
      severity: 'error',
    }));

    const emailFallback = runPlatformDoctor({
      db: { mode: ':memory:' }, tables: {},
      auth: requiredMfa(['email', 'totp']),
      email: { from: 'Zero <zero@example.test>', provider: 'console' },
    }, { env: {} });
    expect(emailFallback.findings).toContainEqual(expect.objectContaining({
      code: 'auth.mfa.totp_encryption_key_missing',
      severity: 'warning',
    }));
    expect(hasFinding(
      emailFallback,
      'auth.mfa.email_delivery_unavailable',
    )).toBe(false);

    const optional = runPlatformDoctor({
      db: { mode: ':memory:' }, tables: {},
      auth: { mfa: { enabled: true, policy: 'optional', methods: ['totp'] } },
      email: false,
    }, { env: {} });
    expect(hasFinding(optional, 'auth.mfa.totp_encryption_key_missing')).toBe(false);
  });

  test('fails closed when verified-domain onboarding email links cannot operate', () => {
    const auth = {
      tenancy: {
        mode: 'multi' as const,
        onboarding: { verifiedDomains: { enabled: true } },
      },
    };
    const disabled = runPlatformDoctor({
      db: { mode: ':memory:' }, tables: {}, auth, email: false,
    }, { env: {} });
    expect(disabled.ok).toBe(false);
    expect(hasFinding(disabled, 'auth.email.disabled')).toBe(true);

    const missingUrl = runPlatformDoctor({
      db: { mode: ':memory:' }, tables: {}, auth,
      email: { from: 'Zero <zero@example.test>', provider: 'console' },
    }, { env: {} });
    expect(missingUrl.ok).toBe(false);
    expect(hasFinding(missingUrl, 'auth.email.public_url_missing')).toBe(true);

    const ready = runPlatformDoctor({
      db: { mode: ':memory:' }, tables: {}, auth,
      app: { publicUrl: 'https://app.example.test' },
      email: { from: 'Zero <zero@example.test>', provider: 'console' },
    }, { env: {} });
    expect(hasFinding(ready, 'auth.email.disabled')).toBe(false);
    expect(hasFinding(ready, 'auth.email.public_url_missing')).toBe(false);
    expect(hasFinding(ready, 'email.from_missing')).toBe(false);
  });

  test('fails invalid account email duration strings', () => {
    const report = runPlatformDoctor({
      db: { mode: ':memory:' },
      tables: {
        users: { id: 'text primary key' },
      },
      auth: {
        accountEmails: {
          actionTokenTTL: 'soon',
          requestCooldown: 'later',
        },
      },
      email: false,
    });

    expect(report.ok).toBe(false);
    expect(hasFinding(report, 'auth.action_token_ttl.invalid')).toBe(true);
    expect(hasFinding(report, 'auth.account_email_cooldown.invalid')).toBe(true);
  });

  test('warns about file DB migration and lazy-table index guidance', () => {
    const report = runPlatformDoctor({
      db: { mode: './data/app.db' },
      migrate: false,
      tables: {
        audit_log: {
          serverTable: { audit_id: 'text primary key', created_at: 'integer not null' },
          clientTable: { _pk: 'audit_id', _sync: 'lazy', created_at: 'integer' },
        },
      },
      auth: false,
    });

    expect(report.ok).toBe(true);
    expect(hasFinding(report, 'migrations.startup.disabled')).toBe(true);
    expect(hasFinding(report, 'sync.lazy.index_guidance')).toBe(true);
  });

  test('checks AI provider readiness, aliases, and status endpoint access', () => {
    const report = runPlatformDoctor({
      db: { mode: ':memory:' },
      tables: {
        users: { id: 'text primary key' },
      },
      auth: false,
      ai: {
        autoDetect: false,
        providers: {
          local: { type: 'openai-compatible', apiKey: 'test-key' },
          groq: { type: 'groq', apiKey: 'test-key' },
          bespoke: { type: 'custom', apiKey: 'test-key' },
        },
        aliases: {
          fast: 'local/model',
          smart: 'not-qualified',
          image: 'groq/image-model',
          speech: 'missing/tts',
        },
        statusEndpoint: { enabled: true, read: 'admin' },
      },
    }, { env: { NODE_ENV: 'production' } });

    expect(report.ok).toBe(true);
    expect(hasFinding(report, 'ai.provider.base_url_missing')).toBe(true);
    expect(hasFinding(report, 'ai.provider.custom_adapter_missing')).toBe(true);
    expect(hasFinding(report, 'ai.alias.provider_inactive')).toBe(true);
    expect(hasFinding(report, 'ai.alias.invalid_model_reference')).toBe(true);
    expect(hasFinding(report, 'ai.alias.capability_unsupported')).toBe(true);
    expect(hasFinding(report, 'ai.alias.provider_missing')).toBe(true);
    expect(hasFinding(report, 'ai.status_endpoint.requires_auth')).toBe(true);
  });

  test('checks vector paths, metadata index guidance, and embedding readiness', () => {
    const report = runPlatformDoctor({
      db: { mode: ':memory:' },
      tables: {
        docs: { id: 'text primary key' },
      },
      auth: false,
      storageDir: './.storage',
      vector: {
        defaultIndex: 'docs',
        indexes: {
          docs: {
            dimensions: 768,
            path: './.storage/vectors',
            readOnly: true,
            metadata: {
              bucket: { type: 'string', indexed: false },
            },
          },
          copy: {
            dimensions: 768,
            path: './.storage/vectors',
          },
          build: {
            dimensions: 8192,
            path: './.build/vector',
            metadata: {
              tenantId: { type: 'string', indexed: false },
            },
          },
        },
      },
    }, { env: {} });

    expect(report.ok).toBe(false);
    expect(hasFinding(report, 'storage.auth_required')).toBe(true);
    expect(hasFinding(report, 'vector.ai.disabled')).toBe(true);
    expect(hasFinding(report, 'vector.index.path_duplicate')).toBe(true);
    expect(hasFinding(report, 'vector.index.path_overlaps_storage')).toBe(true);
    expect(hasFinding(report, 'vector.index.path_overlaps_build_output')).toBe(true);
    expect(hasFinding(report, 'vector.index.read_only')).toBe(true);
    expect(hasFinding(report, 'vector.index.dimensions_high')).toBe(true);
    expect(hasFinding(report, 'vector.metadata.scope_field_unindexed')).toBe(true);
  });

  test('checks auth login routes and production observability readiness', () => {
    const report = runPlatformDoctor({
      db: { mode: ':memory:' },
      tables: {
        users: { id: 'text primary key' },
      },
      auth: true,
      email: false,
      loginPath: '/signin',
      publicPaths: ['/login', '/forgot-password'],
      observability: false,
    }, {
      env: {
        NODE_ENV: 'production',
        ZERO_STORAGE_SIGNING_SECRET: 'doctor-production-storage-secret-at-least-32-bytes',
      },
    });

    expect(report.ok).toBe(true);
    expect(hasFinding(report, 'auth.login_path.not_public')).toBe(true);
    expect(hasFinding(report, 'sync.auth.required_defaulted')).toBe(true);
    expect(hasFinding(report, 'observability.disabled.production')).toBe(true);
  });

  test('does not require loginPath in publicPaths for explicit route auth', () => {
    const report = runPlatformDoctor({
      db: { mode: ':memory:' },
      tables: {
        users: { id: 'text primary key' },
      },
      auth: true,
      routeAuth: 'explicit',
      loginPath: '/signin',
      publicPaths: ['/login'],
    });

    expect(hasFinding(report, 'auth.login_path.not_public')).toBe(false);
  });

  test('does not treat external publicPaths entries as local auth routes', () => {
    const report = runPlatformDoctor({
      db: { mode: ':memory:' }, tables: {}, auth: true,
      loginPath: '/signin', publicPaths: ['https://evil.example/signin'],
    });
    expect(hasFinding(report, 'auth.login_path.not_public')).toBe(true);
  });

  test('checks every enabled auth lifecycle path in an explicit public list', () => {
    const report = runPlatformDoctor({
      db: { mode: ':memory:' }, tables: {}, email: false,
      auth: {
        account: { requireEmailVerification: true, emailVerificationPath: '/confirm' },
        accountEmails: {
          passwordReset: true, adminCreatedUser: true,
          resetPath: '/recover', setupPath: '/activate',
        },
      },
      loginPath: '/signin', registrationPath: '/join', publicPaths: ['/signin'],
    });

    for (const code of [
      'auth.registration_path.not_public', 'auth.forgot_path.not_public',
      'auth.reset_path.not_public', 'auth.setup_path.not_public',
      'auth.verification_path.not_public',
    ]) expect(hasFinding(report, code)).toBe(true);
  });

  test('checks resource registration errors and policy/data/sync guidance', () => {
    const report = runPlatformDoctor({
      db: { mode: ':memory:' },
      tables: {
        tickets: {
          ticket_id: 'text primary key',
          title: 'text not null',
          owner_id: 'text not null',
        },
        projects: {
          project_id: 'text primary key',
          title: 'text not null',
        },
      },
      auth: {
        userProperties: {
          department: {
            type: 'enum',
            values: ['support', 'management'],
            editableBy: 'admin',
            useInPolicies: true,
          },
        },
      },
      resources: [
        defineResource({
          name: 'ticket',
          table: 'tickets',
          policy: {
            list: anyOf(
              ownerPolicy({ userField: 'owner_id' }),
              metadataPolicy({ department: 'support' })
            ),
            get: ownerPolicy({ userField: 'owner_id' }),
            create: ownerPolicy({ userField: 'owner_id' }),
            update: customPolicy(() => true, { name: 'runtime-update' }),
            delete: adminOnly(),
          },
        }),
        defineResource({
          name: 'project',
          table: 'projects',
          actions: ['list'],
          policy: ownerPolicy({ userField: 'missing_owner_id' }),
        }),
        defineResource({
          name: 'internal',
          table: 'projects',
          actions: ['get'],
          policy: readOnly(),
        }),
      ],
    }, { env: {} });

    expect(report.ok).toBe(false);
    expect(hasFinding(report, 'resource.resource-owner-field-missing')).toBe(true);
    expect(hasFinding(report, 'resource.owner_field.index_guidance')).toBe(true);
    expect(hasFinding(report, 'resource.sync.row_filtered')).toBe(true);
    expect(hasFinding(report, 'resource.public_write_policy_uninspectable')).toBe(true);
    expect(hasFinding(report, 'resource.list_policy.missing')).toBe(true);
  });

  test('does not warn about open app sync when sync tables are covered by resources', () => {
    const report = runPlatformDoctor({
      db: { mode: ':memory:' },
      tables: {
        tasks: {
          task_id: 'text primary key',
          owner_id: 'text not null',
          title: 'text not null',
        },
      },
      auth: true,
      email: false,
      doctor: {
        indexedFields: {
          tasks: ['owner_id'],
        },
      },
      resources: [
        defineResource({
          table: 'tasks',
          policy: ownerPolicy({ userField: 'owner_id' }),
        }),
      ],
    }, { env: {} });

    expect(report.ok).toBe(true);
    expect(hasFinding(report, 'sync.auth_policy.open_app_tables')).toBe(false);
    expect(hasFinding(report, 'resource.owner_field.index_guidance')).toBe(false);
    expect(hasFinding(report, 'resource.sync.row_filtered')).toBe(true);
  });

  test('warns when resources require auth but auth is disabled', () => {
    const report = runPlatformDoctor({
      db: { mode: ':memory:' },
      tables: {
        todos: {
          id: 'text primary key',
          title: 'text not null',
          owner_id: 'text not null',
          _identity: ['owner_id', 'title'],
        },
      },
      auth: false,
      resources: [
        defineResource({
          table: 'todos',
          actions: ['list', 'create'],
          policy: {
            list: allOf(ownerPolicy({ userField: 'owner_id' })),
            create: ownerPolicy({ userField: 'owner_id' }),
          },
        }),
      ],
    }, { env: {} });

    expect(report.ok).toBe(true);
    expect(hasFinding(report, 'resource.auth_required_but_disabled')).toBe(true);
    expect(hasFinding(report, 'resource.owner_field.index_guidance')).toBe(false);
  });
});

function hasFinding(
  report: ReturnType<typeof runPlatformDoctor>,
  code: string
): boolean {
  return report.findings.some((finding) => finding.code === code);
}

function getFinding(
  report: ReturnType<typeof runPlatformDoctor>,
  code: string,
) {
  return report.findings.find((finding) => finding.code === code);
}
