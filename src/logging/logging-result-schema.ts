/** Separate additive migration snapshot; do not mutate earlier activity/evidence schemas. */
export const LOGGING_RESULT_TABLES = Object.freeze({
  logging_results: Object.freeze({ id: 'text primary key', scope_kind: 'text not null', tenant_id: 'text', actor_id: 'text not null', session_id: 'text', policy_version: 'text not null',
    digest: 'text not null', manifest: 'text not null', expires_at: 'integer not null', event_ref: 'text not null' }),
  logging_result_views: Object.freeze({ id: 'text primary key', receipt_id: 'text not null', source_id: 'text not null', view_id: 'text not null', latest_sequence: 'integer not null', closed_sequence: 'integer' }),
  logging_result_view_versions: Object.freeze({ id: 'text primary key', view_ref: 'text not null', receipt_id: 'text not null', sequence: 'integer not null', event_ref: 'text not null' }),
});
