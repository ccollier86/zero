/** Private fixed native owner. No fabricated CalendarActor, retained browser
 * session for background work, public query surface or SQL capability exists.
 * execute MUST install finalCommitGuard under real DatabaseCommitAuthority with
 * configured actorAuthorityContext; tests of this helper alone do not prove it. */
import { invokeSynchronousAuthCallback } from '../auth/auth-synchronous-callback';
import { createHash } from 'node:crypto';
import { serviceDataScopeKey, trustedSystemServiceDataScope, type ServiceDataScope } from '../auth/service-data-scope';
import { cloneDatabaseSerializableValue, type DatabaseSerializableValue } from '../databases/database-operations';
import type { CalendarRequestAuthority } from './authority';
import type { CalendarOwnerRecord } from './owner-schema';
import type { CalendarParticipantDirectory } from './participants-directory';
import type { CalendarParticipantReference } from './contracts';
import type { CalendarSeriesCompilationBinding } from './series-compilation';
import { inspectCalendarInitialSeriesCompilation, inspectCalendarInitialSeriesRequest, type CalendarInitialSeriesRequest, type CalendarInitialSeriesCompilation,
  type CalendarSeriesPlanAcceptance } from './series-source-writer';
import { verifyCalendarInitialSeriesNativeEnvelope, verifyCalendarSeriesNativeEnvelope, inspectCalendarSeriesNativeReplayIntent, calendarSeriesNativeSemanticDigest,
  type CalendarSeriesNativePacket, type CalendarSeriesNativeTransport, type CalendarSeriesNativeOperation } from './series-native-transport';
import { CalendarError } from './error';
import { calendarHash, calendarInteger, calendarJson, calendarKey, calendarRecord, calendarScope, calendarValue } from './validation';
import { calendarSeriesNativeProfile, type CalendarSeriesNativeProfile } from './series-native-profile';

export type CalendarSeriesNativeRead = 'calendar.series.run' | 'calendar.series.run.receipt';
export interface CalendarSeriesNativeOwnerDependencies {
  readonly profile?: CalendarSeriesNativeProfile;
  readonly owner: CalendarOwnerRecord;
  readonly transport: CalendarSeriesNativeTransport;
  readonly signal: AbortSignal;
  readonly participants?: Pick<CalendarParticipantDirectory, 'assertBindable'>;
  assertOwnerCurrent(owner: CalendarOwnerRecord): void;
  assertSeriesPolicyCurrent(scope: ServiceDataScope, policyGeneration: string): void;
  execute<T>(kind: 'query' | 'command', name: string, input: DatabaseSerializableValue, options: {
    readonly requestId?: string; readonly guard: () => void; readonly finalCommitGuard?: () => void; readonly signal: AbortSignal;
  }): Promise<T>;
}
export interface CalendarSeriesNativeOwner {
  /** Closed package profile; omitted only by older internal test adapters. */
  readonly profile?: CalendarSeriesNativeProfile;
  readonly owner: CalendarOwnerRecord;
  readonly scope: ServiceDataScope;
  readonly signal: AbortSignal;
  assertCurrent(): void;
  read<T>(name: CalendarSeriesNativeRead, input: unknown): Promise<T>;
  /** Only a locally verified run packet; initial-human source packets MUST use
   * acceptInitial, which retains the actual real human final guard. */
  command<T>(packet: CalendarSeriesNativePacket): Promise<T>;
  acceptInitial(authority: CalendarRequestAuthority, request: CalendarInitialSeriesRequest,
    compiled: CalendarInitialSeriesCompilation | undefined, preparationTtlMs: number): Promise<CalendarSeriesPlanAcceptance>;
  /** Retained owner-read source binding, not a live engine/compiler or caller
   * authored source. Original logical receipt identity survives retirement. */
  retire<T>(input: { readonly seriesId: string; readonly runId: string; readonly logicalKey: string;
    readonly expectedRevision: number; readonly limit?: number; readonly cleanupOnly?: boolean }): Promise<T>;
  /** Retire only this owner facade, not a signer shared by other managed owners. */
  close(): void;
}
const READS = new Set(['calendar.series.run', 'calendar.series.run.receipt']);
const COMMANDS = new Set(['calendar.series.run.begin', 'calendar.series.run.stage', 'calendar.series.run.abort', 'calendar.series.run.seal', 'calendar.series.run.publish']);
function forbidden(): never { throw new CalendarError('CALENDAR_FORBIDDEN'); }
function invalid(): never { throw new CalendarError('CALENDAR_INPUT_INVALID'); }
function notReady(): never { throw new CalendarError('CALENDAR_NOT_READY'); }
function hash(value: unknown): string { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) return notReady(); return value; }
function synchronous(run: () => unknown): void {
  const result = invokeSynchronousAuthCallback(run, { component: 'calendar-series', invariant: 'native-series-owner-guard-is-synchronous', message: 'Calendar series owner guards must not yield.' });
  if (result !== undefined) return forbidden();
}

export function createCalendarSeriesNativeOwner(dependencies: CalendarSeriesNativeOwnerDependencies): CalendarSeriesNativeOwner {
  const profile = calendarSeriesNativeProfile(dependencies.profile).id as CalendarSeriesNativeProfile;
  const r = calendarRecord(calendarValue(dependencies.owner), ['id', 'scope_id', 'owner_id', 'root_hash', 'realm_fingerprint', 'established']);
  const scopeId = calendarScope(r.scope_id), owner: CalendarOwnerRecord = Object.freeze({ id: calendarKey(r.id), scope_id: scopeId, owner_id: calendarKey(r.owner_id),
    root_hash: String(r.root_hash), realm_fingerprint: String(r.realm_fingerprint), established: 1 });
  const transport = dependencies.transport, selected = transport.writerPolicy;
  if (r.established !== 1 || owner.id !== 'calendar:' + calendarHash(scopeId) || !/^[a-f0-9]{64}$/.test(owner.root_hash)
    || !/^sha256:[a-f0-9]{64}$/.test(owner.realm_fingerprint) || selected.rootHash !== owner.root_hash || selected.realmFingerprint !== owner.realm_fingerprint
    || !(dependencies.signal instanceof AbortSignal)) return notReady();
  const scope = trustedSystemServiceDataScope(scopeId === 'application' ? { scopeKind: 'application' } : { scopeKind: 'tenant', tenantId: scopeId.slice(7) });
  if (serviceDataScopeKey(scope) !== scopeId) return notReady();
  const stop = new AbortController(), signal = AbortSignal.any([dependencies.signal, stop.signal]);
  const checkOwner = dependencies.assertOwnerCurrent.bind(dependencies), checkPolicy = dependencies.assertSeriesPolicyCurrent.bind(dependencies), execute = dependencies.execute.bind(dependencies);
  const directory = dependencies.participants, targetMethod = directory?.assertBindable, targets = targetMethod?.bind(directory);
  const current = () => { signal.throwIfAborted(); synchronous(() => checkOwner(owner)); signal.throwIfAborted(); };
  const policy = (generation: string) => { current(); synchronous(() => checkPolicy(scope, generation)); current(); };
  const targetGuard = (refs: readonly CalendarParticipantReference[]) => {
    if (!refs.length) return;
    if (dependencies.participants !== directory || directory?.assertBindable !== targetMethod) throw new CalendarError('CALENDAR_POLICY_STALE');
    if (!targets) return notReady(); synchronous(() => targets(scope, refs));
  };
  const binding = (source: Pick<CalendarSeriesCompilationBinding, 'scopeId' | 'ownerId' | 'rootHash' | 'realmFingerprint'>) => {
    if (source.scopeId !== scopeId || source.ownerId !== owner.owner_id || source.rootHash !== owner.root_hash || source.realmFingerprint !== owner.realm_fingerprint) return forbidden();
  };
  const read = async <T>(name: CalendarSeriesNativeRead, input: unknown): Promise<T> => {
    current(); if (!READS.has(name)) return invalid();
    const body = calendarRecord(cloneDatabaseSerializableValue(input), name === 'calendar.series.run' ? ['seriesId', 'runId'] : ['seriesId', 'runId', 'phase', 'logicalKey']);
    const source = { seriesId: calendarKey(body.seriesId), runId: calendarKey(body.runId), scopeId, ownerId: owner.owner_id,
      ...(name === 'calendar.series.run.receipt' ? { phase: body.phase, logicalKey: calendarKey(body.logicalKey) } : {}) };
    if (name === 'calendar.series.run.receipt' && !['batch', 'publish', 'reconcile'].includes(String(body.phase))) return invalid();
    const result = await execute<T>('query', name, cloneDatabaseSerializableValue(source), { guard: current, signal }); current(); return result;
  };
  const command = async <T>(packet: CalendarSeriesNativePacket): Promise<T> => {
    current();
    const originalPacket = packet;
    const body = calendarRecord(cloneDatabaseSerializableValue(packet), ['envelope', 'transportKey']), raw = calendarRecord(body.envelope);
    if (typeof raw.command !== 'string' || !COMMANDS.has(raw.command)) return forbidden();
    // Original receipt reconciliation is read-only. Shape/payload equality is
    // not fresh signature admission; a missing receipt MUST still verify the
    // current runtime key, deadline and every actual-COMMIT fence below.
    const intent = inspectCalendarSeriesNativeReplayIntent(raw); binding(intent.source);
    const payload = calendarRecord(intent.payload), runId = calendarKey(payload.runId);
    const phase = intent.command === 'calendar.series.run.abort' ? 'reconcile'
      : intent.command === 'calendar.series.run.publish' ? 'publish' : 'batch';
    const transportKey = 'calendar-series:' + createHash('sha256').update(intent.keyId).update('\0').update(intent.command).update('\0')
      .update(intent.logicalKey).update('\0').update(intent.signature).digest('hex');
    if (body.transportKey !== transportKey) return forbidden();
    const observed = calendarRecord(cloneDatabaseSerializableValue(await read('calendar.series.run.receipt', {
      seriesId: intent.source.seriesId, runId, phase, logicalKey: intent.logicalKey,
    })));
    if (observed.status === 'accepted') {
      const receipt = calendarRecord(observed.receipt), semantic = calendarSeriesNativeSemanticDigest(intent);
      if (receipt.scope_id !== scopeId || receipt.run_id !== runId || receipt.phase !== phase || receipt.logical_key !== intent.logicalKey) return notReady();
      if (receipt.candidate_digest !== semantic) throw new CalendarError('CALENDAR_INTENT_CONFLICT');
      current();
      return Object.freeze({ kind: 'calendar-series-native-receipt-v1', operation: intent.command, runId, receiptId: calendarKey(receipt.id),
        revision: calendarInteger(receipt.revision, 1), progressDigest: hash(receipt.after_digest), projectionDigest: hash(receipt.projection_after_digest), semanticDigest: semantic }) as T;
    }
    if (observed.status !== 'unknown') return notReady();
    const envelope = verifyCalendarSeriesNativeEnvelope(selected as unknown as DatabaseSerializableValue, raw, raw.command as CalendarSeriesNativeOperation);
    const retired = envelope.command === 'calendar.series.run.abort', guard = retired ? current : () => policy(envelope.source.policyGeneration);
    const finalCommitGuard = () => {
      guard(); transport.assertPacketCurrent(originalPacket);
      if (!retired) targetGuard(envelope.source.selections.participants);
      transport.assertPacketCurrent(originalPacket); guard();
    };
    guard(); transport.assertPacketCurrent(originalPacket);
    const result = await execute<T>('command', envelope.command, envelope as unknown as DatabaseSerializableValue,
      { requestId: transportKey, guard, finalCommitGuard, signal });
    try { guard(); } catch { throw new CalendarError('CALENDAR_OUTCOME_UNKNOWN'); }
    return result;
  };
  const acceptInitial = async (authority: CalendarRequestAuthority, request: CalendarInitialSeriesRequest,
    compiled: CalendarInitialSeriesCompilation | undefined, preparationTtlMs: number): Promise<CalendarSeriesPlanAcceptance> => {
    current();
    if (!(authority.signal instanceof AbortSignal)) return forbidden();
    synchronous(authority.guard.bind(authority));
    const facts = inspectCalendarInitialSeriesRequest(request), actor = authority.actor;
    if (serviceDataScopeKey(authority.scope) !== scopeId || !actor.manageAll
      || actor.scopeId !== facts.scopeId || actor.scopeId !== scopeId || actor.principal !== facts.principal || actor.userId !== facts.userId) return forbidden();
    const operationSignal = AbortSignal.any([signal, authority.signal]), checkHuman = authority.guard.bind(authority);
    const human = () => {
      operationSignal.throwIfAborted(); synchronous(checkHuman);
      if (authority.actor !== actor || serviceDataScopeKey(authority.scope) !== scopeId || !actor.manageAll || actor.principal !== facts.principal || actor.userId !== facts.userId) return forbidden();
      operationSignal.throwIfAborted();
    };
    const historyGuard = () => { current(); human(); current(); };
    historyGuard();
    const prior = await execute<unknown>('query', 'calendar.series.initialReceipt', cloneDatabaseSerializableValue({ actor, ownerId: owner.owner_id, request: facts }),
      { guard: historyGuard, signal: operationSignal });
    historyGuard();
    if (prior !== null) {
      const found = calendarRecord(cloneDatabaseSerializableValue(prior)), accepted = calendarRecord(found.acceptance,
        ['operation', 'requestId', 'seriesId', 'controlRevision', 'preparationId', 'basePublicationId']);
      if (accepted.operation !== 'series.plan.accepted' || accepted.requestId !== facts.requestId || accepted.seriesId !== facts.seriesId
        || accepted.controlRevision !== 1 || accepted.preparationId !== calendarHash(['calendar.series.preparation.v1', scopeId, facts.seriesId, 1]) || accepted.basePublicationId !== null) return notReady();
      return Object.freeze({ operation: 'series.plan.accepted', requestId: facts.requestId, seriesId: facts.seriesId, controlRevision: 1,
        preparationId: String(accepted.preparationId), basePublicationId: null });
    }
    if (!compiled) return forbidden();
    const frame = inspectCalendarInitialSeriesCompilation(request, compiled);
    const guard = () => { current(); human(); policy(selected.policyGeneration); human(); };
    guard();
    const packet = transport.sealInitial(request, compiled, owner, preparationTtlMs);
    const envelope = verifyCalendarInitialSeriesNativeEnvelope(selected as unknown as DatabaseSerializableValue, packet.envelope);
    binding(envelope.source);
    const finalCommitGuard = () => {
      guard(); inspectCalendarInitialSeriesCompilation(request, compiled);
      targetGuard(frame.request.authoring.template.participants);
      inspectCalendarInitialSeriesCompilation(request, compiled); guard();
    };
    guard();
    const result = await execute<CalendarSeriesPlanAcceptance>('command', 'calendar.series.source.accept', envelope as unknown as DatabaseSerializableValue,
      { requestId: packet.transportKey, guard, finalCommitGuard, signal: operationSignal });
    try { guard(); } catch { throw new CalendarError('CALENDAR_OUTCOME_UNKNOWN'); }
    return result;
  };
  const retire = async <T>(input: { readonly seriesId: string; readonly runId: string; readonly logicalKey: string;
    readonly expectedRevision: number; readonly limit?: number; readonly cleanupOnly?: boolean }): Promise<T> => {
    current(); const r = calendarRecord(cloneDatabaseSerializableValue(input), ['seriesId', 'runId', 'logicalKey', 'expectedRevision', 'limit', 'cleanupOnly']);
    if (r.cleanupOnly !== undefined && typeof r.cleanupOnly !== 'boolean') return invalid();
    const seriesId = calendarKey(r.seriesId), runId = calendarKey(r.runId), logicalKey = calendarKey(r.logicalKey), limit = calendarInteger(r.limit ?? 128, 1, 128);
    const observed = calendarRecord(cloneDatabaseSerializableValue(await read('calendar.series.run', { seriesId, runId })));
    if (observed.status !== 'known') throw new CalendarError('CALENDAR_NOT_FOUND');
    const run = calendarRecord(observed.run), state = calendarRecord(observed.state), revision = calendarInteger(r.expectedRevision, 1);
    if (run.id !== runId || run.scope_id !== scopeId || run.series_id !== seriesId || run.owner_id !== owner.owner_id || state.id !== runId || state.scope_id !== scopeId) return forbidden();
    calendarInteger(state.revision, 1);
    // Retain the original CAS descriptor even if a lost acknowledgement already
    // advanced the head. command() reconciles its accepted original receipt
    // first; an unknown operation still encounters the actor's current CAS.
    let retained: CalendarSeriesCompilationBinding;
    try {
      if (typeof run.source_binding_json !== 'string') return notReady();
      retained = cloneDatabaseSerializableValue(JSON.parse(run.source_binding_json)) as unknown as CalendarSeriesCompilationBinding;
      if (calendarJson(retained) !== run.source_binding_json || retained.seriesId !== seriesId || retained.sourceId !== run.source_id) return forbidden();
      binding(retained);
    } catch (error) { if (error instanceof CalendarError) throw error; return notReady(); }
    current();
    return command<T>(transport.sealRetirement(retained, logicalKey, { runId, expectedRevision: revision, limit,
      ...(r.cleanupOnly === true ? { cleanupOnly: true } : {}) }));
  };
  return Object.freeze({ owner, scope, signal, profile, assertCurrent: current, read, command, acceptInitial, retire, close() { if (!stop.signal.aborted) stop.abort(); } });
}
