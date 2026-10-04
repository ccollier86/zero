'use client';

/** Bind keyed table mutations to Zero's authorization boundary and UI sinks. */

import * as React from 'react';
import { toast } from 'sonner';
import { OBS_CODES } from '../../observability/codes';
import { useAuthorizationScopeBoundary } from '../../frontend/client/authorization-scope-hooks';
import { useClientMaybe } from '../../frontend/client/client-context';
import { emitFrontendCode } from '../../frontend/client/observability';
import {
  DataTableMutationController,
  DataTableMutationLifecycleError,
  type DataTableMutationFailure,
  type DataTableMutationFailureStage,
  type DataTableMutationKind,
  type DataTableMutationOperation,
} from './data-table-mutation-controller';

export interface DataTableMutationRunner {
  readonly boundaryKey: string;
  run<Result>(operation: DataTableMutationOperation<Result>): Promise<Result>;
  retry<Result = unknown>(key: string): Promise<Result>;
  isPending(key: string): boolean;
  getError(key: string): DataTableMutationFailure | null;
  clearError(key: string): void;
}

export interface UseDataTableMutationRunnerOptions {
  /** Additional app/source boundary. Changing it aborts and clears old work. */
  boundaryKey?: string | number | null;
  /** Default refresh awaited after successful mutations. */
  refresh?: () => void | Promise<void>;
  /** Override fixed framework text without exposing the rejected value. */
  failureMessages?: Partial<Record<DataTableMutationKind, string>>;
  /** Disable the default Sonner failure toast when a parent owns presentation. */
  showErrorToast?: boolean;
}

/**
 * Create a mutation runner that fails closed across login, logout, tenant,
 * authorization-data, explicit source-boundary, and unmount transitions.
 */
export function useDataTableMutationRunner(
  options: UseDataTableMutationRunnerOptions = {},
): DataTableMutationRunner {
  const client = useClientMaybe();
  // Passing null explicitly preserves standalone/static table rendering.
  const authorization = useAuthorizationScopeBoundary(client);
  const compositeBoundaryKey = JSON.stringify([
    authorization.key,
    options.boundaryKey ?? null,
  ]);
  const currentBoundaryRef = React.useRef(compositeBoundaryKey);
  const boundaryReadyRef = React.useRef(authorization.ready);
  currentBoundaryRef.current = compositeBoundaryKey;
  boundaryReadyRef.current = authorization.ready;

  const controllerRef = React.useRef<DataTableMutationController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new DataTableMutationController({
      boundaryKey: compositeBoundaryKey,
      available: authorization.ready,
    });
  }
  const controller = controllerRef.current;
  controller.configure({
    refresh: options.refresh,
    failureMessage: (kind, stage) => stage === 'refresh'
      ? defaultFailureMessage(kind, stage)
      : options.failureMessages?.[kind] ?? defaultFailureMessage(kind, stage),
    onFailure: (failure) => {
      emitFrontendCode(OBS_CODES.FRONTEND_MUTATION_FAILED, {
        metadata: {
          surface: 'data-table',
          kind: failure.kind,
          stage: failure.stage,
        },
      });
      if (options.showErrorToast !== false) toast.error(failure.message);
    },
  });

  const revision = React.useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  React.useEffect(() => {
    controller.replaceBoundary(compositeBoundaryKey, authorization.ready);
  }, [authorization.ready, compositeBoundaryKey, controller]);

  const lifecycleGenerationRef = React.useRef(0);
  React.useEffect(() => {
    const generation = ++lifecycleGenerationRef.current;
    controller.replaceBoundary(currentBoundaryRef.current, boundaryReadyRef.current);
    return () => {
      // Abort immediately on a real unmount. Deferring permanent disposal by
      // one microtask lets React StrictMode's setup-cleanup-setup probe revive
      // the same hook instance without leaving it permanently disposed.
      controller.replaceBoundary(currentBoundaryRef.current, false);
      queueMicrotask(() => {
        if (lifecycleGenerationRef.current === generation) controller.dispose();
      });
    };
  }, [controller]);

  const boundaryIsCurrent = React.useCallback(() => (
    boundaryReadyRef.current
      && currentBoundaryRef.current === compositeBoundaryKey
      && controller.isAvailableFor(compositeBoundaryKey)
  ), [compositeBoundaryKey, controller]);

  return React.useMemo<DataTableMutationRunner>(() => ({
    boundaryKey: compositeBoundaryKey,
    run<Result>(operation: DataTableMutationOperation<Result>): Promise<Result> {
      if (!boundaryIsCurrent()) return Promise.reject(scopeUnavailableError());
      return controller.run(operation);
    },
    retry<Result = unknown>(key: string): Promise<Result> {
      if (!boundaryIsCurrent()) return Promise.reject(scopeUnavailableError());
      return controller.retry<Result>(key);
    },
    isPending: (key) => boundaryIsCurrent() && controller.isPending(key),
    getError: (key) => boundaryIsCurrent() ? controller.getError(key) : null,
    clearError: (key) => {
      if (boundaryIsCurrent()) controller.clearError(key);
    },
  }), [boundaryIsCurrent, compositeBoundaryKey, controller, revision]);
}

function defaultFailureMessage(
  kind: DataTableMutationKind,
  stage: DataTableMutationFailureStage,
): string {
  if (stage === 'refresh') {
    return kind === 'cell'
      ? 'The change was saved, but the table could not refresh. Retry refresh.'
      : 'The action completed, but the table could not refresh. Retry refresh.';
  }
  if (kind === 'cell') return 'The change could not be saved. Try again.';
  if (kind === 'bulk') return 'The bulk action could not be completed. Try again.';
  return 'The row action could not be completed. Try again.';
}

function scopeUnavailableError(): DataTableMutationLifecycleError {
  return new DataTableMutationLifecycleError(
    'DATA_TABLE_MUTATION_SCOPE_UNAVAILABLE',
    'Table actions are unavailable during an authorization scope transition.',
  );
}

export type {
  DataTableMutationContext,
  DataTableMutationFailure,
  DataTableMutationFailureStage,
  DataTableMutationKind,
  DataTableMutationLifecycleErrorCode,
  DataTableMutationOperation,
} from './data-table-mutation-controller';
export {
  DataTableMutationLifecycleError,
  isDataTableMutationCancellation,
  mutationCancelledError,
} from './data-table-mutation-controller';
