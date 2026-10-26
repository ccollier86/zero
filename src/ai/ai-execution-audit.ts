/** Optional durable provider-stage port. Never accepts prompts, results, tool data or credentials. */
export interface AIExecutionAuditSpan {
  admit(): Promise<void>;
  finish(outcome: 'completed' | 'unknown'): Promise<void>;
  assertCurrent(): void;
}
export interface AIExecutionAudit {
  /** Capture attribution synchronously before the SDK may defer a streaming invocation. */
  prepare(descriptor: { capability: string; providerId: string; model: string }): (() => AIExecutionAuditSpan) | undefined;
}

/** Preserve provider shape/receivers and synchronous streamText() while fencing the real async provider boundary. */
export function auditAIModel<T>(model: T, prepare: (() => AIExecutionAuditSpan) | undefined): T {
  if (!prepare || !model || typeof model !== 'object') return model;
  const methods = new Map<PropertyKey, unknown>();
  const target = model as object;
  // A separate facade also supports frozen provider objects: returning a
  // wrapped method from a Proxy over a nonconfigurable source would violate JS invariants.
  return new Proxy(Object.create(Object.getPrototypeOf(target)), {
    ownKeys: () => Reflect.ownKeys(target),
    getOwnPropertyDescriptor(_facade, property) { const descriptor = Reflect.getOwnPropertyDescriptor(target, property); return descriptor ? { ...descriptor, configurable: true } : undefined; },
    get(_facade, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      if (methods.has(property)) return methods.get(property);
      const selected = ['doGenerate', 'doStream', 'doEmbed', 'doRerank'].includes(String(property));
      const method = selected ? async (...args: unknown[]) => {
        const span = prepare();
        await span.admit(); span.assertCurrent();
        let result;
        try { result = await Reflect.apply(value, target, args); }
        catch (error) { await span.finish('unknown'); throw error; }
        if (property === 'doStream') {
          if (!result || !(result.stream instanceof ReadableStream)) { await span.finish('unknown'); return result; }
          return { ...result, stream: auditAIProviderStream(result.stream, span) };
        }
        await span.finish('completed'); span.assertCurrent(); return result;
      } : value.bind(target);
      methods.set(property, method); return method;
    },
  }) as T;
}

function auditAIProviderStream(stream: ReadableStream<unknown>, span: AIExecutionAuditSpan): ReadableStream<unknown> {
  const reader = stream.getReader(); let done = false, finished = false, failed = false;
  const release = () => { try { reader.releaseLock(); } catch { /* Preserve the stream outcome. */ } };
  const terminal = async (outcome: 'completed' | 'unknown') => { if (done) return; done = true; release(); await span.finish(outcome); };
  const cancel = async () => { try { await reader.cancel(); } catch { /* Unknown outcome is retained separately. */ } finally { release(); } };
  return new ReadableStream({
    async pull(controller) {
      try {
        span.assertCurrent(); const next = await reader.read(); span.assertCurrent();
        if (next.done) { await terminal(finished && !failed ? 'completed' : 'unknown'); span.assertCurrent(); controller.close(); return; }
        // Inspect only the SDK's fixed part discriminator, never content fields.
        const type = next.value && typeof next.value === 'object' ? Object.getOwnPropertyDescriptor(next.value, 'type')?.value : null;
        if (type === 'finish') finished = true;
        if (type === 'error') failed = true;
        controller.enqueue(next.value);
      } catch (error) { await cancel(); await terminal('unknown').catch(() => {}); controller.error(error); }
    },
    async cancel() { await cancel(); await terminal('unknown'); },
  }, { highWaterMark: 0 });
}
