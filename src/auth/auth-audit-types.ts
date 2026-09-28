/** Durable, secret-free authorization/control-plane audit contracts. */

export type AuthAuditOutcome = 'succeeded' | 'denied' | 'failed';
export type AuthAuditScopeKind = 'application' | 'tenant';
export type AuthAuditActorProvenance =
  | 'authenticated-request'
  | 'bootstrap'
  | 'account-recovery'
  | 'registration'
  | 'system';

export type AuthAuditMetadataValue = string | number | boolean | null;
export type AuthAuditMetadata = Readonly<Record<string, AuthAuditMetadataValue>>;

/** Developer-authored retention configuration. Audit storage is always enabled with auth. */
export interface AuthAuditConfig {
  /** Retain events for this many whole days. Default: 365. Range: 1..3650. */
  retentionDays?: number;
  /** Maximum rows deleted by one SQLite prune transaction. Default: 1000. Range: 1..10000. */
  pruneBatchSize?: number;
  /** Background retention cadence. Default: `6h`. Range: 1m..7d. */
  pruneInterval?: string;
}

export interface ResolvedAuthAuditConfig {
  retentionDays: number;
  pruneBatchSize: number;
  pruneInterval: string;
  pruneIntervalMs: number;
}

export interface AuthAuditRequestContext {
  requestId?: string;
  correlationId?: string;
}

export interface AuthAuditActor {
  userId?: string;
  membershipId?: string;
  sessionId?: string;
  sessionKind?: 'web' | 'native';
  clientId?: string;
  provenance: AuthAuditActorProvenance;
}

export interface AuthAuditTarget {
  type: string;
  id?: string;
}

export interface AppendAuthAuditEventInput {
  action: string;
  outcome: AuthAuditOutcome;
  reason?: string;
  scope: {
    kind: AuthAuditScopeKind;
    tenantId?: string;
  };
  actor: AuthAuditActor;
  request?: AuthAuditRequestContext;
  target?: AuthAuditTarget;
  metadata?: AuthAuditMetadata;
  occurredAt?: number;
}

/** Browser-safe event projection. It deliberately contains no email or free-form message. */
export interface AuthAuditEvent {
  eventId: string;
  occurredAt: number;
  action: string;
  outcome: AuthAuditOutcome;
  reason: string | null;
  scopeKind: AuthAuditScopeKind;
  tenantId: string | null;
  actorUserId: string | null;
  actorMembershipId: string | null;
  actorSessionId: string | null;
  actorSessionKind: 'web' | 'native' | null;
  actorClientId: string | null;
  actorProvenance: AuthAuditActorProvenance;
  requestId: string | null;
  correlationId: string | null;
  targetType: string | null;
  targetId: string | null;
  metadata: AuthAuditMetadata;
}

export interface AuthAuditQuery {
  limit?: number;
  cursor?: string;
  action?: string;
  outcome?: AuthAuditOutcome;
  from?: number;
  to?: number;
  targetType?: string;
}

export interface AuthAuditPage {
  events: readonly AuthAuditEvent[];
  page: Readonly<{
    limit: number;
    count: number;
    hasMore: boolean;
    nextCursor: string | null;
  }>;
}

export interface AuthAuditExport {
  /** Newline-delimited JSON, one browser-safe AuthAuditEvent per line. */
  ndjson: string;
  count: number;
  hasMore: boolean;
  nextCursor: string | null;
}
