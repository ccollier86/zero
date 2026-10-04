/**
 * data-table-mutation-controller.ts
 *
 * Owns the framework-agnostic lifecycle for asynchronous table mutations.
 * React authorization boundaries and user-facing presentation are layered on
 * by `use-data-table-mutation.ts`.
 */

import { awaitDataTableMutation } from './data-table-mutation-await';
import {
  DataTableMutationLifecycleError,
  dataTableMutationFailureMessage,
  dataTableMutationScopeUnavailableError,
  isDataTableMutationCancellation,
  mutationCancelledError,
  type DataTableMutationControllerOptions,
  type DataTableMutationFailure,
  type DataTableMutationFailureStage,
  type DataTableMutationKind,
  type DataTableMutationOperation,
} from './data-table-mutation-types';

export {
  DataTableMutationLifecycleError,
  isDataTableMutationCancellation,
  mutationCancelledError,
} from './data-table-mutation-types';
export type {
  DataTableMutationContext,
  DataTableMutationControllerOptions,
  DataTableMutationFailure,
  DataTableMutationFailureStage,
  DataTableMutationKind,
  DataTableMutationLifecycleErrorCode,
  DataTableMutationOperation,
} from './data-table-mutation-types';

interface InternalMutationOperation<Result = unknown>
  extends DataTableMutationOperation<Result> {
  readonly failureStage?: DataTableMutationFailureStage;
}

interface MutationEntry {
  readonly controller: AbortController;
  readonly promise: Promise<unknown>;
}

interface MutationState {
  readonly pending: boolean;
  readonly failure: DataTableMutationFailure | null;
  readonly retry: InternalMutationOperation | null;
}

/**
 * Keyed mutation controller used by the React hook and directly testable
 * without a DOM. Different keys remain independent; duplicate keys share the
 * same in-flight promise.
 */
export class DataTableMutationController {
  private boundaryKey: string;
  private available: boolean;
  private refresh?: () => void | Promise<void>;
  private failureMessage: (
    kind: DataTableMutationKind,
    stage: DataTableMutationFailureStage,
  ) => string;
  private onFailure?: (failure: DataTableMutationFailure) => void;
  private readonly active = new Map<string, MutationEntry>();
  private readonly state = new Map<string, MutationState>();
  private readonly listeners = new Set<() => void>();
  private revision = 0;
  private nextOperation = 0;
  private disposed = false;

  constructor(options: DataTableMutationControllerOptions) {
    this.boundaryKey = options.boundaryKey;
    this.available = options.available ?? true;
    this.refresh = options.refresh;
    this.failureMessage = options.failureMessage ?? dataTableMutationFailureMessage;
    this.onFailure = options.onFailure;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): number => this.revision;

  configure(options: Pick<
    DataTableMutationControllerOptions,
    'refresh' | 'failureMessage' | 'onFailure'
  >): void {
    this.refresh = options.refresh;
    this.failureMessage = options.failureMessage ?? dataTableMutationFailureMessage;
    this.onFailure = options.onFailure;
  }

  isAvailableFor(boundaryKey: string): boolean {
    return !this.disposed && this.available && this.boundaryKey === boundaryKey;
  }

  /** Abort and discard all state before admitting work from another scope. */
  replaceBoundary(boundaryKey: string, available: boolean): void {
    if (this.disposed) return;
    if (boundaryKey === this.boundaryKey && available === this.available) return;
    this.abortActive();
    this.boundaryKey = boundaryKey;
    this.available = available;
    this.state.clear();
    this.emit();
  }

  run<Result>(operation: DataTableMutationOperation<Result>): Promise<Result> {
    if (this.disposed || !this.available) {
      return Promise.reject(dataTableMutationScopeUnavailableError());
    }
    const current = this.active.get(operation.key);
    if (current) return current.promise as Promise<Result>;

    const controller = new AbortController();
    const boundaryKey = this.boundaryKey;
    const operationId = `table-mutation-${++this.nextOperation}`;
    const normalized = operation as InternalMutationOperation;
    const promise = Promise.resolve().then(() => this.perform(
      normalized,
      controller,
      boundaryKey,
      operationId,
    ));
    const entry: MutationEntry = {
      controller,
      promise,
    };
    this.active.set(operation.key, entry);
    this.state.set(operation.key, { pending: true, failure: null, retry: null });
    this.emit();
    return promise as Promise<Result>;
  }

  retry<Result = unknown>(key: string): Promise<Result> {
    const retry = this.state.get(key)?.retry;
    if (!retry) {
      return Promise.reject(new DataTableMutationLifecycleError(
        'DATA_TABLE_MUTATION_RETRY_UNAVAILABLE',
        'This table operation is no longer available to retry.',
      ));
    }
    return this.run(retry) as Promise<Result>;
  }

  isPending(key: string): boolean {
    return this.state.get(key)?.pending === true;
  }

  getError(key: string): DataTableMutationFailure | null {
    return this.state.get(key)?.failure ?? null;
  }

  clearError(key: string): void {
    const current = this.state.get(key);
    if (!current || current.pending || !current.failure) return;
    this.state.delete(key);
    this.emit();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.available = false;
    this.abortActive();
    this.state.clear();
    this.emit();
    this.listeners.clear();
  }

  private async perform(
    operation: InternalMutationOperation,
    controller: AbortController,
    boundaryKey: string,
    operationId: string,
  ): Promise<unknown> {
    try {
      let result: unknown;
      try {
        result = await awaitDataTableMutation(
          Promise.resolve().then(() => operation.execute({
            signal: controller.signal,
            operationId,
          })),
          controller.signal,
        );
      } catch (cause) {
        this.rejectOperation(
          operation,
          operation.failureStage ?? 'execute',
          operation,
          controller,
          boundaryKey,
          cause,
        );
      }
      this.assertCurrent(operation.key, controller, boundaryKey);

      const refresh = operation.refresh ?? this.refresh;
      if (operation.refreshOnSuccess !== false && refresh) {
        try {
          await awaitDataTableMutation(Promise.resolve().then(refresh), controller.signal);
        } catch (cause) {
          this.rejectOperation(
            operation,
            'refresh',
            refreshRetryOperation(operation, refresh),
            controller,
            boundaryKey,
            cause,
          );
        }
        this.assertCurrent(operation.key, controller, boundaryKey);
      }

      this.state.delete(operation.key);
      return result;
    } finally {
      if (this.ownsActiveEntry(operation.key, controller)) {
        this.active.delete(operation.key);
        const currentState = this.state.get(operation.key);
        if (currentState?.pending) {
          this.state.set(operation.key, { ...currentState, pending: false });
        }
        this.emit();
      }
    }
  }

  private rejectOperation(
    operation: InternalMutationOperation,
    stage: DataTableMutationFailureStage,
    retry: InternalMutationOperation,
    controller: AbortController,
    boundaryKey: string,
    cause: unknown,
  ): never {
    if (isDataTableMutationCancellation(cause)
      || controller.signal.aborted
      || !this.isCurrent(operation.key, controller, boundaryKey)) {
      if (this.ownsActiveEntry(operation.key, controller)) {
        this.state.delete(operation.key);
      }
      throw isDataTableMutationCancellation(cause)
        ? cause
        : mutationCancelledError();
    }

    let message = dataTableMutationFailureMessage(operation.kind, stage);
    try {
      message = this.failureMessage(operation.kind, stage);
    } catch {
      // Keep framework-owned safe text if an app message resolver fails.
    }
    const failure: DataTableMutationFailure = Object.freeze({
      code: 'DATA_TABLE_MUTATION_FAILED',
      message,
      kind: operation.kind,
      stage,
    });
    this.state.set(operation.key, { pending: false, failure, retry });
    try {
      this.onFailure?.(failure);
    } catch {
      // Presentation/reporting must never replace the app mutation failure.
    }
    throw cause;
  }

  private assertCurrent(
    key: string,
    controller: AbortController,
    boundaryKey: string,
  ): void {
    if (!this.isCurrent(key, controller, boundaryKey)) {
      throw mutationCancelledError();
    }
  }

  private isCurrent(
    key: string,
    controller: AbortController,
    boundaryKey: string,
  ): boolean {
    return !this.disposed
      && this.available
      && !controller.signal.aborted
      && this.boundaryKey === boundaryKey
      && this.active.get(key)?.controller === controller;
  }

  private ownsActiveEntry(key: string, controller: AbortController): boolean {
    return this.active.get(key)?.controller === controller;
  }

  private abortActive(): void {
    for (const entry of this.active.values()) entry.controller.abort();
    this.active.clear();
  }

  private emit(): void {
    this.revision += 1;
    for (const listener of this.listeners) listener();
  }
}

function refreshRetryOperation(
  operation: InternalMutationOperation,
  refresh: () => void | Promise<void>,
): InternalMutationOperation {
  return {
    key: operation.key,
    kind: operation.kind,
    failureStage: 'refresh',
    execute: refresh,
    refreshOnSuccess: false,
  };
}
