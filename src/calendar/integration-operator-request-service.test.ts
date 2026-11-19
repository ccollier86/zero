/** Facade qualification only: real Guardian admission from the MEMORY Calendar fixture,
 * with an explicitly simulated Map broker/compiler/acceptance callback. No source
 * transaction, audit, native controller, Jobs, actor process or physical file is tested.
 */
import { expect, test } from 'bun:test';
import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import { createRequestAuthorizationAccess } from '../auth/authorization-access';
import { createAuthorizationKernel } from '../auth/authorization-kernel';
import { serviceDataScopeKey, type ServiceDataScope } from '../auth/service-data-scope';
import type { CalendarAuthority } from './authority';
import type { CalendarActor } from './contracts';
import { CalendarError } from './error';
import type { CalendarIntegrationPolicySelection } from './integration-controller';
import type { CalendarIntegrationPolicySpec } from './integration-model';
import { calendarIntegrationOperatorRequestIntent, calendarOperatorRequestId, type CalendarIntegrationOperatorAction,
  type CalendarIntegrationOperatorRequestReceipt } from './integration-operator-request-model';
import { calendarIntegrationOperatorRequestsForAuthority, type CalendarIntegrationOperatorRequestBroker,
  type CalendarIntegrationOperatorRequestOptions, type CalendarIntegrationOperatorRequestServiceOptions } from './integration-operator-request-service';
import { memoryCalendarServiceFixture } from './test-support/memory-service-fixture';
import { calendarHash, calendarRecord, calendarValue } from './validation';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(accept => { resolve = accept; });
  return { promise, resolve };
}
async function capture<T>(task: Promise<T>) {
  try { return { ok: true as const, value: await task }; }
  catch (error) { return { ok: false as const, error }; }
}
type Hook = () => void | Promise<void>;
interface Submitted {
  readonly actor: CalendarActor; readonly requestId: string; readonly action: CalendarIntegrationOperatorAction;
  readonly ruleId: string; readonly expected: CalendarIntegrationPolicySelection; readonly desired?: CalendarIntegrationPolicySpec;
}
function fixedPolicy(scope: ServiceDataScope, ruleId = 'observe', version = 'A'): CalendarIntegrationPolicySpec {
  return { ruleId, ruleVersion: version, adapter: 'observation-v1', dueOffsetMs: -60_000, maxLatenessMs: 60_000,
    source: { identity: { domain: 'calendar.synthetic-operator', databaseId: 'calendar:' + calendarHash(serviceDataScopeKey(scope)),
      ownerId: 'synthetic-private-owner', rootHash: '1'.repeat(64), scopeId: serviceDataScopeKey(scope) },
      realmFingerprint: 'sha256:' + '2'.repeat(64), policyVersion: 'fixed-native-' + version, semanticsVersion: 'calendar-observation-v1',
      definition: { name: 'zero.calendar.observation', version: '1', fingerprint: '3'.repeat(64) },
      workflow: { name: 'zero.calendar.observation.v1', version: 1, definitionId: 'PRIVATE_NATIVE_GRAPH',
        versionId: 'PRIVATE_NATIVE_GRAPH_VERSION', fingerprint: '4'.repeat(64) } } };
}
function selection(scope: ServiceDataScope, ruleId = 'observe', epoch = 1): CalendarIntegrationPolicySelection {
  return { id: calendarHash([serviceDataScopeKey(scope), ruleId, epoch]), epoch, policyDigest: 'a'.repeat(64) };
}

function fixture(tenancy: 'single' | 'multi' = 'multi') {
  const guardian = memoryCalendarServiceFixture({ tenancy }), closing = new AbortController();
  const stored = new Map<string, { digest: string; receipt: CalendarIntegrationOperatorRequestReceipt }>();
  const reads: Array<{ scope: ServiceDataScope; actor: CalendarActor; key: string; signal?: AbortSignal }> = [];
  const commands: Array<{ scope: ServiceDataScope; body: Submitted; signal?: AbortSignal }> = [];
  const compiled: Array<{ scope: ServiceDataScope; ruleId: string }> = [];
  const hooks: { beforeRead?: Hook; afterRead?: Hook; beforeAccept?: Hook; beforeCommit?: Hook; afterCommit?: Hook; afterAccepted?: Hook } = {};
  const nativeState = { version: 'A', running: true, configured: true, available: true, compilerAvailable: true, pointerEpoch: 1 };
  let accepts = 0, commits = 0, inspections = 0;
  const key = (scope: ServiceDataScope, actor: CalendarActor, requestId: string) =>
    calendarOperatorRequestId(serviceDataScopeKey(scope), actor.principal, requestId);
  const broker: CalendarIntegrationOperatorRequestBroker = {
    async integrationOperatorReceipt(scope, input, guard, signal) {
      guard(); signal?.throwIfAborted(); reads.push({ scope, actor: input.actor, key: input.requestId, signal });
      await hooks.beforeRead?.(); guard(); signal?.throwIfAborted();
      const result = stored.get(key(scope, input.actor, input.requestId))?.receipt ?? null;
      // Intentionally no post-hook authority check: the facade must fence the
      // completed private read itself, not rely on this simulated broker to do it.
      await hooks.afterRead?.(); return result;
    },
    async integrationOperatorRequest(scope, input, guard, signal, finalCommitGuard) {
      guard(); signal?.throwIfAborted();
      const body = calendarRecord(calendarValue(input)) as unknown as Submitted;
      commands.push({ scope, body, signal });
      await hooks.beforeCommit?.(); guard(); signal?.throwIfAborted(); finalCommitGuard?.();
      const identity = key(scope, body.actor, body.requestId), intent = calendarIntegrationOperatorRequestIntent(bodyIntent(body));
      const prior = stored.get(identity);
      if (prior) {
        if (prior.digest !== intent.digest) throw new CalendarError('CALENDAR_INTENT_CONFLICT');
        return prior.receipt;
      }
      // Explicitly simulated source selection, solely so moving it makes any
      // accidental acceptance replay observable. This is not real realm CAS.
      if (nativeState.pointerEpoch !== body.expected.epoch) throw new CalendarError('CALENDAR_POLICY_STALE');
      const policy = body.action === 'retire' ? body.expected : { id: calendarHash([serviceDataScopeKey(scope), body.ruleId, body.expected.epoch + 1]),
        epoch: body.expected.epoch + 1, policyDigest: calendarHash(body.desired) };
      const receipt: CalendarIntegrationOperatorRequestReceipt = Object.freeze({ requestId: body.requestId, action: body.action,
        ruleId: body.ruleId, expected: Object.freeze({ ...body.expected }), policy: Object.freeze({ ...policy }),
        localState: body.action === 'retire' ? 'retired' : 'activating', changed: true, acceptedAtMs: 1_900_000_000_000 });
      stored.set(identity, { digest: intent.digest, receipt }); nativeState.pointerEpoch = policy.epoch; commits++;
      // Simulates a writer whose accepted result waits after commit. No source
      // authority or physical non-commit claim is derived from this callback.
      await hooks.afterCommit?.(); return receipt;
    },
  };
  const options: CalendarIntegrationOperatorRequestServiceOptions = {
    broker,
    native: {
      async inspect() { inspections++; if (!nativeState.available) throw new CalendarError('CALENDAR_NOT_READY'); return null; },
      reactivationPolicy(scope, ruleId) {
        compiled.push({ scope, ruleId });
        if (!nativeState.available || !nativeState.running || !nativeState.configured || !nativeState.compilerAvailable) throw new CalendarError('CALENDAR_NOT_READY');
        return fixedPolicy(scope, ruleId, nativeState.version);
      },
    },
    async accept(authority, operation) {
      accepts++; await hooks.beforeAccept?.(); authority.guard(); const result = await operation(); await hooks.afterAccepted?.(); return result;
    },
  };
  return { ...guardian, closing, stored, reads, commands, compiled, hooks, nativeState, options,
    facade(request: CalendarAuthority, config = guardian.config) {
      return calendarIntegrationOperatorRequestsForAuthority(request, config, closing.signal, options);
    },
    counts: () => ({ accepts, commits, inspections, reads: reads.length, commands: commands.length, compiled: compiled.length }),
    async close() { closing.abort(); await guardian.close(); },
  };
}
function bodyIntent(body: Submitted) { return { action: body.action, ruleId: body.ruleId, expected: body.expected }; }

test('private facade admits only current web-session managers and rejects ordinary, API-key, native and anonymous callers before broker work', async () => {
  const f = fixture('single');
  try {
    const manager = f.session('manager', { manager: true }), ordinary = f.session('ordinary');
    const kernel = createAuthorizationKernel(resolveAuthBehaviorConfig({ tenancy: 'single' }));
    // Obtain canonical scopes from valid web managers first. The fixture's
    // own service-scope admission correctly refuses API keys before a facade
    // exists; here Calendar must re-conceal an already admitted key itself.
    const apiManager = f.session('api-manager', { manager: true }), nativeManager = f.session('native-manager', { manager: true });
    const apiAccess = createRequestAuthorizationAccess({ kernel,
      authContext: { ...apiManager.authority.access.requireUser(), credentialKind: 'api-key', credentialId: 'synthetic-operator-key' } });
    apiAccess.authorize({ user: 'required', credentials: ['api-key'] }); expect(apiAccess.requireUser().credentialKind).toBe('api-key');
    const api: CalendarAuthority = { ...apiManager.authority, access: apiAccess };
    const native: CalendarAuthority = { ...nativeManager.authority, access: createRequestAuthorizationAccess({ kernel,
      authContext: { ...nativeManager.authority.access.requireUser(), sessionKind: 'native', scope: ['profile', 'profile:write'] } }) };
    const anonymous: CalendarAuthority = { access: createRequestAuthorizationAccess({ kernel, authContext: null }), scope: manager.scope,
      assertCurrentAuthoritySync() {}, async assertCurrentAuthority() {} };
    for (const request of [ordinary.authority, api, native, anonymous]) {
      const view = f.facade(request), input = { idempotencyKey: 'denied', expected: selection(manager.scope) };
      for (const task of [() => view.retire('observe', input), () => view.reactivate('observe', input), () => view.requests.get('denied'), () => view.inspect()]) {
        await expect(task()).rejects.toBeInstanceOf(Error);
      }
    }
    expect(apiAccess.context).toBeNull();
    expect(f.counts()).toEqual({ accepts: 0, commits: 0, inspections: 0, reads: 0, commands: 0, compiled: 0 });
    const view = f.facade(manager.authority);
    expect(Object.isFrozen(view)).toBe(true); expect(Object.isFrozen(view.requests)).toBe(true);
    expect(Object.keys(view).sort()).toEqual(['inspect', 'reactivate', 'requests', 'retire']);
    expect(Object.keys(view.requests)).toEqual(['get']);
    await expect(view.retire('observe', { idempotencyKey: 'manager-retire', expected: selection(manager.scope) })).resolves.toMatchObject({ localState: 'retired' });
    expect(f.stats()).toMatchObject({ planes: 0, ownerRows: 0, acquisitions: 0, activeLeases: 0 });
  } finally { await f.close(); }
});

test('request methods and receipt reads reject authored routing, callbacks, accessors and invalid signals before any broker operation', async () => {
  const f = fixture();
  try {
    const manager = f.session('manager', { manager: true }), view = f.facade(manager.authority), expected = selection(manager.scope);
    let getters = 0;
    const accessor = Object.defineProperty({}, 'expected', { enumerable: true, get() { getters++; throw new Error('Authored getter must not run.'); } });
    const selectedAccessor = Object.defineProperty({}, 'id', { enumerable: true, get() { getters++; throw new Error('Authored selection getter must not run.'); } });
    const valid = { idempotencyKey: 'strict', expected };
    for (const input of [null, [], true, 1, 'invalid', accessor, {}, { ...valid, expected: selectedAccessor }, { ...valid, expected: { ...expected, ownerId: 'forged' } },
      { ...valid, signal: {} }, { ...valid, signal: null }, { ...valid, actor: {} }, { ...valid, scope: manager.scope },
      { ...valid, scopeId: 'application' }, { ...valid, expectedOwnerId: 'forged' }, { ...valid, requestId: 'forged' },
      { ...valid, desired: fixedPolicy(manager.scope) }, { ...valid, action: 'retire' }, { ...valid, assertCurrent() {} },
      { ...valid, async confirmCurrent() {} }]) {
      await expect(view.retire('observe', input as never)).rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
      await expect(view.reactivate('observe', input as never)).rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
    }
    for (const input of [null, [], { scope: manager.scope }, { actor: {} }, { signal: {} }, { signal: null }, { assertCurrent() {} }]) {
      await expect(view.requests.get('strict', input as never)).rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
    }
    expect(getters).toBe(0); expect(f.counts()).toEqual({ accepts: 0, commits: 0, inspections: 0, reads: 0, commands: 0, compiled: 0 });
    const cancelled = new AbortController(); cancelled.abort(new Error('pre-aborted-request'));
    await expect(view.retire('observe', { ...valid, signal: cancelled.signal })).rejects.toThrow('pre-aborted-request');
    await expect(view.requests.get('strict', { signal: cancelled.signal })).rejects.toThrow('pre-aborted-request');
    expect(f.reads).toHaveLength(0);
  } finally { await f.close(); }
});

test('authored request options and selected policy are detached before the first admission/read wait', async () => {
  const f = fixture(), entered = deferred(), release = deferred(); let pending: ReturnType<typeof capture> | undefined;
  try {
    const manager = f.session('manager', { manager: true }), view = f.facade(manager.authority), expected = selection(manager.scope);
    const original = { ...expected }, firstSignal = new AbortController(), replacement = new AbortController();
    const input: CalendarIntegrationOperatorRequestOptions = { idempotencyKey: 'original-key', expected, signal: firstSignal.signal };
    f.hooks.beforeRead = async () => { entered.resolve(); await release.promise; };
    pending = capture(view.retire('observe', input)); await entered.promise;
    Object.assign(input, { idempotencyKey: 'changed-key', signal: replacement.signal });
    Object.assign(expected, { id: 'b'.repeat(64), epoch: 99, policyDigest: 'c'.repeat(64) }); replacement.abort(); release.resolve();
    const result = await pending; expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toMatchObject({ requestId: 'original-key', expected: original });
    expect(f.reads[0]!.key).toBe('original-key'); expect(f.commands[0]!.body.expected).toEqual(original);
    expect(f.commands[0]!.signal!.aborted).toBe(false); expect(f.compiled).toEqual([]);
  } finally { release.resolve(); await pending; await f.close(); }
});

test('retirement never compiles or calls a native control and fresh reactivation supplies only the fixed native policy with a final recompilation fence', async () => {
  const f = fixture();
  try {
    const manager = f.session('manager', { manager: true }), view = f.facade(manager.authority), expected = selection(manager.scope);
    const retired = await view.retire('observe', { idempotencyKey: 'retire', expected });
    expect(retired.localState).toBe('retired'); expect(f.compiled).toEqual([]); expect(f.counts().inspections).toBe(0);
    const prepared = await view.reactivate('observe', { idempotencyKey: 'reactivate', expected });
    expect(prepared).toMatchObject({ action: 'reactivate', localState: 'activating', policy: { epoch: expected.epoch + 1 } });
    expect(prepared).not.toHaveProperty('downstream'); expect(prepared).not.toHaveProperty('safeToDisable');
    expect(f.compiled).toEqual([{ scope: manager.scope, ruleId: 'observe' }, { scope: manager.scope, ruleId: 'observe' }]);
    expect(f.commands[1]!.body.desired).toEqual(fixedPolicy(manager.scope));
    expect(f.commands[1]!.body.actor).toMatchObject({ userId: 'manager', scopeId: serviceDataScopeKey(manager.scope), manageAll: true });
    expect(f.counts()).toEqual({ accepts: 2, commits: 2, inspections: 0, reads: 2, commands: 2, compiled: 2 });
  } finally { await f.close(); }
});

test('a changed fixed policy or native availability at the final writer fence prevents simulated acceptance', async () => {
  for (const change of ['policy', 'running', 'configured', 'compiler'] as const) {
    const f = fixture();
    try {
      const manager = f.session('manager', { manager: true }), view = f.facade(manager.authority);
      f.hooks.beforeCommit = () => {
        if (change === 'policy') f.nativeState.version = 'B';
        else if (change === 'running') f.nativeState.running = false;
        else if (change === 'configured') f.nativeState.configured = false;
        else f.nativeState.compilerAvailable = false;
      };
      await expect(view.reactivate('observe', { idempotencyKey: 'fenced-' + change, expected: selection(manager.scope) }))
        .rejects.toMatchObject({ code: change === 'policy' ? 'CALENDAR_POLICY_STALE' : 'CALENDAR_NOT_READY', outcome: 'not-started' });
      expect(f.compiled).toHaveLength(2); expect(f.commands).toHaveLength(1); expect(f.stored.size).toBe(0); expect(f.counts().commits).toBe(0);
    } finally { await f.close(); }
  }
});

test('exact accepted replay ignores later pointers, configured policy, graph/compiler and native availability without any acceptance callback or command', async () => {
  const f = fixture();
  try {
    const manager = f.session('manager', { manager: true }), view = f.facade(manager.authority), expected = selection(manager.scope);
    const input = { idempotencyKey: 'original-reactivation', expected };
    const original = await view.reactivate('observe', input), before = f.counts();
    f.nativeState.pointerEpoch = 40; f.nativeState.version = 'B'; f.nativeState.running = false;
    f.nativeState.configured = false; f.nativeState.compilerAvailable = false; f.nativeState.available = false;
    f.hooks.beforeAccept = () => { throw new Error('Replay entered native acceptance.'); };
    expect(await view.reactivate('observe', input)).toBe(original);
    expect(await view.requests.get(input.idempotencyKey)).toBe(original);
    expect(f.counts()).toEqual({ ...before, reads: before.reads + 2 });
    expect(original.localState).toBe('activating'); expect(original.policy.epoch).toBe(2);
  } finally { await f.close(); }
});

test('one actor request key cannot be replayed with changed action, rule or expected selection even when native state is unavailable', async () => {
  const f = fixture();
  try {
    const manager = f.session('manager', { manager: true }), view = f.facade(manager.authority), expected = selection(manager.scope);
    await view.retire('observe', { idempotencyKey: 'one-intent', expected });
    const before = f.counts(); f.nativeState.available = false;
    for (const task of [() => view.reactivate('observe', { idempotencyKey: 'one-intent', expected }),
      () => view.retire('another-rule', { idempotencyKey: 'one-intent', expected }),
      () => view.retire('observe', { idempotencyKey: 'one-intent', expected: { ...expected, policyDigest: 'f'.repeat(64) } }),
      () => view.retire('observe', { idempotencyKey: 'one-intent', expected: { ...expected, epoch: 2 } }),
      () => view.retire('observe', { idempotencyKey: 'one-intent', expected: { ...expected, id: 'e'.repeat(64) } })]) {
      await expect(task()).rejects.toMatchObject({ code: 'CALENDAR_INTENT_CONFLICT' });
    }
    expect(f.counts()).toEqual({ ...before, reads: before.reads + 5 });
  } finally { await f.close(); }
});

test('simulated receipts are scoped to the real admitted actor and tenant, and every replay/read still requires current management', async () => {
  const f = fixture();
  try {
    const manager = f.session('manager', { manager: true }), view = f.facade(manager.authority), input = { idempotencyKey: 'private-key', expected: selection(manager.scope) };
    const accepted = await view.retire('observe', input);
    const another = f.session('another-manager', { manager: true }), otherScope = f.session('manager', { manager: true, tenantId: 'tenant-b' });
    expect(await f.facade(another.authority).requests.get(input.idempotencyKey)).toBeNull();
    expect(await f.facade(otherScope.authority).requests.get(input.idempotencyKey)).toBeNull();
    const renewed = f.session('manager', { manager: true });
    expect(await f.facade(renewed.authority).requests.get(input.idempotencyKey)).toBe(accepted);
    const demoted = f.session('manager'), before = f.counts();
    await expect(f.facade(demoted.authority).retire('observe', input)).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
    await expect(f.facade(demoted.authority).requests.get(input.idempotencyKey)).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
    await expect(f.facade(renewed.authority, { ...f.config, manage: false }).retire('observe', input)).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
    manager.revoke(); await expect(view.retire('observe', input)).rejects.toBeInstanceOf(Error);
    await expect(view.requests.get(input.idempotencyKey)).rejects.toBeInstanceOf(Error); expect(f.counts()).toEqual(before);
  } finally { await f.close(); }
});

test('revocation or scope replacement during receipt preflight prevents both acceptance callbacks and source commands', async () => {
  for (const replace of ['revoke', 'scope'] as const) {
    const f = fixture();
    try {
      const manager = f.session('manager', { manager: true });
      f.hooks.afterRead = () => { if (replace === 'revoke') manager.revoke(); else manager.replaceScope('tenant-b'); };
      await expect(f.facade(manager.authority).reactivate('observe', { idempotencyKey: 'read-race', expected: selection(manager.scope) })).rejects.toBeInstanceOf(Error);
      expect(f.counts()).toEqual({ accepts: 0, commits: 0, inspections: 0, reads: 1, commands: 0, compiled: 0 });
    } finally { await f.close(); }
  }
});

test('the source final guard refuses authority replacement after preflight and before simulated commit', async () => {
  for (const replace of ['revoke', 'scope'] as const) {
    const f = fixture();
    try {
      const manager = f.session('manager', { manager: true });
      f.hooks.beforeCommit = () => { if (replace === 'revoke') manager.revoke(); else manager.replaceScope('tenant-b'); };
      await expect(f.facade(manager.authority).retire('observe', { idempotencyKey: 'commit-race', expected: selection(manager.scope) })).rejects.toBeInstanceOf(Error);
      expect(f.counts()).toEqual({ accepts: 1, commits: 0, inspections: 0, reads: 1, commands: 1, compiled: 0 }); expect(f.stored.size).toBe(0);
    } finally { await f.close(); }
  }
});

test('authority replacement after an acceptance callback preserves the original receipt and reports unknown, never a fresh rejection', async () => {
  for (const replace of ['revoke', 'scope', 'callback-error'] as const) {
    const f = fixture();
    try {
      const manager = f.session('manager', { manager: true }), input = { idempotencyKey: 'accepted-race', expected: selection(manager.scope) };
      f.hooks.afterAccepted = () => {
        if (replace === 'revoke') manager.revoke(); else if (replace === 'scope') manager.replaceScope('tenant-b');
        else throw new Error('Simulated acceptance callback failed after the broker returned.');
      };
      await expect(f.facade(manager.authority).retire('observe', input)).rejects.toMatchObject({ code: 'CALENDAR_OUTCOME_UNKNOWN', outcome: 'unknown' });
      expect(f.counts().commits).toBe(1); expect(f.stored.size).toBe(1);
      const current = f.session('manager', { manager: true }), before = f.counts(); f.hooks.afterAccepted = undefined;
      expect(await f.facade(current.authority).requests.get(input.idempotencyKey)).toMatchObject({ requestId: input.idempotencyKey, localState: 'retired' });
      expect(await f.facade(current.authority).retire('observe', input)).toMatchObject({ requestId: input.idempotencyKey, localState: 'retired' });
      expect(f.counts()).toEqual({ ...before, reads: before.reads + 2 });
    } finally { await f.close(); }
  }
});

test('late caller, request and owner aborts cannot relabel a simulated accepted write as not-started or expose its late result', async () => {
  for (const aborted of ['caller', 'request', 'closing'] as const) {
    const f = fixture(), entered = deferred(), release = deferred(), supplied = new AbortController(), requestStop = new AbortController();
    let pending: ReturnType<typeof capture> | undefined;
    try {
      const manager = f.session('manager', { manager: true }), request: CalendarAuthority = { ...manager.authority, signal: requestStop.signal };
      const view = f.facade(request), input = { idempotencyKey: 'late-abort', expected: selection(manager.scope), signal: supplied.signal };
      f.hooks.afterCommit = async () => { entered.resolve(); await release.promise; };
      pending = capture(view.retire('observe', input)); await entered.promise;
      ({ caller: supplied, request: requestStop, closing: f.closing })[aborted].abort(new Error('Simulated late ' + aborted + ' abort.'));
      expect(f.commands[0]!.signal!.aborted).toBe(true); expect(f.stored.size).toBe(1); release.resolve();
      const result = await pending; expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatchObject({ code: 'CALENDAR_OUTCOME_UNKNOWN', outcome: 'unknown' });
      expect(f.counts()).toEqual({ accepts: 1, commits: 1, inspections: 0, reads: 1, commands: 1, compiled: 0 });
    } finally { release.resolve(); await pending; supplied.abort(); requestStop.abort(); await f.close(); }
  }
});

test('unknown broker outcomes are not weakened by rapid null receipt reads or turned into automatic acceptance retries', async () => {
  const f = fixture();
  try {
    const manager = f.session('manager', { manager: true }), view = f.facade(manager.authority);
    f.hooks.beforeCommit = () => { throw new CalendarError('CALENDAR_OUTCOME_UNKNOWN'); };
    await expect(view.retire('observe', { idempotencyKey: 'uncertain', expected: selection(manager.scope) }))
      .rejects.toMatchObject({ code: 'CALENDAR_OUTCOME_UNKNOWN', outcome: 'unknown' });
    const before = f.counts();
    expect(await view.requests.get('uncertain')).toBeNull(); expect(await view.requests.get('uncertain')).toBeNull();
    expect(f.counts()).toEqual({ ...before, reads: before.reads + 2 }); expect(f.stored.size).toBe(0);
    // The fake contains no physical settlement barrier. Its null reads prove
    // only what this facade returned, not that an actual writer could not commit.
  } finally { await f.close(); }
});

test('accepted-receipt replay fences the outer await before returning a private result', async () => {
  const f = fixture();
  try {
    const manager = f.session('manager', { manager: true }), input = { idempotencyKey: 'outer-replay', expected: selection(manager.scope) };
    await f.facade(manager.authority).retire('observe', input);
    let confirmations = 0, finalGuards = 0, retired = false;
    const request: CalendarAuthority = { ...manager.authority,
      async assertCurrentAuthority() { await manager.authority.assertCurrentAuthority(); confirmations++; },
      assertCurrentAuthoritySync() {
        manager.authority.assertCurrentAuthoritySync();
        // Confirmation has its own post-wait guard; the receipt helper has
        // another. Retire before the OUTER submit continuation can publish it.
        if (confirmations >= 2 && ++finalGuards === 2) queueMicrotask(() => { retired = true; manager.revoke(); });
      },
    };
    const before = f.counts();
    await expect(f.facade(request).retire('observe', input)).rejects.toBeInstanceOf(Error);
    expect(retired).toBe(true); expect(f.stored.size).toBe(1);
    expect(f.counts()).toEqual({ ...before, reads: before.reads + 1 });
  } finally { await f.close(); }
});
