/** Pure parent/actor-seal evidence, not real actor/COMMIT qualification. */
import { expect, spyOn, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { cloneDatabaseSerializableValue } from '../databases/database-operations';
import { stableStringify } from '../migrations/schema-snapshot';
import { CalendarError, type CalendarErrorCode } from './error';
import { calendarHash } from './validation';
import { calendarRecurrenceTraversal } from './recurrence-engine';
import { normalizeCalendarTimedSeriesAuthoring } from './series-authoring';
import { captureCalendarSeriesCompilationSource, createCalendarSeriesCompilationCursor, compileCalendarSeriesBatch } from './series-compilation';
import { createCalendarSeriesProjection, advanceCalendarSeriesProjection, restoreCalendarSeriesProjection,
  CALENDAR_SERIES_MAX_PROJECTION_PAYLOAD_NODES, CALENDAR_SERIES_MAX_PROJECTION_PAYLOAD_BYTES } from './series-projection';
import { createCalendarSeriesNativeTransport, verifyCalendarSeriesNativeEnvelope, normalizeCalendarSeriesNativeWriterPolicy } from './series-native-transport';

const rootHash = calendarHash('synthetic-native-root'), realmFingerprint = 'sha256:' + calendarHash('synthetic-native-realm');
const policyGeneration = calendarHash('synthetic-native-policy');
function fixture(extra: Record<string, unknown> = {}, width: { participants?: number; count?: number; title?: string } = {}) {
  const authoring = normalizeCalendarTimedSeriesAuthoring({ kind: 'timed-series-v1', recurrence: {
    kind: 'timed-local-v1', localStart: '2030-01-01T10:00:00.000', timeZone: 'UTC', fold: 'earlier', durationMilliseconds: 3_600_000,
    rule: { frequency: 'daily', interval: 1, end: { kind: 'after', count: width.count ?? 3 } },
  }, template: { resourceIds: ['r'], title: width.title ?? 'PRIVATE_NATIVE_TITLE', bufferBeforeMinutes: 0, bufferAfterMinutes: 0,
    appointmentType: null, visit: null, participants: Array.from({ length: width.participants ?? 0 }, (_, index) => ({ kind: 'guardian-user', userId: `participant-${String(index).padStart(3, '0')}-` + 'x'.repeat(108) })) } }, { maxResources: 16, maxParticipants: 100 });
  const source = captureCalendarSeriesCompilationSource({ kind: 'calendar-series-source-snapshot-v1', scopeId: 'application', ownerId: 'synthetic-owner', rootHash, realmFingerprint,
    sourceId: 'synthetic-source', seriesId: 'synthetic-series', segmentId: 'synthetic-logical-segment', segmentRecordId: 'synthetic-generation-segment', generationId: 'generation',
    sourceGeneration: 1, controlRevision: 1, exceptionRevision: 0, preparationId: 'preparation', basePublicationId: null, planManifestDigest: calendarHash('plan'), preparationExpiresAtMs: 100_000,
    intentDigest: calendarHash('intent'), authoringDigest: calendarHash(authoring), engineGeneration: calendarHash(calendarRecurrenceTraversal(authoring.recurrence).engine), policyGeneration, authoring,
    grant: { grantId: 'grant', grantEpoch: 1, authorityDigest: calendarHash('authority'), resourceDigest: calendarHash(['r']) }, resourceRevisions: [{ id: 'r', revision: 1 }], ...extra } as never,
  { maxResources: 16, maxParticipants: 100 });
  const compiled = compileCalendarSeriesBatch(source, createCalendarSeriesCompilationCursor(source, { from: '2030-01-01', until: width.count ? '2030-05-01' : '2030-01-04' }));
  const projection = createCalendarSeriesProjection(source, compiled.contribution, compiled.evidence.batchDigest, { runId: 'synthetic-run' });
  const step = advanceCalendarSeriesProjection(projection);
  return { source, compiled, step, projection };
}
function nodes(value: unknown): number {
  if (value === null || typeof value !== 'object') return 1;
  return 1 + Object.values(value).reduce<number>((total, child) => total + nodes(child), 0);
}
function reject(run: () => unknown, code: CalendarErrorCode = 'CALENDAR_FORBIDDEN') {
  try { run(); throw new Error('Synthetic expected rejection'); }
  catch (error) { expect(error instanceof CalendarError ? error.code : null).toBe(code); }
}

test('native transport seals exact branded projection facts with short expiry and root/realm/source provenance', () => {
  const clock = spyOn(Date, 'now').mockReturnValue(2000), transport = createCalendarSeriesNativeTransport({ rootHash, realmFingerprint, policyGeneration });
  try {
    const f = fixture(), packet = transport.sealProjection(f.source, f.step.cursor, f.step.stepDigest);
    expect(packet.envelope.command).toBe('calendar.series.run.stage'); expect(packet.envelope.logicalKey).toBe(f.step.originalStepKey);
    expect(packet.envelope.issuedAtMs).toBe(2000); expect(packet.envelope.expiresAtMs).toBe(32_000);
    expect(packet.transportKey).toMatch(/^calendar-series:[a-f0-9]{64}$/);
    const admitted = verifyCalendarSeriesNativeEnvelope(normalizeCalendarSeriesNativeWriterPolicy(transport.writerPolicy as never), packet.envelope, 'calendar.series.run.stage');
    expect(admitted).toEqual(packet.envelope); expect(Object.isFrozen(admitted)).toBe(true);
    expect((admitted.payload as Record<string, unknown>).instructions).toEqual(f.step.instructions);
    expect(JSON.stringify(packet.envelope)).not.toContain(transport.writerPolicy.verificationKey);
  } finally { transport.close(); clock.mockRestore(); }
});

test('default projection steps with 100 participants and 40 occurrences remain portable through every real sealed actor envelope', () => {
  const clock = spyOn(Date, 'now').mockReturnValue(2000), transport = createCalendarSeriesNativeTransport({ rootHash, realmFingerprint, policyGeneration });
  try {
    const f = fixture({}, { participants: 100, count: 40, title: '🚦'.repeat(255) + '"\\' });
    expect(f.compiled.evidence.candidates).toHaveLength(40);
    expect(f.step.rowCount).toBeLessThan(256); // Payload, not SQL rows, ends this step.
    let cursor = f.projection, versions = 0, instructionCount = 0, steps = 0;
    for (;;) {
      const step = advanceCalendarSeriesProjection(cursor); steps++;
      expect(nodes(step.instructions)).toBeLessThanOrEqual(CALENDAR_SERIES_MAX_PROJECTION_PAYLOAD_NODES);
      expect(Buffer.byteLength(JSON.stringify(step.instructions))).toBeLessThanOrEqual(CALENDAR_SERIES_MAX_PROJECTION_PAYLOAD_BYTES);
      const packet = transport.sealProjection(f.source, step.cursor, step.stepDigest);
      expect(() => cloneDatabaseSerializableValue(packet as never)).not.toThrow();
      expect(verifyCalendarSeriesNativeEnvelope(transport.writerPolicy as never, packet.envelope, 'calendar.series.run.stage')).toEqual(packet.envelope);
      if (steps === 1) {
        const restored = restoreCalendarSeriesProjection(f.source, f.compiled.contribution, f.compiled.evidence.batchDigest, { runId: 'synthetic-run' },
          JSON.parse(JSON.stringify(step.progress.checkpoint)), step.progress.afterDigest);
        expect(advanceCalendarSeriesProjection(restored).instructions).toEqual(advanceCalendarSeriesProjection(step.cursor).instructions);
      }
      versions += step.instructions.filter(value => value.kind === 'version').length; instructionCount += step.instructions.length; cursor = step.cursor;
      if (step.progress.checkpoint.phase === 'complete') break;
      expect(steps).toBeLessThan(100);
    }
    expect(versions).toBe(40); expect(instructionCount).toBe(160); expect(steps).toBeGreaterThan(1);
  } finally { transport.close(); clock.mockRestore(); }
});

test('copied steps/evidence cannot forge signed facts, even next to a genuine projection cursor', () => {
  const clock = spyOn(Date, 'now').mockReturnValue(2000), transport = createCalendarSeriesNativeTransport({ rootHash, realmFingerprint, policyGeneration });
  try {
    const f = fixture(), forged = { ...f.step, instructions: [{ kind: 'version', title: 'FORGED' }] };
    const packet = transport.sealProjection(f.source, forged.cursor, forged.stepDigest);
    expect((packet.envelope.payload as Record<string, unknown>).instructions).toEqual(f.step.instructions);
    expect(JSON.stringify(packet.envelope.payload)).not.toContain('FORGED');
    reject(() => transport.sealProjection({} as never, f.step.cursor, f.step.stepDigest));
    reject(() => transport.sealProjection(f.source, {} as never, f.step.stepDigest));
    reject(() => transport.sealProjection(f.source, f.step.cursor, 'a'.repeat(64)), 'CALENDAR_INTENT_CONFLICT');
    reject(() => transport.sealSource(f.source, 'calendar.series.run.stage' as never, 'forged', {}));
  } finally { transport.close(); clock.mockRestore(); }
});

test('fresh packet proof retains exact local source/step identity and current engine; copied or foreign packets are never fresh capabilities', () => {
  const clock = spyOn(Date, 'now').mockReturnValue(2000), transport = createCalendarSeriesNativeTransport({ rootHash, realmFingerprint, policyGeneration });
  const other = createCalendarSeriesNativeTransport({ rootHash, realmFingerprint, policyGeneration });
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Temporal');
  try {
    const f = fixture(), sourcePacket = transport.sealSource(f.source, 'calendar.series.run.begin', 'begin', { runId: 'synthetic-run' });
    const stepPacket = transport.sealProjection(f.source, f.step.cursor, f.step.stepDigest);
    const retirement = transport.sealRetirement(sourcePacket.envelope.source, 'retire', { runId: 'synthetic-run', expectedRevision: 1 });
    for (const packet of [sourcePacket, stepPacket, retirement]) expect(() => transport.assertPacketCurrent(packet)).not.toThrow();
    for (const copied of [{ ...sourcePacket }, { ...stepPacket }, JSON.parse(JSON.stringify(stepPacket))]) reject(() => transport.assertPacketCurrent(copied));
    reject(() => other.assertPacketCurrent(sourcePacket));
    let touched = false; const proxy = new Proxy(stepPacket, { getPrototypeOf() { touched = true; throw new Error('must not inspect proxy'); } });
    reject(() => transport.assertPacketCurrent(proxy)); expect(touched).toBe(false);
    Object.defineProperty(globalThis, 'Temporal', { configurable: true, get() { throw new Error('replaced native engine'); } });
    reject(() => transport.assertPacketCurrent(sourcePacket), 'CALENDAR_TIME_RULES_UNAVAILABLE');
    reject(() => transport.assertPacketCurrent(stepPacket), 'CALENDAR_TIME_RULES_UNAVAILABLE');
    expect(() => transport.assertPacketCurrent(retirement)).not.toThrow();
    transport.close(); reject(() => transport.assertPacketCurrent(retirement));
  } finally { if (descriptor) Object.defineProperty(globalThis, 'Temporal', descriptor); else Reflect.deleteProperty(globalThis, 'Temporal'); transport.close(); other.close(); clock.mockRestore(); }
});

test('actor verification rejects changed payload, self-rehashed payload, fields, command, root, realm and a different runtime key', () => {
  const clock = spyOn(Date, 'now').mockReturnValue(2000), transport = createCalendarSeriesNativeTransport({ rootHash, realmFingerprint, policyGeneration });
  const other = createCalendarSeriesNativeTransport({ rootHash, realmFingerprint, policyGeneration });
  try {
    const f = fixture(), packet = transport.sealSource(f.source, 'calendar.series.run.begin', 'begin-key', { runId: 'run', window: [1, 2] });
    const changed = cloneDatabaseSerializableValue({ ...packet.envelope, payload: { runId: 'ATTACK' } });
    const payloadDigest = createHash('sha256').update('zero.calendar.native-transport-v1\0payload\0').update(stableStringify({ runId: 'ATTACK' })).digest('hex');
    const bad = [changed, { ...packet.envelope, payload: { runId: 'ATTACK' }, payloadDigest },
      { ...packet.envelope, command: 'calendar.series.run.publish' }, { ...packet.envelope, logicalKey: 'other-key' },
      { ...packet.envelope, extra: 1 }, { ...packet.envelope, source: { ...packet.envelope.source, rootHash: 'a'.repeat(64) } },
      { ...packet.envelope, source: { ...packet.envelope.source, realmFingerprint: 'sha256:' + 'a'.repeat(64) } }];
    for (const value of bad) reject(() => verifyCalendarSeriesNativeEnvelope(transport.writerPolicy as never, value, 'calendar.series.run.begin'));
    reject(() => verifyCalendarSeriesNativeEnvelope(other.writerPolicy as never, packet.envelope, 'calendar.series.run.begin'));
    reject(() => transport.sealSource(fixture({ rootHash: 'a'.repeat(64) }).source, 'calendar.series.run.begin', 'key', {}));
    reject(() => verifyCalendarSeriesNativeEnvelope(undefined, packet.envelope, 'calendar.series.run.begin'), 'CALENDAR_CONFIG_INVALID');
  } finally { transport.close(); other.close(); clock.mockRestore(); }
});

test('short seals reject future/expired requests and honor source expiry without accepting browser clocks', () => {
  const clock = spyOn(Date, 'now').mockReturnValue(2000), transport = createCalendarSeriesNativeTransport({ rootHash, realmFingerprint, policyGeneration, maxAgeMs: 1000 });
  try {
    const f = fixture(), packet = transport.sealSource(f.source, 'calendar.series.run.begin', 'key', {});
    clock.mockReturnValue(1999); reject(() => verifyCalendarSeriesNativeEnvelope(transport.writerPolicy as never, packet.envelope, 'calendar.series.run.begin'));
    clock.mockReturnValue(3000); reject(() => verifyCalendarSeriesNativeEnvelope(transport.writerPolicy as never, packet.envelope, 'calendar.series.run.begin'));
    clock.mockReturnValue(99_500); const nearExpiry = transport.sealSource(f.source, 'calendar.series.run.begin', 'key', {});
    expect(nearExpiry.envelope.expiresAtMs).toBe(100_000);
    clock.mockReturnValue(100_000); reject(() => transport.sealSource(f.source, 'calendar.series.run.begin', 'key', {}), 'CALENDAR_NOT_READY');
  } finally { transport.close(); clock.mockRestore(); }
});

test('rotating native bind keys changes transport attempts, not permanent logical identity; closing retires the signer', () => {
  const clock = spyOn(Date, 'now').mockReturnValue(2000), first = createCalendarSeriesNativeTransport({ rootHash, realmFingerprint, policyGeneration });
  const second = createCalendarSeriesNativeTransport({ rootHash, realmFingerprint, policyGeneration });
  try {
    const f = fixture(), one = first.sealProjection(f.source, f.step.cursor, f.step.stepDigest), two = second.sealProjection(f.source, f.step.cursor, f.step.stepDigest);
    expect(one.envelope.logicalKey).toBe(two.envelope.logicalKey); expect(one.transportKey).not.toBe(two.transportKey);
    expect(one.envelope.source.intentDigest).toBe(two.envelope.source.intentDigest);
    first.close(); reject(() => first.sealProjection(f.source, f.step.cursor, f.step.stepDigest)); first.close();
  } finally { first.close(); second.close(); clock.mockRestore(); }
});

test('native retirement uses retained owned facts after engine, source TTL or policy retirement without granting fresh booking', () => {
  const clock = spyOn(Date, 'now').mockReturnValue(2000), first = createCalendarSeriesNativeTransport({ rootHash, realmFingerprint, policyGeneration });
  const changed = createCalendarSeriesNativeTransport({ rootHash, realmFingerprint, policyGeneration: 'c'.repeat(64) });
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Temporal');
  try {
    const f = fixture(), retained = first.sealProjection(f.source, f.step.cursor, f.step.stepDigest).envelope.source;
    clock.mockReturnValue(200_000);
    Object.defineProperty(globalThis, 'Temporal', { configurable: true, get() { throw new Error('PRIVATE_ENGINE_RETIRED'); } });
    const packet = changed.sealRetirement(retained, 'retire-original-run', { runId: 'synthetic-run', expectedRevision: 1 });
    expect(packet.envelope.command).toBe('calendar.series.run.abort'); expect(packet.envelope.expiresAtMs).toBe(230_000);
    expect(verifyCalendarSeriesNativeEnvelope(changed.writerPolicy as never, packet.envelope, 'calendar.series.run.abort')).toEqual(packet.envelope);
    reject(() => verifyCalendarSeriesNativeEnvelope(changed.writerPolicy as never, packet.envelope, 'calendar.series.run.stage'));
    reject(() => changed.sealRetirement({ ...retained, rootHash: 'd'.repeat(64) }, 'key', {}));
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'Temporal', descriptor); else Reflect.deleteProperty(globalThis, 'Temporal');
    first.close(); changed.close(); clock.mockRestore();
  }
});
