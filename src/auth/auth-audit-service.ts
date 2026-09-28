import type { Statement } from 'bun:sqlite';
import { emitPlatformCode } from '../observability/sink';
import { OBS_CODES } from '../observability/codes';
import type { ReactiveDB } from '../sync/reactive-db';
import { AuthError, type AuthContext } from './types';
import type {
  AppendAuthAuditEventInput,
  AuthAuditActor,
  AuthAuditActorProvenance,
  AuthAuditEvent,
  AuthAuditExport,
  AuthAuditMetadata,
  AuthAuditMetadataValue,
  AuthAuditOutcome,
  AuthAuditPage,
  AuthAuditQuery,
  AuthAuditRequestContext,
  ResolvedAuthAuditConfig,
} from './auth-audit-types';

interface AuditRow {
  event_id: string;
  occurred_at: number;
  action: string;
  outcome: AuthAuditOutcome;
  reason: string | null;
  scope_kind: 'application' | 'tenant';
  tenant_id: string | null;
  actor_user_id: string | null;
  actor_membership_id: string | null;
  actor_session_id: string | null;
  actor_session_kind: 'web' | 'native' | null;
  actor_client_id: string | null;
  actor_provenance: AuthAuditActorProvenance;
  request_id: string | null;
  correlation_id: string | null;
  target_type: string | null;
  target_id: string | null;
  metadata_json: string;
}

interface AuditCursor { occurredAt: number; eventId: string }

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_EXPORT_LIMIT = 1_000;
const MAX_CURSOR_LENGTH = 512;
const CODE_PATTERN = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const MAX_ACTION_LENGTH = 100;
const MAX_REASON_LENGTH = 100;
const MAX_TARGET_TYPE_LENGTH = 64;
const MAX_ID_LENGTH = 200;
const MAX_METADATA_KEYS = 16;
const MAX_METADATA_KEY_LENGTH = 64;
const MAX_METADATA_STRING_LENGTH = 200;
const MAX_METADATA_JSON_BYTES = 2_048;
const MAX_DATE_MS = 8_640_000_000_000_000;
const MAX_RETENTION_BATCHES_PER_PASS = 10;
const RETENTION_CONTINUATION_DELAY_MS = 1_000;
const FORBIDDEN_METADATA_KEY = /(email|password|secret|token|credential|authorization|cookie|address|phone|name)/i;

/** Durable, app-local authorization/control-plane audit store and retention owner. */
export class AuthAuditService {
  private readonly insert: Statement;
  private retentionTimer: ReturnType<typeof setInterval> | null = null;
  private retentionContinuation: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly db: ReactiveDB,
    private readonly config: ResolvedAuthAuditConfig,
  ) {
    this.insert = db.prepare(`
      INSERT INTO _auth_audit_events (
        event_id, occurred_at, action, outcome, reason, scope_kind, tenant_id,
        actor_user_id, actor_membership_id, actor_session_id, actor_session_kind,
        actor_client_id, actor_provenance, request_id, correlation_id,
        target_type, target_id, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
  }

  /**
   * Append synchronously. When called inside a ReactiveDB transaction, this
   * insert commits or rolls back with the protected mutation.
   */
  append(raw: AppendAuthAuditEventInput): AuthAuditEvent {
    const input = normalizeAppendInput(raw);
    const eventId = crypto.randomUUID();
    this.insert.run(
      eventId,
      input.occurredAt,
      input.action,
      input.outcome,
      input.reason,
      input.scope.kind,
      input.scope.tenantId,
      input.actor.userId,
      input.actor.membershipId,
      input.actor.sessionId,
      input.actor.sessionKind,
      input.actor.clientId,
      input.actor.provenance,
      input.request.requestId,
      input.request.correlationId,
      input.target.type,
      input.target.id,
      JSON.stringify(input.metadata),
    );
    return Object.freeze({
      eventId,
      occurredAt: input.occurredAt,
      action: input.action,
      outcome: input.outcome,
      reason: input.reason,
      scopeKind: input.scope.kind,
      tenantId: input.scope.tenantId,
      actorUserId: input.actor.userId,
      actorMembershipId: input.actor.membershipId,
      actorSessionId: input.actor.sessionId,
      actorSessionKind: input.actor.sessionKind,
      actorClientId: input.actor.clientId,
      actorProvenance: input.actor.provenance,
      requestId: input.request.requestId,
      correlationId: input.request.correlationId,
      targetType: input.target.type,
      targetId: input.target.id,
      metadata: input.metadata,
    });
  }

  listPlatform(query: AuthAuditQuery = {}): AuthAuditPage {
    return this.list(undefined, query, MAX_LIMIT);
  }

  listTenant(tenantId: string, query: AuthAuditQuery = {}): AuthAuditPage {
    return this.list(requireId(tenantId, 'tenant id'), query, MAX_LIMIT);
  }

  exportPlatform(query: AuthAuditQuery = {}): AuthAuditExport {
    return exportPage(this.list(undefined, query, MAX_EXPORT_LIMIT));
  }

  exportTenant(tenantId: string, query: AuthAuditQuery = {}): AuthAuditExport {
    return exportPage(this.list(requireId(tenantId, 'tenant id'), query, MAX_EXPORT_LIMIT));
  }

  /** Delete only expired rows, in one bounded batch, through the schema gate. */
  prune(now = Date.now(), limit = this.config.pruneBatchSize): number {
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid audit retention time.');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > this.config.pruneBatchSize) {
      throw new Error(`Audit retention limit must be between 1 and ${this.config.pruneBatchSize}.`);
    }
    const cutoff = now - this.config.retentionDays * 86_400_000;
    return this.db.transaction(() => {
      this.db.prepare(`
        UPDATE _auth_audit_retention_gate SET enabled = 1, cutoff_at = ? WHERE gate_id = 1
      `).run(cutoff);
      try {
        return this.db.prepare(`
          DELETE FROM _auth_audit_events
          WHERE event_id IN (
            SELECT event_id FROM _auth_audit_events
            WHERE occurred_at < ?
            ORDER BY occurred_at ASC, event_id ASC
            LIMIT ?
          )
        `).run(cutoff, limit).changes;
      } finally {
        this.db.prepare(`
          UPDATE _auth_audit_retention_gate SET enabled = 0, cutoff_at = 0 WHERE gate_id = 1
        `).run();
      }
    });
  }

  /**
   * Drain several bounded transactions and report whether another pass may be
   * needed. Workers reschedule instead of monopolizing the event loop.
   */
  pruneBacklog(
    now = Date.now(),
    maxBatches = MAX_RETENTION_BATCHES_PER_PASS,
  ): Readonly<{ deleted: number; hasMore: boolean }> {
    if (!Number.isSafeInteger(maxBatches)
      || maxBatches < 1 || maxBatches > MAX_RETENTION_BATCHES_PER_PASS) {
      throw new Error(
        `Audit retention batches must be between 1 and ${MAX_RETENTION_BATCHES_PER_PASS}.`,
      );
    }
    let deleted = 0;
    let lastBatch = 0;
    for (let batch = 0; batch < maxBatches; batch += 1) {
      lastBatch = this.prune(now);
      deleted += lastBatch;
      if (lastBatch < this.config.pruneBatchSize) break;
    }
    return Object.freeze({
      deleted,
      hasMore: lastBatch === this.config.pruneBatchSize,
    });
  }

  /** Start one app-local retention worker. Failures are observable and retried next cadence. */
  start(): void {
    if (this.retentionTimer) return;
    this.runRetentionPass();
    this.retentionTimer = setInterval(
      () => this.runRetentionPass(),
      this.config.pruneIntervalMs,
    );
    this.retentionTimer.unref?.();
  }

  stop(): void {
    if (this.retentionTimer) {
      clearInterval(this.retentionTimer);
      this.retentionTimer = null;
    }
    if (this.retentionContinuation) {
      clearTimeout(this.retentionContinuation);
      this.retentionContinuation = null;
    }
  }

  /** Operator-triggered retention whose deletion and success event are atomic. */
  pruneBacklogAudited(input: {
    actor: AuthAuditActor;
    request?: AuthAuditRequestContext;
    now?: number;
  }): Readonly<{ deleted: number; hasMore: boolean }> {
    return this.db.transaction(() => {
      // Keep the operator transaction bounded to one configured batch. The
      // caller may repeat while hasMore is true; the background worker owns
      // multi-transaction backlog draining.
      const deleted = this.prune(input.now);
      const result = Object.freeze({
        deleted,
        hasMore: deleted === this.config.pruneBatchSize,
      });
      this.append({
        action: 'audit.retention-pruned',
        outcome: 'succeeded',
        scope: { kind: 'application' },
        actor: input.actor,
        request: input.request,
        target: { type: 'audit-events' },
        metadata: { deleted: result.deleted, 'has-more': result.hasMore },
      });
      return result;
    });
  }

  private runRetentionPass(): void {
    try {
      const result = this.pruneBacklog();
      if (result.deleted > 0) {
        emitPlatformCode(OBS_CODES.AUTH_AUDIT_PRUNED, {
          metadata: { deleted: result.deleted, continuation: result.hasMore },
        });
      }
      if (result.hasMore && !this.retentionContinuation) {
        this.retentionContinuation = setTimeout(() => {
          this.retentionContinuation = null;
          this.runRetentionPass();
        }, RETENTION_CONTINUATION_DELAY_MS);
        this.retentionContinuation.unref?.();
      }
    } catch (error) {
      emitPlatformCode(OBS_CODES.AUTH_AUDIT_PRUNE_FAILED, { error });
    }
  }

  private list(
    tenantId: string | undefined,
    raw: AuthAuditQuery,
    maxLimit: number,
  ): AuthAuditPage {
    const query = normalizeQuery(raw, maxLimit);
    const cursor = decodeCursor(query.cursor);
    const where: string[] = [];
    const args: Array<string | number> = [];
    if (tenantId !== undefined) {
      where.push('tenant_id = ?');
      args.push(tenantId);
    }
    if (query.action) {
      where.push('action = ?');
      args.push(query.action);
    }
    if (query.outcome) {
      where.push('outcome = ?');
      args.push(query.outcome);
    }
    if (query.from !== undefined) {
      where.push('occurred_at >= ?');
      args.push(query.from);
    }
    if (query.to !== undefined) {
      where.push('occurred_at <= ?');
      args.push(query.to);
    }
    if (query.targetType) {
      where.push('target_type = ?');
      args.push(query.targetType);
    }
    if (cursor) {
      where.push('(occurred_at < ? OR (occurred_at = ? AND event_id < ?))');
      args.push(cursor.occurredAt, cursor.occurredAt, cursor.eventId);
    }
    const predicate = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = this.db.prepare(`
      SELECT * FROM _auth_audit_events
      ${predicate}
      ORDER BY occurred_at DESC, event_id DESC
      LIMIT ?
    `).all(...args, query.limit + 1) as AuditRow[];
    const hasMore = rows.length > query.limit;
    const selected = hasMore ? rows.slice(0, query.limit) : rows;
    const events = Object.freeze(selected.map(mapRow));
    const last = events.at(-1);
    return Object.freeze({
      events,
      page: Object.freeze({
        limit: query.limit,
        count: events.length,
        hasMore,
        nextCursor: hasMore && last
          ? encodeCursor({ occurredAt: last.occurredAt, eventId: last.eventId })
          : null,
      }),
    });
  }
}

export function authAuditActorFromContext(
  auth: AuthContext,
  provenance: AuthAuditActorProvenance = 'authenticated-request',
): AuthAuditActor {
  return Object.freeze({
    userId: auth.userId,
    membershipId: auth.membershipId,
    sessionId: auth.sessionId,
    sessionKind: auth.sessionKind,
    clientId: auth.clientId,
    provenance,
  });
}

/** Accept only opaque tracing identifiers, never arbitrary header contents. */
export function authAuditRequestFromRequest(request: Request): AuthAuditRequestContext {
  return Object.freeze({
    requestId: optionalHeaderId(request.headers.get('x-request-id')),
    correlationId: optionalHeaderId(request.headers.get('x-correlation-id')),
  });
}

function normalizeAppendInput(raw: AppendAuthAuditEventInput) {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid auth audit event.');
  const action = requireCode(raw.action, 'action', MAX_ACTION_LENGTH);
  if (!['succeeded', 'denied', 'failed'].includes(raw.outcome)) {
    throw new Error('Invalid auth audit outcome.');
  }
  if (raw.scope?.kind !== 'application' && raw.scope?.kind !== 'tenant') {
    throw new Error('Invalid auth audit scope.');
  }
  const tenantId = raw.scope.kind === 'tenant'
    ? requireId(raw.scope.tenantId, 'tenant id')
    : null;
  if (raw.scope.kind === 'application' && raw.scope.tenantId !== undefined) {
    throw new Error('Application audit events cannot carry a tenant id.');
  }
  const occurredAt = raw.occurredAt ?? Date.now();
  if (!Number.isSafeInteger(occurredAt) || occurredAt < 0 || occurredAt > MAX_DATE_MS) {
    throw new Error('Invalid auth audit timestamp.');
  }
  const provenance = raw.actor?.provenance;
  if (!['authenticated-request', 'bootstrap', 'account-recovery', 'registration', 'system']
    .includes(provenance)) throw new Error('Invalid auth audit actor provenance.');
  const metadata = normalizeMetadata(raw.metadata);
  return {
    action,
    outcome: raw.outcome,
    reason: raw.reason === undefined
      ? null
      : requireCode(raw.reason, 'reason', MAX_REASON_LENGTH),
    scope: { kind: raw.scope.kind, tenantId },
    actor: {
      userId: optionalId(raw.actor.userId, 'actor user id'),
      membershipId: optionalId(raw.actor.membershipId, 'actor membership id'),
      sessionId: optionalId(raw.actor.sessionId, 'actor session id'),
      sessionKind: normalizeSessionKind(raw.actor.sessionKind),
      clientId: optionalId(raw.actor.clientId, 'actor client id'),
      provenance,
    },
    request: {
      requestId: optionalId(raw.request?.requestId, 'request id'),
      correlationId: optionalId(raw.request?.correlationId, 'correlation id'),
    },
    target: {
      type: raw.target?.type === undefined
        ? null
        : requireCode(raw.target.type, 'target type', MAX_TARGET_TYPE_LENGTH),
      id: optionalId(raw.target?.id, 'target id'),
    },
    metadata,
    occurredAt,
  } as const;
}

function normalizeQuery(raw: AuthAuditQuery, maxLimit: number): Required<Pick<AuthAuditQuery, 'limit'>> & AuthAuditQuery {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw auditQueryError('Invalid auth audit query.');
  }
  const limit = raw.limit ?? Math.min(DEFAULT_LIMIT, maxLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxLimit) {
    throw auditQueryError(`Auth audit page limit must be between 1 and ${maxLimit}.`);
  }
  if (raw.cursor !== undefined
    && (typeof raw.cursor !== 'string' || raw.cursor.length > MAX_CURSOR_LENGTH)) {
    throw auditQueryError('Invalid auth audit cursor.');
  }
  if (raw.outcome !== undefined
    && !['succeeded', 'denied', 'failed'].includes(raw.outcome)) {
    throw auditQueryError('Invalid auth audit outcome filter.');
  }
  if (raw.from !== undefined
    && (!Number.isSafeInteger(raw.from) || raw.from < 0 || raw.from > MAX_DATE_MS)) {
    throw auditQueryError('Invalid auth audit start time.');
  }
  if (raw.to !== undefined
    && (!Number.isSafeInteger(raw.to) || raw.to < 0 || raw.to > MAX_DATE_MS)) {
    throw auditQueryError('Invalid auth audit end time.');
  }
  if (raw.from !== undefined && raw.to !== undefined && raw.from > raw.to) {
    throw auditQueryError('Auth audit start time must not be after end time.');
  }
  return {
    ...raw,
    limit,
    ...(raw.action === undefined
      ? {} : { action: requireQueryCode(raw.action, 'action', MAX_ACTION_LENGTH) }),
    ...(raw.targetType === undefined ? {} : {
      targetType: requireQueryCode(raw.targetType, 'target type', MAX_TARGET_TYPE_LENGTH),
    }),
  };
}

function normalizeMetadata(raw: AuthAuditMetadata | undefined): AuthAuditMetadata {
  if (raw === undefined) return Object.freeze({});
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Auth audit metadata must be an object.');
  }
  const entries = Object.entries(raw);
  if (entries.length > MAX_METADATA_KEYS) throw new Error('Auth audit metadata has too many keys.');
  const normalized: Record<string, AuthAuditMetadataValue> = {};
  for (const [key, value] of entries) {
    if (!CODE_PATTERN.test(key) || key.length > MAX_METADATA_KEY_LENGTH
      || FORBIDDEN_METADATA_KEY.test(key)) {
      throw new Error(`Auth audit metadata key is unsafe: ${key}.`);
    }
    if (value !== null && typeof value !== 'string'
      && typeof value !== 'number' && typeof value !== 'boolean') {
      throw new Error(`Auth audit metadata value is invalid: ${key}.`);
    }
    if (typeof value === 'string') {
      if (value.length > MAX_METADATA_STRING_LENGTH || value.includes('@')) {
        throw new Error(`Auth audit metadata string is unsafe: ${key}.`);
      }
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error(`Auth audit metadata number is invalid: ${key}.`);
    }
    normalized[key] = value;
  }
  const json = JSON.stringify(normalized);
  if (Buffer.byteLength(json, 'utf8') > MAX_METADATA_JSON_BYTES) {
    throw new Error('Auth audit metadata is too large.');
  }
  return Object.freeze(normalized);
}

function mapRow(row: AuditRow): AuthAuditEvent {
  return Object.freeze({
    eventId: row.event_id,
    occurredAt: row.occurred_at,
    action: row.action,
    outcome: row.outcome,
    reason: row.reason,
    scopeKind: row.scope_kind,
    tenantId: row.tenant_id,
    actorUserId: row.actor_user_id,
    actorMembershipId: row.actor_membership_id,
    actorSessionId: row.actor_session_id,
    actorSessionKind: row.actor_session_kind,
    actorClientId: row.actor_client_id,
    actorProvenance: row.actor_provenance,
    requestId: row.request_id,
    correlationId: row.correlation_id,
    targetType: row.target_type,
    targetId: row.target_id,
    metadata: parseMetadata(row.metadata_json),
  });
}

function parseMetadata(json: string): AuthAuditMetadata {
  try {
    return normalizeMetadata(JSON.parse(json) as AuthAuditMetadata);
  } catch {
    // Rows can only be created through the validated service, but fail closed
    // if an operator modified SQLite out of band.
    return Object.freeze({ invalid: true });
  }
}

function exportPage(page: AuthAuditPage): AuthAuditExport {
  return Object.freeze({
    ndjson: page.events.map((event) => JSON.stringify(event)).join('\n'),
    count: page.page.count,
    hasMore: page.page.hasMore,
    nextCursor: page.page.nextCursor,
  });
}

function encodeCursor(cursor: AuditCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(value: string | undefined): AuditCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object') throw new Error();
    const occurredAt = Reflect.get(parsed, 'occurredAt');
    const eventId = Reflect.get(parsed, 'eventId');
    if (!Number.isSafeInteger(occurredAt) || occurredAt < 0 || occurredAt > MAX_DATE_MS
      || typeof eventId !== 'string' || !ID_PATTERN.test(eventId)
      || eventId.length > MAX_ID_LENGTH) throw new Error();
    return { occurredAt, eventId };
  } catch {
    throw auditQueryError('Invalid auth audit cursor.');
  }
}

function requireCode(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maxLength
    || !CODE_PATTERN.test(value)) throw new Error(`Invalid auth audit ${label}.`);
  return value;
}

function requireQueryCode(value: unknown, label: string, maxLength: number): string {
  try {
    return requireCode(value, label, maxLength);
  } catch {
    throw auditQueryError(`Invalid auth audit ${label} filter.`);
  }
}

function auditQueryError(message: string): AuthError {
  return new AuthError(message, 'AUTH_AUDIT_QUERY_INVALID', 422);
}

function requireId(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > MAX_ID_LENGTH
    || !ID_PATTERN.test(value)) throw new Error(`Invalid auth audit ${label}.`);
  return value;
}

function optionalId(value: unknown, label: string): string | null {
  return value === undefined || value === null ? null : requireId(value, label);
}

function optionalHeaderId(value: string | null): string | undefined {
  if (!value || value.length > MAX_ID_LENGTH || !ID_PATTERN.test(value)) return undefined;
  return value;
}

function normalizeSessionKind(value: unknown): 'web' | 'native' | null {
  if (value === undefined || value === null) return null;
  if (value !== 'web' && value !== 'native') throw new Error('Invalid auth audit session kind.');
  return value;
}
