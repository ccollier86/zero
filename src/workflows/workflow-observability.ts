/** App-local, transaction-aware observability boundary for workflows. */

import type { PlatformCodeDefinition, PlatformCodeEmitOptions } from '../observability/types';
import {
  emitPlatformCode,
  emitPlatformCodeTo,
} from '../observability/sink';
import { ZERO_OBSERVABILITY_RUNTIME } from '../runtime/service-keys';
import type { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import type { ReactiveDB } from '../sync/reactive-db';

export type WorkflowCodeEmitter = (
  definition: PlatformCodeDefinition,
  options?: PlatformCodeEmitOptions,
) => void;

/**
 * One workflow runtime owns one of these objects and passes it to every
 * collaborator. State-derived events use `emitAfterCommit`; operational
 * failures that do not describe a committed state transition use `emitNow`.
 */
export interface WorkflowObservability {
  readonly emitNow: WorkflowCodeEmitter;
  readonly emitAfterCommit: WorkflowCodeEmitter;
}

/**
 * Bind workflow events to a managed app's observability runtime.
 *
 * The process-global sink remains available only to standalone composition.
 * A supplied managed runtime must have installed its app-local observability
 * capability; failing setup is safer than leaking events into another app.
 */
export function createWorkflowObservability(
  db?: Pick<ReactiveDB, 'afterCommit'>,
  runtime?: ZeroAppRuntime,
): WorkflowObservability {
  const target = runtime?.require(ZERO_OBSERVABILITY_RUNTIME) ?? null;
  const emitNow: WorkflowCodeEmitter = target
    ? (definition, options) => {
        emitPlatformCodeTo(target, definition, options);
      }
    : (definition, options) => {
        emitPlatformCode(definition, options);
      };

  return Object.freeze({
    emitNow,
    emitAfterCommit(
      definition: PlatformCodeDefinition,
      options?: PlatformCodeEmitOptions,
    ) {
      if (!db) {
        emitNow(definition, options);
        return;
      }

      // Snapshot the caller-owned options before deferring them. Metadata is
      // shallow by contract and the sink performs its own sensitive-key pass.
      const deferredOptions = options === undefined
        ? undefined
        : {
            ...options,
            ...(options.metadata ? { metadata: { ...options.metadata } } : {}),
          };
      try {
        db.afterCommit(() => emitNow(definition, deferredOptions));
      } catch (error) {
        // Outside a managed transaction there is nothing left to roll back,
        // so the lifecycle fact can be emitted immediately. Do not swallow a
        // disposed-database or callback-validation failure.
        if (!isMissingActiveTransaction(error)) throw error;
        emitNow(definition, deferredOptions);
      }
    },
  });
}

function isMissingActiveTransaction(error: unknown): boolean {
  return error instanceof Error
    && error.message === 'ReactiveDB afterCommit callbacks require an active transaction';
}
