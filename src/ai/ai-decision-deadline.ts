/** One owned, cancellable deadline spanning all phases of a native request. */
import { AIError } from './ai-errors';

export function createDecisionDeadline(timeoutMs: number, external?: AbortSignal) {
  const controller = new AbortController();
  const expiresAt = performance.now() + timeoutMs;
  let failure: AIError | null = null;
  let rejectDeadline!: (error: AIError) => void;
  const cancelled = new Promise<never>((_, reject) => { rejectDeadline = reject; });
  // A pre-aborted caller may stop the request before its first awaited operation.
  void cancelled.catch(() => undefined);
  const abort = (code: 'AI_REQUEST_TIMEOUT' | 'AI_REQUEST_ABORTED') => {
    if (failure) return;
    failure = new AIError(code === 'AI_REQUEST_TIMEOUT' ? 'AI decision deadline exceeded.' : 'AI decision request was cancelled.',
      code, code === 'AI_REQUEST_TIMEOUT' ? 504 : 499);
    controller.abort(failure);
    rejectDeadline(failure);
  };
  const onAbort = () => abort('AI_REQUEST_ABORTED');
  const timer = setTimeout(() => abort('AI_REQUEST_TIMEOUT'), timeoutMs);
  if (external?.aborted) onAbort();
  else external?.addEventListener('abort', onAbort, { once: true });
  return {
    signal: controller.signal,
    assertCurrent() {
      if (!failure && performance.now() >= expiresAt) abort('AI_REQUEST_TIMEOUT');
      if (failure) throw failure;
    },
    async wait<Value>(operation: PromiseLike<Value>): Promise<Value> {
      const handled = Promise.resolve(operation);
      // Reentrant cancellation can occur while a custom transport creates the operation.
      void handled.catch(() => undefined);
      this.assertCurrent();
      return await Promise.race([handled, cancelled]);
    },
    async delay(ms: number) {
      let delayTimer: ReturnType<typeof setTimeout> | undefined;
      try { await this.wait(new Promise<void>(resolve => { delayTimer = setTimeout(resolve, ms); })); }
      finally { clearTimeout(delayTimer); }
    },
    dispose() { clearTimeout(timer); external?.removeEventListener('abort', onAbort); },
  };
}
export type AIDecisionDeadline = ReturnType<typeof createDecisionDeadline>;
