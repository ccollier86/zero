/** Closed, privacy-safe failures for synchronous Sync lifecycle contracts. */

export const SYNC_LIFECYCLE_ERROR_CODES = Object.freeze([
  'SYNC_POLICY_HISTORY_GAP_UNHANDLED',
  'SYNC_POLICY_HISTORY_GAP_ASYNC',
  'SYNC_STATE_CHANGE_INVALID',
  'SYNC_POLICY_OBSERVER_ASYNC',
  'SYNC_CALLBACK_THENABLE_INSPECTION_FAILED',
] as const);

export type SyncLifecycleErrorCode =
  (typeof SYNC_LIFECYCLE_ERROR_CODES)[number];

/** Stable internal classifier carried into the platform observability envelope. */
export class SyncLifecycleError extends Error {
  constructor(
    readonly code: SyncLifecycleErrorCode,
    message: string,
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = 'SyncLifecycleError';
  }
}

export function syncLifecycleError(
  code: SyncLifecycleErrorCode,
  options: ErrorOptions = {},
): SyncLifecycleError {
  return new SyncLifecycleError(code, syncLifecycleErrorMessage(code), options);
}

/** Inspect app-owned synchronous callback results without trusting `then`. */
export function isSyncPromiseLike(value: unknown): value is PromiseLike<unknown> {
  if (value === null
    || (typeof value !== 'object' && typeof value !== 'function')) {
    return false;
  }

  try {
    return typeof (value as { then?: unknown }).then === 'function';
  } catch (cause) {
    throw syncLifecycleError(
      'SYNC_CALLBACK_THENABLE_INSPECTION_FAILED',
      { cause },
    );
  }
}

function syncLifecycleErrorMessage(code: SyncLifecycleErrorCode): string {
  switch (code) {
    case 'SYNC_POLICY_HISTORY_GAP_UNHANDLED':
      return 'Stateful Sync policy cannot rebuild after a history gap.';
    case 'SYNC_POLICY_HISTORY_GAP_ASYNC':
      return 'Sync policy history-gap reset must be synchronous.';
    case 'SYNC_STATE_CHANGE_INVALID':
      return 'Durable State Sync change is invalid.';
    case 'SYNC_POLICY_OBSERVER_ASYNC':
      return 'Sync policy change observer must be synchronous.';
    case 'SYNC_CALLBACK_THENABLE_INSPECTION_FAILED':
      return 'Sync synchronous callback thenable inspection failed.';
  }
}
