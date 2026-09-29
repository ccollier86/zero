const RESPONSE_BODY_READ_METHODS = new Set<PropertyKey>([
  'arrayBuffer', 'blob', 'bytes', 'formData', 'json', 'text',
]);

interface GuardedResponseMetadata {
  readonly ok: boolean;
  readonly redirected: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly type: ResponseType;
  readonly url: string;
}

/**
 * Preserve the Response contract while refusing to surface body bytes after
 * the browser crosses an authorization-scope boundary.
 */
export function guardResponseAuthorizationScope(
  response: Response,
  assertCurrent: () => void,
): Response {
  assertCurrent();
  const metadata: GuardedResponseMetadata = {
    ok: response.ok,
    redirected: response.redirected,
    status: response.status,
    statusText: response.statusText,
    type: response.type,
    url: response.url,
  };
  if (!response.body) return proxyGuardedResponse(response, metadata, assertCurrent);

  const guardedBody = createAuthorizationScopeGuardedStream(response.body, assertCurrent);
  const internalStatus = response.status >= 200 && response.status <= 599
    ? response.status
    : 200;
  const guardedResponse = new Response(guardedBody, {
    headers: response.headers,
    status: internalStatus,
    statusText: internalStatus === response.status ? response.statusText : undefined,
  });
  return proxyGuardedResponse(guardedResponse, metadata, assertCurrent);
}

export interface ComposedAuthorizationScopeSignal {
  readonly signal: AbortSignal;
  dispose(): void;
}

/** Couple caller and authorization-scope cancellation without leaking listeners. */
export function composeAuthorizationScopeSignal(
  callerSignal: AbortSignal | null | undefined,
  authorizationScopeSignal: AbortSignal,
): ComposedAuthorizationScopeSignal {
  if (!callerSignal || callerSignal === authorizationScopeSignal) {
    return { signal: authorizationScopeSignal, dispose: () => {} };
  }

  const controller = new AbortController();
  const abortFrom = (signal: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(signal.reason);
  };
  const abortFromCaller = () => abortFrom(callerSignal);
  const abortFromScope = () => abortFrom(authorizationScopeSignal);
  if (callerSignal.aborted) abortFrom(callerSignal);
  else callerSignal.addEventListener('abort', abortFromCaller, { once: true });
  if (authorizationScopeSignal.aborted) abortFrom(authorizationScopeSignal);
  else authorizationScopeSignal.addEventListener('abort', abortFromScope, { once: true });

  return {
    signal: controller.signal,
    dispose() {
      callerSignal.removeEventListener('abort', abortFromCaller);
      authorizationScopeSignal.removeEventListener('abort', abortFromScope);
    },
  };
}

function createAuthorizationScopeGuardedStream(
  source: ReadableStream<Uint8Array>,
  assertCurrent: () => void,
): ReadableStream<Uint8Array> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let finished = false;
  const releaseReader = () => {
    if (!reader) return;
    try { reader.releaseLock(); } catch { /* A settled stream may release first. */ }
    reader = null;
  };
  const cancelSource = async (reason: unknown) => {
    if (!reader) reader = source.getReader();
    try { await reader.cancel(reason); } finally { releaseReader(); }
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (finished) return;
      try {
        assertCurrent();
        if (!reader) reader = source.getReader();
        const chunk = await reader.read();
        assertCurrent();
        if (chunk.done) {
          finished = true;
          releaseReader();
          controller.close();
          return;
        }
        controller.enqueue(chunk.value);
      } catch (error) {
        finished = true;
        try { await cancelSource(error); } catch { /* Keep the boundary error. */ }
        controller.error(error);
      }
    },
    async cancel(reason) {
      if (finished) return;
      finished = true;
      await cancelSource(reason);
    },
  });
}

function proxyGuardedResponse(
  response: Response,
  metadata: GuardedResponseMetadata,
  assertCurrent: () => void,
): Response {
  return new Proxy(response, {
    get(target, property) {
      assertCurrent();
      if (property === 'url' || property === 'redirected' || property === 'type'
        || property === 'status' || property === 'statusText' || property === 'ok') {
        return metadata[property];
      }
      if (property === 'clone') {
        return () => {
          assertCurrent();
          return proxyGuardedResponse(target.clone(), metadata, assertCurrent);
        };
      }
      const value = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      if (RESPONSE_BODY_READ_METHODS.has(property)) {
        return async (...args: unknown[]) => {
          assertCurrent();
          const result = await Reflect.apply(value, target, args);
          assertCurrent();
          return result;
        };
      }
      return value.bind(target);
    },
  });
}
