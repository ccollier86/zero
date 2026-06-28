/**
 * mutation-hooks.ts
 *
 * Zero-flavored async mutation hooks for frontend commands. This file owns
 * UI-facing mutation lifecycle state and observability emission only; callers
 * provide the SDK/client action being executed.
 */

import { useCallback, useState } from 'react';
import { OBS_CODES } from '../../observability/codes';
import { useStableCallback } from '../../hooks/use-stable-callback';
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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<Result | null>(null);
  const actionRef = useStableCallback(action);
  const onSuccess = useStableCallback((value: Result) => options.onSuccess?.(value));
  const onError = useStableCallback((err: unknown) => options.onError?.(err));
  const resetOnRun = options.resetOnRun ?? true;
  const emitErrors = options.emitErrors ?? true;
  const metadata = options.metadata;

  const reset = useCallback(() => {
    setPending(false);
    setError(null);
    setResult(null);
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
      if (emitErrors) {
        emitFrontendCode(OBS_CODES.FRONTEND_MUTATION_FAILED, {
          error: err,
          metadata,
        });
      }
      throw err;
    } finally {
      setPending(false);
    }
  });

  return { pending, error, result, run, reset };
}
