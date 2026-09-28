/**
 * subprocess-database-executor-factory.ts
 *
 * Production-oriented parent launch configuration for same-entry database
 * actors. Commands are direct argv vectors (never shell strings), receive only
 * an explicit environment allowlist, and always end with the private actor
 * marker, role, and slot.
 */

import { fileURLToPath } from 'node:url';
import { isAbsolute } from 'node:path';
import { types as utilTypes } from 'node:util';

import {
  DATABASE_ACTOR_CHILD_FLAG,
  normalizeDatabaseActorFlag,
} from './database-actor-entry-contract';
import type { DatabaseActorRole } from './database-actor-protocol';
import { DatabaseError } from './database-error';
import {
  readDatabaseExecutorDataRecord,
} from './database-executor-validation';
import {
  SubprocessDatabaseExecutor,
  type SubprocessDatabaseExecutorOptions,
} from './subprocess-database-executor';

const MAX_COMMAND_PREFIX_PARTS = 64;
const MAX_COMMAND_PART_BYTES = 16_384;
const MAX_ENVIRONMENT_ENTRIES = 64;
const MAX_ENVIRONMENT_VALUE_BYTES = 16_384;
const ENVIRONMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const textEncoder = new TextEncoder();

const FACTORY_FIELDS = new Set([
  'launch',
  'actorFlag',
  'env',
  'executor',
]);
const BUILD_FIELDS = new Set([
  'launch',
  'actorFlag',
  'role',
  'slot',
]);
const CONTEXT_FIELDS = new Set(['role', 'slot']);
const SOURCE_FIELDS = new Set([
  'kind',
  'entrypoint',
  'runtimeExecutable',
]);
const BUNDLE_FIELDS = new Set(['kind', 'entrypoint']);
const COMMAND_PREFIX_FIELDS = new Set(['kind', 'commandPrefix']);
const EXECUTOR_POLICY_FIELDS = new Set([
  'maxInFlight',
  'startupTimeoutMs',
  'operationTimeoutMs',
  'shutdownAckTimeoutMs',
  'shutdownExitTimeoutMs',
  'sigtermTimeoutMs',
  'sigkillTimeoutMs',
]);

/** Launch a TypeScript/JavaScript application entry through the current Bun. */
export interface DatabaseActorSourceLaunch {
  readonly kind: 'source';
  readonly entrypoint: string | URL;
  /** Defaults to process.execPath and must be an absolute executable path. */
  readonly runtimeExecutable?: string;
}

/** Launch an application compiled as a directly executable Bun bundle. */
export interface DatabaseActorBundleLaunch {
  readonly kind: 'bundle';
  readonly entrypoint: string | URL;
}

/**
 * Use an explicit argv prefix for a wrapper or deployment-specific launcher.
 * The executable must be absolute; Zero appends the private three-part suffix.
 */
export interface DatabaseActorCommandPrefixLaunch {
  readonly kind: 'command-prefix';
  readonly commandPrefix: readonly [string, ...string[]];
}

export type DatabaseActorLaunch =
  | DatabaseActorSourceLaunch
  | DatabaseActorBundleLaunch
  | DatabaseActorCommandPrefixLaunch;

/** Coordinator-compatible actor identity supplied to the executor factory. */
export interface DatabaseActorExecutorFactoryContext {
  readonly role: DatabaseActorRole;
  readonly slot: number;
}

/** Executor lifecycle limits that do not alter actor identity or launch argv. */
export type DatabaseActorExecutorPolicy = Omit<
  SubprocessDatabaseExecutorOptions,
  'command' | 'env' | 'role' | 'slot'
>;

export interface BuildDatabaseActorCommandOptions
  extends DatabaseActorExecutorFactoryContext {
  readonly launch: DatabaseActorLaunch;
  readonly actorFlag?: string;
}

export interface SubprocessDatabaseExecutorFactoryOptions {
  readonly launch: DatabaseActorLaunch;
  readonly actorFlag?: string;
  /** Complete child environment. Nothing is inherited or merged implicitly. */
  readonly env?: Readonly<Record<string, string>>;
  readonly executor?: DatabaseActorExecutorPolicy;
}

export type SubprocessDatabaseExecutorFactory = (
  context: DatabaseActorExecutorFactoryContext,
) => SubprocessDatabaseExecutor;

/** Build one immutable, shell-free actor command with an exact private suffix. */
export function buildDatabaseActorCommand(
  options: BuildDatabaseActorCommandOptions,
): readonly [string, ...string[]] {
  const record = requireDataRecord(options);
  assertOnlyFields(record, BUILD_FIELDS);
  const actorFlag = normalizeDatabaseActorFlag(
    record.actorFlag ?? DATABASE_ACTOR_CHILD_FLAG,
  );
  const identity = normalizeIdentity(record.role, record.slot);
  const prefix = normalizeLaunch(record.launch, actorFlag);
  return appendActorInvocation(prefix, actorFlag, identity);
}

/**
 * Create a coordinator-compatible factory for strict Bun subprocess actors.
 *
 * Configuration is detached at construction, so later mutation of caller
 * objects cannot change executable, arguments, environment, or timeouts.
 */
export function createSubprocessDatabaseExecutorFactory(
  options: SubprocessDatabaseExecutorFactoryOptions,
): SubprocessDatabaseExecutorFactory {
  const record = requireDataRecord(options);
  assertOnlyFields(record, FACTORY_FIELDS);
  const actorFlag = normalizeDatabaseActorFlag(
    record.actorFlag ?? DATABASE_ACTOR_CHILD_FLAG,
  );
  const prefix = normalizeLaunch(record.launch, actorFlag);
  const env = normalizeEnvironment(record.env);
  const executor = normalizeExecutorPolicy(record.executor);

  const factory: SubprocessDatabaseExecutorFactory = (context) => {
    const contextRecord = requireDataRecord(context);
    assertOnlyFields(contextRecord, CONTEXT_FIELDS);
    const identity = normalizeIdentity(
      contextRecord.role,
      contextRecord.slot,
    );
    return new SubprocessDatabaseExecutor({
      command: appendActorInvocation(prefix, actorFlag, identity),
      env,
      role: identity.role,
      slot: identity.slot,
      ...executor,
    });
  };
  return Object.freeze(factory);
}

function normalizeLaunch(
  value: unknown,
  actorFlag: string,
): readonly [string, ...string[]] {
  const record = requireDataRecord(value);
  switch (record.kind) {
    case 'source': {
      assertOnlyFields(record, SOURCE_FIELDS);
      const runtimeExecutable = normalizeAbsolutePath(
        record.runtimeExecutable ?? process.execPath,
      );
      const entrypoint = normalizeEntrypoint(record.entrypoint);
      return Object.freeze([runtimeExecutable, entrypoint]);
    }
    case 'bundle': {
      assertOnlyFields(record, BUNDLE_FIELDS);
      return Object.freeze([normalizeEntrypoint(record.entrypoint)]);
    }
    case 'command-prefix': {
      assertOnlyFields(record, COMMAND_PREFIX_FIELDS);
      const prefix = normalizeCommandPrefix(record.commandPrefix);
      if (prefix.includes(actorFlag)) throw invalidLaunchConfiguration();
      return prefix;
    }
    default:
      throw invalidLaunchConfiguration();
  }
}

function normalizeCommandPrefix(
  value: unknown,
): readonly [string, ...string[]] {
  if (!Array.isArray(value)
    || utilTypes.isProxy(value)
    || value.length === 0
    || value.length > MAX_COMMAND_PREFIX_PARTS) {
    throw invalidLaunchConfiguration();
  }
  try {
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw invalidLaunchConfiguration();
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors).filter((key) => key !== 'length');
    if (keys.length !== value.length) throw invalidLaunchConfiguration();

    const prefix: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor
        || !descriptor.enumerable
        || !('value' in descriptor)
        || typeof descriptor.value !== 'string'
        || descriptor.value.includes('\0')
        || textEncoder.encode(descriptor.value).byteLength
          > MAX_COMMAND_PART_BYTES) {
        throw invalidLaunchConfiguration();
      }
      prefix.push(descriptor.value);
    }
    if (!prefix[0] || !isAbsolute(prefix[0])) {
      throw invalidLaunchConfiguration();
    }
    return Object.freeze(prefix) as readonly [string, ...string[]];
  } catch (error) {
    if (error instanceof DatabaseError) throw error;
    throw invalidLaunchConfiguration();
  }
}

function normalizeEntrypoint(value: unknown): string {
  if (value instanceof URL && !utilTypes.isProxy(value)) {
    try {
      if (value.protocol !== 'file:'
        || value.search.length > 0
        || value.hash.length > 0
        || value.username.length > 0
        || value.password.length > 0) {
        throw invalidLaunchConfiguration();
      }
      return normalizeAbsolutePath(fileURLToPath(value));
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      throw invalidLaunchConfiguration();
    }
  }
  return normalizeAbsolutePath(value);
}

function normalizeAbsolutePath(value: unknown): string {
  if (typeof value !== 'string'
    || value.length === 0
    || value.includes('\0')
    || textEncoder.encode(value).byteLength > MAX_COMMAND_PART_BYTES
    || !isAbsolute(value)) {
    throw invalidLaunchConfiguration();
  }
  return value;
}

function normalizeEnvironment(
  value: unknown,
): Readonly<Record<string, string>> {
  if (value === undefined) return Object.freeze(Object.create(null));
  const record = requireDataRecord(value);
  const entries = Object.entries(record);
  if (entries.length > MAX_ENVIRONMENT_ENTRIES) {
    throw invalidLaunchConfiguration();
  }
  const normalized: Record<string, string> = Object.create(null);
  const caseFoldedNames = new Set<string>();
  for (const [key, entry] of entries) {
    const folded = key.toUpperCase();
    if (!ENVIRONMENT_NAME_PATTERN.test(key)
      || caseFoldedNames.has(folded)
      || typeof entry !== 'string'
      || entry.includes('\0')
      || textEncoder.encode(entry).byteLength > MAX_ENVIRONMENT_VALUE_BYTES) {
      throw invalidLaunchConfiguration();
    }
    caseFoldedNames.add(folded);
    normalized[key] = entry;
  }
  return Object.freeze(normalized);
}

function normalizeExecutorPolicy(
  value: unknown,
): Readonly<DatabaseActorExecutorPolicy> {
  if (value === undefined) return Object.freeze({});
  const record = requireDataRecord(value);
  assertOnlyFields(record, EXECUTOR_POLICY_FIELDS);
  const result: Record<string, number> = Object.create(null);
  for (const [key, entry] of Object.entries(record)) {
    if (!Number.isSafeInteger(entry) || (entry as number) <= 0) {
      throw invalidLaunchConfiguration();
    }
    result[key] = entry as number;
  }
  return Object.freeze(result) as Readonly<DatabaseActorExecutorPolicy>;
}

function normalizeIdentity(
  role: unknown,
  slot: unknown,
): DatabaseActorExecutorFactoryContext {
  if ((role !== 'writer' && role !== 'reader')
    || !Number.isSafeInteger(slot)
    || (slot as number) < 0) {
    throw invalidLaunchConfiguration();
  }
  return Object.freeze({ role, slot: slot as number });
}

function appendActorInvocation(
  prefix: readonly [string, ...string[]],
  actorFlag: string,
  identity: DatabaseActorExecutorFactoryContext,
): readonly [string, ...string[]] {
  return Object.freeze([
    ...prefix,
    actorFlag,
    identity.role,
    String(identity.slot),
  ]) as readonly [string, ...string[]];
}

function requireDataRecord(value: unknown): Record<string, unknown> {
  const record = readDatabaseExecutorDataRecord(value);
  if (!record) throw invalidLaunchConfiguration();
  return record;
}

function assertOnlyFields(
  record: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): void {
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw invalidLaunchConfiguration();
  }
}

function invalidLaunchConfiguration(): DatabaseError {
  return new DatabaseError(
    'DATABASE_CONFIG_INVALID',
    'Database actor launch configuration is invalid.',
  );
}
