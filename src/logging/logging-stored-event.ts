/** One retained-row integrity projection shared by snapshots and the reactive append cursor. */
import { DatabaseError } from '../databases/database-error';
import { loggingDigest } from './logging-hash';
import { loggingChainHash } from './logging-evidence-realm';
import { normalizeLoggingEvent } from './logging-validation';
import type { StoredLoggingEvent } from './logging-contracts';

export interface LoggingStoredRow {
  [key: string]: unknown;
  id: string; digest: string; envelope: string; ordinal: number; ingested_at: number;
}
export function projectLoggingStoredEvent(row: LoggingStoredRow): StoredLoggingEvent {
  const event = normalizeLoggingEvent(JSON.parse(row.envelope));
  const columns = { stream: event.stream, source_id: event.sourceId, event_id: event.id, scope_kind: event.scope.kind, tenant_id: event.scope.tenantId,
    occurred_at: event.occurredAt, actor_id: event.actor.id, session_id: event.actor.sessionId, family: event.family, action: event.action,
    level: event.level, outcome: event.outcome, target_type: event.target?.type ?? null, target_id: event.target?.id ?? null };
  if (row.expired !== 0 || row.proof_digest !== row.digest || row.chain_hash !== loggingChainHash(String(row.previous_hash), row.ordinal, row.id, row.digest, row.ingested_at)
    || row.id !== loggingDigest([event.sourceId, event.id]) || row.digest !== loggingDigest(event)
    || Object.entries(columns).some(([key, value]) => row[key] !== value)) throw new DatabaseError('DATABASE_PROTOCOL_ERROR', 'Stored logging evidence is inconsistent.');
  return { event, ordinal: row.ordinal, ingestedAt: row.ingested_at };
}
