/** Private parent-to-actor admission. Neither canonical hashes nor copied
 * compiled JSON are write capabilities. The private runtime owns the signer;
 * only verification material crosses the native actor bind as writerPolicy.
 * A valid seal still requires final owner/grant/policy/resource/participant and
 * occupancy checks under the real DatabaseCommitAuthority at COMMIT. */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cloneDatabaseSerializableValue, type DatabaseSerializableValue } from '../databases/database-operations';
import { databaseOperationRecord } from '../databases/database-operation-payload';
import { stableStringify } from '../migrations/schema-snapshot';
import { inspectCalendarSeriesCompilationSource, type CalendarSeriesCompilationBinding, type CalendarSeriesCompilationSource } from './series-compilation';
import { inspectCalendarSeriesProjection, inspectCalendarSeriesProjectionStep, inspectCalendarSeriesProjectionCompilation,
  type CalendarSeriesProjection } from './series-projection';
import { calendarInteger, calendarKey, calendarRecord } from './validation';
import { calendarNow } from './hold-time';
import { CalendarError } from './error';
import type { CalendarOwnerRecord } from './owner-schema';
import { inspectCalendarInitialSeriesCompilation, type CalendarInitialSeriesRequest, type CalendarInitialSeriesCompilation } from './series-source-writer';

const DOMAIN = 'zero.calendar.native-transport-v1';
const OPERATIONS = ['calendar.series.run.begin', 'calendar.series.run.stage', 'calendar.series.run.seal',
  'calendar.series.run.publish', 'calendar.series.run.abort'] as const;
export type CalendarSeriesNativeOperation = typeof OPERATIONS[number];
export interface CalendarSeriesNativeTransportBinding {
  readonly rootHash: string;
  readonly realmFingerprint: string;
  readonly policyGeneration: string;
}
/** @internal Do not expose or log a bind policy. It is not an application setting. */
export interface CalendarSeriesNativeWriterPolicy extends CalendarSeriesNativeTransportBinding {
  readonly kind: 'calendar-series-native-writer-v1';
  readonly keyId: string;
  readonly verificationKey: string;
  readonly maxAgeMs: number;
}
export interface CalendarSeriesNativeEnvelope {
  readonly kind: 'calendar-series-native-envelope-v1';
  readonly command: CalendarSeriesNativeOperation;
  /** Durable domain identity. It never includes a random seal/key/claim generation. */
  readonly logicalKey: string;
  readonly keyId: string;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly source: CalendarSeriesCompilationBinding;
  readonly payload: DatabaseSerializableValue;
  readonly payloadDigest: string;
  readonly signature: string;
}
export interface CalendarSeriesNativePacket {
  readonly envelope: CalendarSeriesNativeEnvelope;
  /** The transport attempt MAY change across process restarts. The domain key cannot. */
  readonly transportKey: string;
}
export interface CalendarInitialSeriesNativeEnvelope extends Omit<CalendarSeriesNativeEnvelope, 'kind' | 'command' | 'source'> {
  readonly kind: 'calendar-series-initial-source-envelope-v1';
  readonly command: 'calendar.series.source.accept';
  readonly source: CalendarSeriesNativeTransportBinding & {
    readonly scopeId: string; readonly ownerId: string; readonly snapshotDigest: string;
  };
}
export interface CalendarInitialSeriesNativePacket { readonly envelope: CalendarInitialSeriesNativeEnvelope; readonly transportKey: string }
export interface CalendarSeriesNativeTransport {
  readonly writerPolicy: CalendarSeriesNativeWriterPolicy;
  /** Code-owned controls only. Source capture must come from the native read boundary. */
  sealSource(source: CalendarSeriesCompilationSource, command: Exclude<CalendarSeriesNativeOperation, 'calendar.series.run.stage'>,
    logicalKey: string, payload: DatabaseSerializableValue): CalendarSeriesNativePacket;
  /** The signer reads the exact private WeakMap step, not a caller's step.instructions. */
  sealProjection(source: CalendarSeriesCompilationSource, cursorAfterStep: CalendarSeriesProjection, expectedStepDigest: string): CalendarSeriesNativePacket;
  /** Native cleanup only: read this binding from the retained run via the
   * actual owner, never request JSON. Retirement does not need a live engine,
   * current grant/policy or the expired preparation to become fresh again. */
  sealRetirement(binding: CalendarSeriesCompilationBinding, logicalKey: string, payload: DatabaseSerializableValue): CalendarSeriesNativePacket;
  /** The initial command represents a real, currently admitted human. Its frame
   * has no fabricated background session and cannot be reconstructed from JSON. */
  sealInitial(request: CalendarInitialSeriesRequest, compiled: CalendarInitialSeriesCompilation, owner: CalendarOwnerRecord,
    preparationTtlMs: number): CalendarInitialSeriesNativePacket;
  /** Fresh local work requires the exact minted packet, retaining its original
   * runtime-branded source/step engine proof. Copied envelopes are sufficient
   * only to reconcile a proven accepted receipt, never to authorize new work. */
  assertPacketCurrent(packet: CalendarSeriesNativePacket): void;
  close(): void;
}
function forbidden(): never { throw new CalendarError('CALENDAR_FORBIDDEN'); }
function invalid(): never { throw new CalendarError('CALENDAR_CONFIG_INVALID'); }
function hash(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) return invalid();
  return value;
}
function realm(value: unknown): string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) return invalid();
  return value;
}
/** Database actor payload limits remain in force; do not expand Calendar's
 * unrelated 32KiB per-value limits to hash an entire multi-instruction packet. */
function payloadHash(value: DatabaseSerializableValue): string {
  return createHash('sha256').update(DOMAIN + '\0payload\0').update(stableStringify(value)).digest('hex');
}
function proofHash(value: { readonly payload: DatabaseSerializableValue }): Buffer {
  const { payload: _payload, ...facts } = value;
  return createHash('sha256').update(DOMAIN + '\0envelope\0').update(stableStringify(facts)).digest();
}
/** Original logical receipt comparison. A fresh transport seal after restart
 * must not change an already-accepted native operation's semantic identity. */
export function calendarSeriesNativeSemanticDigest(envelope: CalendarSeriesNativeEnvelope): string {
  return createHash('sha256').update(DOMAIN + '\0semantic\0').update(stableStringify({
    command: envelope.command, logicalKey: envelope.logicalKey, source: envelope.source.snapshotDigest, payloadDigest: envelope.payloadDigest,
  })).digest('hex');
}
/** Read-only original-intent inspection, NOT seal verification or permission to
 * execute. A private owner may compare it with a durable accepted receipt before
 * requiring a current engine/key/policy. A missing receipt must still go through
 * verifyCalendarSeriesNativeEnvelope and every fresh COMMIT fence. */
export function inspectCalendarSeriesNativeReplayIntent(input: unknown): CalendarSeriesNativeEnvelope {
  try {
    const cloned = cloneDatabaseSerializableValue(input), r = databaseOperationRecord(cloned);
    const fields = ['kind', 'command', 'logicalKey', 'keyId', 'issuedAtMs', 'expiresAtMs', 'source', 'payload', 'payloadDigest', 'signature'];
    if (Object.keys(r).length !== fields.length || fields.some(field => !Object.hasOwn(r, field)) || r.kind !== 'calendar-series-native-envelope-v1'
      || !(OPERATIONS as readonly string[]).includes(String(r.command))) return forbidden();
    calendarKey(r.logicalKey); hash(r.keyId); hash(r.signature); calendarInteger(r.issuedAtMs); calendarInteger(r.expiresAtMs);
    const source = databaseOperationRecord(r.source);
    hash(source.snapshotDigest); hash(source.rootHash); realm(source.realmFingerprint); hash(source.policyGeneration);
    calendarKey(source.ownerId); calendarKey(source.seriesId); calendarKey(source.sourceId);
    if (payloadHash(r.payload as DatabaseSerializableValue) !== hash(r.payloadDigest)) return forbidden();
    return cloned as unknown as CalendarSeriesNativeEnvelope;
  } catch { return forbidden(); }
}
function policy(input: unknown): CalendarSeriesNativeWriterPolicy {
  try {
    const r = calendarRecord(input, ['kind', 'rootHash', 'realmFingerprint', 'policyGeneration', 'keyId', 'verificationKey', 'maxAgeMs']);
    if (Object.keys(r).length !== 7 || r.kind !== 'calendar-series-native-writer-v1') return invalid();
    return Object.freeze({ kind: r.kind, rootHash: hash(r.rootHash), realmFingerprint: realm(r.realmFingerprint), policyGeneration: hash(r.policyGeneration),
      keyId: hash(r.keyId), verificationKey: hash(r.verificationKey), maxAgeMs: calendarInteger(r.maxAgeMs, 1, 30_000) });
  } catch { return invalid(); }
}
/** Native actor bind normalizer; no secret is loaded from dotenv or a browser. */
export function normalizeCalendarSeriesNativeWriterPolicy(input: DatabaseSerializableValue | undefined): DatabaseSerializableValue {
  return cloneDatabaseSerializableValue(policy(input));
}
function sourceMatches(binding: CalendarSeriesCompilationBinding, selected: CalendarSeriesNativeTransportBinding, retirement = false): void {
  if (binding.rootHash !== selected.rootHash || binding.realmFingerprint !== selected.realmFingerprint
    || !retirement && binding.policyGeneration !== selected.policyGeneration) return forbidden();
}

/** Only the trusted managed runtime may retain this object. A different factory
 * creates a different bind key and cannot authorize writes to an existing actor. */
export function createCalendarSeriesNativeTransport(input: CalendarSeriesNativeTransportBinding & { readonly maxAgeMs?: number }): CalendarSeriesNativeTransport {
  const r = calendarRecord(input, ['rootHash', 'realmFingerprint', 'policyGeneration', 'maxAgeMs']);
  const secret = randomBytes(32), keyId = createHash('sha256').update(DOMAIN).update(secret).digest('hex');
  const selected = policy({ kind: 'calendar-series-native-writer-v1', rootHash: r.rootHash, realmFingerprint: r.realmFingerprint,
    policyGeneration: r.policyGeneration, keyId, verificationKey: secret.toString('hex'), maxAgeMs: r.maxAgeMs ?? 30_000 });
  let closed = false;
  const packetProofs = new WeakMap<object, () => void>();
  const retain = (packet: CalendarSeriesNativePacket, assertCurrent: () => void): CalendarSeriesNativePacket => {
    packetProofs.set(packet, assertCurrent); return packet;
  };
  const seal = (binding: CalendarSeriesCompilationBinding, command: CalendarSeriesNativeOperation, logicalInput: string, inputPayload: DatabaseSerializableValue): CalendarSeriesNativePacket => {
    if (closed) return forbidden();
    const retirement = command === 'calendar.series.run.abort';
    sourceMatches(binding, selected, retirement);
    if (!(OPERATIONS as readonly string[]).includes(command)) return forbidden();
    const logicalKey = calendarKey(logicalInput), issuedAtMs = calendarInteger(calendarNow(), 0, Number.MAX_SAFE_INTEGER - selected.maxAgeMs);
    const expiresAtMs = retirement ? issuedAtMs + selected.maxAgeMs : Math.min(issuedAtMs + selected.maxAgeMs, binding.preparationExpiresAtMs);
    if (expiresAtMs <= issuedAtMs) throw new CalendarError('CALENDAR_NOT_READY');
    const source = cloneDatabaseSerializableValue(binding) as unknown as CalendarSeriesCompilationBinding;
    const payload = cloneDatabaseSerializableValue(inputPayload);
    const body = { kind: 'calendar-series-native-envelope-v1' as const, command, logicalKey, keyId, issuedAtMs, expiresAtMs,
      source, payload, payloadDigest: payloadHash(payload) };
    const signature = createHmac('sha256', secret).update(proofHash(body)).digest('hex');
    const envelope = Object.freeze({ ...body, signature });
    // Signature/boot binding distinguishes transport attempts. Permanent native
    // receipt reconciliation remains keyed by logicalKey + exact domain intent.
    const transportKey = 'calendar-series:' + createHash('sha256').update(keyId).update('\0').update(command).update('\0')
      .update(logicalKey).update('\0').update(signature).digest('hex');
    return Object.freeze({ envelope, transportKey });
  };
  return Object.freeze<CalendarSeriesNativeTransport>({ writerPolicy: selected,
    sealSource(source, command, logicalKey, payload) {
      if (command === 'calendar.series.run.stage' as string) return forbidden();
      const binding = inspectCalendarSeriesCompilationSource(source);
      return retain(seal(binding, command, logicalKey, payload), () => {
        if (inspectCalendarSeriesCompilationSource(source).snapshotDigest !== binding.snapshotDigest) return forbidden();
      });
    },
    sealProjection(source, cursorAfterStep, expectedStepDigest) {
      const binding = inspectCalendarSeriesCompilationSource(source), projected = inspectCalendarSeriesProjection(cursorAfterStep);
      const step = inspectCalendarSeriesProjectionStep(cursorAfterStep, expectedStepDigest);
      const compiled = inspectCalendarSeriesProjectionCompilation(cursorAfterStep);
      if (projected.binding.source.snapshotDigest !== binding.snapshotDigest) return forbidden();
      return retain(seal(binding, 'calendar.series.run.stage', step.originalStepKey, cloneDatabaseSerializableValue({
        kind: 'calendar-series-projection-step-v1', runId: projected.binding.runId, binding: projected.binding,
        instructions: step.instructions, rowCount: step.rowCount, originalStepKey: step.originalStepKey,
        stepDigest: step.stepDigest, progress: step.progress, compilationProgress: compiled.progress, compilationWork: compiled.work,
      })), () => {
        const current = inspectCalendarSeriesCompilationSource(source), currentProjection = inspectCalendarSeriesProjection(cursorAfterStep);
        if (current.snapshotDigest !== binding.snapshotDigest || currentProjection.binding.source.snapshotDigest !== binding.snapshotDigest
          || inspectCalendarSeriesProjectionStep(cursorAfterStep, expectedStepDigest) !== step) return forbidden();
      });
    },
    sealRetirement(binding, logicalKey, payload) {
      const source = cloneDatabaseSerializableValue(binding) as unknown as CalendarSeriesCompilationBinding;
      // Retained native cleanup has local mint provenance but deliberately does
      // not depend on a retired engine/grant/policy/preparation becoming fresh.
      return retain(seal(source, 'calendar.series.run.abort', logicalKey, payload), () => {});
    },
    sealInitial(request, compiled, suppliedOwner, preparationTtlMs) {
      if (closed) return forbidden();
      const frame = inspectCalendarInitialSeriesCompilation(request, compiled);
      const owner = calendarRecord(suppliedOwner, ['id', 'scope_id', 'owner_id', 'root_hash', 'realm_fingerprint', 'established']);
      if (owner.established !== 1 || owner.scope_id !== frame.request.scopeId || owner.root_hash !== selected.rootHash
        || owner.realm_fingerprint !== selected.realmFingerprint) return forbidden();
      const ttl = calendarInteger(preparationTtlMs, 1000, 86_400_000), issuedAtMs = calendarInteger(calendarNow(), 0, Number.MAX_SAFE_INTEGER - selected.maxAgeMs);
      const payload = cloneDatabaseSerializableValue({ kind: 'calendar-series-initial-source-v1', frame, owner,
        preparationTtlMs: ttl, policyGeneration: selected.policyGeneration });
      const source = Object.freeze({ rootHash: selected.rootHash, realmFingerprint: selected.realmFingerprint, policyGeneration: selected.policyGeneration,
        scopeId: frame.request.scopeId, ownerId: calendarKey(owner.owner_id), snapshotDigest: payloadHash(cloneDatabaseSerializableValue(frame)) });
      const body = { kind: 'calendar-series-initial-source-envelope-v1' as const, command: 'calendar.series.source.accept' as const,
        logicalKey: frame.request.requestId, keyId, issuedAtMs, expiresAtMs: issuedAtMs + Math.min(ttl, selected.maxAgeMs), source,
        payload, payloadDigest: payloadHash(payload) };
      const signature = createHmac('sha256', secret).update(proofHash(body)).digest('hex');
      const envelope = Object.freeze({ ...body, signature });
      return Object.freeze({ envelope, transportKey: 'calendar-series-initial:' + createHash('sha256').update(keyId).update('\0')
        .update(frame.request.digest).update('\0').update(signature).digest('hex') });
    },
    assertPacketCurrent(packet) {
      if (closed) return forbidden();
      const proof = packet !== null && typeof packet === 'object' ? packetProofs.get(packet) : undefined;
      if (!proof) return forbidden(); proof();
    },
    close() { if (closed) return; closed = true; secret.fill(0); },
  });
}

/** The actor reuses canonical initial-source admission only after verifying the
 * real parent's bind key and exact human frame. This does not recreate Guardian. */
export function verifyCalendarInitialSeriesNativeEnvelope(writerPolicy: DatabaseSerializableValue | undefined, input: unknown): CalendarInitialSeriesNativeEnvelope {
  const selected = policy(writerPolicy);
  try {
    const cloned = cloneDatabaseSerializableValue(input), r = databaseOperationRecord(cloned), source = databaseOperationRecord(r.source);
    const fields = ['kind', 'command', 'logicalKey', 'keyId', 'issuedAtMs', 'expiresAtMs', 'source', 'payload', 'payloadDigest', 'signature'];
    if (Object.keys(r).length !== fields.length || fields.some(field => !Object.hasOwn(r, field))
      || r.kind !== 'calendar-series-initial-source-envelope-v1' || r.command !== 'calendar.series.source.accept' || r.keyId !== selected.keyId) return forbidden();
    const issued = calendarInteger(r.issuedAtMs), expires = calendarInteger(r.expiresAtMs), now = calendarNow();
    if (issued > now || expires <= now || expires <= issued || expires - issued > selected.maxAgeMs) return forbidden();
    if (source.rootHash !== selected.rootHash || source.realmFingerprint !== selected.realmFingerprint || source.policyGeneration !== selected.policyGeneration) return forbidden();
    calendarKey(r.logicalKey); calendarKey(source.ownerId);
    if (payloadHash(r.payload as DatabaseSerializableValue) !== r.payloadDigest) return forbidden();
    const { signature: _signature, ...body } = r;
    const expected = createHmac('sha256', Buffer.from(selected.verificationKey, 'hex'))
      .update(proofHash(body as unknown as { payload: DatabaseSerializableValue })).digest();
    if (!timingSafeEqual(expected, Buffer.from(hash(r.signature), 'hex'))) return forbidden();
    return cloned as unknown as CalendarInitialSeriesNativeEnvelope;
  } catch { return forbidden(); }
}

/** Actor-side verification, before any command mutation. It supplies provenance
 * only; the canonical writer must also rehydrate and fence all current facts.
 * Accepted original receipts must be reconciled without replaying a fresh effect. */
export function verifyCalendarSeriesNativeEnvelope(writerPolicy: DatabaseSerializableValue | undefined, input: unknown,
  expectedCommand: CalendarSeriesNativeOperation): CalendarSeriesNativeEnvelope {
  const selected = policy(writerPolicy);
  try {
    const cloned = cloneDatabaseSerializableValue(input), r = databaseOperationRecord(cloned);
    const fields = ['kind', 'command', 'logicalKey', 'keyId', 'issuedAtMs', 'expiresAtMs', 'source', 'payload', 'payloadDigest', 'signature'];
    if (Object.keys(r).length !== fields.length || fields.some(field => !Object.hasOwn(r, field)) || r.kind !== 'calendar-series-native-envelope-v1'
      || r.command !== expectedCommand || !(OPERATIONS as readonly string[]).includes(expectedCommand) || r.keyId !== selected.keyId) return forbidden();
    calendarKey(r.logicalKey); const signature = hash(r.signature), issuedAtMs = calendarInteger(r.issuedAtMs), expiresAtMs = calendarInteger(r.expiresAtMs);
    const now = calendarNow();
    if (issuedAtMs > now || expiresAtMs <= now || expiresAtMs <= issuedAtMs || expiresAtMs - issuedAtMs > selected.maxAgeMs) return forbidden();
    const source = databaseOperationRecord(r.source) as unknown as CalendarSeriesCompilationBinding;
    const retirement = expectedCommand === 'calendar.series.run.abort';
    sourceMatches(source, selected, retirement);
    if (!retirement && expiresAtMs > calendarInteger(source.preparationExpiresAtMs)
      || payloadHash(r.payload as DatabaseSerializableValue) !== r.payloadDigest) return forbidden();
    const { signature: _signature, ...body } = r;
    const expected = createHmac('sha256', Buffer.from(selected.verificationKey, 'hex'))
      .update(proofHash(body as unknown as Omit<CalendarSeriesNativeEnvelope, 'signature'>)).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) return forbidden();
    return cloned as unknown as CalendarSeriesNativeEnvelope;
  } catch { return forbidden(); }
}
