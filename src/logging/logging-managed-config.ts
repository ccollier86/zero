/** Server-only managed logging configuration; validates policy/launch without opening databases or workers. */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSubprocessDatabaseExecutorFactory, type SubprocessDatabaseExecutorFactoryOptions, type SubprocessDatabaseExecutorFactory } from '../databases/subprocess-database-executor-factory';
import { resolveLoggingConfig, type LoggingConfig, type ResolvedLoggingConfig } from './logging-config';
import { LoggingError } from './logging-error';
import { loggingArray, loggingRecord } from './logging-validation';
import { LOGGING_ACTOR_FLAG } from './logging-actor-contract';
import { loggingDigest } from './logging-hash';
import { normalizeLoggingSourceLimits, type LoggingSourceLimits } from './logging-source-limits';

/** Branch-preview configuration. Core audit instrumentation and client collection remain separate readiness gates. */
export interface ManagedLoggingConfig extends LoggingConfig {
  /** Per-origin durable spool, independent of the in-memory writer queue. */
  readonly sourceQueue?: Partial<LoggingSourceLimits>;
  /** Declared Guardian permissions. Omission restricts investigations/management to platform administrators. */
  readonly access?: Readonly<{ read?: string; manage?: string; export?: string; hold?: string; review?: string }>;
  /** Omission/null keeps the stream indefinitely. Pruning is explicit, bounded, and respects holds. */
  readonly retention?: Readonly<{ auditDays?: number | null; operationalDays?: number | null }>;
  /** Explicit safe scalar metadata keys available to trusted server record() calls. */
  readonly metadataKeys?: readonly string[];
  /** Private dedicated Fabric directory, relative to the immutable project root. Default: data/zero.logs. */
  readonly rootDirectory?: string;
  /** Explicit actor launch for packaged deployments; children receive only this environment allowlist. */
  readonly actors?: Omit<SubprocessDatabaseExecutorFactoryOptions, 'actorFlag'>;
}

export interface ResolvedManagedLoggingConfig {
  readonly sourceQueue: LoggingSourceLimits;
  readonly policyVersion: string;
  readonly access: Readonly<Record<'read' | 'manage' | 'export' | 'hold' | 'review', string | null>>;
  readonly retention: Readonly<{ auditDays: number | null; operationalDays: number | null }>;
  readonly metadataKeys: readonly string[];
  readonly policy: ResolvedLoggingConfig;
  readonly rootDirectory: string;
  readonly createExecutor: SubprocessDatabaseExecutorFactory;
  /** A default source actor must exist in an installed package; compiled apps need an explicit launch. */
  readonly defaultActorEntrypoint: string | null;
}

/** Omission has no filesystem/lifecycle effect. Strict compliance cannot be advertised before its controls exist. */
export function resolveManagedLoggingConfig(input: boolean | ManagedLoggingConfig | undefined, projectRoot: string): ResolvedManagedLoggingConfig | false {
  if (input === false || input === undefined) return false;
  try {
    const record = input === true ? {} : loggingRecord(input, ['preset', 'minimumLevel', 'capture', 'queue', 'rootDirectory', 'actors', 'access', 'metadataKeys', 'retention', 'sourceQueue'], 'LOGGING_CONFIG_INVALID');
    const { rootDirectory, actors, access: rawAccess, metadataKeys: rawKeys, retention: rawRetention, sourceQueue: rawSourceQueue, ...capture } = record;
    const sourceQueue = normalizeLoggingSourceLimits(rawSourceQueue);
    const access = rawAccess === undefined ? {} : loggingRecord(rawAccess, ['read', 'manage', 'export', 'hold', 'review']);
    for (const value of Object.values(access)) if (typeof value !== 'string' || !/^[a-z][a-z0-9._:-]{0,119}$/.test(value)) throw new Error();
    const metadataKeys = rawKeys === undefined ? [] : loggingArray(rawKeys, 32);
    if (metadataKeys.some(key => typeof key !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key))) throw new Error();
    const policy = resolveLoggingConfig(capture as LoggingConfig);
    const retention = rawRetention === undefined ? {} : loggingRecord(rawRetention, ['auditDays', 'operationalDays']);
    for (const days of Object.values(retention)) if (days !== null && (typeof days !== 'number' || !Number.isSafeInteger(days) || days < 1 || days > 36500)) throw new Error();
    if (policy.complianceRequested) throw new LoggingError('LOGGING_NOT_READY', 'Managed compliance logging is not available until required audit controls are qualified.');
    if (rootDirectory !== undefined && (typeof rootDirectory !== 'string' || !rootDirectory.trim() || rootDirectory.includes('\0'))) throw new Error();
    const actor = actors === undefined ? fileURLToPath(new URL('./logging-actor-entry.ts', import.meta.url)) : null;
    const launch = actors === undefined ? { launch: { kind: 'source' as const, entrypoint: actor! }, env: {} } : loggingRecord(actors, ['launch', 'env', 'executor'], 'LOGGING_CONFIG_INVALID');
    const createExecutor = createSubprocessDatabaseExecutorFactory({ ...launch, actorFlag: LOGGING_ACTOR_FLAG } as unknown as SubprocessDatabaseExecutorFactoryOptions);
    return Object.freeze({ policy, sourceQueue, policyVersion: 'logging-v1:' + loggingDigest({ policy, metadataKeys, retention, sourceQueue }), access: Object.freeze({ read: access.read as string ?? null, manage: access.manage as string ?? null,
      export: access.export as string ?? null, hold: access.hold as string ?? null, review: access.review as string ?? null }),
      retention: Object.freeze({ auditDays: retention.auditDays as number ?? null, operationalDays: retention.operationalDays as number ?? null }),
      metadataKeys: Object.freeze(metadataKeys as string[]), rootDirectory: resolve(projectRoot, typeof rootDirectory === 'string' ? rootDirectory : 'data/zero.logs'), createExecutor, defaultActorEntrypoint: actor });
  } catch (error) {
    if (error instanceof LoggingError && error.code === 'LOGGING_NOT_READY') throw error;
    throw new LoggingError('LOGGING_CONFIG_INVALID', 'Managed logging configuration is invalid.');
  }
}
