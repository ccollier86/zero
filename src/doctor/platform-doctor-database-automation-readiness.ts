/**
 * platform-doctor-database-automation-readiness.ts
 *
 * Checks realm/actor fingerprint agreement and abstract durable-infrastructure
 * readiness. It consumes admitted metadata only and does not open databases,
 * inspect outbox items, run handlers, or control dispatcher lifecycle.
 */

import type { DatabaseAutomationRegistry } from '../database-automations/database-automations';
import type { DatabaseRealm } from '../databases/database-realm';
import { defineDatabaseRealm } from '../databases/database-realm';
import type { DatabaseAutomationIntegrityReport } from './platform-doctor-database-automation-integrity';
import {
  addPlatformDoctorFinding as addFinding,
  type PlatformDoctorFindingSink,
} from './platform-doctor-contracts';

export interface DatabaseAutomationInfrastructureSnapshot {
  /** Whether source commits survive process restart. */
  readonly storage: 'ephemeral' | 'durable';
  /** Persistence guarantee of the source-local durable-effect outbox. */
  readonly outbox: 'absent' | 'ephemeral' | 'durable';
  /** Whether a host dispatcher is configured to drain durable effects. */
  readonly dispatcherEnabled: boolean;
}

export interface DatabaseAutomationReportedFingerprints {
  /** Realm fingerprint reported by the live actor generation. */
  readonly realm?: string;
  /** Automation fingerprint reported by the live actor generation. */
  readonly automations?: string;
}

const DOCS = './docs/framework/reactive-database-automations.md';

/** Check configured and live actor fingerprints against a fresh realm rebuild. */
export function checkDatabaseAutomationRealmConsistency(
  realm: DatabaseRealm,
  registry: DatabaseAutomationRegistry,
  integrity: DatabaseAutomationIntegrityReport,
  reported: DatabaseAutomationReportedFingerprints | undefined,
  findings: PlatformDoctorFindingSink,
  path: string,
): number {
  let errors = 0;
  if (integrity.canonicalFingerprint !== null
    && reported?.automations !== undefined
    && reported.automations !== integrity.canonicalFingerprint) {
    errors += 1;
    addFinding(findings, {
      severity: 'error',
      code: 'database.automations.actor_manifest_drift',
      path,
      message: 'The live actor automation fingerprint differs from the configured realm manifest.',
      hint: 'Drain and replace stale actor generations before routing writes to this realm version.',
      docs: DOCS,
    });
  }
  if (reported?.realm !== undefined && reported.realm !== realm.fingerprint) {
    errors += 1;
    addFinding(findings, {
      severity: 'error',
      code: 'database.automations.actor_realm_drift',
      path,
      message: 'The live actor realm fingerprint differs from the configured realm fingerprint.',
      hint: 'Stop mixed generations and redeploy parent and actor code from the same realm module.',
      docs: DOCS,
    });
  }

  try {
    const rebuilt = defineDatabaseRealm({
      name: realm.name,
      version: realm.version,
      tables: realm.tables,
      migrations: realm.migrations,
      queries: realm.queries,
      commands: realm.commands,
      automations: registry,
    });
    if (rebuilt.fingerprint !== realm.fingerprint) {
      errors += 1;
      addFinding(findings, {
        severity: 'error',
        code: 'database.automations.realm_fingerprint_stale',
        path,
        message: 'The configured realm fingerprint is stale for its current schema, handlers, migrations, or automation manifest.',
        hint: 'Recreate the realm at startup and bump its explicit version when executable behavior changes.',
        docs: DOCS,
      });
    }
  } catch {
    errors += 1;
    addFinding(findings, {
      severity: 'error',
      code: 'database.automations.realm_rejected',
      path,
      message: 'The realm cannot be readmitted with its current automation registry.',
      hint: 'Fix schema and automation definition errors before starting any Fabric actor for this realm.',
      docs: DOCS,
    });
  }
  return errors;
}

/** Check that durable functions have durable commit, outbox, and drain paths. */
export function checkDatabaseAutomationInfrastructure(
  durableFunctions: number,
  infrastructure: DatabaseAutomationInfrastructureSnapshot | undefined,
  findings: PlatformDoctorFindingSink,
  path: string,
): number {
  if (durableFunctions === 0) return 0;
  if (!infrastructure) {
    addFinding(findings, {
      severity: 'error',
      code: 'database.automations.durable.infrastructure_missing',
      path,
      message: `${durableFunctions} durable database function${durableFunctions === 1 ? '' : 's'} lack an admitted infrastructure snapshot.`,
      hint: 'Configure durable source storage, a durable source-local outbox, and the host dispatcher before enabling these definitions.',
      docs: DOCS,
    });
    return 1;
  }

  let errors = 0;
  if (infrastructure.storage !== 'durable') {
    errors += 1;
    addFinding(findings, {
      severity: 'error',
      code: 'database.automations.durable.ephemeral_source',
      path,
      message: 'Durable database functions are configured on ephemeral source storage.',
      hint: 'Use a crash-durable source database; durable effects must be committed atomically with their originating mutation.',
      docs: DOCS,
    });
  }
  if (infrastructure.outbox !== 'durable') {
    errors += 1;
    addFinding(findings, {
      severity: 'error',
      code: infrastructure.outbox === 'absent'
        ? 'database.automations.durable.outbox_missing'
        : 'database.automations.durable.outbox_ephemeral',
      path,
      message: infrastructure.outbox === 'absent'
        ? 'Durable database functions have no source-local outbox.'
        : 'Durable database functions use an ephemeral outbox.',
      hint: 'Install the managed durable outbox in the same atomic database boundary as the source mutation.',
      docs: DOCS,
    });
  }
  if (infrastructure.dispatcherEnabled !== true) {
    errors += 1;
    addFinding(findings, {
      severity: 'error',
      code: 'database.automations.durable.dispatcher_disabled',
      path,
      message: 'Durable database functions are configured without an active host dispatcher.',
      hint: 'Enable the managed dispatcher and its restart recovery loop before accepting durable automation work.',
      docs: DOCS,
    });
  }
  return errors;
}
