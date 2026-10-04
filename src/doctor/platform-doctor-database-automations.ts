/**
 * platform-doctor-database-automations.ts
 *
 * Adapts admitted pinned/Fabric automations into prescriptive Doctor findings.
 * Focused modules own integrity, readiness, and operational-health policy; this
 * file owns orchestration only and never executes an automation handler.
 */

import type { DatabaseRealm } from '../databases/database-realm';
import type { DatabaseAutomationRegistry } from '../database-automations/database-automations';
import type { TableSchema } from '../sync/types';
import {
  checkDatabaseAutomationOperationalHealth,
  type DatabaseAutomationOperationalHealth,
} from './platform-doctor-database-automation-health';
import {
  emitDatabaseAutomationIntegrityFindings,
} from './platform-doctor-database-automation-findings';
import {
  inspectDatabaseAutomationIntegrity,
} from './platform-doctor-database-automation-integrity';
import {
  checkDatabaseAutomationInfrastructure,
  checkDatabaseAutomationRealmConsistency,
  type DatabaseAutomationInfrastructureSnapshot,
  type DatabaseAutomationReportedFingerprints,
} from './platform-doctor-database-automation-readiness';
import {
  addPlatformDoctorFinding as addFinding,
  type PlatformDoctorFindingSink,
} from './platform-doctor-contracts';

export type {
  DatabaseAutomationOperationalHealth,
} from './platform-doctor-database-automation-health';
export type {
  DatabaseAutomationInfrastructureSnapshot,
  DatabaseAutomationReportedFingerprints,
} from './platform-doctor-database-automation-readiness';

interface DatabaseAutomationDoctorOptions {
  /** Abstract readiness snapshot; deliberately independent of outbox internals. */
  readonly infrastructure?: DatabaseAutomationInfrastructureSnapshot;
  /** Optional actor/runtime fingerprints for deployment-drift checks. */
  readonly reportedFingerprints?: DatabaseAutomationReportedFingerprints;
  /** Optional aggregate runtime health; item contents must never be supplied. */
  readonly health?: DatabaseAutomationOperationalHealth;
  /** Finding path used by the platform-doctor config adapter. */
  readonly path?: string;
}

/** Fabric realm or pinned-application target accepted by the same checker. */
export type DatabaseAutomationDoctorInput = DatabaseAutomationDoctorOptions & (
  | {
      readonly realm: DatabaseRealm;
      readonly registry?: never;
      readonly tables?: never;
    }
  | {
      readonly realm?: never;
      readonly registry: DatabaseAutomationRegistry;
      readonly tables: Readonly<Record<string, Readonly<TableSchema>>>;
    }
);

const DOCS = './docs/framework/reactive-database-automations.md';

/** Validate one source registry's definitions, deployment, and aggregate health. */
export function checkDatabaseAutomations(
  input: DatabaseAutomationDoctorInput,
  findings: PlatformDoctorFindingSink,
): void {
  const path = input.path ?? 'databaseAutomations';
  const realm = input.realm ?? null;
  const registry = realm ? realm.automations : input.registry;
  if (!registry) {
    addFinding(findings, {
      severity: 'info',
      code: 'database.automations.not_configured',
      path,
      message: 'This Fabric realm has no ReactiveDB database automations configured.',
      hint: 'No action is required unless this realm should run transactional or durable AFTER-change functions.',
      docs: DOCS,
    });
    if (input.health) {
      checkDatabaseAutomationOperationalHealth(input.health, findings, `${path}.health`);
    }
    return;
  }

  // The public union requires tables for a pinned registry. The realm branch
  // owns its admitted tables directly.
  const tables = realm ? realm.tables : input.tables!;
  const integrity = inspectDatabaseAutomationIntegrity(registry, tables);
  let configurationErrors = emitDatabaseAutomationIntegrityFindings(
    integrity,
    findings,
    path,
  );
  if (realm) {
    configurationErrors += checkDatabaseAutomationRealmConsistency(
      realm,
      registry,
      integrity,
      input.reportedFingerprints,
      findings,
      path,
    );
  }
  configurationErrors += checkDatabaseAutomationInfrastructure(
    integrity.durableFunctions,
    input.infrastructure,
    findings,
    path,
  );

  if (configurationErrors === 0) {
    const functionCount = registry.listFunctions().length;
    const triggerCount = registry.listTriggers().length;
    addFinding(findings, {
      severity: 'info',
      code: 'database.automations.configuration_valid',
      path,
      message: `ReactiveDB automation configuration is consistent with ${functionCount} function${functionCount === 1 ? '' : 's'} and ${triggerCount} trigger${triggerCount === 1 ? '' : 's'}.`,
      hint: 'Bump the realm or definition version whenever handler behavior changes without a manifest-shape change.',
      docs: DOCS,
    });
  }

  if (input.health) {
    checkDatabaseAutomationOperationalHealth(input.health, findings, `${path}.health`);
  }
}
