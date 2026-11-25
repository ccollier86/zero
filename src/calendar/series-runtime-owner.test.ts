/** Real Guardian + SYSTEM participant MEMORY policies with a controlled executor
 * that invokes the supplied final callback at its simulated commit edge. This
 * is NOT actor transport/physical commit qualification. No generated fixtures. */
import { expect, spyOn, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { stableStringify } from '../migrations/schema-snapshot';
import { defineAuthTables } from '../auth/auth-schema';
import { installAuthAuthorityRevision } from '../auth/auth-authority-revision';
import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import { createAuthorizationKernel } from '../auth/authorization-kernel';
import { UserStore } from '../auth/user-store';
import { serviceDataScopeKey } from '../auth/service-data-scope';
import type { DatabaseSerializableValue } from '../databases/database-operations';
import { admitCalendarRequest } from './authority';
import { ManagedCalendarParticipantDirectory } from './participants-directory';
import { memoryCalendarServiceFixture } from './test-support/memory-service-fixture';
import { calendarHash, calendarJson } from './validation';
import { calendarRecurrenceTraversal } from './recurrence-engine';
import { normalizeCalendarTimedSeriesAuthoring } from './series-authoring';
import { captureCalendarSeriesCompilationSource, inspectCalendarSeriesCompilationSource } from './series-compilation';
import { compileCalendarInitialSeriesRequest, prepareCalendarInitialSeriesRequest, inspectCalendarInitialSeriesRequest } from './series-source-writer';
import { createCalendarSeriesNativeTransport, calendarSeriesNativeSemanticDigest } from './series-native-transport';
import { createCalendarSeriesNativeOwner, type CalendarSeriesNativeOwnerDependencies } from './series-runtime-owner';
import type { CalendarOwnerRecord } from './owner-schema';
import { CalendarError } from './error';

async function fixture() {
  const base = memoryCalendarServiceFixture({ tenancy: 'single', config: { participants: { userEligibility: 'user' } } });
  let directory: ManagedCalendarParticipantDirectory | undefined;
  let transport: ReturnType<typeof createCalendarSeriesNativeTransport> | undefined;
  let facade: ReturnType<typeof createCalendarSeriesNativeOwner> | undefined;
  try {
    const browser = base.session('real-fixture-human', { manager: true });
    const resource = await browser.api.resources.create({ label: 'PRIVATE_RESOURCE', kind: 'person', timeZone: 'UTC' }, { idempotencyKey: 'resource' });
    const authority = await admitCalendarRequest(browser.authority, base.config, new AbortController().signal);
    const owner = base.system.prepare('SELECT * FROM _calendar_owners WHERE scope_id=?').get(authority.actor.scopeId) as CalendarOwnerRecord;
    defineAuthTables(base.system); installAuthAuthorityRevision(base.system);
    base.system.prepare("INSERT INTO users(user_id,username,email,role,status,created_at) VALUES('target','target','target@example.test','user','active',1)").run();
    const users = new UserStore(base.system, { tenancyMode: 'single' }), kernel = createAuthorizationKernel(resolveAuthBehaviorConfig({ tenancy: 'single' }));
    directory = new ManagedCalendarParticipantDirectory({ db: base.system, users, tenancy: null, kernel, roles: null, config: base.config, assertCurrent: () => users.assertCurrentProfile() });
    const policyGeneration = calendarHash('native-owner-policy'), lifetime = new AbortController();
    transport = createCalendarSeriesNativeTransport({ rootHash: owner.root_hash, realmFingerprint: owner.realm_fingerprint, policyGeneration });
    const authoring = normalizeCalendarTimedSeriesAuthoring({ kind: 'timed-series-v1', recurrence: {
      kind: 'timed-local-v1', localStart: '2030-01-01T10:00:00.000', timeZone: 'UTC', fold: 'earlier', durationMilliseconds: 3_600_000,
      rule: { frequency: 'daily', interval: 1, end: { kind: 'after', count: 3 } },
    }, template: { resourceIds: [resource.id], title: 'PRIVATE_SERIES', bufferBeforeMinutes: 0, bufferAfterMinutes: 0,
      appointmentType: null, visit: null, participants: [{ kind: 'guardian-user', userId: 'target' }] } }, { maxResources: 16, maxParticipants: 100 });
    const source = captureCalendarSeriesCompilationSource({ kind: 'calendar-series-source-snapshot-v1', scopeId: owner.scope_id, ownerId: owner.owner_id,
      rootHash: owner.root_hash, realmFingerprint: owner.realm_fingerprint, sourceId: 'native-source', seriesId: 'native-series', segmentId: 'logical-segment',
      segmentRecordId: 'segment-row', generationId: 'generation', sourceGeneration: 1, controlRevision: 1, exceptionRevision: 0,
      preparationId: 'preparation', basePublicationId: null, planManifestDigest: calendarHash('source-plan'), preparationExpiresAtMs: Date.now() + 60_000,
      intentDigest: calendarHash('source-intent'), authoringDigest: calendarHash(authoring), engineGeneration: calendarHash(calendarRecurrenceTraversal(authoring.recurrence).engine),
      policyGeneration, authoring, grant: { grantId: 'grant', grantEpoch: 1, authorityDigest: calendarHash('authority'), resourceDigest: calendarHash([resource.id]) },
      resourceRevisions: [{ id: resource.id, revision: 1 }] }, { maxResources: 16, maxParticipants: 100 });
    const calls: { kind: string; name: string; input: DatabaseSerializableValue; requestId?: string }[] = [];
    let physical = true, policy = true, finalChecks = 0, committed = false;
    let beforeFinal: (() => void) | undefined, afterFinal: (() => void) | undefined, afterRead: (() => void) | undefined;
    let queryResult: unknown = { status: 'unknown' }, receiptResult: unknown = { status: 'unknown' }, initialReceipt: unknown = null, initialDigest: string | undefined, commandResult: unknown = { status: 'accepted' };
    const dependencies: CalendarSeriesNativeOwnerDependencies = { owner, transport, signal: lifetime.signal, participants: directory,
      assertOwnerCurrent(selected) { if (!physical || calendarJson(selected) !== calendarJson(owner)) throw new CalendarError('CALENDAR_STATE_INVALID'); },
      assertSeriesPolicyCurrent(scope, generation) { if (!policy || serviceDataScopeKey(scope) !== owner.scope_id || generation !== policyGeneration) throw new CalendarError('CALENDAR_FORBIDDEN'); },
      async execute<T>(...args: Parameters<CalendarSeriesNativeOwnerDependencies['execute']>): Promise<T> {
        const [kind, name, input, options] = args;
        calls.push({ kind, name, input, requestId: options.requestId }); options.guard(); await Promise.resolve(); options.guard();
        if (kind === 'query') {
          afterRead?.();
          if (name === 'calendar.series.initialReceipt' && initialDigest !== undefined && (input as any).request.digest !== initialDigest) throw new CalendarError('CALENDAR_INTENT_CONFLICT');
          return (name === 'calendar.series.initialReceipt' ? initialReceipt : name === 'calendar.series.run.receipt' ? receiptResult : queryResult) as T;
        }
        beforeFinal?.(); options.signal.throwIfAborted(); options.guard();
        if (!options.finalCommitGuard) throw new Error('Owned native commands require their real final callback');
        finalChecks++; options.finalCommitGuard(); committed = true; afterFinal?.(); return commandResult as T;
      },
    };
    facade = createCalendarSeriesNativeOwner(dependencies);
    const packet = () => transport!.sealSource(source, 'calendar.series.run.begin', 'begin', { runId: 'run' });
    const initial = () => { const request = prepareCalendarInitialSeriesRequest(authority, 'initial', authoring, base.config); return { request, compiled: compileCalendarInitialSeriesRequest(request) }; };
    return { base, browser, authority, owner, directory, users, lifetime, dependencies, facade, transport, source, authoring, calls, packet, initial,
      before(callback: () => void) { beforeFinal = callback; }, after(callback: () => void) { afterFinal = callback; }, afterRead(callback: () => void) { afterRead = callback; },
      physical(value: boolean) { physical = value; }, policy(value: boolean) { policy = value; }, query(value: unknown) { queryResult = value; }, result(value: unknown) { commandResult = value; },
      initialReceipt(value: unknown, digest?: string) { initialReceipt = value; initialDigest = digest; },
      receipt(value: unknown) { receiptResult = value; },
      committed: () => committed, finalChecks: () => finalChecks,
      async close() { facade?.close(); transport?.close(); directory?.close(); await base.close(); } };
  } catch (error) { facade?.close(); transport?.close(); directory?.close(); await base.close(); throw error; }
}

test('fixed owner read routes inject trusted scope/owner, cannot accept authored identities or arbitrary query names', async () => {
  const f = await fixture();
  try {
    expect(serviceDataScopeKey(f.facade.scope)).toBe(f.owner.scope_id); expect(f.facade).not.toHaveProperty('actor'); expect(Object.isFrozen(f.facade)).toBe(true);
    await f.facade.read('calendar.series.run', { seriesId: 'series', runId: 'run' });
    expect(f.calls[0]).toMatchObject({ kind: 'query', name: 'calendar.series.run', input: { seriesId: 'series', runId: 'run', scopeId: f.owner.scope_id, ownerId: f.owner.owner_id } });
    await f.facade.read('calendar.series.run.receipt', { seriesId: 'series', runId: 'run', phase: 'batch', logicalKey: 'original-key' });
    for (const input of [{ seriesId: 'series', runId: 'run', scopeId: 'tenant:attack' }, { seriesId: 'series', runId: 'run', ownerId: 'attack' },
      { seriesId: 'series', runId: 'run', actor: {} }, { seriesId: 'series', runId: 'bad id' }])
      await expect(f.facade.read('calendar.series.run', input)).rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
    await expect(f.facade.read('calendar.resources' as never, {})).rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
    expect(f.calls).toHaveLength(2); f.policy(false);
    await expect(f.facade.read('calendar.series.run', { seriesId: 'series', runId: 'run' })).resolves.toEqual({ status: 'unknown' });
  } finally { await f.close(); }
});

test('locally verified native run packets retain fresh policy and actual SYSTEM participant final checks', async () => {
  const f = await fixture();
  try {
    const packet = f.packet(); expect(await f.facade.command<{ status: string }>(packet)).toEqual({ status: 'accepted' });
    expect(f.finalChecks()).toBe(1); expect(f.committed()).toBe(true); expect(f.calls.find(call => call.kind === 'command')?.requestId).toBe(packet.transportKey);
    const before = f.calls.filter(call => call.kind === 'command').length;
    await expect(f.facade.command({ ...packet })).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
    await expect(f.facade.command({ ...packet, envelope: { ...packet.envelope, signature: 'a'.repeat(64) } })).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
    await expect(f.facade.command({ ...packet, transportKey: 'changed-transport-routing' })).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
    await expect(f.facade.command({ ...packet, envelope: { ...packet.envelope, source: { ...packet.envelope.source, ownerId: 'another-owner' } } })).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
    const initial = f.initial(); const initialPacket = f.transport.sealInitial(initial.request, initial.compiled, f.owner, 60_000);
    await expect(f.facade.command(initialPacket as never)).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' }); expect(f.calls.filter(call => call.kind === 'command')).toHaveLength(before);
  } finally { await f.close(); }
});

test('native publication preparation reconciles its canonical batch receipt phase, while final publication uses publish', async () => {
  const f = await fixture();
  try {
    for (const [name, phase] of [['calendar.series.run.seal', 'batch'], ['calendar.series.run.publish', 'publish']] as const) {
      const packet = f.transport.sealSource(f.source, name, name + '-original', { runId: 'run', expectedRevision: 1 });
      await expect(f.facade.command<{ status: string }>(packet)).resolves.toEqual({ status: 'accepted' });
      const read = f.calls.filter(call => call.name === 'calendar.series.run.receipt').at(-1)!;
      expect(read.input).toMatchObject({ phase, logicalKey: packet.envelope.logicalKey });
    }
  } finally { await f.close(); }
});

test('fresh native work fences its retained engine proof both after executor waits and after final SYSTEM target checks', async () => {
  for (const change of ['after-wait', 'after-targets'] as const) {
    const f = await fixture(), descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Temporal');
    let facade = f.facade;
    try {
      const packet = f.packet(), replace = () => Object.defineProperty(globalThis, 'Temporal', { configurable: true, get() { throw new Error('replaced engine before commit'); } });
      if (change === 'after-wait') f.before(replace);
      else facade = createCalendarSeriesNativeOwner({ ...f.dependencies, participants: { assertBindable(scope, refs) { f.directory.assertBindable(scope, refs); replace(); } } });
      await expect(facade.command(packet)).rejects.toMatchObject({ code: 'CALENDAR_TIME_RULES_UNAVAILABLE' }); expect(f.committed()).toBe(false);
    } finally { if (descriptor) Object.defineProperty(globalThis, 'Temporal', descriptor); else Reflect.deleteProperty(globalThis, 'Temporal'); if (facade !== f.facade) facade.close(); await f.close(); }
  }
});

test('target suspension after executor wait is a proven final refusal, while later target change cannot revoke an accepted receipt', async () => {
  const before = await fixture();
  try {
    const packet = before.packet(); before.before(() => before.base.system.prepare("UPDATE users SET status='disabled' WHERE user_id='target'").run());
    await expect(before.facade.command(packet)).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' }); expect(before.committed()).toBe(false);
  } finally { await before.close(); }
  const after = await fixture();
  try {
    after.after(() => after.base.system.prepare("UPDATE users SET status='disabled' WHERE user_id='target'").run());
    await expect(after.facade.command<{ status: string }>(after.packet())).resolves.toEqual({ status: 'accepted' }); expect(after.committed()).toBe(true);
  } finally { await after.close(); }
});

test('initial acceptance requires actual admitted human handles and retains the real human guard through final commit and late acknowledgement', async () => {
  const f = await fixture();
  try {
    const initial = f.initial(); f.before(() => f.browser.revoke());
    // The controlled executor preserves the REAL Guardian's AuthError. The
    // actual DatabaseCommitAuthority adapter additionally translates its proven
    // pre-commit refusal; neither path is an unknown accepted operation.
    await expect(f.facade.acceptInitial(f.authority, initial.request, initial.compiled, 60_000)).rejects.toBeInstanceOf(Error);
    expect(f.committed()).toBe(false);
  } finally { await f.close(); }
  const late = await fixture();
  try {
    const initial = late.initial(); late.after(() => late.browser.revoke());
    await expect(late.facade.acceptInitial(late.authority, initial.request, initial.compiled, 60_000)).rejects.toMatchObject({ code: 'CALENDAR_OUTCOME_UNKNOWN', outcome: 'unknown' });
    expect(late.committed()).toBe(true);
  } finally { await late.close(); }
});

test('initial source route uses branded proofs and real final SYSTEM/engine checks without a background actor', async () => {
  const f = await fixture(); const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Temporal');
  try {
    const initial = f.initial();
    await expect(f.facade.acceptInitial(f.authority, {} as never, initial.compiled, 60_000)).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
    expect(f.calls).toHaveLength(0);
    f.before(() => Object.defineProperty(globalThis, 'Temporal', { configurable: true, get() { throw new Error('replaced engine at final commit'); } }));
    await expect(f.facade.acceptInitial(f.authority, initial.request, initial.compiled, 60_000)).rejects.toMatchObject({ code: 'CALENDAR_TIME_RULES_UNAVAILABLE' });
    expect(f.committed()).toBe(false); expect(f.calls.at(-1)?.name).toBe('calendar.series.source.accept');
    expect((f.calls.at(-1)?.input as any).payload.frame.request.userId).toBe(f.authority.actor.userId);
    expect((f.calls.at(-1)?.input as any).payload.frame).not.toHaveProperty('actor');
  } finally { if (descriptor) Object.defineProperty(globalThis, 'Temporal', descriptor); else Reflect.deleteProperty(globalThis, 'Temporal'); await f.close(); }
});

test('original initial receipt reconciliation precedes unavailable engine, retired policy/targets and any new write while retaining current human authority', async () => {
  const f = await fixture(), descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Temporal');
  try {
    const initial = f.initial(), facts = inspectCalendarInitialSeriesRequest(initial.request);
    const changed = prepareCalendarInitialSeriesRequest(f.authority, facts.requestId, { ...f.authoring, template: { ...f.authoring.template, title: 'changed-intent' } }, f.base.config);
    const accepted = { operation: 'series.plan.accepted', requestId: facts.requestId, seriesId: facts.seriesId, controlRevision: 1,
      preparationId: calendarHash(['calendar.series.preparation.v1', facts.scopeId, facts.seriesId, 1]), basePublicationId: null } as const;
    f.initialReceipt({ acceptance: accepted, state: 'preparing', blockedCode: null, publication: null }, facts.digest);
    f.policy(false); f.directory.close(); Object.defineProperty(globalThis, 'Temporal', { configurable: true, get() { throw new Error('historical reconciliation cannot compile'); } });
    await expect(f.facade.acceptInitial(f.authority, initial.request, undefined, 60_000)).resolves.toEqual(accepted);
    expect(f.calls.map(call => call.name)).toEqual(['calendar.series.initialReceipt']); expect(f.finalChecks()).toBe(0); expect(f.committed()).toBe(false);
    expect((f.calls[0]?.input as any).actor).toEqual(f.authority.actor); expect((f.calls[0]?.input as any).request.digest).toBe(facts.digest);
    await expect(f.facade.acceptInitial(f.authority, changed, undefined, 60_000)).rejects.toMatchObject({ code: 'CALENDAR_INTENT_CONFLICT' });
    f.browser.revoke(); const before = f.calls.length;
    await expect(f.facade.acceptInitial(f.authority, initial.request, undefined, 60_000)).rejects.toBeInstanceOf(Error); expect(f.calls).toHaveLength(before);
  } finally { if (descriptor) Object.defineProperty(globalThis, 'Temporal', descriptor); else Reflect.deleteProperty(globalThis, 'Temporal'); await f.close(); }
});

test('late native policy/owner change makes command acknowledgement unknown but read guard failure stays an ordinary refusal', async () => {
  const work = await fixture();
  try {
    work.after(() => work.policy(false)); await expect(work.facade.command(work.packet())).rejects.toMatchObject({ code: 'CALENDAR_OUTCOME_UNKNOWN' });
  } finally { await work.close(); }
  const read = await fixture();
  try {
    read.afterRead(() => read.physical(false));
    await expect(read.facade.read('calendar.series.run', { seriesId: 'series', runId: 'run' })).rejects.toMatchObject({ code: 'CALENDAR_STATE_INVALID' });
  } finally { await read.close(); }
});

test('native retirement uses the exact retained owner-read binding after policy, engine, participant and preparation retirement', async () => {
  const f = await fixture(), descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Temporal');
  try {
    const retained = { ...inspectCalendarSeriesCompilationSource(f.source), preparationExpiresAtMs: 1, policyGeneration: calendarHash('retired-policy') };
    f.query({ status: 'known', run: { id: 'run', scope_id: f.owner.scope_id, series_id: retained.seriesId, owner_id: f.owner.owner_id, source_id: retained.sourceId,
      source_binding_json: calendarJson(retained) }, state: { id: 'run', scope_id: f.owner.scope_id, revision: 7 } });
    f.policy(false); f.directory.close(); Object.defineProperty(globalThis, 'Temporal', { configurable: true, get() { throw new Error('retired engine must not be read'); } });
    await expect(f.facade.retire({ seriesId: retained.seriesId, runId: 'run', logicalKey: 'original-abort', expectedRevision: 7, limit: 32 })).resolves.toEqual({ status: 'accepted' });
    expect(f.calls.map(call => call.name)).toEqual(['calendar.series.run', 'calendar.series.run.receipt', 'calendar.series.run.abort']);
    const packet = f.calls[2]?.input as any; expect(packet.source.policyGeneration).toBe(retained.policyGeneration); expect(packet.logicalKey).toBe('original-abort');
    expect(packet.payload).toEqual({ runId: 'run', expectedRevision: 7, limit: 32 });
    const semantic = calendarSeriesNativeSemanticDigest(packet);
    f.query({ status: 'known', run: { id: 'run', scope_id: f.owner.scope_id, series_id: retained.seriesId, owner_id: f.owner.owner_id, source_id: retained.sourceId,
      source_binding_json: calendarJson(retained) }, state: { id: 'run', scope_id: f.owner.scope_id, revision: 8 } });
    f.receipt({ status: 'accepted', receipt: { id: 'original-abort-receipt', scope_id: f.owner.scope_id, run_id: 'run', phase: 'reconcile', logical_key: 'original-abort',
      candidate_digest: semantic, revision: 8, after_digest: calendarHash('aborted-progress'), projection_after_digest: calendarHash('aborted-projection') } });
    await expect(f.facade.retire({ seriesId: retained.seriesId, runId: 'run', logicalKey: 'original-abort', expectedRevision: 7, limit: 32 })).resolves.toMatchObject({
      kind: 'calendar-series-native-receipt-v1', revision: 8, receiptId: 'original-abort-receipt', semanticDigest: semantic });
    expect(f.calls.filter(call => call.kind === 'command')).toHaveLength(1);
    f.receipt({ status: 'unknown' });
    await expect(f.facade.retire({ seriesId: retained.seriesId, runId: 'run', logicalKey: 'cleanup-published', expectedRevision: 8, limit: 32, cleanupOnly: true })).resolves.toEqual({ status: 'accepted' });
    expect((f.calls.at(-1)?.input as any).payload).toEqual({ runId: 'run', expectedRevision: 8, limit: 32, cleanupOnly: true });
    await expect(f.facade.retire({ seriesId: retained.seriesId, runId: 'run', logicalKey: 'invalid-cleanup', expectedRevision: 8, cleanupOnly: 'yes' as never })).rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
  } finally { if (descriptor) Object.defineProperty(globalThis, 'Temporal', descriptor); else Reflect.deleteProperty(globalThis, 'Temporal'); await f.close(); }
});

test('accepted native original receipts survive key/clock/policy/target/engine retirement without treating unknown or changed intents as authority', async () => {
  const f = await fixture(), descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Temporal');
  const rotated = createCalendarSeriesNativeTransport({ rootHash: f.owner.root_hash, realmFingerprint: f.owner.realm_fingerprint, policyGeneration: f.transport.writerPolicy.policyGeneration });
  const owned = createCalendarSeriesNativeOwner({ ...f.dependencies, transport: rotated });
  const packet = f.packet(), semantic = calendarSeriesNativeSemanticDigest(packet.envelope), clock = spyOn(Date, 'now').mockReturnValue(packet.envelope.expiresAtMs + 1);
  try {
    const receipt = { id: calendarHash('original-native-receipt'), scope_id: f.owner.scope_id, run_id: 'run', phase: 'batch', logical_key: 'begin',
      candidate_digest: semantic, revision: 4, after_digest: calendarHash('compiled-progress'), projection_after_digest: calendarHash('projected-progress') };
    f.receipt({ status: 'accepted', receipt }); f.policy(false); f.directory.close();
    Object.defineProperty(globalThis, 'Temporal', { configurable: true, get() { throw new Error('historical native replay cannot compile'); } });
    await expect(owned.command({ ...packet })).resolves.toEqual({ kind: 'calendar-series-native-receipt-v1', operation: packet.envelope.command, runId: 'run',
      receiptId: receipt.id, revision: 4, progressDigest: receipt.after_digest, projectionDigest: receipt.projection_after_digest, semanticDigest: semantic });
    expect(f.calls.every(call => call.kind === 'query')).toBe(true); expect(f.finalChecks()).toBe(0);
    const payload = { runId: 'run', changedIntent: true }, payloadDigest = createHash('sha256').update('zero.calendar.native-transport-v1\0payload\0').update(stableStringify(payload)).digest('hex');
    await expect(owned.command({ ...packet, envelope: { ...packet.envelope, payload, payloadDigest } })).rejects.toMatchObject({ code: 'CALENDAR_INTENT_CONFLICT' });
    f.receipt({ status: 'unknown' });
    await expect(owned.command(packet)).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
    expect(f.calls.every(call => call.kind === 'query')).toBe(true);
  } finally { clock.mockRestore(); if (descriptor) Object.defineProperty(globalThis, 'Temporal', descriptor); else Reflect.deleteProperty(globalThis, 'Temporal'); owned.close(); rotated.close(); await f.close(); }
});

test('closing a fixed owner cancels its owned operations without closing a shared signer; post-commit closure is unknown', async () => {
  const f = await fixture();
  try {
    const packet = f.packet(); f.facade.close(); expect(f.facade.signal.aborted).toBe(true);
    await expect(f.facade.command(packet)).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.packet().envelope.command).toBe('calendar.series.run.begin');
  } finally { await f.close(); }
  const late = await fixture();
  try {
    const packet = late.packet(); late.after(() => late.facade.close());
    await expect(late.facade.command(packet)).rejects.toMatchObject({ code: 'CALENDAR_OUTCOME_UNKNOWN' });
  } finally { await late.close(); }
});
