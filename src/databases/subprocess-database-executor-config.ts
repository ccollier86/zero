/**
 * subprocess-database-executor-config.ts
 *
 * Validates and detaches subprocess lifecycle bounds and the explicit child
 * environment allowlist. Process ownership remains in the executor class.
 */

import { MAX_RUNTIME_TIMER_INTERVAL_MS } from '../runtime/timer-limits';
import {
  isDatabaseExecutorRole,
  readDatabaseExecutorDataRecord,
} from './database-executor-validation';

const DEFAULT_MAX_IN_FLIGHT = 64;
const DEFAULT_STARTUP_TIMEOUT_MS = 5_000;
const DEFAULT_OPERATION_TIMEOUT_MS = 30_000;
const DEFAULT_SHUTDOWN_ACK_TIMEOUT_MS = 5_000;
const DEFAULT_SHUTDOWN_EXIT_TIMEOUT_MS = 5_000;
const DEFAULT_SIGTERM_TIMEOUT_MS = 2_000;
const DEFAULT_SIGKILL_TIMEOUT_MS = 2_000;

export interface SubprocessDatabaseExecutorOptions {
  /** Complete executable and argument vector. It is never exposed in diagnostics. */
  readonly command: readonly [string, ...string[]];
  /** Complete allowlist passed to the child; the parent environment is not inherited. */
  readonly env: Readonly<Record<string, string>>;
  /** Non-secret actor role included in the startup challenge. */
  readonly role: string;
  /** Stable non-negative pool slot. */
  readonly slot: number;
  readonly maxInFlight?: number;
  readonly startupTimeoutMs?: number;
  readonly operationTimeoutMs?: number;
  readonly shutdownAckTimeoutMs?: number;
  readonly shutdownExitTimeoutMs?: number;
  readonly sigtermTimeoutMs?: number;
  readonly sigkillTimeoutMs?: number;
}

export interface NormalizedSubprocessDatabaseExecutorOptions {
  readonly command: [string, ...string[]];
  readonly env: Readonly<Record<string, string>>;
  readonly role: string;
  readonly slot: number;
  readonly maxInFlight: number;
  readonly startupTimeoutMs: number;
  readonly operationTimeoutMs: number;
  readonly shutdownAckTimeoutMs: number;
  readonly shutdownExitTimeoutMs: number;
  readonly sigtermTimeoutMs: number;
  readonly sigkillTimeoutMs: number;
}

/** Validate, copy, and freeze executor launch/lifecycle configuration. */
export function normalizeSubprocessDatabaseExecutorOptions(
  options: SubprocessDatabaseExecutorOptions,
): NormalizedSubprocessDatabaseExecutorOptions {
  if (!Array.isArray(options.command)
    || options.command.length === 0
    || options.command.some((part) => typeof part !== 'string')
    || options.command[0]?.length === 0) {
    throw new TypeError('command must contain a non-empty executable string.');
  }
  if (!isDatabaseExecutorRole(options.role)) {
    throw new TypeError('role must be a bounded executor identifier.');
  }

  return Object.freeze({
    command: [...options.command] as [string, ...string[]],
    env: normalizeEnvironment(options.env),
    role: options.role,
    slot: normalizeNonNegativeSafeInteger(options.slot, 'slot'),
    maxInFlight: normalizePositiveSafeInteger(
      options.maxInFlight ?? DEFAULT_MAX_IN_FLIGHT,
      'maxInFlight',
    ),
    startupTimeoutMs: normalizeSubprocessDatabaseExecutorTimeout(
      options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
      'startupTimeoutMs',
    ),
    operationTimeoutMs: normalizeSubprocessDatabaseExecutorTimeout(
      options.operationTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS,
      'operationTimeoutMs',
    ),
    shutdownAckTimeoutMs: normalizeSubprocessDatabaseExecutorTimeout(
      options.shutdownAckTimeoutMs ?? DEFAULT_SHUTDOWN_ACK_TIMEOUT_MS,
      'shutdownAckTimeoutMs',
    ),
    shutdownExitTimeoutMs: normalizeSubprocessDatabaseExecutorTimeout(
      options.shutdownExitTimeoutMs ?? DEFAULT_SHUTDOWN_EXIT_TIMEOUT_MS,
      'shutdownExitTimeoutMs',
    ),
    sigtermTimeoutMs: normalizeSubprocessDatabaseExecutorTimeout(
      options.sigtermTimeoutMs ?? DEFAULT_SIGTERM_TIMEOUT_MS,
      'sigtermTimeoutMs',
    ),
    sigkillTimeoutMs: normalizeSubprocessDatabaseExecutorTimeout(
      options.sigkillTimeoutMs ?? DEFAULT_SIGKILL_TIMEOUT_MS,
      'sigkillTimeoutMs',
    ),
  });
}

function normalizeEnvironment(
  value: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const record = readDatabaseExecutorDataRecord(value);
  if (!record) {
    throw new TypeError('env must be an explicit plain-data allowlist.');
  }
  const normalized: Record<string, string> = Object.create(null);
  for (const [key, entry] of Object.entries(record)) {
    if (key.length === 0 || key.includes('=') || key.includes('\0')) {
      throw new TypeError('env contains an invalid environment variable name.');
    }
    if (typeof entry !== 'string' || entry.includes('\0')) {
      throw new TypeError('env values must be strings without null bytes.');
    }
    normalized[key] = entry;
  }
  return Object.freeze(normalized);
}

function normalizePositiveSafeInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new TypeError(`${name} must be a positive safe integer.`);
  }
  return value as number;
}

/** Validate one portable positive timer interval. */
export function normalizeSubprocessDatabaseExecutorTimeout(
  value: unknown,
  name: string,
): number {
  const normalized = normalizePositiveSafeInteger(value, name);
  if (normalized > MAX_RUNTIME_TIMER_INTERVAL_MS) {
    throw new TypeError(
      `${name} must not exceed ${MAX_RUNTIME_TIMER_INTERVAL_MS}.`,
    );
  }
  return normalized;
}

function normalizeNonNegativeSafeInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer.`);
  }
  return value as number;
}
