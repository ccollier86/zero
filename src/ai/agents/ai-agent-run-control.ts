/** Abort-signal ownership and stable error classification for ephemeral agent runs. */

import { AIError } from '../ai-errors';

/** Normalize provider, timeout, and cancellation failures into stable Zero errors. */
export function normalizeAIAgentRunError(error: unknown, signal: AbortSignal): AIError {
  if (signal.aborted) {
    if (signal.reason instanceof AIError) return signal.reason;
    return new AIError('AI agent execution was aborted.', 'AI_REQUEST_ABORTED', 499);
  }
  if (error instanceof AIError) return error;
  if (isTimeoutError(error)) {
    const timeout = new AIError('AI agent execution timed out.', 'AI_AGENT_EXECUTION_TIMEOUT', 504);
    Object.defineProperty(timeout, 'cause', { value: error, configurable: true });
    return timeout;
  }
  if (isAbortError(error)) {
    const aborted = new AIError('AI agent execution was aborted.', 'AI_REQUEST_ABORTED', 499);
    Object.defineProperty(aborted, 'cause', { value: error, configurable: true });
    return aborted;
  }
  const wrapped = new AIError('AI agent execution failed.', 'AI_AGENT_EXECUTION_FAILED', 500);
  Object.defineProperty(wrapped, 'cause', { value: error, configurable: true });
  return wrapped;
}

/** Combine caller and budget cancellation while retaining deterministic cleanup. */
export function combineAIAgentAbortSignals(
  ...signals: Array<AbortSignal | undefined>
): { readonly signal: AbortSignal; readonly dispose: () => void } {
  const controller = new AbortController();
  const active = signals.filter((signal): signal is AbortSignal => signal !== undefined);
  const abort = (event: Event) => controller.abort((event.target as AbortSignal).reason);
  for (const signal of active) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', abort, { once: true });
  }
  return {
    signal: controller.signal,
    dispose: () => active.forEach((signal) => signal.removeEventListener('abort', abort)),
  };
}

function isAbortError(error: unknown, seen = new Set<object>()): boolean {
  if (error === null || typeof error !== 'object' || seen.has(error)) return false;
  seen.add(error);
  if ('name' in error && (error.name === 'AbortError' || error.name === 'ResponseAborted')) {
    return true;
  }
  return 'cause' in error && isAbortError(error.cause, seen);
}

function isTimeoutError(error: unknown, seen = new Set<object>()): boolean {
  if (error === null || typeof error !== 'object' || seen.has(error)) return false;
  seen.add(error);
  if ('name' in error && error.name === 'TimeoutError') return true;
  return 'cause' in error && isTimeoutError(error.cause, seen);
}
