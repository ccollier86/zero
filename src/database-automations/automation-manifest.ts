/**
 * automation-manifest.ts
 *
 * Projects validated definitions into canonical, handler-free deployment
 * metadata and fingerprints it with Bun's SHA-256 implementation. It does not
 * retain executable handlers or interact with a database.
 */

import type { DatabaseFunctionDefinition, DatabaseFunctionMode } from './database-function';
import type {
  DatabaseFunctionReference,
  DatabaseTriggerAfterEvent,
  DatabaseTriggerDefinition,
} from './database-trigger';

export const DATABASE_AUTOMATION_MANIFEST_VERSION = 1 as const;

export interface DatabaseFunctionManifestEntry {
  readonly identity: string;
  readonly name: string;
  readonly version: number;
  readonly mode: DatabaseFunctionMode;
}

export interface DatabaseTriggerManifestEntry {
  readonly identity: string;
  readonly name: string;
  readonly version: number;
  readonly table: string;
  readonly timing: 'after';
  readonly after: readonly DatabaseTriggerAfterEvent[];
  readonly run: readonly DatabaseFunctionReference[];
}

/** Canonical metadata safe to persist or pass to actor runtimes. */
export interface DatabaseAutomationManifest {
  readonly version: typeof DATABASE_AUTOMATION_MANIFEST_VERSION;
  readonly functions: readonly DatabaseFunctionManifestEntry[];
  readonly triggers: readonly DatabaseTriggerManifestEntry[];
}

export interface CanonicalDatabaseAutomationManifest {
  readonly manifest: DatabaseAutomationManifest;
  readonly json: string;
  readonly fingerprint: `sha256:${string}`;
}

/** Build sorted, immutable, handler-free metadata and its stable fingerprint. */
export function createDatabaseAutomationManifest(input: {
  readonly functions: readonly DatabaseFunctionDefinition[];
  readonly triggers: readonly DatabaseTriggerDefinition[];
}): CanonicalDatabaseAutomationManifest {
  const functions = [...input.functions]
    .sort(compareIdentity)
    .map((definition) => Object.freeze({
      identity: definition.identity,
      name: definition.name,
      version: definition.version,
      mode: definition.mode,
    }));
  const triggers = [...input.triggers]
    .sort(compareIdentity)
    .map(projectTrigger);
  const manifest: DatabaseAutomationManifest = Object.freeze({
    version: DATABASE_AUTOMATION_MANIFEST_VERSION,
    functions: Object.freeze(functions),
    triggers: Object.freeze(triggers),
  });
  const json = JSON.stringify(manifest);
  const fingerprint = `sha256:${new Bun.CryptoHasher('sha256')
    .update(json)
    .digest('hex')}` as const;
  return Object.freeze({ manifest, json, fingerprint });
}

function projectTrigger(
  trigger: DatabaseTriggerDefinition,
): DatabaseTriggerManifestEntry {
  return Object.freeze({
    identity: trigger.identity,
    name: trigger.name,
    version: trigger.version,
    table: trigger.table,
    timing: trigger.timing,
    after: Object.freeze(trigger.after.map((event) => Object.freeze({
      operation: event.operation,
      columns: event.columns === null ? null : Object.freeze([...event.columns]),
    }))),
    // Function order is behavioral and must never be sorted here.
    run: Object.freeze(trigger.run.map((target) => Object.freeze({ ...target }))),
  });
}

function compareIdentity(
  left: { readonly identity: string },
  right: { readonly identity: string },
): number {
  return left.identity < right.identity ? -1 : left.identity > right.identity ? 1 : 0;
}
