import { expect, test } from 'bun:test';
import { captureLoggingEvent, loggingArray, normalizeLoggingEvent } from './logging-validation';
import { loggingContext, loggingEvent } from './test-support/logging-fixture';
import { normalizeLoggingQuery, loggingPagePredicate } from './logging-query';
import { loggingRealm } from './logging-realm';
import type { DatabaseReadQueryContext } from '../databases/database-realm';

test('event capture freezes a detached context, target and metadata snapshot', () => {
  const context = loggingContext(), metadata = { count: 2 }, target = { type: 'record', id: 'record-1' };
  const captured = captureLoggingEvent(context, { id: 'detached', family: 'records', action: 'record.read',
    outcome: 'succeeded', evidence: 'server-confirmed', occurredAt: 1, target, metadata }, ['count']);
  metadata.count = 9; target.id = 'record-2'; (context.actor as any).id = 'other';
  expect(captured.metadata.count).toBe(2); expect(captured.target?.id).toBe('record-1'); expect(captured.actor.id).toBe('fixture-user');
  expect(Object.isFrozen(captured.actor)).toBe(true);
});
test('normalization preserves event identity and metadata ordering', () => {
  const event = loggingEvent(); expect(normalizeLoggingEvent(JSON.parse(JSON.stringify(event)))).toEqual(event);
});
test('metadata is denied by default, secret keys remain forbidden, and approved safe counters are supported', () => {
  const base = { id: 'event', family: 'ai' as const, action: 'ai.completed', outcome: 'succeeded' as const, evidence: 'server-confirmed' as const, occurredAt: 1 };
  expect(() => captureLoggingEvent(loggingContext(), { ...base, metadata: { detail: 'not admitted' } })).toThrow();
  for (const key of ['accessToken', 'sessionToken', 'id_token', 'csrfToken', 'privateKey', 'signing_key']) {
    expect(() => captureLoggingEvent(loggingContext(), { ...base, metadata: { [key]: 'synthetic' } }, [key])).toThrow();
  }
  expect(captureLoggingEvent(loggingContext(), { ...base, metadata: { inputTokens: 12 } }, ['inputTokens']).metadata.inputTokens).toBe(12);
});
test('browser observations cannot impersonate server or provider confirmation', () => {
  const context = { ...loggingContext(), origin: 'frontend' as const };
  const { version, stream, sourceId, origin, scope, actor, requestId, correlationId, policyVersion, ...input } = loggingEvent();
  expect(() => captureLoggingEvent(context, input)).toThrow();
  expect(captureLoggingEvent(context, { ...input, evidence: 'browser-observed' }).evidence).toBe('browser-observed');
  for (const origin of ['frontend', 'backend', 'system'] as const) {
    expect(() => captureLoggingEvent({ ...loggingContext(), origin }, { ...input, evidence: 'provider-confirmed' })).toThrow();
    expect(() => normalizeLoggingEvent({ ...loggingEvent(), origin, evidence: 'provider-confirmed' })).toThrow();
  }
});
test('getters, proxies and sparse/accessor arrays are rejected without evaluating application code', () => {
  let called = false;
  const unsafe = { ...loggingEvent(), get metadata() { called = true; return {}; } };
  expect(() => normalizeLoggingEvent(unsafe)).toThrow(); expect(called).toBe(false);
  const proxy = new Proxy({}, { ownKeys() { called = true; return []; } });
  expect(() => normalizeLoggingEvent(proxy)).toThrow(); expect(called).toBe(false);
  expect(() => loggingArray(new Array(2), 3)).toThrow();
  const array: unknown[] = []; Object.defineProperty(array, 0, { get() { called = true; return 1; }, enumerable: true });
  expect(() => loggingArray(array, 3)).toThrow(); expect(called).toBe(false);
});
test('invalid scopes, origin claims, oversized metadata and unknown fields never become valid envelopes', () => {
  for (const patch of [{ scope: { kind: 'application', tenantId: 'tenant-a' } }, { occurredAt: NaN }, { stream: 'operational' },
    { metadata: { payload: { nested: true } } }, { extra: true }, { version: 2 }, { metadata: { count: Infinity } }]) {
    expect(() => normalizeLoggingEvent({ ...loggingEvent(), ...patch })).toThrow();
  }
});
test('query predicates keep mandatory tenant scope and a fixed high-water boundary before optional filters', () => {
  const normalized = normalizeLoggingQuery('audit', { kind: 'tenant', tenantId: 'tenant-a' }, { since: 10, until: 20, actorId: 'user-1', beforeOrdinal: 100 });
  const compiled = loggingPagePredicate(normalized, 200);
  expect(compiled.sql).toContain('scope_kind = ? AND tenant_id = ?'); expect(compiled.sql).not.toContain('tenant-a');
  expect(compiled.values).toEqual(['audit', 200, 'tenant', 'tenant-a', 10, 20, 100, 'user-1']);
  for (const input of [{ limit: 0 }, { limit: 201 }, { limit: null }, { since: 20, until: 10 }, { beforeOrdinal: 0 }, { sql: 'SELECT *' }]) {
    expect(() => normalizeLoggingQuery('audit', { kind: 'platform' }, input as any)).toThrow();
  }
});

test('count suppression skips the COUNT statement entirely without changing scope or page selection', () => {
  const sql: string[] = [];
  const context = { database: { query(statement: string) {
    sql.push(statement);
    return { get: () => statement.includes('COUNT(*)') ? { count: 0 } : null, all: () => [] };
  } } } as unknown as DatabaseReadQueryContext;
  const input = { stream: 'audit', scope: { kind: 'tenant', tenantId: 'tenant-a' }, query: { limit: 1, includeTotal: false } };
  const helper = loggingRealm.queries['logging.page'](context, input);
  expect(helper).not.toHaveProperty('total'); expect(sql.some(statement => statement.includes('COUNT(*)'))).toBe(false);
  expect(sql.at(-1)).toContain('e.scope_kind = ? AND e.tenant_id = ?');
  sql.length = 0;
  const page = loggingRealm.queries['logging.page'](context, { ...input, query: { limit: 1 } });
  expect(page.total).toBe(0); expect(sql.filter(statement => statement.includes('COUNT(*)'))).toHaveLength(1);
  for (const includeTotal of [null, 0, 'false', {}, []]) {
    expect(() => normalizeLoggingQuery('audit', { kind: 'application' }, { includeTotal } as any)).toThrow();
  }
});
