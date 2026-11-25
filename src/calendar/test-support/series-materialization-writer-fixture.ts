/** Owned synthetic native MEMORY only; every handle closes in caller finally. */
import { createReactiveDB } from '../../sync/reactive-db';
import { runDatabaseRealmCommand, runDatabaseRealmQuery } from '../../databases/database-realm';
import { createDatabaseReadQuerySession, withDatabaseReadQuerySession } from '../../databases/database-read-query-capability';
import { cloneDatabaseSerializableValue } from '../../databases/database-operations';
import { calendarRealm } from '../realm';
import { seriesMaterializationMemoryFixture, insertMaterializationRow as insert } from './series-materialization-fixture';
import { calendarSeriesMaterializationTables } from '../realm-series-materialization-migration';
import { normalizeCalendarTimedSeriesAuthoring } from '../series-authoring';
import { calendarRecurrenceTraversal } from '../recurrence-engine';
import { captureCalendarSeriesCompilationSource, compileCalendarSeriesBatch, createCalendarSeriesCompilationCursor } from '../series-compilation';
import { advanceCalendarSeriesProjection, createCalendarSeriesProjection, inspectCalendarSeriesProjection } from '../series-projection';
import { createCalendarSeriesNativeTransport, type CalendarSeriesNativePacket } from '../series-native-transport';
import { calendarSeriesMaterializationRealm as realm } from '../series-materialization-realm';
import { calendarHash as h, calendarJson } from '../validation';
import type { CalendarOwnerRecord } from '../owner-schema';

export function seriesMaterializationWriterFixture(options: { resources?: number; durationMs?: number; before?: number; after?: number; count?: number; start?: string; frequency?: 'daily' | 'monthly'; windowFrom?: string; windowUntil?: string; compilerLimit?: number; typed?: boolean } = {}) {
  const base = seriesMaterializationMemoryFixture(), reactive = createReactiveDB({ database: base.db, ownsDatabase: false });
  let transport: ReturnType<typeof createCalendarSeriesNativeTransport> | undefined;
  try {
    for (const [table, definition] of Object.entries(calendarSeriesMaterializationTables())) reactive.defineTable(table, definition);
    const actor = { scopeId: base.scope, userId: 'synthetic-user', principal: base.principal, manageAll: true, createOwn: true };
    const resources = ['r', ...Array.from({ length: (options.resources ?? 1) - 1 }, (_, i) => 'r' + String(i + 1).padStart(2, '0'))].sort();
    for (const id of resources.filter(value => value !== 'r')) runDatabaseRealmCommand(calendarRealm, reactive, 'calendar.resource.create', { actor, requestId: 'resource-' + id, id, label: 'Synthetic resource', kind: 'person', ownerId: actor.userId, timeZone: 'UTC' });
    if (options.typed) runDatabaseRealmCommand(calendarRealm, reactive, 'calendar.type.create', { actor, requestId: 'fixture-type', id: 'consult', label: 'Synthetic type', durationMinutes: 60, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, colorKey: null, active: true });
    const authoring = normalizeCalendarTimedSeriesAuthoring({ kind: 'timed-series-v1', recurrence: { kind: 'timed-local-v1', localStart: options.start ?? '2030-01-01T10:00:00.000',
      timeZone: 'UTC', fold: 'earlier', durationMilliseconds: options.durationMs ?? 3_600_000, rule: { frequency: options.frequency ?? 'daily', interval: 1, end: { kind: 'after', count: options.count ?? 3 } } },
      template: { resourceIds: resources, title: 'PRIVATE_NATIVE_TITLE', bufferBeforeMinutes: options.before ?? 0, bufferAfterMinutes: options.after ?? 0, appointmentType: options.typed ? { id: 'consult', revision: 1 } : null, visit: null, participants: [] } }, { maxResources: 16, maxParticipants: 100 });
    const scope = base.scope, ownerId = base.owner, seriesId = 'native-series', generationId = 'native-generation', preparationId = 'native-preparation', grantId = 'native-grant';
    const segmentId = h(['calendar.series.segment.v1', scope, seriesId, 'original']), sourceId = 'series-source:' + h([scope, ownerId, seriesId]);
    const acceptanceId = h([scope, base.principal, 'native-plan']), now = Date.now(), expiry = now + 600_000;
    const policyGeneration = h('native-policy'), engineGeneration = h(calendarRecurrenceTraversal(authoring.recurrence).engine), planDigest = h('native-plan');
    const ownerRecord: CalendarOwnerRecord = { id: 'calendar:' + h(scope), scope_id: scope, owner_id: ownerId, root_hash: h('native-root'), realm_fingerprint: realm.fingerprint, established: 1 };
    const authorityDigest = h(['calendar.series.authority.v1', ownerRecord, policyGeneration]);
    base.db.transaction(() => {
      insert(base.db, 'calendar_series', { id: seriesId, scope_id: scope, owner_id: ownerId, source_id: sourceId, created_by: actor.userId, control_revision: 1,
        initial_acceptance_receipt_id: acceptanceId, lifecycle: 'active', grant_epoch: 1, current_grant_id: grantId, published_generation_id: null, published_publication_id: null, active_preparation_id: preparationId });
      insert(base.db, '_calendar_series_generations', { id: generationId, scope_id: scope, series_id: seriesId, generation: 1, predecessor_id: null, base_publication_id: null,
        kind: authoring.kind, authoring_json: calendarJson(authoring), authoring_digest: h(authoring), engine_generation: engineGeneration, policy_generation: policyGeneration, acceptance_receipt_id: acceptanceId });
      insert(base.db, '_calendar_series_segments', { id: segmentId, scope_id: scope, series_id: seriesId, generation_id: generationId, segment_key: 'original', predecessor_segment_id: null, nominal_cut: null,
        local_from: authoring.recurrence.localStart.slice(0, 10), local_until: null, start_json: calendarJson({ localStart: authoring.recurrence.localStart, timeZone: authoring.recurrence.timeZone,
          fold: authoring.recurrence.fold, durationMilliseconds: authoring.recurrence.durationMilliseconds }), rule_json: calendarJson(authoring.recurrence.rule), template_json: calendarJson(authoring.template), source_digest: h(authoring) });
      insert(base.db, '_calendar_series_grants', { id: grantId, scope_id: scope, series_id: seriesId, generation_id: generationId, grant_revision: 1, issued_epoch: 1, owner_id: ownerId, source_id: sourceId,
        source_generation: 1, operations_json: '["series.coverage.commit","series.coverage.prepare","series.coverage.reconcile"]', resource_ids_json: calendarJson(resources), authority_digest: authorityDigest,
        resource_digest: h(resources), issuance_receipt_id: acceptanceId, issued_ms: now });
      insert(base.db, '_calendar_series_preparations', { id: preparationId, scope_id: scope, series_id: seriesId, generation_id: generationId, grant_id: grantId, grant_epoch: 1,
        acceptance_receipt_id: acceptanceId, base_publication_id: null, manifest_digest: planDigest, revision: 1, state: 'preparing', created_ms: now, expires_ms: expiry,
        claim_generation: 0, claim_nonce: null, claim_until_ms: null, blocked_code: null, publication_id: null });
      insert(base.db, '_calendar_series_receipts', { id: acceptanceId, scope_id: scope, principal: base.principal, request_id: 'native-plan', digest: h('native-intent'), series_id: seriesId,
        generation_id: generationId, control_revision: 1, preparation_id: preparationId, base_publication_id: null, accepted_ms: now + 1, operation: 'series.plan.accepted' });
    })();
    const snapshot = { kind: 'calendar-series-source-snapshot-v1' as const, scopeId: scope, ownerId, rootHash: ownerRecord.root_hash, realmFingerprint: ownerRecord.realm_fingerprint,
      sourceId, seriesId, segmentId, segmentRecordId: segmentId, generationId, sourceGeneration: 1, controlRevision: 1, exceptionRevision: 0,
      preparationId, basePublicationId: null, planManifestDigest: planDigest, preparationExpiresAtMs: expiry, intentDigest: h('native-intent'), authoringDigest: h(authoring),
      engineGeneration, policyGeneration, authoring, grant: { grantId, grantEpoch: 1, authorityDigest, resourceDigest: h(resources) }, resourceRevisions: resources.map(id => ({ id, revision: 1 })) };
    const source = captureCalendarSeriesCompilationSource(snapshot, { maxResources: 16, maxParticipants: 100 });
    const range = { from: options.windowFrom ?? authoring.recurrence.localStart.slice(0, 10), until: options.windowUntil ?? '2030-01-04' };
    const batch = compileCalendarSeriesBatch(source, createCalendarSeriesCompilationCursor(source, range), { occurrenceLimit: options.compilerLimit ?? 100 });
    const runId = 'native-run', projection = createCalendarSeriesProjection(source, batch.contribution, batch.evidence.batchDigest, { runId });
    transport = createCalendarSeriesNativeTransport({ rootHash: snapshot.rootHash, realmFingerprint: snapshot.realmFingerprint, policyGeneration });
    const execute = (packet: CalendarSeriesNativePacket, native = transport!) => runDatabaseRealmCommand(realm, reactive, packet.envelope.command, cloneDatabaseSerializableValue(packet.envelope), native.writerPolicy as never) as unknown as { ok: true; value: Record<string, unknown> };
    const beginPayload = { runId, kind: 'cutover', sourcePublicationId: 'native-source-publication', windowFromMs: Date.parse(range.from + 'T00:00:00.000Z'), windowUntilMs: Date.parse(range.until + 'T00:00:00.000Z'),
      nominalFrom: range.from, nominalUntil: range.until, initialProgressDigest: batch.evidence.progress.beforeDigest, initialProjectionCheckpoint: inspectCalendarSeriesProjection(projection).checkpoint };
    const begin = () => execute(transport!.sealSource(source, 'calendar.series.run.begin', 'begin', cloneDatabaseSerializableValue(beginPayload)));
    const command = (name: string, input: Record<string, unknown>) => runDatabaseRealmCommand(realm, reactive, name, cloneDatabaseSerializableValue({ actor, ...input }));
    const query = (name: string, input: Record<string, unknown>) => withDatabaseReadQuerySession(createDatabaseReadQuerySession(base.db), context => runDatabaseRealmQuery(realm, context, name, cloneDatabaseSerializableValue(input)));
    const head = () => base.db.query('SELECT * FROM _calendar_series_run_state WHERE id=?').get(runId) as Record<string, unknown>;
    const prepare = (limit = 256) => {
      for (let steps = 0; steps < 10000; steps++) {
        const q = head(); if (JSON.parse(String(q.publication_cursor_json)).phase === 'ready') return steps;
        execute(transport!.sealSource(source, 'calendar.series.run.seal', h(['prepare', runId, q.revision]), { runId, expectedRevision: Number(q.revision), limit }));
      }
      throw new Error('Synthetic bounded preparation made no terminal progress');
    };
    let publicationPacket: CalendarSeriesNativePacket | undefined;
    const publish = () => {
      publicationPacket ??= transport!.sealSource(source, 'calendar.series.run.publish', 'publish', { runId, expectedRevision: Number(head().revision) });
      return execute(publicationPacket);
    };
    const cleanup = (limit = 128) => {
      for (let turns = 0; turns < 10000; turns++) {
        const observed = query('calendar.series.run', { scopeId: scope, ownerId, seriesId, runId }) as unknown as { cleanupPending: boolean };
        if (!observed.cleanupPending) return turns;
        const q = head(), retained = JSON.parse(String((base.db.query('SELECT source_binding_json FROM _calendar_series_runs WHERE id=?').get(runId) as Record<string, unknown>).source_binding_json));
        execute(transport!.sealRetirement(retained, h(['cleanup', runId, q.revision]), { runId, expectedRevision: Number(q.revision), limit, cleanupOnly: q.state === 'published' }));
      }
      throw new Error('Synthetic bounded cleanup made no terminal progress');
    };
    return { base, db: base.db, reactive, source, snapshot, ownerRecord, batch, projection, transport, realm, resources, runId, actor, beginPayload, execute, begin, command, query, head, prepare, publish, cleanup,
      stage: (cursor = projection, rowLimit = 256) => { const step = advanceCalendarSeriesProjection(cursor, { rowLimit }); return { step, result: execute(transport!.sealProjection(source, step.cursor, step.stepDigest)) }; },
      close() { transport?.close(); reactive.dispose(); base.close(); } };
  } catch (error) { transport?.close(); reactive.dispose(); base.close(); throw error; }
}
