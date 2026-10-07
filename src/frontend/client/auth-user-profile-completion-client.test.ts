/** Actual AuthClient first-use exchange and anonymous proof replacement fences; synthetic fetch only. */
import { afterEach, expect, test } from 'bun:test';
import { AuthClient } from './auth-client';
import { AuthUserProfileCompletionTransport } from './auth-user-profile-completion-transport';
import type { AuthCompletionResult } from './auth-types';
import { completionUser, profileCompletionResult } from './auth-user-profile-completion.test-fixtures';
const originalFetch = globalThis.fetch;
const clients = new Set<AuthClient>();
afterEach(() => { globalThis.fetch = originalFetch; for (const client of clients) client.dispose(); clients.clear(); });
function client() { const auth = new AuthClient('http://zero.test', { authorizationRevalidationIntervalMs: 0 }); clients.add(auth); return auth; }
function mock(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init ?? {})) as typeof fetch;
}
test('profile completion stays anonymous and uses private bodies, then continues real tenant binding without app success', async () => {
  const required = profileCompletionResult(), requests: Array<{ url: string; init: RequestInit }> = [];
  mock((url, init) => {
    requests.push({ url, init });
    if (url.endsWith('/auth/login')) return Response.json(required);
    if (url.endsWith('/inspect')) return Response.json(required.profileCompletion);
    if (url.endsWith('/auth/profile/completion')) return Response.json({ user: completionUser(), tenantSelectionRequired: true,
      tenantSelection: { continuation: 'tenant-proof', expiresAt: 10000, tenants: [{ tenantId: 'org', kind: 'organization', slug: 'org', name: 'Organization', role: 'member' }] } });
    return Response.json({ error: 'Unavailable' }, { status: 503 });
  });
  const auth = client(); await auth.login('person', 'password');
  expect(auth.isAuthenticated).toBe(false); expect(auth.accessToken).toBeNull(); expect(auth.hasRecoverableSession).toBe(false);
  expect(auth.authenticationContinuation).toMatchObject({ profileCompletionRequired: true });
  expect((await auth.profileCompletion.inspect(required.profileCompletion.continuation)).missingFields).toEqual(['firstName']);
  const result = await auth.profileCompletion.complete({ continuation: required.profileCompletion.continuation, expectedRevision: 1, changes: { firstName: 'Ada' } });
  expect(result).toMatchObject({ tenantSelectionRequired: true }); expect(auth.isAuthenticated).toBe(false);
  expect(auth.authenticationContinuation).toMatchObject({ tenantSelectionRequired: true });
  for (const request of requests.filter(request => request.url.includes('/profile/completion'))) {
    expect(new Headers(request.init.headers).get('Authorization')).toBeNull();
    expect(request.init.credentials).toBe('include'); expect(request.url).not.toContain(required.profileCompletion.continuation);
  }
});
test('same completion deduplicates, a different concurrent intent rejects, and genuine accepted session alone installs credentials', async () => {
  const required = profileCompletionResult(); let resolve!: (response: Response) => void, dispatched = 0;
  let markDispatched!: () => void;
  const admitted = new Promise<void>(done => { markDispatched = done; });
  mock(url => {
    if (url.endsWith('/auth/login')) return Response.json(required);
    if (url.endsWith('/auth/profile/completion')) {
      dispatched++; markDispatched(); return new Promise<Response>(done => { resolve = done; });
    }
    return Response.json({ error: 'Unavailable' }, { status: 503 });
  });
  const auth = client(); await auth.login('person', 'password');
  const input = { continuation: required.profileCompletion.continuation, expectedRevision: 1, changes: { firstName: 'Ada' } };
  const first = auth.profileCompletion.complete(input), duplicate = auth.profileCompletion.complete(input);
  expect(first).toBe(duplicate); await expect(auth.profileCompletion.complete({ ...input, expectedRevision: 2 })).rejects.toMatchObject({ code: 'AUTH_PROFILE_COMPLETION_IN_PROGRESS' });
  await admitted;
  expect(dispatched).toBe(1);
  resolve(Response.json({ user: { ...completionUser(), firstName: 'Ada' }, accessToken: 'accepted-access', refreshToken: 'accepted-refresh' }));
  expect(await first).toMatchObject({ accessToken: 'accepted-access' });
  expect(auth.isAuthenticated).toBe(true); expect(auth.user?.firstName).toBe('Ada'); expect(auth.authenticationContinuation).toBeNull();
});
test('current rejected CAS keeps the restricted continuation available for explicit inspect and retry', async () => {
  const required = profileCompletionResult();
  mock(url => {
    if (url.endsWith('/auth/login')) return Response.json(required);
    if (url.endsWith('/inspect')) return Response.json(required.profileCompletion);
    return Response.json({ error: 'Profile changed', code: 'AUTH_PROFILE_REVISION_CONFLICT' }, { status: 409 });
  });
  const auth = client(); await auth.login('person', 'password');
  await expect(auth.profileCompletion.complete({ continuation: required.profileCompletion.continuation,
    expectedRevision: 1, changes: { firstName: 'Ada' } })).rejects.toMatchObject({ status: 409, code: 'AUTH_PROFILE_REVISION_CONFLICT' });
  expect(auth.authenticationContinuation).toMatchObject({ profileCompletionRequired: true, user: { userId: 'user-a' } });
  expect(auth.error).toBeNull(); expect(auth.isAuthenticated).toBe(false);
  expect((await auth.profileCompletion.inspect(required.profileCompletion.continuation)).missingFields).toEqual(['firstName']);
});
test('replacement anonymous continuation rejects late inspect bytes and late completion without overwriting its identity or error', async () => {
  for (const operation of ['inspect', 'complete'] as const) {
    const a = profileCompletionResult(), b = profileCompletionResult('user-b'); let resolve!: (response: Response) => void;
    let markDispatched!: () => void;
    const admitted = new Promise<void>(done => { markDispatched = done; });
    mock((url, init) => {
      if (url.endsWith('/auth/login')) return Response.json(JSON.parse(String(init.body)).username === 'b' ? b : a);
      if (url.includes('/profile/completion')) {
        markDispatched(); return new Promise<Response>(done => { resolve = done; });
      }
      return Response.json({ error: 'Unavailable' }, { status: 503 });
    });
    const auth = client(); await auth.login('a', 'password');
    const pending = operation === 'inspect' ? auth.profileCompletion.inspect(a.profileCompletion.continuation)
      : auth.profileCompletion.complete({ continuation: a.profileCompletion.continuation, expectedRevision: 1, changes: { firstName: 'Ada' } });
    const rejected = pending.then(
      () => { throw new Error('A replaced profile request unexpectedly succeeded'); },
      cause => cause,
    );
    await admitted;
    await auth.login('b', 'password');
    resolve(Response.json(operation === 'inspect' ? a.profileCompletion : { user: completionUser(), accessToken: 'stale-a', refreshToken: 'stale-a-refresh' }));
    expect(await rejected).toMatchObject({ name: 'AbortError' });
    expect(auth.authenticationContinuation?.user.userId).toBe('user-b'); expect(auth.accessToken).toBeNull(); expect(auth.error).toBeNull();
  }
});

/** A scope-only owner isolates finite HTTP reads from the already-qualified AuthClient completion writer. */
function boundedCompletion(timeoutMs: number) {
  const required = profileCompletionResult(), lifetime = new AbortController();
  let retained: AuthCompletionResult = required, accepted = 0, disposed = 0;
  const transport = new AuthUserProfileCompletionTransport({ baseUrl: 'http://zero.test', requestTimeoutMs: timeoutMs,
    beginAuthentication: () => ({ signal: lifetime.signal, assertCurrent: () => lifetime.signal.throwIfAborted(), dispose: () => { disposed++; } }),
    readContinuation: () => retained,
    completeAuthentication: async result => { accepted++; retained = result; return result; },
  });
  return { required, get retained() { return retained; }, get accepted() { return accepted; }, get disposed() { return disposed; },
    start(operation: 'inspect' | 'complete', signal?: AbortSignal) {
      return operation === 'inspect' ? transport.inspect(required.profileCompletion.continuation, signal)
        : transport.complete({ continuation: required.profileCompletion.continuation, expectedRevision: 1, changes: { firstName: 'Retained draft' } }, signal);
    },
    replace() { retained = profileCompletionResult('user-b'); lifetime.abort(new DOMException('Replaced authentication attempt', 'AbortError')); },
  };
}
function heldCompletionResponse(phase: 'headers' | 'body') {
  if (phase === 'headers') {
    let resolve!: (response: Response) => void;
    return { response: new Promise<Response>(yes => { resolve = yes; }), reading: null,
      finish: (body: unknown) => resolve(Response.json(body)) };
  }
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
  const response = new Response(body, { headers: { 'Content-Type': 'application/json' } }), json = response.json.bind(response);
  let started!: () => void; const reading = new Promise<void>(yes => { started = yes; });
  response.json = () => { started(); return json(); };
  return { response, reading,
    finish(value: unknown) { controller.enqueue(new TextEncoder().encode(JSON.stringify(value))); controller.close(); } };
}
function completionSuccess(operation: 'inspect' | 'complete') {
  return operation === 'inspect' ? profileCompletionResult().profileCompletion
    : { user: completionUser(), accessToken: 'acknowledged-access', refreshToken: 'acknowledged-refresh' };
}

for (const operation of ['inspect', 'complete'] as const) for (const phase of ['headers', 'body'] as const) {
  test(`profile ${operation} bounds held ${phase}, retains restricted proof/draft, and admits only explicit retry`, async () => {
    const flow = boundedCompletion(5), held = heldCompletionResponse(phase), signals: AbortSignal[] = [], acceptedBody = completionSuccess(operation);
    let dispatched = 0;
    mock((_url, init) => { signals.push(init.signal as AbortSignal); return ++dispatched === 1 ? held.response : Response.json(acceptedBody); });
    await expect(flow.start(operation)).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(signals[0]?.aborted).toBe(true); expect(flow.accepted).toBe(0); expect(flow.disposed).toBe(1);
    expect(flow.retained).toBe(flow.required); expect('accessToken' in flow.retained).toBe(false);
    expect(flow.required.profileCompletion.profile?.values.firstName).toBeNull();
    expect(dispatched).toBe(1); // Never silently replay an ambiguous mutation.
    expect(await flow.start(operation)).toMatchObject(acceptedBody);
    expect(flow.accepted).toBe(operation === 'complete' ? 1 : 0); expect(dispatched).toBe(2);
    expect(flow.disposed).toBe(2);
    const retained = flow.retained;
    held.finish(completionSuccess(operation)); await Bun.sleep(0);
    expect(flow.retained).toBe(retained); expect(flow.accepted).toBe(operation === 'complete' ? 1 : 0);
  });

  for (const retirement of ['caller cancellation', 'replacement'] as const) {
    test(`profile ${operation} aborts held ${phase} on ${retirement} without waiting for its deadline`, async () => {
      const flow = boundedCompletion(10_000), held = heldCompletionResponse(phase), caller = new AbortController();
      let dispatched!: () => void, requestSignal: AbortSignal | undefined;
      const dispatch = new Promise<void>(yes => { dispatched = yes; });
      mock((_url, init) => { requestSignal = init.signal as AbortSignal; dispatched(); return held.response; });
      const pending = flow.start(operation, caller.signal); await dispatch; if (held.reading) await held.reading;
      if (retirement === 'replacement') flow.replace(); else caller.abort();
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      expect(requestSignal!.aborted).toBe(true); expect(flow.accepted).toBe(0); expect(flow.disposed).toBe(1);
      expect(flow.retained.user.userId).toBe(retirement === 'replacement' ? 'user-b' : 'user-a');
      held.finish(completionSuccess(operation)); await Bun.sleep(0);
      expect(flow.accepted).toBe(0); expect(flow.retained.user.userId).toBe(retirement === 'replacement' ? 'user-b' : 'user-a');
    }, 5000);
  }
}

test('already-aborted profile completion dispatches no request and retains the restricted proof', async () => {
  const flow = boundedCompletion(5), caller = new AbortController(); let requests = 0;
  mock(() => { requests++; return Response.json(completionSuccess('complete')); }); caller.abort();
  await expect(flow.start('complete', caller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(requests).toBe(0); expect(flow.accepted).toBe(0); expect(flow.retained).toBe(flow.required); expect(flow.disposed).toBe(1);
});
