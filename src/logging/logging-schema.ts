/** Fixed private log tables shared by realm admission and pre-initialization migrations. */
import type { TableSchema } from '../sync/types';

export const LOGGING_EVENTS_TABLE = 'logging_events';
export const LOGGING_STATE_TABLE = 'logging_state';
export const LOGGING_TABLES = Object.freeze({
  [LOGGING_STATE_TABLE]: Object.freeze({ id: 'text primary key', stream: 'text not null', ordinal: 'integer not null' }),
  [LOGGING_EVENTS_TABLE]: Object.freeze({
    id: 'text primary key', stream: 'text not null', ordinal: 'integer not null unique',
    source_id: 'text not null', event_id: 'text not null', digest: 'text not null',
    occurred_at: 'integer not null', ingested_at: 'integer not null', scope_kind: 'text not null', tenant_id: 'text',
    actor_id: 'text', session_id: 'text', family: 'text not null', action: 'text not null',
    level: 'text not null', outcome: 'text not null', target_type: 'text', target_id: 'text', envelope: 'text not null',
  }),
} as const satisfies Readonly<Record<string, TableSchema>>);
