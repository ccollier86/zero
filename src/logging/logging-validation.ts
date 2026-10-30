/** Server-side descriptor-safe validation and canonical snapshots. No getters, coercion or free-form bodies. */
import { types } from 'node:util';
import { LoggingError, type LoggingErrorCode } from './logging-error';
import {
  LOGGING_EVIDENCE, LOGGING_FAMILIES, LOGGING_LEVELS, LOGGING_OUTCOMES,
  type LoggingContext, type LoggingEvent, type LoggingEventInput, type LoggingScalar,
} from './logging-contracts';
import { normalizeLoggingActivityDetail } from './logging-activity-validation';
import { loggingTableTarget } from './logging-table-target';

export const LOGGING_MAX_EVENT_BYTES = 16_384;
export const LOGGING_MAX_BATCH = 256;
/** Leave headroom for Fabric's 1 MiB operation/result boundary and envelope accounting. */
export const LOGGING_MAX_BATCH_BYTES = 512 * 1024;
export const LOGGING_MAX_PAGE = 100;
const encoder = new TextEncoder();
const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const actionCode = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/;
const forbidden = /password|secret|cookie|authorization|credential|body|content|prompt|clipboard|patient|diagnosis|email|phone|address|(?:access|refresh|bearer|action|session|id|csrf|auth|oauth)[_-]?token|(?:api|private|signing)[_-]?key|^token$/i;

/** Read only enumerable plain data properties, rejecting proxies before inspecting descriptors. */
export function loggingRecord(value: unknown, keys?: readonly string[], code: LoggingErrorCode = 'LOGGING_EVENT_INVALID'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || types.isProxy(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid(code);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key) || keys && !keys.includes(key)) invalid(code);
    const descriptor = descriptors[key]!;
    if (!descriptor.enumerable || !('value' in descriptor)) invalid(code);
    result[key] = descriptor.value;
  }
  return result;
}

/** Detach dense ordinary arrays without invoking accessors or accepting extra/symbol properties. */
export function loggingArray(value: unknown, max: number): unknown[] {
  if (!value || typeof value !== 'object' || types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > max || Reflect.ownKeys(descriptors).length !== length + 1) invalid();
  const result: unknown[] = [];
  for (let i = 0; i < length; i++) {
    const descriptor = descriptors[String(i)];
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) invalid();
    result.push(descriptor.value);
  }
  return result;
}

export function loggingId(value: unknown, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !identifier.test(value)) invalid();
  return value;
}
export function loggingCode(value: unknown): string {
  if (typeof value !== 'string' || value.length > 120 || !actionCode.test(value)) invalid();
  return value;
}
export function loggingTime(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 8_640_000_000_000_000) invalid();
  return value;
}
export function loggingChoice<T extends string>(value: unknown, choices: readonly T[]): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) invalid();
  return value as T;
}
export function loggingByteLength(value: unknown): number { return encoder.encode(JSON.stringify(value)).byteLength; }

/** Canonical key order is explicit; this is not a general serializer for untrusted objects. */
export function loggingCanonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(loggingCanonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + loggingCanonical((value as Record<string, unknown>)[key])).join(',') + '}';
}

function context(value: unknown): LoggingContext {
  const r = loggingRecord(value, ['sourceId', 'origin', 'scope', 'actor', 'requestId', 'correlationId', 'policyVersion']);
  const scope = loggingRecord(r.scope, ['kind', 'tenantId']);
  const kind = loggingChoice(scope.kind, ['application', 'tenant'] as const);
  if (kind === 'application' && scope.tenantId !== null) invalid();
  const actor = loggingRecord(r.actor, ['kind', 'id', 'sessionId', 'initiatorId']);
  const actorKind = loggingChoice(actor.kind, ['user', 'service', 'system', 'anonymous'] as const);
  if (actorKind === 'anonymous' ? actor.id !== null : actor.id === null) invalid();
  return Object.freeze({
    sourceId: loggingId(r.sourceId)!, origin: loggingChoice(r.origin, ['backend', 'frontend', 'provider', 'system'] as const),
    scope: Object.freeze(kind === 'tenant' ? { kind, tenantId: loggingId(scope.tenantId)! } : { kind, tenantId: null }),
    actor: Object.freeze({ kind: actorKind, id: loggingId(actor.id, true), sessionId: loggingId(actor.sessionId, true), initiatorId: loggingId(actor.initiatorId, true) }),
    requestId: loggingId(r.requestId, true), correlationId: loggingId(r.correlationId, true), policyVersion: loggingId(r.policyVersion)!,
  });
}

function metadata(value: unknown, allowlist?: readonly string[]): Readonly<Record<string, LoggingScalar>> {
  const input = loggingRecord(value), output: Record<string, LoggingScalar> = Object.create(null);
  if (Object.keys(input).length > 32) invalid();
  for (const key of Object.keys(input).sort()) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) || forbidden.test(key) || allowlist && !allowlist.includes(key)) invalid();
    const item = input[key];
    if (item !== null && typeof item !== 'string' && typeof item !== 'boolean' && typeof item !== 'number') invalid();
    if (typeof item === 'number' && !Number.isFinite(item) || typeof item === 'string' && encoder.encode(item).byteLength > 256) invalid();
    output[key] = item as LoggingScalar;
  }
  return Object.freeze(output);
}

/** Capture a detached event before any await; metadata requires explicit approved keys, empty by default. */
export function captureLoggingEvent(trustedContext: LoggingContext, input: LoggingEventInput, metadataKeys: readonly string[] = []): LoggingEvent {
  const allowed = loggingArray(metadataKeys, 32);
  if (allowed.some(key => typeof key !== 'string')) invalid();
  const c = context(trustedContext);
  const r = loggingRecord(input, ['id', 'family', 'action', 'level', 'outcome', 'evidence', 'occurredAt', 'target', 'metadata', 'detail']);
  const family = loggingChoice(r.family, LOGGING_FAMILIES);
  const evidence = loggingChoice(r.evidence, LOGGING_EVIDENCE);
  if (c.origin === 'frontend' && !['browser-observed', 'estimated', 'incomplete'].includes(evidence)) invalid();
  if (evidence === 'provider-confirmed' && c.origin !== 'provider') invalid();
  const target = r.target == null ? null : loggingRecord(r.target, ['type', 'id']);
  const detail = r.detail === undefined ? undefined : normalizeLoggingActivityDetail(r.detail);
  if (detail?.kind === 'record-change' && (c.origin === 'frontend' || family !== 'records' || !['record.created', 'record.updated', 'record.deleted'].includes(r.action as string)
    || r.outcome !== 'succeeded' || evidence !== 'server-confirmed' || !target || target.type !== loggingTableTarget(detail.table)
    || r.action === 'record.created' && detail.changes.some(field => field.beforePresent || !field.afterPresent)
    || r.action === 'record.deleted' && detail.changes.some(field => !field.beforePresent || field.afterPresent)
    || r.action === 'record.updated' && !detail.changes.length && !detail.omittedFields)) invalid();
  if (detail?.kind === 'result' && (c.origin === 'frontend' || family !== 'records' || r.action !== (detail.resultKind === 'record' ? 'record.read.prepared' : 'record.list.prepared')
    || r.outcome !== 'succeeded' || evidence !== 'server-confirmed' || !target || target.type !== loggingTableTarget(detail.table)
    || detail.resultKind === 'list' && target.id !== detail.receiptId)) invalid();
  const event: LoggingEvent = Object.freeze({
    ...c, version: detail ? 2 : 1, id: loggingId(r.id)!, stream: family === 'operational' ? 'operational' : 'audit', family,
    action: loggingCode(r.action), level: r.level === undefined ? 'info' : loggingChoice(r.level, LOGGING_LEVELS),
    outcome: loggingChoice(r.outcome, LOGGING_OUTCOMES), evidence, occurredAt: loggingTime(r.occurredAt),
    target: target ? Object.freeze({ type: loggingCode(target.type), id: loggingId(target.id)! }) : null,
    metadata: metadata(r.metadata ?? {}, allowed as string[]),
    ...(detail ? { detail } : {}),
  });
  if (loggingByteLength(event) > LOGGING_MAX_EVENT_BYTES) invalid();
  return event;
}

/** Validate a previously captured envelope again at the actor/storage boundary. */
export function normalizeLoggingEvent(value: unknown): LoggingEvent {
  const r = loggingRecord(value, ['version', 'id', 'stream', 'family', 'action', 'level', 'outcome', 'evidence', 'occurredAt', 'target', 'metadata',
    'sourceId', 'origin', 'scope', 'actor', 'requestId', 'correlationId', 'policyVersion', 'detail']);
  if (r.version !== 1 && r.version !== 2 || r.version === 1 && r.detail !== undefined || r.version === 2 && r.detail === undefined) invalid();
  const approved = metadata(r.metadata);
  const event = captureLoggingEvent({ sourceId: r.sourceId, origin: r.origin, scope: r.scope, actor: r.actor, requestId: r.requestId,
    correlationId: r.correlationId, policyVersion: r.policyVersion } as LoggingContext,
  { id: r.id, family: r.family, action: r.action, level: r.level, outcome: r.outcome, evidence: r.evidence,
    occurredAt: r.occurredAt, target: r.target, metadata: approved, ...(r.detail === undefined ? {} : { detail: r.detail }) } as LoggingEventInput, Object.keys(approved));
  if (event.stream !== r.stream) invalid();
  return event;
}

export function invalid(code: LoggingErrorCode = 'LOGGING_EVENT_INVALID'): never {
  throw new LoggingError(code, 'Logging input does not match the admitted contract.');
}
