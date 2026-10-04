/**
 * platform-doctor-database-automation-findings.ts
 *
 * Translates aggregate automation-integrity counters into stable Doctor
 * findings. It owns presentation policy only and never reads definitions,
 * handlers, rows, payloads, or operational outbox records.
 */

import type { DatabaseAutomationIntegrityReport } from './platform-doctor-database-automation-integrity';
import {
  addPlatformDoctorFinding as addFinding,
  type PlatformDoctorFindingSink,
} from './platform-doctor-contracts';

const DOCS = './docs/framework/reactive-database-automations.md';

/** Emit configuration findings and return the number of error findings added. */
export function emitDatabaseAutomationIntegrityFindings(
  report: DatabaseAutomationIntegrityReport,
  findings: PlatformDoctorFindingSink,
  path: string,
): number {
  if (!report.readable) {
    addFinding(findings, {
      severity: 'error',
      code: 'database.automations.registry_unreadable',
      path,
      message: 'Doctor could not safely inspect the database automation registry.',
      hint: 'Recreate the registry with defineDatabaseAutomations() and do not proxy, mutate, or deserialize executable definitions.',
      docs: DOCS,
    });
    return 1;
  }

  let errors = 0;
  errors += emitCountFinding(report.definitionIdentityInvalid, findings, {
    code: 'database.automations.definitions.identity_invalid',
    path,
    noun: 'definition or function reference',
    problem: 'canonical name/version identity mismatch',
    hint: 'Recreate functions and triggers with the public definition helpers; never hand-author persisted identities.',
  });
  errors += emitCountFinding(report.definitionCollisions, findings, {
    code: 'database.automations.definitions.collision',
    path,
    noun: 'definition identity',
    problem: 'duplicate registration',
    hint: 'Give every function and trigger a unique name/version pair across all realm contributions.',
  });
  errors += emitCountFinding(report.definitionTargetsMissing, findings, {
    code: 'database.automations.definitions.target_missing',
    path,
    noun: 'trigger function target',
    problem: 'unresolved registered function version',
    hint: 'Register each exact function version in the same composed automation registry or update the trigger reference.',
  });
  errors += emitCountFinding(report.definitionTablesMissing, findings, {
    code: 'database.automations.definitions.table_missing',
    path,
    noun: 'trigger table',
    problem: 'table key is outside the admitted realm',
    hint: 'Point each trigger at an exact declared realm table; table matching is intentionally case-sensitive.',
  });
  errors += emitCountFinding(report.definitionColumnsMissing, findings, {
    code: 'database.automations.definitions.column_missing',
    path,
    noun: 'filtered UPDATE column',
    problem: 'column is not persisted by its trigger table',
    hint: 'Update trigger column lists after schema changes; _identity metadata is not a persisted column.',
  });
  errors += emitCountFinding(report.manifestIdentityInvalid, findings, {
    code: 'database.automations.manifest.identity_invalid',
    path,
    noun: 'manifest entry or target',
    problem: 'non-canonical identity',
    hint: 'Regenerate the handler-free manifest from admitted definitions instead of editing it directly.',
  });
  errors += emitCountFinding(report.manifestCollisions, findings, {
    code: 'database.automations.manifest.collision',
    path,
    noun: 'manifest identity',
    problem: 'duplicate manifest registration',
    hint: 'Rebuild the registry and deploy one canonical manifest per realm version.',
  });
  errors += emitCountFinding(report.manifestTargetsMissing, findings, {
    code: 'database.automations.manifest.target_missing',
    path,
    noun: 'manifest trigger target',
    problem: 'unresolved manifest function',
    hint: 'Regenerate the manifest from the complete composed function and trigger registry.',
  });
  errors += emitCountFinding(report.manifestTablesMissing, findings, {
    code: 'database.automations.manifest.table_missing',
    path,
    noun: 'manifest trigger table',
    problem: 'table is outside the admitted realm',
    hint: 'Rebuild and redeploy the realm after table or trigger changes.',
  });
  errors += emitCountFinding(report.manifestColumnsMissing, findings, {
    code: 'database.automations.manifest.column_missing',
    path,
    noun: 'manifest UPDATE column',
    problem: 'column is outside its admitted table',
    hint: 'Regenerate the manifest after changing filtered UPDATE columns.',
  });

  if (!report.manifestMatchesDefinitions) {
    errors += 1;
    addFinding(findings, {
      severity: 'error',
      code: 'database.automations.manifest.mismatch',
      path,
      message: 'The handler-free automation manifest does not match the admitted definitions.',
      hint: 'Rebuild the registry and actor bundle from one source tree; do not reuse stale generated metadata.',
      docs: DOCS,
    });
  }
  if (!report.fingerprintMatchesManifest) {
    errors += 1;
    addFinding(findings, {
      severity: 'error',
      code: 'database.automations.fingerprint.mismatch',
      path,
      message: 'The automation fingerprint does not match the canonical handler-free manifest.',
      hint: 'Rebuild and redeploy all actor generations from the same manifest before admitting writes.',
      docs: DOCS,
    });
  }
  return errors;
}

interface CountFindingDefinition {
  readonly code: string;
  readonly path: string;
  readonly noun: string;
  readonly problem: string;
  readonly hint: string;
}

function emitCountFinding(
  count: number,
  findings: PlatformDoctorFindingSink,
  definition: CountFindingDefinition,
): number {
  if (count === 0) return 0;
  addFinding(findings, {
    severity: 'error',
    code: definition.code,
    path: definition.path,
    message: `Database automation validation found ${count} affected ${definition.noun}${count === 1 ? '' : 's'}: ${definition.problem}.`,
    hint: definition.hint,
    docs: DOCS,
  });
  return 1;
}
