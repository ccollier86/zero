/**
 * platform-doctor-database-automation-integrity.ts
 *
 * Performs side-effect-free integrity inspection of a ReactiveDB automation
 * registry and its handler-free manifest. It returns aggregate counts only and
 * never executes handlers or includes definition names in its result.
 */

import {
  createDatabaseAutomationManifest,
  type DatabaseAutomationManifest,
} from '../database-automations/automation-manifest';
import type { DatabaseAutomationRegistry } from '../database-automations/database-automations';
import {
  automationDefinitionIdentity,
  normalizeAutomationName,
  normalizeAutomationVersion,
} from '../database-automations/definition-identity';
import type { DatabaseFunctionDefinition } from '../database-automations/database-function';
import type { DatabaseTriggerDefinition } from '../database-automations/database-trigger';
import { validateDatabaseAutomations } from '../database-automations/automation-validation';
import type { TableSchema } from '../sync/types';

export interface DatabaseAutomationIntegrityReport {
  readonly readable: boolean;
  readonly definitionIdentityInvalid: number;
  readonly definitionCollisions: number;
  readonly definitionTargetsMissing: number;
  readonly definitionTablesMissing: number;
  readonly definitionColumnsMissing: number;
  readonly manifestIdentityInvalid: number;
  readonly manifestCollisions: number;
  readonly manifestTargetsMissing: number;
  readonly manifestTablesMissing: number;
  readonly manifestColumnsMissing: number;
  readonly manifestMatchesDefinitions: boolean;
  readonly fingerprintMatchesManifest: boolean;
  readonly canonicalFingerprint: string | null;
  readonly durableFunctions: number;
}

const UNREADABLE_REPORT: DatabaseAutomationIntegrityReport = Object.freeze({
  readable: false,
  definitionIdentityInvalid: 0,
  definitionCollisions: 0,
  definitionTargetsMissing: 0,
  definitionTablesMissing: 0,
  definitionColumnsMissing: 0,
  manifestIdentityInvalid: 0,
  manifestCollisions: 0,
  manifestTargetsMissing: 0,
  manifestTablesMissing: 0,
  manifestColumnsMissing: 0,
  manifestMatchesDefinitions: false,
  fingerprintMatchesManifest: false,
  canonicalFingerprint: null,
  durableFunctions: 0,
});

/** Inspect definitions, manifest, fingerprint, and exact declared schema. */
export function inspectDatabaseAutomationIntegrity(
  registry: DatabaseAutomationRegistry,
  tables: Readonly<Record<string, Readonly<TableSchema>>>,
): DatabaseAutomationIntegrityReport {
  try {
    const functions = registry.listFunctions();
    const triggers = registry.listTriggers();
    const validation = validateDatabaseAutomations({ functions, triggers }, {
      tableExists: (table) => Object.prototype.hasOwnProperty.call(tables, table),
      tableColumns: (table) => declaredColumns(tables[table]),
    });
    const canonical = createDatabaseAutomationManifest({ functions, triggers });
    const manifest = registry.manifest;
    const manifestInspection = inspectManifest(manifest, tables);
    const definitionCollisions = validation.filter((issue) =>
      issue.code === 'AUTOMATION_FUNCTION_DUPLICATE'
      || issue.code === 'AUTOMATION_TRIGGER_DUPLICATE').length;

    return Object.freeze({
      readable: true,
      definitionIdentityInvalid: countInvalidDefinitionIdentities(functions, triggers),
      definitionCollisions,
      definitionTargetsMissing: countIssues(validation, 'AUTOMATION_TARGET_MISSING'),
      definitionTablesMissing: countIssues(validation, 'AUTOMATION_TABLE_MISSING'),
      definitionColumnsMissing: countIssues(validation, 'AUTOMATION_TABLE_INVALID'),
      ...manifestInspection,
      manifestMatchesDefinitions: registry.manifestJson === canonical.json
        && JSON.stringify(manifest) === canonical.json,
      fingerprintMatchesManifest: registry.fingerprint === canonical.fingerprint,
      canonicalFingerprint: canonical.fingerprint,
      durableFunctions: functions.filter(({ mode }) => mode === 'durable').length,
    });
  } catch {
    return UNREADABLE_REPORT;
  }
}

function countInvalidDefinitionIdentities(
  functions: readonly DatabaseFunctionDefinition[],
  triggers: readonly DatabaseTriggerDefinition[],
): number {
  let invalid = 0;
  for (const definition of functions) {
    if (!hasCanonicalIdentity('function', definition)) invalid += 1;
  }
  for (const definition of triggers) {
    if (!hasCanonicalIdentity('trigger', definition)) invalid += 1;
    for (const target of definition.run) {
      if (!hasCanonicalIdentity('function', target)) invalid += 1;
    }
  }
  return invalid;
}

function inspectManifest(
  manifest: DatabaseAutomationManifest,
  tables: Readonly<Record<string, Readonly<TableSchema>>>,
): Pick<DatabaseAutomationIntegrityReport,
  | 'manifestIdentityInvalid'
  | 'manifestCollisions'
  | 'manifestTargetsMissing'
  | 'manifestTablesMissing'
  | 'manifestColumnsMissing'> {
  let identityInvalid = 0;
  let collisions = 0;
  let targetsMissing = 0;
  let tablesMissing = 0;
  let columnsMissing = 0;
  const functions = new Set<string>();
  const triggers = new Set<string>();

  for (const definition of manifest.functions) {
    if (!hasCanonicalIdentity('function', definition)
      || definition.mode !== 'transaction' && definition.mode !== 'durable') {
      identityInvalid += 1;
    }
    if (functions.has(definition.identity)) collisions += 1;
    functions.add(definition.identity);
  }

  for (const trigger of manifest.triggers) {
    if (!hasCanonicalIdentity('trigger', trigger) || trigger.timing !== 'after') {
      identityInvalid += 1;
    }
    if (triggers.has(trigger.identity)) collisions += 1;
    triggers.add(trigger.identity);

    const schema = tables[trigger.table];
    if (!schema) {
      tablesMissing += 1;
    }
    const columns = declaredColumns(schema);
    for (const event of trigger.after) {
      for (const column of event.columns ?? []) {
        if (columns && !columns.has(column)) columnsMissing += 1;
      }
    }
    for (const target of trigger.run) {
      if (!hasCanonicalIdentity('function', target)) identityInvalid += 1;
      if (!functions.has(target.identity)) targetsMissing += 1;
    }
  }

  return {
    manifestIdentityInvalid: identityInvalid,
    manifestCollisions: collisions,
    manifestTargetsMissing: targetsMissing,
    manifestTablesMissing: tablesMissing,
    manifestColumnsMissing: columnsMissing,
  };
}

function hasCanonicalIdentity(
  kind: 'function' | 'trigger',
  value: { readonly name: string; readonly version: number; readonly identity: string },
): boolean {
  try {
    const name = normalizeAutomationName(value.name, 'Automation definition name');
    const version = normalizeAutomationVersion(
      value.version,
      'Automation definition version',
    );
    return value.identity === automationDefinitionIdentity(kind, { name, version });
  } catch {
    return false;
  }
}

function declaredColumns(
  schema: Readonly<TableSchema> | undefined,
): ReadonlySet<string> | undefined {
  if (!schema) return undefined;
  return new Set(Object.keys(schema).filter((column) => column !== '_identity'));
}

function countIssues(
  issues: ReturnType<typeof validateDatabaseAutomations>,
  code: ReturnType<typeof validateDatabaseAutomations>[number]['code'],
): number {
  return issues.filter((issue) => issue.code === code).length;
}
