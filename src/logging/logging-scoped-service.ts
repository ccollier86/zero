/** Request/background projection; live Guardian scope and authority are injected, never accepted from request JSON. */
import type { RequestAuthorizationAccess } from '../auth/authorization-access';
import type { ServiceDataScope } from '../auth/service-data-scope';
import type { LoggingRuntime } from './logging-runtime';
import type { LoggingContext, LoggingEventInput, LoggingQuery, LoggingReadScope } from './logging-contracts';
import { LOGGING_BROWSER_ACTIONS, type LoggingObservation, type ScopedLogging } from './logging-api-contracts';
import { LoggingError } from './logging-error';
import { captureLoggingEvent, loggingArray, loggingByteLength, loggingCanonical, loggingChoice, loggingId, loggingRecord, loggingTime } from './logging-validation';
import { loggingDigest } from './logging-hash';
import { normalizeLoggingQuery } from './logging-query';
import { runWithLoggingAttribution } from './logging-attribution';
import { createLoggingProjectionStream } from './logging-stream';
import { normalizeLoggingEvidenceCursor } from './logging-evidence-cursor';
import { AuthError } from '../auth/types';
import { readOwnedLoggingExport } from './logging-export-validation';
import { LOGGING_EXPORT_NAMESPACE } from './logging-export-manager';

const rateWindows = new WeakMap<LoggingRuntime, Map<string, { start: number; count: number }>>();
const readWindows = new WeakMap<LoggingRuntime, Map<string, { expires: number; admission: Promise<void> }>>();

/** Every yielding operation fences authority on both sides, and before any protected evidence release. */
export function createScopedLoggingService(runtime: LoggingRuntime, access: RequestAuthorizationAccess, scope: ServiceDataScope,
  revalidate: () => Promise<void>, assertCurrent: () => void, systemActor?: string, getProperties: () => Readonly<Record<string, string>> = () => ({}), assertWorkAdmission: () => void = () => {}): ScopedLogging {
  const readScope: LoggingReadScope = scope.scopeKind === 'tenant' ? { kind: 'tenant', tenantId: scope.tenantId! } : { kind: 'application' };
  const permit = (kind: keyof LoggingRuntime['config']['access']) => {
    assertWorkAdmission();
    const user = access.requireUser();
    const permission = runtime.config.access[kind];
    if (permission) access.requirePermission(permission);
    else access.requirePlatformAdmin();
    return user;
  };
  const permitPlatformManagement = () => { access.requirePlatformAdmin(); access.requireApplicationAuthorization(); permit('manage'); };
  const context = (origin: 'backend' | 'frontend', collector?: string): LoggingContext => {
    assertCurrent();
    if (systemActor && !access.context?.userId && origin === 'backend') return {
      sourceId: 'system:' + loggingDigest([systemActor, scope]), origin: 'system',
      scope: scope.scopeKind === 'tenant' ? { kind: 'tenant', tenantId: scope.tenantId! } : { kind: 'application', tenantId: null },
      actor: { kind: 'system', id: systemActor, sessionId: null, initiatorId: null }, requestId: null, correlationId: null, policyVersion: runtime.config.policyVersion,
    };
    const user = access.requireUser();
    return { sourceId: origin === 'frontend' ? 'browser:' + loggingDigest([user.userId, user.sessionId ?? null, scope.scopeKind, scope.tenantId, collector]) : 'request:' + loggingDigest([user.userId, scope.scopeKind, scope.tenantId]),
      origin, scope: scope.scopeKind === 'tenant' ? { kind: 'tenant', tenantId: scope.tenantId! } : { kind: 'application', tenantId: null },
      actor: { kind: user.credentialKind === 'api-key' ? 'service' : 'user', id: user.credentialKind === 'api-key' ? user.credentialId ?? user.userId : user.userId,
        sessionId: user.sessionId ?? null, initiatorId: user.credentialKind === 'api-key' ? user.userId : null }, requestId: null, correlationId: null, policyVersion: runtime.config.policyVersion };
  };
  const audit = (action: string, metadata: Record<string, string | number | boolean> = {}, target?: { type: string; id: string }) =>
    captureLoggingEvent(context('backend'), { id: crypto.randomUUID(), family: action.startsWith('record.') ? 'records' : 'investigations', action, occurredAt: Date.now(), evidence: 'server-confirmed', outcome: 'succeeded', metadata, ...(target ? { target } : {}) }, Object.keys(metadata));
  const readAdmission = async (stream: string, query: unknown) => {
    const c = context('backend'), key = loggingDigest([c.actor, c.scope, stream, query]), now = Date.now();
    let windows = readWindows.get(runtime); if (!windows) readWindows.set(runtime, windows = new Map());
    for (const [id, entry] of windows) if (entry.expires <= now) windows.delete(id);
    const existing = windows.get(key); if (existing) { await existing.admission; return; }
    if (windows.size >= 4096) throw new LoggingError('LOGGING_BACKPRESSURE', 'Investigation admission capacity is exhausted.');
    const entry = { expires: now + 300000, admission: Promise.resolve() };
    entry.admission = runtime.deliver(audit('logging.query.window', { stream, criteriaDigest: loggingDigest(query), windowMs: 300000 })).then(() => {}).catch(error => { if (windows!.get(key) === entry) windows!.delete(key); throw error; });
    windows.set(key, entry); await entry.admission; assertCurrent();
  };
  const investigationCriteria = (query: LoggingQuery) => {
    // Page cursors and internal INSERT-membership lookups belong to the same
    // investigation window. Auditing every such RPC would make a live audit
    // table recursively observe the queries caused by its own inserted rows.
    const { limit: _limit, beforeOrdinal: _before, highWaterOrdinal: _highWater, eventIds: _ids, ...criteria } = query;
    return criteria;
  };
  const readPage = async (stream: Parameters<ScopedLogging['page']>[0], query: Parameters<ScopedLogging['page']>[1] = {}, platform = false) => {
    const admitted = normalizeLoggingQuery(stream, platform ? { kind: 'platform' } : readScope, query);
    const caller = context('backend');
    const authorize = async () => {
      try { if (platform) { access.requirePlatformAdmin(); access.requireApplicationAuthorization(); } permit('read'); }
      catch (error) {
        await runtime.deliver(captureLoggingEvent(caller, { id: crypto.randomUUID(), family: 'investigations', action: 'logging.query.denied',
          occurredAt: Date.now(), outcome: 'denied', evidence: 'server-confirmed',
          metadata: { stream, criteriaDigest: loggingDigest(investigationCriteria(admitted.query)) } }, ['stream', 'criteriaDigest']));
        throw error;
      }
    };
    await revalidate(); await authorize(); await readAdmission((platform ? 'platform.' : '') + stream, investigationCriteria(admitted.query));
    const result = await runtime.page(stream, admitted.scope, admitted.query); await revalidate(); await authorize(); return result;
  };
  return Object.freeze({
    page: (stream, query = {}) => readPage(stream, query),
    platformPage: (stream, query = {}) => readPage(stream, query, true),
    async stream(stream, query, signal, platform = false, afterOrdinal) {
      if (afterOrdinal !== undefined && (!Number.isSafeInteger(afterOrdinal) || afterOrdinal < 0)) throw new LoggingError('LOGGING_QUERY_INVALID', 'Logging change cursor is invalid.');
      const admitted = normalizeLoggingQuery(stream, readScope, query);
      const first = await readPage(stream, admitted.query, platform);
      return createLoggingProjectionStream(runtime, stream, first, () => readPage(stream, admitted.query, platform), signal,
        afterOrdinal === undefined ? undefined : { afterOrdinal, read: async after => {
          await revalidate();
          if (platform) { access.requirePlatformAdmin(); access.requireApplicationAuthorization(); } permit('read');
          const result = await runtime.changes(stream, platform ? { kind: 'platform' } : readScope, { ...admitted.query, limit: 100 }, after);
          await revalidate();
          if (platform) { access.requirePlatformAdmin(); access.requireApplicationAuthorization(); } permit('read');
          return result;
        } });
    },
    async record(input: LoggingEventInput) {
      const captured = captureLoggingEvent(context('backend'), input, runtime.config.metadataKeys);
      await revalidate(); assertCurrent();
      const result = await runtime.append(captured);
      await revalidate(); return result;
    },
    async observe(raw: readonly LoggingObservation[], policyVersion?: string) {
      assertCurrent(); const user = access.requireUser();
      if (user.credentialKind === 'api-key') throw new LoggingError('LOGGING_FORBIDDEN', 'Browser observation requires an interactive session.');
      if (runtime.config.policy.complianceRequested && policyVersion !== runtime.config.policyVersion) throw new LoggingError('LOGGING_ADMISSION_REQUIRED', 'The current audit delivery policy is required.');
      const items = loggingArray(raw, 32);
      if (!items.length && !runtime.config.policy.complianceRequested) return { accepted: 0 };
      const now = Date.now(), key = loggingDigest([user.userId, user.sessionId ?? null, scope.scopeKind, scope.tenantId]);
      let windows = rateWindows.get(runtime); if (!windows) rateWindows.set(runtime, windows = new Map());
      for (const [id, window] of windows) if (now - window.start >= 60000) windows.delete(id);
      const window = windows.get(key) ?? { start: now, count: 0 };
      const charge = Math.max(1, items.length);
      if (window.count + charge > 240 || !windows.has(key) && windows.size >= 4096) throw new LoggingError('LOGGING_BACKPRESSURE', 'Browser logging rate exceeded.');
      // Validate the complete batch before admitting any part. Browser clocks/durations remain observations.
      const events = items.map(value => {
        const r = loggingRecord(value, ['id', 'collectorId', 'action', 'occurredAt', 'target', 'interval']);
        const action = loggingChoice(r.action, Object.keys(LOGGING_BROWSER_ACTIONS) as (keyof typeof LOGGING_BROWSER_ACTIONS)[]);
        const occurredAt = loggingTime(r.occurredAt); if (Math.abs(now - occurredAt) > 300000) throw new LoggingError('LOGGING_EVENT_INVALID', 'Browser observation clock is outside its admission window.');
        const metadata: Record<string, string | number | boolean> = {};
        const isView = LOGGING_BROWSER_ACTIONS[action] === 'views';
        if (isView !== (r.interval !== undefined)) throw new LoggingError('LOGGING_EVENT_INVALID', 'Viewing observations require a sequenced interval.');
        if (r.interval !== undefined) {
          const interval = loggingRecord(r.interval, ['viewId', 'sequence', 'elapsedMs', 'visibleMs', 'activeMs', 'incomplete']);
          metadata.viewId = loggingId(interval.viewId)!;
          for (const field of ['sequence', 'elapsedMs', 'visibleMs', 'activeMs'] as const) {
            const n = interval[field]; if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0 || (field !== 'sequence' && n > 60000)) throw new LoggingError('LOGGING_EVENT_INVALID', 'Invalid observed interval.');
            metadata[field] = n;
          }
          if (Number(interval.activeMs) > Number(interval.visibleMs) || Number(interval.visibleMs) > Number(interval.elapsedMs) || typeof interval.incomplete !== 'boolean') throw new LoggingError('LOGGING_EVENT_INVALID', 'Invalid observed interval.');
          metadata.incomplete = interval.incomplete;
        }
        const c = context('frontend', loggingId(r.collectorId)!);
        const suppliedId = loggingId(r.id)!;
        const id = isView ? 'view:' + loggingDigest([metadata.viewId, metadata.sequence]) : suppliedId;
        return captureLoggingEvent(c, { id, family: LOGGING_BROWSER_ACTIONS[action], action, occurredAt,
          outcome: 'attempted', evidence: 'browser-observed', target: r.target, metadata } as LoggingEventInput, Object.keys(metadata));
      });
      window.count += charge; windows.set(key, window);
      await revalidate(); assertCurrent();
      let accepted = 0;
      for (const event of events) { assertCurrent(); if (await runtime.append(event)) accepted++; }
      await revalidate();
      const admission = runtime.config.policy.complianceRequested
        ? await runtime.admission.acknowledge({ auth: user, properties: getProperties() }, context('backend'), policyVersion ?? '', revalidate)
        : undefined;
      return Object.freeze({ accepted, ...(admission ? { admission } : {}) });
    },
    async collectionPolicy() {
      await revalidate(); access.requireUser();
      return Object.freeze({ enabled: runtime.config.policy.enabled, capture: runtime.config.policy.capture, heartbeatMs: 30000, idleMs: 60000,
        durableExports: Boolean(runtime.exports),
        ...(runtime.config.policy.complianceRequested ? { delivery: { required: true as const, policyVersion: runtime.config.policyVersion, ttlMs: runtime.admission.ttlMs } } : {}) });
    },
    async health() {
      await revalidate(); permitPlatformManagement(); const d = runtime.diagnostics();
      const streams = Object.values(d.streams) as { pendingEvents: number; failed: number }[];
      return Object.freeze({ state: d.state === 'ready' && (d.deliveryWorker?.state === 'recovering' || d.custody?.state === 'unavailable' || d.unavailableSources > 0) ? 'recovering' : d.state, preset: d.preset, coverage: d.coverage,
        pendingEvents: streams.reduce((n, s) => n + s.pendingEvents, 0), failedEvents: streams.reduce((n, s) => n + s.failed, 0),
        sourcePendingEvents: (d.sources?.application.queued ?? 0) + (d.sources?.guardian.queued ?? 0) + (d.fabricSources?.queued ?? 0),
        sourceDiscoveryPending: d.fabricSources?.pendingSources ?? 0,
        sourceDeliveryFailures: (d.sources?.failed ?? 0) + (d.fabricSources?.failed ?? 0) + (d.deliveryWorker?.failures ?? 0), maintenanceFailures: d.maintenanceFailed });
    },
    async run(operation) {
      const captured = context('backend'); await revalidate(); assertCurrent(); assertWorkAdmission();
      const result = await runWithLoggingAttribution(runtime, captured, () => { assertCurrent(); assertWorkAdmission(); }, operation);
      await revalidate(); assertWorkAdmission(); return result;
    },
    async read(target, operation) {
      const attribution = context('backend');
      const operationId = crypto.randomUUID();
      const stage = (action: string, outcome: LoggingEventInput['outcome']) => captureLoggingEvent(attribution, {
        id: operationId + ':' + action, family: 'records', action, occurredAt: Date.now(), evidence: 'server-confirmed', outcome, target,
      });
      // Snapshot the target before the first await. Later caller mutation must
      // not change the identity of the release/failure stage.
      const captured = stage('record.read.admitted', 'attempted');
      await revalidate(); assertCurrent(); assertWorkAdmission(); await runtime.deliver(captured); await revalidate(); assertWorkAdmission();
      let result;
      try {
        result = await runWithLoggingAttribution(runtime, attribution, () => { assertCurrent(); assertWorkAdmission(); }, operation);
        await revalidate(); assertWorkAdmission();
      } catch (error) {
        // Never retain exception messages, SQL, query content or provider bodies.
        // A failed read is not a successful preparation/release. An unknown
        // operation outcome is not falsely converted into a definite failure.
        const unknown = error !== null && typeof error === 'object'
          && Object.getOwnPropertyDescriptor(error, 'outcome')?.value === 'unknown';
        const outcome = unknown ? 'unknown' : error instanceof AuthError ? 'denied' : 'failed';
        await runtime.deliver(captureLoggingEvent(attribution, { id: operationId + ':terminal', family: 'records',
          action: 'record.read.' + outcome, occurredAt: Date.now(), evidence: 'server-confirmed', outcome, target: captured.target }));
        throw error;
      }
      await runtime.deliver(captureLoggingEvent(attribution, { id: operationId + ':terminal', family: 'records',
        action: 'record.read.prepared', occurredAt: Date.now(), evidence: 'server-confirmed', outcome: 'succeeded', target: captured.target }));
      await revalidate(); assertWorkAdmission(); return result;
    },
    async evidence(before) { const cursor = normalizeLoggingEvidenceCursor(before); await revalidate(); permit('read'); await readAdmission('evidence', { before: cursor ?? null }); const result = await runtime.evidence(readScope, cursor); await revalidate(); permit('read'); return result; },
    async hold(input) {
      const r = loggingRecord(input, ['id', 'since', 'until', 'reasonRef']);
      const detached = { id: loggingId(r.id)!, since: loggingTime(r.since), until: loggingTime(r.until), reasonRef: loggingId(r.reasonRef)! };
      if (detached.since >= detached.until) throw new LoggingError('LOGGING_EVENT_INVALID', 'Hold interval is invalid.');
      await revalidate(); const user = permit('hold');
      const result = await runtime.evidenceCommand('logging.hold', { ...detached, scope: readScope, actorId: user.userId, auditEvent: audit('logging.hold.created', {}, { type: 'logging.hold', id: detached.id }) });
      await revalidate(); permit('hold'); const receipt = loggingRecord(result, ['id', 'active']);
      if (receipt.id !== detached.id || typeof receipt.active !== 'boolean') throw new LoggingError('LOGGING_RESPONSE_INVALID', 'Hold acknowledgment is invalid.', 'unknown');
      return Object.freeze({ id: detached.id, active: receipt.active });
    },
    async releaseHold(id) {
      loggingId(id); await revalidate(); const user = permit('hold');
      const result = await runtime.evidenceCommand('logging.hold', { id, scope: readScope, actorId: user.userId, release: true, auditEvent: audit('logging.hold.released', {}, { type: 'logging.hold', id }) });
      await revalidate(); permit('hold'); const receipt = loggingRecord(result, ['id', 'active']);
      if (receipt.id !== id || receipt.active !== false) throw new LoggingError('LOGGING_RESPONSE_INVALID', 'Hold release acknowledgment is invalid.', 'unknown');
      return Object.freeze({ id, active: false });
    },
    async review(input) {
      const r = loggingRecord(input, ['id', 'query', 'highWaterOrdinal', 'result', 'reference']);
      const admitted = normalizeLoggingQuery('audit', readScope, r.query as Parameters<ScopedLogging['page']>[1]);
      const id = loggingId(r.id)!, reference = loggingId(r.reference)!, highWaterOrdinal = loggingTime(r.highWaterOrdinal), resultKind = loggingChoice(r.result, ['reviewed', 'follow-up'] as const);
      await revalidate(); permit('read'); const user = permit('review');
      const result = await runtime.evidenceCommand('logging.review', { id, query: admitted.query, highWaterOrdinal, reference, result: resultKind, scope: readScope, actorId: user.userId, auditEvent: audit('logging.review.recorded', {}, { type: 'logging.review', id }) });
      await revalidate(); permit('review'); const receipt = loggingRecord(result, ['id', 'reviewedAt']);
      if (receipt.id !== id) throw new LoggingError('LOGGING_RESPONSE_INVALID', 'Review acknowledgment is invalid.', 'unknown');
      return Object.freeze({ id, reviewedAt: loggingTime(receipt.reviewedAt) });
    },
    async export(stream, query = {}) {
      if (runtime.config.policy.complianceRequested) throw new LoggingError('LOGGING_FORBIDDEN', 'Strict evidence exports require createExport() and a separately authorized download.');
      const capturedQuery = normalizeLoggingQuery(stream, readScope, query);
      const admitted = normalizeLoggingQuery(stream, readScope, { ...capturedQuery.query, limit: 100 });
      await revalidate(); permit('read'); permit('export'); await readAdmission('export', admitted.query);
      let highWater: number | undefined = admitted.query.highWaterOrdinal, before = admitted.query.beforeOrdinal;
      const lines: string[] = []; let complete = false, bytes = 0;
      for (let page = 0; page < 10; page++) {
        const result = await runtime.page(stream, readScope, { ...admitted.query, ...(highWater === undefined ? {} : { highWaterOrdinal: highWater }), ...(before === undefined ? {} : { beforeOrdinal: before }) });
        await revalidate(); permit('read'); permit('export'); highWater = result.highWaterOrdinal;
        for (const row of result.events) {
          const line = loggingCanonical(row); const size = loggingByteLength(line);
          if (bytes + size > 8 * 1024 * 1024) throw new LoggingError('LOGGING_BACKPRESSURE', 'Export byte budget exceeded; narrow the query.');
          lines.push(line); bytes += size;
        }
        before = result.nextBeforeOrdinal ?? undefined;
        if (!result.hasMore) { complete = true; break; }
      }
      const ndjson = lines.length ? lines.join('\n') + '\n' : '', id = crypto.randomUUID();
      const sha256 = new Bun.CryptoHasher('sha256').update(ndjson).digest('hex');
      await runtime.deliver(audit('logging.export.generated', { count: lines.length, highWaterOrdinal: highWater ?? 0, complete, sha256 }, { type: 'logging.export', id }));
      await revalidate(); permit('read'); permit('export');
      return Object.freeze({ version: 1 as const, id, stream, highWaterOrdinal: highWater ?? 0, count: lines.length, complete, nextBeforeOrdinal: complete ? null : before ?? null, sha256, ndjson });
    },
    async createExport(input) {
      const r = loggingRecord(input, ['id', 'stream', 'query']);
      const id = loggingId(r.id)!, stream = loggingChoice(r.stream, ['audit', 'operational'] as const);
      const admitted = normalizeLoggingQuery(stream, readScope, r.query as Parameters<ScopedLogging['page']>[1]);
      await revalidate(); const user = permit('export'); permit('read');
      if (!runtime.exports) throw new LoggingError('LOGGING_NOT_READY', 'Private export storage is unavailable.');
      const prior = await runtime.exportJob(readScope, id);
      await revalidate(); permit('read'); permit('export');
      const first = prior ? null : await runtime.page(stream, readScope, { ...admitted.query, limit: 1 });
      const query = { ...admitted.query, limit: 100, highWaterOrdinal: prior?.job.highWaterOrdinal ?? first!.highWaterOrdinal };
      const queryDigest = loggingDigest([stream, readScope, query]);
      await revalidate(); permit('read'); permit('export');
      const raw = await runtime.evidenceCommand('logging.export.reserve', { id, stream, scope: readScope, query, actorId: user.userId, expiresAt: Date.now() + 3600000,
        auditEvent: audit('logging.export.requested', { queryDigest }, { type: 'logging.export', id }) });
      const owned = readOwnedLoggingExport(raw);
      await revalidate(); permit('read'); permit('export');
      const result = await runtime.exports.materialize(owned);
      await revalidate(); permit('read'); permit('export'); return result;
    },
    async exportJob(id) {
      loggingId(id); await revalidate(); permit('read'); permit('export');
      const result = await runtime.exportJob(readScope, id);
      await revalidate(); permit('read'); permit('export'); return result?.job ?? null;
    },
    async openExport(id) {
      loggingId(id); await revalidate(); permit('read'); permit('export');
      const owned = await runtime.exportJob(readScope, id), manager = runtime.exports;
      if (!manager || !owned || owned.job.state !== 'ready' || owned.job.expiresAt <= Date.now()) throw new LoggingError('LOGGING_FORBIDDEN', 'Export is unavailable or expired.');
      const job = owned.job, attribution = context('backend'), operationId = crypto.randomUUID();
      const fence = () => { assertCurrent(); permit('read'); permit('export'); if (job.expiresAt <= Date.now()) throw new LoggingError('LOGGING_FORBIDDEN', 'Export access expired.'); };
      await runtime.deliver(audit('logging.export.download.admitted', {}, { type: 'logging.export', id }));
      await revalidate(); fence();
      const opened = await manager.storage.get(LOGGING_EXPORT_NAMESPACE, id, fence);
      try { await revalidate(); fence(); }
      catch (error) { await opened?.stream.cancel().catch(() => {}); throw error; }
      if (!opened || opened.object.checksum !== job.sha256 || opened.object.sizeBytes > 8 * 1024 * 1024 + 16384) {
        await opened?.stream.cancel().catch(() => {}); throw new LoggingError('LOGGING_INTEGRITY_FAILED', 'Export artifact does not match its evidence receipt.');
      }
      const reader = opened.stream.getReader(), hash = new Bun.CryptoHasher('sha256');
      let done = false, bytes = 0, remove = () => {};
      const release = () => { try { reader.releaseLock(); } catch { /* Never replace the actual read/cancel outcome with native cleanup behavior. */ } };
      const cancel = async () => { try { await reader.cancel(); } catch { /* The terminal evidence records interruption. */ } finally { release(); } };
      const terminal = async (complete: boolean) => {
        if (done) return; done = true; remove();
        await runtime.deliver(captureLoggingEvent(attribution, { id: operationId + ':terminal', family: 'investigations',
          action: complete ? 'logging.export.stream.completed' : 'logging.export.stream.incomplete', occurredAt: Date.now(),
          outcome: complete ? 'succeeded' : 'unknown', evidence: complete ? 'server-confirmed' : 'incomplete', target: { type: 'logging.export', id } }));
      };
      let stream: ReadableStream<Uint8Array>;
      try { stream = new ReadableStream<Uint8Array>({
        start(controller) {
          remove = runtime.subscribe('audit', () => {}, () => {
            if (done) return; done = true; remove(); void cancel();
            try { controller.error(new LoggingError('LOGGING_CLOSED', 'Export stream stopped.')); } catch { /* Already retired. */ }
          });
        },
        async pull(controller) {
          try {
            await revalidate(); fence(); const chunk = await reader.read(); await revalidate(); fence();
            if (chunk.done) {
              if (bytes !== opened.object.sizeBytes || hash.digest('hex') !== job.sha256) throw new LoggingError('LOGGING_INTEGRITY_FAILED', 'Export bytes failed integrity verification.');
              release(); await terminal(true); await revalidate(); fence(); controller.close(); return;
            }
            bytes += chunk.value.byteLength;
            if (bytes > opened.object.sizeBytes) throw new LoggingError('LOGGING_INTEGRITY_FAILED', 'Export artifact length is invalid.');
            hash.update(chunk.value); controller.enqueue(chunk.value);
          } catch (error) { await cancel(); await terminal(false).catch(() => {}); controller.error(error); }
        },
        async cancel() { await cancel(); await terminal(false).catch(() => {}); },
      }); } catch (error) { await cancel(); remove(); throw error; }
      return Object.freeze({ job, stream });
    },
    async verify(stream, afterOrdinal = 0, checkpoint) {
      loggingTime(afterOrdinal); let cp: typeof checkpoint;
      if (checkpoint !== undefined) {
        const r = loggingRecord(checkpoint, ['version', 'stream', 'ordinal', 'hash']);
        if (r.version !== 1 || r.stream !== stream || typeof r.hash !== 'string' || !/^[a-f0-9]{64}$/.test(r.hash)) throw new LoggingError('LOGGING_EVENT_INVALID', 'Checkpoint is invalid.');
        cp = Object.freeze({ version: 1, stream, ordinal: loggingTime(r.ordinal), hash: r.hash });
      }
      await revalidate(); permitPlatformManagement();
      const result = await runtime.verify(stream, afterOrdinal, cp); await revalidate(); permitPlatformManagement(); return result;
    },
  } satisfies ScopedLogging);
}
