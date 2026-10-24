/** Request/background projection; live Guardian scope and authority are injected, never accepted from request JSON. */
import type { RequestAuthorizationAccess } from '../auth/authorization-access';
import type { ServiceDataScope } from '../auth/service-data-scope';
import type { LoggingRuntime } from './logging-runtime';
import type { LoggingContext, LoggingEventInput, LoggingReadScope } from './logging-contracts';
import { LOGGING_BROWSER_ACTIONS, type LoggingObservation, type ScopedLogging } from './logging-api-contracts';
import { LoggingError } from './logging-error';
import { captureLoggingEvent, loggingArray, loggingByteLength, loggingCanonical, loggingChoice, loggingId, loggingRecord, loggingTime } from './logging-validation';
import { loggingDigest } from './logging-hash';
import { normalizeLoggingQuery } from './logging-query';
import { runWithLoggingAttribution } from './logging-attribution';
import { createLoggingProjectionStream } from './logging-stream';

const rateWindows = new WeakMap<LoggingRuntime, Map<string, { start: number; count: number }>>();
const readWindows = new WeakMap<LoggingRuntime, Map<string, { expires: number; admission: Promise<void> }>>();

/** Every yielding operation fences authority on both sides, and before any protected evidence release. */
export function createScopedLoggingService(runtime: LoggingRuntime, access: RequestAuthorizationAccess, scope: ServiceDataScope,
  revalidate: () => Promise<void>, assertCurrent: () => void, systemActor?: string): ScopedLogging {
  const readScope: LoggingReadScope = scope.scopeKind === 'tenant' ? { kind: 'tenant', tenantId: scope.tenantId! } : { kind: 'application' };
  const permit = (kind: keyof LoggingRuntime['config']['access']) => {
    const user = access.requireUser();
    const permission = runtime.config.access[kind];
    if (permission) access.requirePermission(permission);
    else access.requirePlatformAdmin();
    return user;
  };
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
  const readPage = async (stream: Parameters<ScopedLogging['page']>[0], query: Parameters<ScopedLogging['page']>[1] = {}, platform = false) => {
    const admitted = normalizeLoggingQuery(stream, platform ? { kind: 'platform' } : readScope, query);
    const authorize = () => { if (platform) { access.requirePlatformAdmin(); access.requireApplicationAuthorization(); } permit('read'); };
    await revalidate(); authorize(); await readAdmission((platform ? 'platform.' : '') + stream, admitted.query);
    const result = await runtime.page(stream, admitted.scope, admitted.query); await revalidate(); authorize(); return result;
  };
  return Object.freeze({
    page: (stream, query = {}) => readPage(stream, query),
    platformPage: (stream, query = {}) => readPage(stream, query, true),
    async stream(stream, query, signal, platform = false) {
      const admitted = normalizeLoggingQuery(stream, readScope, query);
      const first = await readPage(stream, admitted.query, platform);
      return createLoggingProjectionStream(runtime, stream, first, () => readPage(stream, admitted.query, platform), signal);
    },
    async record(input: LoggingEventInput) {
      const captured = captureLoggingEvent(context('backend'), input, runtime.config.metadataKeys);
      await revalidate(); assertCurrent();
      const result = await runtime.append(captured);
      await revalidate(); return result;
    },
    async observe(raw: readonly LoggingObservation[]) {
      assertCurrent(); const user = access.requireUser();
      if (user.credentialKind === 'api-key') throw new LoggingError('LOGGING_FORBIDDEN', 'Browser observation requires an interactive session.');
      const items = loggingArray(raw, 32);
      if (!items.length) return { accepted: 0 };
      const now = Date.now(), key = loggingDigest([user.userId, user.sessionId ?? null, scope.scopeKind, scope.tenantId]);
      let windows = rateWindows.get(runtime); if (!windows) rateWindows.set(runtime, windows = new Map());
      for (const [id, window] of windows) if (now - window.start >= 60000) windows.delete(id);
      const window = windows.get(key) ?? { start: now, count: 0 };
      if (window.count + items.length > 240 || !windows.has(key) && windows.size >= 4096) throw new LoggingError('LOGGING_BACKPRESSURE', 'Browser logging rate exceeded.');
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
      window.count += items.length; windows.set(key, window);
      await revalidate(); assertCurrent();
      let accepted = 0;
      for (const event of events) { assertCurrent(); if (await runtime.append(event)) accepted++; }
      await revalidate(); return Object.freeze({ accepted });
    },
    async collectionPolicy() {
      await revalidate(); access.requireUser();
      return Object.freeze({ enabled: runtime.config.policy.enabled, capture: runtime.config.policy.capture, heartbeatMs: 30000, idleMs: 60000 });
    },
    async health() {
      await revalidate(); permit('read'); const d = runtime.diagnostics();
      const streams = Object.values(d.streams) as { pendingEvents: number; failed: number }[];
      return Object.freeze({ state: d.state, preset: d.preset, coverage: d.coverage,
        pendingEvents: streams.reduce((n, s) => n + s.pendingEvents, 0), failedEvents: streams.reduce((n, s) => n + s.failed, 0),
        sourcePendingEvents: (d.sources?.application.queued ?? 0) + (d.sources?.guardian.queued ?? 0),
        sourceDeliveryFailures: d.sources?.failed ?? 0, maintenanceFailures: d.maintenanceFailed });
    },
    async run(operation) {
      const captured = context('backend'); await revalidate(); assertCurrent();
      const result = await runWithLoggingAttribution(runtime, captured, assertCurrent, operation);
      await revalidate(); return result;
    },
    async read(target, operation) {
      const attribution = context('backend');
      const captured = captureLoggingEvent(attribution, { id: crypto.randomUUID(), family: 'records', action: 'record.read.admitted', occurredAt: Date.now(), evidence: 'server-confirmed', outcome: 'attempted', target });
      await revalidate(); assertCurrent(); await runtime.deliver(captured); await revalidate();
      const result = await runWithLoggingAttribution(runtime, attribution, assertCurrent, operation);
      await revalidate(); await runtime.deliver(audit('record.read.prepared', {}, captured.target!)); await revalidate(); return result;
    },
    async evidence(before) { if (before !== undefined) loggingTime(before); await revalidate(); permit('read'); await readAdmission('evidence', { before: before ?? null }); const result = await runtime.evidence(readScope, before); await revalidate(); permit('read'); return result; },
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
    async verify(stream, afterOrdinal = 0, checkpoint) {
      loggingTime(afterOrdinal); let cp: typeof checkpoint;
      if (checkpoint !== undefined) {
        const r = loggingRecord(checkpoint, ['version', 'stream', 'ordinal', 'hash']);
        if (r.version !== 1 || r.stream !== stream || typeof r.hash !== 'string' || !/^[a-f0-9]{64}$/.test(r.hash)) throw new LoggingError('LOGGING_EVENT_INVALID', 'Checkpoint is invalid.');
        cp = Object.freeze({ version: 1, stream, ordinal: loggingTime(r.ordinal), hash: r.hash });
      }
      await revalidate(); access.requirePlatformAdmin(); permit('manage');
      const result = await runtime.verify(stream, afterOrdinal, cp); await revalidate(); access.requirePlatformAdmin(); permit('manage'); return result;
    },
  } satisfies ScopedLogging);
}
