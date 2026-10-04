import { describe, expect, test } from 'bun:test';

import {
  DatabaseAutomationRegistry,
  defineDatabaseAutomations,
} from '../database-automations/database-automations';
import { defineDatabaseFunction } from '../database-automations/database-function';
import { defineDatabaseTrigger } from '../database-automations/database-trigger';
import type { DatabaseRealm } from '../databases/database-realm';
import { defineDatabaseRealm } from '../databases/database-realm';
import type { TableSchema } from '../sync/types';
import {
  createPlatformDoctorFindingSink,
  type PlatformDoctorFinding,
} from './platform-doctor-contracts';
import { checkDatabaseAutomations as exportedCheckDatabaseAutomations } from './index';
import { runPlatformDoctor } from './platform-doctor';
import { checkDatabaseAutomations } from './platform-doctor-database-automations';

const rollup = defineDatabaseFunction({
  name: 'orders.rollup',
  version: 1,
  mode: 'transaction',
  handler: () => undefined,
});
const notify = defineDatabaseFunction({
  name: 'orders.notify',
  version: 1,
  mode: 'durable',
  handler: async () => undefined,
});

function tables(): Record<string, TableSchema> {
  return {
    orders: {
      id: 'text primary key',
      status: 'text not null',
      total: 'integer not null',
    },
  };
}

function trigger(functions = [rollup, notify]) {
  return defineDatabaseTrigger({
    name: 'orders.changed',
    version: 1,
    table: 'orders',
    after: { insert: true, update: { columns: ['status'] } },
    run: functions,
  });
}

function realm(options: { durable?: boolean } = {}): DatabaseRealm {
  const functions = options.durable === false ? [rollup] : [rollup, notify];
  return defineDatabaseRealm({
    name: 'doctor-automations',
    version: '1',
    tables: tables(),
    automations: defineDatabaseAutomations({
      functions,
      triggers: [trigger(functions)],
    }),
  });
}

function run(input: Parameters<typeof checkDatabaseAutomations>[0]) {
  const findings: PlatformDoctorFinding[] = [];
  checkDatabaseAutomations(input, createPlatformDoctorFindingSink(findings));
  return findings;
}

function codes(findings: readonly PlatformDoctorFinding[]): string[] {
  return findings.map(({ code }) => code);
}

describe('database automation Doctor adapter', () => {
  test('exports the focused checker from the public Doctor barrel', () => {
    expect(exportedCheckDatabaseAutomations).toBe(checkDatabaseAutomations);
  });

  test('accepts a consistent transactional realm without durable infrastructure', () => {
    const findings = run({ realm: realm({ durable: false }) });

    expect(codes(findings)).toEqual(['database.automations.configuration_valid']);
    expect(findings[0]).toMatchObject({
      severity: 'info',
      path: 'databaseAutomations',
    });
  });

  test('accepts durable functions only with durable source, outbox, and dispatcher', () => {
    const configured = realm();
    const findings = run({
      realm: configured,
      infrastructure: {
        storage: 'durable',
        outbox: 'durable',
        dispatcherEnabled: true,
      },
      reportedFingerprints: {
        realm: configured.fingerprint,
        automations: configured.automations?.fingerprint,
      },
    });

    expect(codes(findings)).toEqual(['database.automations.configuration_valid']);
  });

  test('prescribes every missing durable infrastructure boundary', () => {
    const missing = run({ realm: realm() });
    expect(codes(missing)).toContain(
      'database.automations.durable.infrastructure_missing',
    );

    const unsafe = run({
      realm: realm(),
      infrastructure: {
        storage: 'ephemeral',
        outbox: 'ephemeral',
        dispatcherEnabled: false,
      },
    });
    expect(codes(unsafe)).toEqual(expect.arrayContaining([
      'database.automations.durable.ephemeral_source',
      'database.automations.durable.outbox_ephemeral',
      'database.automations.durable.dispatcher_disabled',
    ]));
    expect(unsafe.every(({ hint }) => typeof hint === 'string')).toBe(true);

    const absentOutbox = run({
      realm: realm(),
      infrastructure: {
        storage: 'durable',
        outbox: 'absent',
        dispatcherEnabled: true,
      },
    });
    expect(codes(absentOutbox)).toContain(
      'database.automations.durable.outbox_missing',
    );
  });

  test('detects exact trigger table and UPDATE-column drift', () => {
    const configured = realm({ durable: false });
    const missingTable = {
      ...configured,
      tables: { records: { id: 'text primary key' } },
    } as unknown as DatabaseRealm;
    expect(codes(run({ realm: missingTable }))).toEqual(expect.arrayContaining([
      'database.automations.definitions.table_missing',
      'database.automations.manifest.table_missing',
      'database.automations.realm_rejected',
    ]));

    const missingColumn = {
      ...configured,
      tables: {
        orders: {
          id: 'text primary key',
          total: 'integer not null',
        },
      },
    } as unknown as DatabaseRealm;
    expect(codes(run({ realm: missingColumn }))).toEqual(expect.arrayContaining([
      'database.automations.definitions.column_missing',
      'database.automations.manifest.column_missing',
      'database.automations.realm_rejected',
    ]));
  });

  test('detects definition identity, collision, manifest, and fingerprint defects', () => {
    const configured = realm({ durable: false });
    const invalidFunction = {
      ...rollup,
      identity: 'function:forged@999',
    } as typeof rollup;
    const forged = forgeRegistry({
      functions: [invalidFunction, invalidFunction],
      triggers: [trigger([invalidFunction])],
      manifest: {
        version: 1,
        functions: [{
          identity: 'function:forged@999',
          name: rollup.name,
          version: rollup.version,
          mode: rollup.mode,
        }, {
          identity: 'function:forged@999',
          name: rollup.name,
          version: rollup.version,
          mode: rollup.mode,
        }],
        triggers: [],
      },
      fingerprint: `sha256:${'0'.repeat(64)}`,
    });
    const findings = run({
      realm: {
        ...configured,
        automations: forged,
      },
    });

    expect(codes(findings)).toEqual(expect.arrayContaining([
      'database.automations.definitions.identity_invalid',
      'database.automations.definitions.collision',
      'database.automations.manifest.identity_invalid',
      'database.automations.manifest.collision',
      'database.automations.manifest.mismatch',
      'database.automations.fingerprint.mismatch',
    ]));
  });

  test('detects configured and live actor fingerprint drift without exposing values', () => {
    const configured = realm({ durable: false });
    const privateMarker = 'opaque-private-actor-fingerprint';
    const findings = run({
      realm: {
        ...configured,
        fingerprint: `sha256:${'f'.repeat(64)}`,
      },
      reportedFingerprints: {
        realm: privateMarker,
        automations: privateMarker,
      },
    });

    expect(codes(findings)).toEqual(expect.arrayContaining([
      'database.automations.actor_manifest_drift',
      'database.automations.actor_realm_drift',
      'database.automations.realm_fingerprint_stale',
    ]));
    expect(JSON.stringify(findings)).not.toContain(privateMarker);
  });

  test('reports aggregate dead letters, stale leases, and high backlog', () => {
    const configured = realm({ durable: false });
    const findings = run({
      realm: configured,
      health: {
        pending: 7,
        processing: 2,
        dead: 3,
        staleLeases: 1,
        backlog: 10,
        warningBacklog: 8,
        backlogLimit: 20,
      },
    });

    expect(codes(findings)).toEqual(expect.arrayContaining([
      'database.automations.outbox.dead',
      'database.automations.outbox.stale_leases',
      'database.automations.outbox.backlog_high',
      'database.automations.outbox.active',
    ]));
    expect(findings.find(({ code }) =>
      code === 'database.automations.outbox.dead')?.severity).toBe('error');

    const exceeded = run({
      realm: configured,
      health: {
        pending: 11,
        processing: 10,
        dead: 0,
        staleLeases: 0,
        backlog: 21,
        backlogLimit: 20,
      },
    });
    expect(codes(exceeded)).toContain(
      'database.automations.outbox.capacity_exceeded',
    );
  });

  test('fails closed on invalid aggregate health and reports an idle worker cleanly', () => {
    const configured = realm({ durable: false });
    const invalid = run({
      realm: configured,
      health: {
        pending: 2,
        processing: 1,
        dead: 0,
        staleLeases: 0,
        backlog: 1,
      },
    });
    expect(codes(invalid)).toContain('database.automations.health.invalid');
    expect(codes(invalid)).not.toContain('database.automations.outbox.active');

    const idle = run({
      realm: configured,
      health: {
        pending: 0,
        processing: 0,
        dead: 0,
        staleLeases: 0,
        backlog: 0,
      },
    });
    expect(codes(idle)).toContain('database.automations.outbox.idle');
  });

  test('reports a realm with no automations without requiring infrastructure', () => {
    const plain = defineDatabaseRealm({
      name: 'doctor-plain',
      version: '1',
      tables: { records: { id: 'text primary key' } },
    });
    expect(codes(run({ realm: plain }))).toEqual([
      'database.automations.not_configured',
    ]);
  });

  test('contains registry inspection failures without leaking caught details', () => {
    const configured = realm({ durable: false });
    const privateMarker = 'private-registry-inspection-detail';
    const unreadable = Object.create(DatabaseAutomationRegistry.prototype) as Record<
      string,
      unknown
    >;
    unreadable.listFunctions = () => {
      throw new Error(privateMarker);
    };
    unreadable.listTriggers = () => [];
    const findings = run({
      realm: {
        ...configured,
        automations: unreadable as unknown as DatabaseAutomationRegistry,
      },
    });

    expect(codes(findings)).toEqual(expect.arrayContaining([
      'database.automations.registry_unreadable',
      'database.automations.realm_rejected',
    ]));
    expect(JSON.stringify(findings)).not.toContain(privateMarker);
  });
});

describe('database automation Platform Doctor integration', () => {
  test('checks a pinned transaction registry through runPlatformDoctor', () => {
    const registry = realm({ durable: false }).automations!;
    const report = runPlatformDoctor({
      db: { mode: 'file', path: './data/doctor-automation-application.db' },
      tables: tables(),
      auth: false,
      databaseAutomations: registry,
    }, { env: {} });

    expect(report.findings).toContainEqual(expect.objectContaining({
      code: 'database.automations.configuration_valid',
      path: 'databaseAutomations',
      severity: 'info',
    }));
  });

  test('rejects pinned durable functions on ephemeral source storage', () => {
    const report = runPlatformDoctor({
      db: { mode: 'ephemeral' },
      tables: tables(),
      auth: false,
      databaseAutomations: realm().automations!,
    }, { env: {} });
    const findingCodes = codes(report.findings);

    expect(findingCodes).toContain(
      'database.automations.durable.ephemeral_source',
    );
    expect(findingCodes).toContain(
      'database.automations.durable.outbox_missing',
    );
    expect(report.ok).toBe(false);
  });

  test('admits pinned durable functions with the managed durable pipeline', () => {
    const report = runPlatformDoctor({
      db: { mode: 'file', path: './data/doctor-automation-durable.db' },
      tables: tables(),
      auth: false,
      databaseAutomations: realm().automations!,
    }, { env: {} });
    const automationFindings = report.findings.filter(({ code }) =>
      code.startsWith('database.automations.'));

    expect(codes(automationFindings)).toEqual([
      'database.automations.configuration_valid',
    ]);
  });

  test('checks a Fabric realm registry at its exact config path', () => {
    const configuredRealm = realm({ durable: false });
    const report = runPlatformDoctor({
      db: { mode: 'ephemeral' },
      tables: tables(),
      auth: false,
      databaseTopology: {
        mode: 'multiple',
        rootDirectory: './data/doctor-automation-fabric',
        realm: configuredRealm,
        actors: {
          launch: { kind: 'source', entrypoint: import.meta.path },
        },
      },
    }, { env: {} });

    expect(report.findings).toContainEqual(expect.objectContaining({
      code: 'database.automations.configuration_valid',
      path: 'databaseTopology.realm.automations',
      severity: 'info',
    }));
  });
});

function forgeRegistry(input: {
  functions: readonly unknown[];
  triggers: readonly unknown[];
  manifest: unknown;
  fingerprint: string;
}): DatabaseAutomationRegistry {
  const registry = Object.create(DatabaseAutomationRegistry.prototype) as Record<
    string,
    unknown
  >;
  registry.functions = input.functions;
  registry.triggers = input.triggers;
  registry.functionsByIdentity = new Map();
  registry.triggersByIdentity = new Map();
  registry.manifest = input.manifest;
  registry.manifestJson = JSON.stringify(input.manifest);
  registry.fingerprint = input.fingerprint;
  return registry as unknown as DatabaseAutomationRegistry;
}
