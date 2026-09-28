import { parseTokenTTL } from '../tokens/token-utils';
import type { AuthAuditConfig, ResolvedAuthAuditConfig } from './auth-audit-types';

const DEFAULT_RETENTION_DAYS = 365;
const DEFAULT_PRUNE_BATCH_SIZE = 1_000;
const DEFAULT_PRUNE_INTERVAL = '6h';
const MAX_RETENTION_DAYS = 3_650;
const MAX_PRUNE_BATCH_SIZE = 10_000;
const MIN_PRUNE_INTERVAL_MS = 60_000;
const MAX_PRUNE_INTERVAL_MS = 7 * 86_400_000;

export function resolveAuthAuditConfig(
  input: AuthAuditConfig | undefined,
): ResolvedAuthAuditConfig {
  if (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input))) {
    throw new Error('[auth] Audit config must be an object.');
  }
  if (input) assertOnlyKeys(input, ['retentionDays', 'pruneBatchSize', 'pruneInterval']);

  const retentionDays = input?.retentionDays ?? DEFAULT_RETENTION_DAYS;
  if (!Number.isSafeInteger(retentionDays)
    || retentionDays < 1 || retentionDays > MAX_RETENTION_DAYS) {
    throw new Error(
      `[auth] Audit retentionDays must be an integer between 1 and ${MAX_RETENTION_DAYS}.`,
    );
  }
  const pruneBatchSize = input?.pruneBatchSize ?? DEFAULT_PRUNE_BATCH_SIZE;
  if (!Number.isSafeInteger(pruneBatchSize)
    || pruneBatchSize < 1 || pruneBatchSize > MAX_PRUNE_BATCH_SIZE) {
    throw new Error(
      `[auth] Audit pruneBatchSize must be an integer between 1 and ${MAX_PRUNE_BATCH_SIZE}.`,
    );
  }
  const pruneInterval = input?.pruneInterval ?? DEFAULT_PRUNE_INTERVAL;
  if (typeof pruneInterval !== 'string') {
    throw new Error('[auth] Audit pruneInterval must be a duration string.');
  }
  const pruneIntervalMs = parseTokenTTL(pruneInterval, 'auth audit prune interval');
  if (pruneIntervalMs < MIN_PRUNE_INTERVAL_MS || pruneIntervalMs > MAX_PRUNE_INTERVAL_MS) {
    throw new Error('[auth] Audit pruneInterval must be between 1m and 7d.');
  }
  return Object.freeze({
    retentionDays,
    pruneBatchSize,
    pruneInterval,
    pruneIntervalMs,
  });
}

function assertOnlyKeys(input: object, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(input).filter((key) => !allowedSet.has(key));
  if (unknown.length > 0) {
    throw new Error(`[auth] Audit config contains unknown key: "${unknown[0]}".`);
  }
}
