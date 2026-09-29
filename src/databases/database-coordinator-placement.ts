/** Placement-policy validation and immutable per-entry resolution. */

import type { DatabaseActorPlacementConfig } from './database-actor-protocol';
import { DatabaseError } from './database-error';
import type { DatabaseRef } from './database-file';
import {
  DATABASE_HOT_MAX_SNAPSHOT_INTERVAL_MS,
  DATABASE_HOT_MAX_SNAPSHOT_TIMEOUT_MS,
  defaultDatabaseHotSnapshotTimeoutMs,
  isDatabaseHotDurability,
  isDatabasePlacement,
  type DatabaseHotPlacementConfig,
  type DatabasePlacementPolicy,
} from './database-placement';

const DATABASE_PLACEMENT_POLICY_FIELDS = new Set(['default', 'select', 'hot']);
const DATABASE_HOT_PLACEMENT_FIELDS = new Set([
  'durability',
  'maxBytes',
  'snapshotIntervalMs',
  'snapshotTimeoutMs',
]);

/**
 * Revalidate the low-level coordinator contract instead of trusting the
 * createApp() normalizer. DatabaseCoordinator is public and can be
 * constructed directly from runtime JavaScript.
 */
export function normalizeCoordinatorPlacementPolicy(
  value: unknown,
): DatabasePlacementPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidPlacementPolicy();
  }

  let record: Readonly<Record<string, unknown>>;
  try {
    record = value as Readonly<Record<string, unknown>>;
    if (Object.keys(record).some((field) => !DATABASE_PLACEMENT_POLICY_FIELDS.has(field))) {
      throw invalidPlacementPolicy();
    }
  } catch {
    throw invalidPlacementPolicy();
  }

  let defaultPlacement: unknown;
  let selector: unknown;
  let hotInput: unknown;
  try {
    defaultPlacement = record.default;
    selector = record.select;
    hotInput = record.hot;
  } catch {
    throw invalidPlacementPolicy();
  }
  if (!isDatabasePlacement(defaultPlacement)
    || (selector !== undefined && typeof selector !== 'function')) {
    throw invalidPlacementPolicy();
  }

  const hot = normalizeCoordinatorHotPlacement(hotInput);
  if ((defaultPlacement === 'hot' || selector !== undefined) && hot === null) {
    throw invalidPlacementPolicy();
  }

  return Object.freeze({
    default: defaultPlacement,
    ...(selector === undefined
      ? {}
      : { select: selector as DatabasePlacementPolicy['select'] }),
    hot,
  });
}

function normalizeCoordinatorHotPlacement(
  value: unknown,
): DatabaseHotPlacementConfig | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidPlacementPolicy();
  }

  let record: Readonly<Record<string, unknown>>;
  try {
    record = value as Readonly<Record<string, unknown>>;
    if (Object.keys(record).some((field) => !DATABASE_HOT_PLACEMENT_FIELDS.has(field))) {
      throw invalidPlacementPolicy();
    }
  } catch {
    throw invalidPlacementPolicy();
  }

  let durability: unknown;
  let maxBytes: unknown;
  let snapshotIntervalMs: unknown;
  let snapshotTimeoutMs: unknown;
  let hasSnapshotInterval: boolean;
  let hasSnapshotTimeout: boolean;
  try {
    durability = record.durability;
    maxBytes = record.maxBytes;
    snapshotIntervalMs = record.snapshotIntervalMs;
    snapshotTimeoutMs = record.snapshotTimeoutMs;
    hasSnapshotInterval = Object.hasOwn(record, 'snapshotIntervalMs');
    hasSnapshotTimeout = Object.hasOwn(record, 'snapshotTimeoutMs');
  } catch {
    throw invalidPlacementPolicy();
  }

  if (!isDatabaseHotDurability(durability)
    || !Number.isSafeInteger(maxBytes)
    || (maxBytes as number) < 1) {
    throw invalidPlacementPolicy();
  }
  if (durability === 'periodic') {
    if (!hasSnapshotInterval
      || !Number.isSafeInteger(snapshotIntervalMs)
      || (snapshotIntervalMs as number) < 1
      || (snapshotIntervalMs as number) > DATABASE_HOT_MAX_SNAPSHOT_INTERVAL_MS) {
      throw invalidPlacementPolicy();
    }
    snapshotTimeoutMs = hasSnapshotTimeout
      ? snapshotTimeoutMs
      : defaultDatabaseHotSnapshotTimeoutMs(snapshotIntervalMs as number);
    if (!Number.isSafeInteger(snapshotTimeoutMs)
      || (snapshotTimeoutMs as number) < (snapshotIntervalMs as number)
      || (snapshotTimeoutMs as number) > DATABASE_HOT_MAX_SNAPSHOT_TIMEOUT_MS) {
      throw invalidPlacementPolicy();
    }
  } else if (hasSnapshotInterval || hasSnapshotTimeout) {
    throw invalidPlacementPolicy();
  }

  return Object.freeze({
    durability,
    maxBytes: maxBytes as number,
    ...(durability === 'periodic'
      ? {
          snapshotIntervalMs: snapshotIntervalMs as number,
          snapshotTimeoutMs: snapshotTimeoutMs as number,
        }
      : {}),
  });
}

export function placementPolicyCanSelectFile(
  policy: DatabasePlacementPolicy,
): boolean {
  return policy.default === 'file' || policy.select !== undefined;
}

/** Resolve and pin placement without granting the selector path or tenant authority. */
export function resolveCoordinatorEntryPlacement(
  policy: DatabasePlacementPolicy,
  databaseRef: DatabaseRef,
): DatabaseActorPlacementConfig {
  let selected = policy.default;
  if (policy.select) {
    try {
      selected = policy.select(Object.freeze({ databaseRef }));
      if (isPromiseLikePlacement(selected)) {
        void Promise.resolve(selected).catch(() => {});
        throw new TypeError('Database placement selector must be synchronous.');
      }
    } catch {
      throw new DatabaseError(
        'DATABASE_CONFIG_INVALID',
        'Database placement selector failed.',
        { retryable: false, outcome: 'not-started' },
      );
    }
  }
  if (!isDatabasePlacement(selected)) {
    throw new DatabaseError(
      'DATABASE_CONFIG_INVALID',
      'Database placement selector returned an invalid placement.',
      { retryable: false, outcome: 'not-started' },
    );
  }
  if (selected === 'file') return Object.freeze({ mode: 'file' });

  const hot = policy.hot;
  if (!hot) throw invalidPlacementPolicy();
  return Object.freeze({
    mode: 'hot',
    durability: hot.durability,
    maxBytes: hot.maxBytes,
    ...(hot.snapshotIntervalMs === undefined
      ? {}
      : { snapshotIntervalMs: hot.snapshotIntervalMs }),
    ...(hot.snapshotTimeoutMs === undefined
      ? {}
      : { snapshotTimeoutMs: hot.snapshotTimeoutMs }),
  });
}

export function sameCoordinatorActorPlacement(
  left: DatabaseActorPlacementConfig,
  right: DatabaseActorPlacementConfig,
): boolean {
  if (left.mode !== right.mode) return false;
  if (left.mode === 'file' || right.mode === 'file') return true;
  return left.durability === right.durability
    && left.maxBytes === right.maxBytes
    && left.snapshotIntervalMs === right.snapshotIntervalMs
    && left.snapshotTimeoutMs === right.snapshotTimeoutMs;
}

function isPromiseLikePlacement(value: unknown): value is PromiseLike<unknown> {
  return (typeof value === 'object' && value !== null)
    || typeof value === 'function'
    ? typeof (value as { then?: unknown }).then === 'function'
    : false;
}

function invalidPlacementPolicy(): DatabaseError {
  return new DatabaseError(
    'DATABASE_CONFIG_INVALID',
    'Database placement policy is invalid.',
    { retryable: false, outcome: 'not-started' },
  );
}
