/** Authenticated browser transport for durable control-plane audit records. */

import type {
  AuthAuditActorProvenance,
  AuthAuditEvent,
  AuthAuditExport,
  AuthAuditMetadata,
  AuthAuditOutcome,
  AuthAuditPage,
  AuthAuditPruneResult,
  AuthAuditQuery,
  AuthAuditReadScope,
  AuthAuditSdkSurface,
} from './auth-audit-types';

const MAX_PAGE_EVENTS = 100;
const MAX_EXPORT_EVENTS = 1_000;
const MAX_PRUNE_BATCH_SIZE = 10_000;
const MAX_EXPORT_BYTES = 8 * 1_024 * 1_024;
const MAX_ID_LENGTH = 200;
const MAX_CODE_LENGTH = 100;
const MAX_CURSOR_LENGTH = 512;
const MAX_METADATA_KEYS = 16;
const MAX_METADATA_STRING_LENGTH = 200;
const MAX_METADATA_JSON_BYTES = 2_048;
const MAX_DATE_MS = 8_640_000_000_000_000;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const CODE_PATTERN = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/;
const FORBIDDEN_METADATA_KEY = /(email|password|secret|token|credential|authorization|cookie|address|phone|name)/i;
const PROVENANCE = new Set<AuthAuditActorProvenance>([
  'authenticated-request',
  'bootstrap',
  'account-recovery',
  'registration',
  'system',
]);
const OUTCOMES = new Set<AuthAuditOutcome>(['succeeded', 'denied', 'failed']);

export interface AuthAuditTransportOptions {
  baseUrl: string;
  authenticatedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  createResponseError: (response: Response, body: unknown, fallback: string) => Error;
  assertResponseCurrent: (response: Response) => void;
}

export class AuthAuditTransport implements AuthAuditSdkSurface {
  constructor(private readonly options: AuthAuditTransportOptions) {}

  list(scope: AuthAuditReadScope, query: AuthAuditQuery = {}): Promise<AuthAuditPage> {
    return this.request(
      `/auth/audit/${scope}/events${querySuffix(query)}`,
      undefined,
      'Failed to load authorization audit events',
      parsePage,
    );
  }

  export(scope: AuthAuditReadScope, query: AuthAuditQuery = {}): Promise<AuthAuditExport> {
    return this.request(
      `/auth/audit/${scope}/export${querySuffix(query)}`,
      undefined,
      'Failed to export authorization audit events',
      parseExport,
    );
  }

  prune(): Promise<AuthAuditPruneResult> {
    return this.request(
      '/auth/audit/platform/prune',
      { method: 'POST' },
      'Failed to prune authorization audit events',
      parsePruneResult,
    );
  }

  private async request<T>(
    path: string,
    init: RequestInit | undefined,
    fallback: string,
    parse: (body: unknown) => T,
  ): Promise<T> {
    const response = await this.options.authenticatedFetch(
      `${this.options.baseUrl}${path}`,
      { ...init, cache: 'no-store' },
    );
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw this.options.createResponseError(response, body, fallback);
    }
    let result: T;
    try {
      result = parse(body);
    } catch {
      throw new Error(`${fallback}: server returned an invalid response.`);
    }
    this.options.assertResponseCurrent(response);
    return result;
  }
}

function querySuffix(query: AuthAuditQuery): string {
  const params = new URLSearchParams();
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.action) params.set('action', query.action);
  if (query.outcome) params.set('outcome', query.outcome);
  if (query.from !== undefined) params.set('from', String(query.from));
  if (query.to !== undefined) params.set('to', String(query.to));
  if (query.targetType) params.set('targetType', query.targetType);
  return params.size > 0 ? `?${params}` : '';
}

function parsePage(value: unknown): AuthAuditPage {
  const object = requireObject(value);
  assertExactKeys(object, ['events', 'page']);
  const events = Reflect.get(object, 'events');
  if (!Array.isArray(events) || events.length > MAX_PAGE_EVENTS) throw invalid();
  const parsedEvents = Object.freeze(events.map(parseEvent));
  const page = parsePageInfo(Reflect.get(object, 'page'), MAX_PAGE_EVENTS);
  if (page.count !== parsedEvents.length) throw invalid();
  return Object.freeze({ events: parsedEvents, page });
}

function parseExport(value: unknown): AuthAuditExport {
  const object = requireObject(value);
  assertExactKeys(object, ['ndjson', 'count', 'hasMore', 'nextCursor']);
  const ndjson = Reflect.get(object, 'ndjson');
  const count = Reflect.get(object, 'count');
  const hasMore = Reflect.get(object, 'hasMore');
  const nextCursor = nullableBoundedString(Reflect.get(object, 'nextCursor'), MAX_CURSOR_LENGTH);
  if (typeof ndjson !== 'string' || utf8ByteLength(ndjson) > MAX_EXPORT_BYTES
    || !safeInteger(count, 0, MAX_EXPORT_EVENTS) || typeof hasMore !== 'boolean') {
    throw invalid();
  }
  const lines = ndjson === '' ? [] : ndjson.split('\n');
  if (lines.length !== count || lines.length > MAX_EXPORT_EVENTS) throw invalid();
  for (const line of lines) {
    if (!line || line.length > 8_192) throw invalid();
    parseEvent(JSON.parse(line) as unknown);
  }
  if (hasMore !== (nextCursor !== null)) throw invalid();
  return Object.freeze({ ndjson, count, hasMore, nextCursor });
}

function parsePruneResult(value: unknown): AuthAuditPruneResult {
  const object = requireObject(value);
  assertExactKeys(object, ['deleted', 'hasMore']);
  const deleted = Reflect.get(object, 'deleted');
  const hasMore = Reflect.get(object, 'hasMore');
  if (!safeInteger(deleted, 0, MAX_PRUNE_BATCH_SIZE) || typeof hasMore !== 'boolean') {
    throw invalid();
  }
  return Object.freeze({ deleted, hasMore });
}

function parseEvent(value: unknown): AuthAuditEvent {
  const object = requireObject(value);
  assertExactKeys(object, [
    'eventId',
    'occurredAt',
    'action',
    'outcome',
    'reason',
    'scopeKind',
    'tenantId',
    'actorUserId',
    'actorMembershipId',
    'actorSessionId',
    'actorSessionKind',
    'actorClientId',
    'actorProvenance',
    'requestId',
    'correlationId',
    'targetType',
    'targetId',
    'metadata',
  ]);
  const outcome = Reflect.get(object, 'outcome');
  const scopeKind = Reflect.get(object, 'scopeKind');
  const actorProvenance = Reflect.get(object, 'actorProvenance');
  const actorSessionKind = Reflect.get(object, 'actorSessionKind');
  const tenantId = nullableBoundedString(Reflect.get(object, 'tenantId'), MAX_ID_LENGTH);
  if (!OUTCOMES.has(outcome as AuthAuditOutcome)
    || (scopeKind !== 'application' && scopeKind !== 'tenant')
    || !PROVENANCE.has(actorProvenance as AuthAuditActorProvenance)
    || (actorSessionKind !== null && actorSessionKind !== 'web'
      && actorSessionKind !== 'native')
    || (scopeKind === 'tenant') !== (tenantId !== null)) throw invalid();
  const metadata = parseMetadata(Reflect.get(object, 'metadata'));
  return Object.freeze({
    eventId: boundedString(Reflect.get(object, 'eventId'), MAX_ID_LENGTH),
    occurredAt: boundedInteger(Reflect.get(object, 'occurredAt'), MAX_DATE_MS),
    action: boundedCode(Reflect.get(object, 'action'), MAX_CODE_LENGTH),
    outcome: outcome as AuthAuditOutcome,
    reason: nullableBoundedCode(Reflect.get(object, 'reason'), MAX_CODE_LENGTH),
    scopeKind,
    tenantId,
    actorUserId: nullableBoundedString(Reflect.get(object, 'actorUserId'), MAX_ID_LENGTH),
    actorMembershipId: nullableBoundedString(
      Reflect.get(object, 'actorMembershipId'), MAX_ID_LENGTH,
    ),
    actorSessionId: nullableBoundedString(Reflect.get(object, 'actorSessionId'), MAX_ID_LENGTH),
    actorSessionKind,
    actorClientId: nullableBoundedString(Reflect.get(object, 'actorClientId'), MAX_ID_LENGTH),
    actorProvenance: actorProvenance as AuthAuditActorProvenance,
    requestId: nullableBoundedString(Reflect.get(object, 'requestId'), MAX_ID_LENGTH),
    correlationId: nullableBoundedString(Reflect.get(object, 'correlationId'), MAX_ID_LENGTH),
    targetType: nullableBoundedCode(Reflect.get(object, 'targetType'), 64),
    targetId: nullableBoundedString(Reflect.get(object, 'targetId'), MAX_ID_LENGTH),
    metadata,
  });
}

function parsePageInfo(value: unknown, maxLimit: number): AuthAuditPage['page'] {
  const object = requireObject(value);
  assertExactKeys(object, ['limit', 'count', 'hasMore', 'nextCursor']);
  const limit = Reflect.get(object, 'limit');
  const count = Reflect.get(object, 'count');
  const hasMore = Reflect.get(object, 'hasMore');
  const nextCursor = nullableBoundedString(Reflect.get(object, 'nextCursor'), MAX_CURSOR_LENGTH);
  if (!safeInteger(limit, 1, maxLimit) || !safeInteger(count, 0, limit as number)
    || typeof hasMore !== 'boolean' || hasMore !== (nextCursor !== null)) throw invalid();
  return Object.freeze({ limit, count, hasMore, nextCursor });
}

function parseMetadata(value: unknown): AuthAuditMetadata {
  const object = requireObject(value);
  const entries = Object.entries(object);
  if (entries.length > MAX_METADATA_KEYS) throw invalid();
  const parsed: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of entries) {
    if (key.length < 1 || key.length > 64 || !CODE_PATTERN.test(key)
      || FORBIDDEN_METADATA_KEY.test(key)
      || (item !== null && typeof item !== 'string'
        && typeof item !== 'number' && typeof item !== 'boolean')
      || (typeof item === 'string'
        && (item.length > MAX_METADATA_STRING_LENGTH || item.includes('@')))
      || (typeof item === 'number' && !Number.isFinite(item))) throw invalid();
    parsed[key] = item as string | number | boolean | null;
  }
  if (utf8ByteLength(JSON.stringify(parsed)) > MAX_METADATA_JSON_BYTES) throw invalid();
  return Object.freeze(parsed);
}

function assertExactKeys(value: object, expected: readonly string[]): void {
  const keys = Object.keys(value);
  if (keys.length !== expected.length) throw invalid();
  const allowed = new Set(expected);
  if (keys.some((key) => !allowed.has(key))) throw invalid();
}

function requireObject(value: unknown): object {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return value;
}

function boundedString(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max
    || !ID_PATTERN.test(value)) throw invalid();
  return value;
}

function nullableBoundedString(value: unknown, max: number): string | null {
  return value === null ? null : boundedString(value, max);
}

function boundedCode(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max
    || !CODE_PATTERN.test(value)) throw invalid();
  return value;
}

function nullableBoundedCode(value: unknown, max: number): string | null {
  return value === null ? null : boundedCode(value, max);
}

function boundedInteger(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (!safeInteger(value, 0, max)) throw invalid();
  return value as number;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function safeInteger(value: unknown, min: number, max: number): boolean {
  return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
}

function invalid(): Error {
  return new Error('Invalid auth audit response.');
}
