/**
 * use-async-action.ts
 *
 * Wraps async UI actions with pending/result/error state. This file owns local
 * action lifecycle state only; callers provide the actual side effect.
 */

import { useCallback, useState } from 'react';
import { useStableCallback } from './use-stable-callback';

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

  const reset = useCallback(() => {
    setError(null);
    setResult(null);
    setPending(false);
  }, []);

  const run = useStableCallback(async (...args: Args) => {
    if (resetOnRun) {
      setError(null);
      setResult(null);
    }

    setPending(true);
    try {
      const value = await actionRef(...args);
      setResult(value);
      onSuccess(value);
      return value;
    } catch (err) {
      setError(err);
      onError(err);
      throw err;
    } finally {
      setPending(false);
    }
  });

  return { pending, error, result, run, reset };
}
