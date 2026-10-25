/** Fixed private log tables shared by realm admission and pre-initialization migrations. */
import type { TableSchema } from '../sync/types';

export const LOGGING_EVENTS_TABLE = 'logging_events';
export const LOGGING_STATE_TABLE = 'logging_state';
export const LOGGING_PROOFS_TABLE = 'logging_proofs';
export const LOGGING_CHAIN_TABLE = 'logging_chain';
export const LOGGING_HOLDS_TABLE = 'logging_holds';
export const LOGGING_REVIEWS_TABLE = 'logging_reviews';
export const LOGGING_EXPORTS_TABLE = 'logging_exports';
export const LOGGING_CHECKPOINTS_TABLE = 'logging_checkpoints';
export const LOGGING_TABLES = Object.freeze({
  [LOGGING_CHECKPOINTS_TABLE]: Object.freeze({ id: 'text primary key', ledger_id: 'text not null', stream: 'text not null',
    position: 'integer not null', ordinal: 'integer not null', hash: 'text not null', digest: 'text not null', envelope: 'text not null' }),
  [LOGGING_EXPORTS_TABLE]: Object.freeze({ id: 'text primary key', scope_kind: 'text not null', tenant_id: 'text', actor_id: 'text not null',
    stream: 'text not null', query_json: 'text not null', request_event: 'text not null', state_event: 'text not null', state: 'text not null', created_at: 'integer not null',
    expires_at: 'integer not null', completed_at: 'integer', high_water: 'integer not null', count: 'integer not null', complete: 'integer not null',
    next_before: 'integer', sha256: 'text', artifact_removed: 'integer not null default 0' }),
  [LOGGING_CHAIN_TABLE]: Object.freeze({ id: 'text primary key', ordinal: 'integer not null', hash: 'text not null' }),
  [LOGGING_PROOFS_TABLE]: Object.freeze({ id: 'text primary key', ordinal: 'integer not null unique', digest: 'text not null', previous_hash: 'text not null', chain_hash: 'text not null', expired: 'integer not null default 0', ingested_at: 'integer not null' }),
  [LOGGING_HOLDS_TABLE]: Object.freeze({ id: 'text primary key', scope_kind: 'text not null', tenant_id: 'text', since: 'integer not null', until: 'integer not null', reason_ref: 'text not null', active: 'integer not null', created_at: 'integer not null', created_by: 'text not null', released_at: 'integer', released_by: 'text' }),
  [LOGGING_REVIEWS_TABLE]: Object.freeze({ id: 'text primary key', scope_kind: 'text not null', tenant_id: 'text', query_json: 'text not null', high_water: 'integer not null', result: 'text not null', reference: 'text not null', reviewed_at: 'integer not null', reviewed_by: 'text not null' }),
  [LOGGING_STATE_TABLE]: Object.freeze({ id: 'text primary key', stream: 'text not null', ordinal: 'integer not null' }),
  [LOGGING_EVENTS_TABLE]: Object.freeze({
    id: 'text primary key', stream: 'text not null', ordinal: 'integer not null unique',
    source_id: 'text not null', event_id: 'text not null', digest: 'text not null',
    occurred_at: 'integer not null', ingested_at: 'integer not null', scope_kind: 'text not null', tenant_id: 'text',
    actor_id: 'text', session_id: 'text', family: 'text not null', action: 'text not null',
    level: 'text not null', outcome: 'text not null', target_type: 'text', target_id: 'text', envelope: 'text not null',
  }),
} as const satisfies Readonly<Record<string, TableSchema>>);
