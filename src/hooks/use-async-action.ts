/**
 * use-async-action.ts
 *
 * Wraps async UI actions with pending/result/error state. This file owns local
 * action lifecycle state only; callers provide the actual side effect.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useStableCallback } from './use-stable-callback';
import { emitFrontendCode } from '../frontend/client/observability';
import { OBS_CODES } from '../observability/codes';

export interface UseAsyncActionOptions<Result> {
  /** Called after the action resolves successfully. */
  onSuccess?: (result: Result) => void;
  /** Called after the action rejects. */
  onError?: (error: unknown) => void;
  /** Clear previous result/error before each run. Defaults to true. */
  resetOnRun?: boolean;
}

export interface UseAsyncActionReturn<Args extends unknown[], Result> {
  pending: boolean;
  error: unknown;
  result: Result | null;
  run: (...args: Args) => Promise<Result>;
  reset: () => void;
}

/**
 * Track the lifecycle of an async command from UI code.
 *
 * Re-throws action errors after storing them so form handlers can still use
 * normal try/catch behavior.
 */
export function useAsyncAction<Args extends unknown[], Result>(
  action: (...args: Args) => Promise<Result> | Result,
  options: UseAsyncActionOptions<Result> = {},
): UseAsyncActionReturn<Args, Result> {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<Result | null>(null);
  const actionRef = useStableCallback(action);
  const onSuccess = useStableCallback((value: Result) => options.onSuccess?.(value));
  const onError = useStableCallback((err: unknown) => options.onError?.(err));
  const resetOnRun = options.resetOnRun ?? true;
  const mounted = useRef(true);
  const generation = useRef(0);
  const active = useRef(new Set<number>());
  const nextOperation = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current += 1; active.current.clear(); };
  }, []);

  const reset = useCallback(() => {
    if (!mounted.current) return;
    generation.current += 1;
    active.current.clear();
    setError(null);
    setResult(null);
    setPending(false);
  }, []);

  const run = useStableCallback(async (...args: Args) => {
    if (!mounted.current) throw new Error('This async action is unavailable after its component unmounted.');
    if (resetOnRun) {
      generation.current += 1;
      active.current.clear();
      setError(null);
      setResult(null);
    }

    setPending(true);
    const capturedGeneration = generation.current;
    const operation = ++nextOperation.current;
    active.current.add(operation);
    const current = () => mounted.current && generation.current === capturedGeneration;
    try {
      let value: Result;
      try {
        value = await actionRef(...args);
      } catch (error) {
        if (current()) {
          setError(error);
          try { await onError(error); }
          catch { if (current()) reportCallbackFailure('error-callback'); }
        }
        throw error;
      }
      if (current()) {
        setResult(value);
        try { await onSuccess(value); }
        catch { if (current()) reportCallbackFailure('accepted-callback'); }
      }
      return value;
    } finally {
      active.current.delete(operation);
      if (current()) setPending(active.current.size > 0);
    }
  });

  return { pending, error, result, run, reset };
}

function reportCallbackFailure(stage: 'accepted-callback' | 'error-callback'): void {
  emitFrontendCode(OBS_CODES.FRONTEND_MUTATION_FAILED, {
    metadata: { surface: 'use-async-action', stage },
  });
}
