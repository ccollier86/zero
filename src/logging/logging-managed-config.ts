/** Server-only managed logging configuration; validates policy/launch without opening databases or workers. */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSubprocessDatabaseExecutorFactory, type SubprocessDatabaseExecutorFactoryOptions, type SubprocessDatabaseExecutorFactory } from '../databases/subprocess-database-executor-factory';
import { resolveLoggingConfig, type LoggingConfig, type ResolvedLoggingConfig } from './logging-config';
import { LoggingError } from './logging-error';
import { loggingRecord } from './logging-validation';

/** Branch-preview configuration. Core audit instrumentation and client collection remain separate readiness gates. */
export interface ManagedLoggingConfig extends LoggingConfig {
  /** Private dedicated Fabric directory, relative to the immutable project root. Default: data/zero.logs. */
  readonly rootDirectory?: string;
  /** Explicit actor launch for packaged deployments; children receive only this environment allowlist. */
  readonly actors?: Omit<SubprocessDatabaseExecutorFactoryOptions, 'actorFlag'>;
}

export interface ResolvedManagedLoggingConfig {
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
    const record = input === true ? {} : loggingRecord(input, ['preset', 'minimumLevel', 'capture', 'queue', 'rootDirectory', 'actors'], 'LOGGING_CONFIG_INVALID');
    const { rootDirectory, actors, ...capture } = record;
    const policy = resolveLoggingConfig(capture as LoggingConfig);
    if (policy.complianceRequested) throw new LoggingError('LOGGING_NOT_READY', 'Managed compliance logging is not available until required audit controls are qualified.');
    if (rootDirectory !== undefined && (typeof rootDirectory !== 'string' || !rootDirectory.trim() || rootDirectory.includes('\0'))) throw new Error();
    const actor = actors === undefined ? fileURLToPath(new URL('./logging-actor-entry.ts', import.meta.url)) : null;
    const launch = actors === undefined ? { launch: { kind: 'source' as const, entrypoint: actor! }, env: {} } : loggingRecord(actors, ['launch', 'env', 'executor'], 'LOGGING_CONFIG_INVALID');
    const createExecutor = createSubprocessDatabaseExecutorFactory(launch as unknown as SubprocessDatabaseExecutorFactoryOptions);
    return Object.freeze({ policy, rootDirectory: resolve(projectRoot, typeof rootDirectory === 'string' ? rootDirectory : 'data/zero.logs'), createExecutor, defaultActorEntrypoint: actor });
  } catch (error) {
    if (error instanceof LoggingError && error.code === 'LOGGING_NOT_READY') throw error;
    throw new LoggingError('LOGGING_CONFIG_INVALID', 'Managed logging configuration is invalid.');
  }
}
