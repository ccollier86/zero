/**
 * mutation-hooks.ts
 *
 * Zero-flavored async mutation hooks for frontend commands. This file owns
 * UI-facing mutation lifecycle state and observability emission only; callers
 * provide the SDK/client action being executed.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { OBS_CODES } from '../../observability/codes';
import { useStableCallback } from '../../hooks/use-stable-callback';
import { useAuthorizationScopeBoundary } from './authorization-scope-hooks';
import { useClientMaybe } from './client-context';
import { emitFrontendCode } from './observability';

export interface UseMutationOptions<Result> {
  onSuccess?: (result: Result) => void;
  onError?: (error: unknown) => void;
  resetOnRun?: boolean;
  emitErrors?: boolean;
  metadata?: Record<string, unknown>;
}

export interface UseMutationReturn<Args extends unknown[], Result> {
  pending: boolean;
  error: unknown;
  result: Result | null;
  run: (...args: Args) => Promise<Result>;
  reset: () => void;
}

/**
 * Track a platform mutation action and emit failures through observability.
 *
 * Use this for SDK-backed form submits, toolbar actions, and app commands
 * where components need pending/error/result state.
 */
export function useMutation<Args extends unknown[], Result>(
  action: (...args: Args) => Promise<Result> | Result,
  options: UseMutationOptions<Result> = {},
): UseMutationReturn<Args, Result> {
  const client = useClientMaybe();
  const authorizationBoundary = useAuthorizationScopeBoundary(client);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [loadedBoundaryKey, setLoadedBoundaryKey] = useState(authorizationBoundary.key);
  const boundaryKeyRef = useRef(authorizationBoundary.key);
  const boundaryReadyRef = useRef(authorizationBoundary.ready);
  const lifecycleRevisionRef = useRef(0);
  const nextOperationRef = useRef(0);
  const activeOperationsRef = useRef(new Set<number>());
  boundaryKeyRef.current = authorizationBoundary.key;
  boundaryReadyRef.current = authorizationBoundary.ready;
  const callbackBoundaryKey = authorizationBoundary.key;
  const actionRef = useStableCallback(action);
  const onSuccess = useStableCallback((value: Result) => options.onSuccess?.(value));
  const onError = useStableCallback((err: unknown) => options.onError?.(err));
  const resetOnRunRef = useRef(options.resetOnRun ?? true);
  const emitErrorsRef = useRef(options.emitErrors ?? true);
  const metadataRef = useRef(options.metadata);
  resetOnRunRef.current = options.resetOnRun ?? true;
  emitErrorsRef.current = options.emitErrors ?? true;
  metadataRef.current = options.metadata;

  useEffect(() => {
    lifecycleRevisionRef.current += 1;
    activeOperationsRef.current.clear();
    setLoadedBoundaryKey(authorizationBoundary.key);
    setPending(false);
    setError(null);
    setResult(null);
  }, [authorizationBoundary.key]);

  const reset = useCallback(() => {
    if (!boundaryReadyRef.current
      || boundaryKeyRef.current !== callbackBoundaryKey) return;
    lifecycleRevisionRef.current += 1;
    activeOperationsRef.current.clear();
    setPending(false);
    setError(null);
    setResult(null);
  }, [callbackBoundaryKey]);

  // `run` deliberately changes identity with the authorization boundary. A
  // stable/latest-callback wrapper here would let a handler retained from
  // scope A dispatch the newest scope-B action after an account or tenant
  // switch. The captured boundary key makes old handlers fail closed.
  const run = useCallback(async (...args: Args) => {
    if (!boundaryReadyRef.current
      || boundaryKeyRef.current !== callbackBoundaryKey) {
      throw new Error('Mutations are unavailable during an authorization scope transition.');
    }

    const operationBoundaryKey = callbackBoundaryKey;
    if (resetOnRunRef.current) {
      lifecycleRevisionRef.current += 1;
      activeOperationsRef.current.clear();
      setError(null);
      setResult(null);
    }

    const lifecycleRevision = lifecycleRevisionRef.current;
    const operationId = ++nextOperationRef.current;
    activeOperationsRef.current.add(operationId);
    setLoadedBoundaryKey(operationBoundaryKey);
    setPending(true);

    const scopeIsCurrent = () => boundaryReadyRef.current
      && boundaryKeyRef.current === operationBoundaryKey;
    const stateIsCurrent = () => scopeIsCurrent()
      && lifecycleRevisionRef.current === lifecycleRevision;

    try {
      const value = await actionRef(...args);
      if (!scopeIsCurrent()) {
        throw new Error('The authorization scope changed before the mutation completed.');
      }
      if (stateIsCurrent()) {
        setResult(value);
        onSuccess(value);
      }
      return value;
    } catch (err) {
      if (!scopeIsCurrent()) {
        throw new Error('The authorization scope changed before the mutation completed.');
      }
      if (stateIsCurrent()) {
        setError(err);
        onError(err);
        if (emitErrorsRef.current) {
          emitFrontendCode(OBS_CODES.FRONTEND_MUTATION_FAILED, {
            error: err,
            metadata: metadataRef.current,
          });
        }
      }
      throw err;
    } finally {
      activeOperationsRef.current.delete(operationId);
      if (stateIsCurrent()) {
        setPending(activeOperationsRef.current.size > 0);
      }
    }
  }, [
    actionRef,
    callbackBoundaryKey,
    onError,
    onSuccess,
  ]);

  const visible = authorizationBoundary.ready
    && loadedBoundaryKey === authorizationBoundary.key;
  return {
    pending: visible ? pending : false,
    error: visible ? error : null,
    result: visible ? result : null,
    run,
    reset,
  };
}
