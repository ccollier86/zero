'use client';

/** React subscription and observability boundary for app-owned cascader loaders. */

import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { emitFrontendCode } from '../../frontend/client/observability';
import { OBS_CODES } from '../../observability/codes';
import {
  CascaderLoadController,
  type CascaderLoadControllerOptions,
  type CascaderLoadError,
  type CascaderLoaderSnapshot,
} from './cascader-load-controller';

export type { CascaderLoadContext, CascaderLoadError } from './cascader-load-controller';

/** Change scopeKey on an organization/auth boundary when retaining one picker. */
export interface UseCascaderLoaderOptions<T = unknown> extends Omit<CascaderLoadControllerOptions<T>, 'isActive'> {
  readonly scopeKey?: string | number;
}

/** Request methods have stable identity until the source/scope changes. */
export interface CascaderLoaderState<T = unknown> extends CascaderLoaderSnapshot<T> {
  readonly load: CascaderLoadController<T>['load'];
  readonly retryLoad: CascaderLoadController<T>['retryLoad'];
  readonly getLoadedChildren: CascaderLoadController<T>['getLoadedChildren'];
  readonly search: CascaderLoadController<T>['search'];
  readonly cancel: CascaderLoadController<T>['cancel'];
}

/**
 * Cache successful levels within one source/scope; immediately hide old snapshots
 * on a scope, items, or adapter change, including before effect cleanup runs.
 */
export function useCascaderLoader<T = unknown>(options: UseCascaderLoaderOptions<T>): CascaderLoaderState<T> {
  const activeController = useRef<CascaderLoadController<T> | null>(null);
  const onErrorRef = useRef(options.onError);
  onErrorRef.current = options.onError;
  const controller = useMemo(() => {
    const created: CascaderLoadController<T> = new CascaderLoadController<T>({
      items: options.items,
      getChildren: options.getChildren,
      onSearch: options.onSearch,
      isActive: (): boolean => activeController.current === created,
      onError: (error: CascaderLoadError) => {
        emitFrontendCode(OBS_CODES.FRONTEND_CASCADER_LOAD_FAILED, {
          metadata: { operation: error.operation, errorCode: error.code },
        });
        try {
          const result = onErrorRef.current?.(error);
          if (result && typeof (result as Promise<unknown>).catch === 'function') {
            void (result as Promise<unknown>).catch(() => emitCallbackFailure(error.operation));
          }
        } catch { emitCallbackFailure(error.operation); }
      },
    });
    return created;
  }, [options.items, options.getChildren, options.onSearch, options.scopeKey]);
  activeController.current = controller;
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => () => { controller.cancel(); }, [controller]);
  return useMemo(() => ({
    ...snapshot, load: controller.load, retryLoad: controller.retryLoad,
    getLoadedChildren: controller.getLoadedChildren,
    search: controller.search, cancel: controller.cancel,
  }), [controller, snapshot]);
}

function emitCallbackFailure(operation: CascaderLoadError['operation']): void {
  emitFrontendCode(OBS_CODES.FRONTEND_CASCADER_CALLBACK_FAILED, {
    metadata: { stage: 'load-error-callback', operation },
  });
}
