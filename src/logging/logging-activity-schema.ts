/** Additive projection tables. Do not add these to the frozen v1-v6 LOGGING_TABLES migration snapshot. */
export const LOGGING_ACTIVITY_TABLES = Object.freeze({
  logging_activities: Object.freeze({ id: 'text primary key', ordinal: 'integer not null unique', revision: 'integer not null',
    stream: 'text not null', scope_kind: 'text not null', tenant_id: 'text', actor_id: 'text', actor_kind: 'text not null', initiator_id: 'text', session_id: 'text',
    family: 'text not null', action: 'text not null', level: 'text not null', outcome: 'text not null', target_type: 'text', target_id: 'text',
    occurred_at: 'integer not null', ingested_at: 'integer not null', evidence_since: 'integer not null', evidence_until: 'integer not null', event_ref: 'text not null', summary: 'text not null', digest: 'text not null', binding: 'text not null' }),
  logging_activity_revisions: Object.freeze({ id: 'text primary key', ordinal: 'integer not null unique', activity_id: 'text not null',
    activity_ordinal: 'integer not null', view_sequence: 'integer', event_ref: 'text not null', summary: 'text not null', digest: 'text not null',
    stream: 'text not null', scope_kind: 'text not null', tenant_id: 'text', actor_id: 'text', actor_kind: 'text not null', initiator_id: 'text', session_id: 'text',
    family: 'text not null', action: 'text not null', level: 'text not null', outcome: 'text not null', target_type: 'text', target_id: 'text',
    occurred_at: 'integer not null', ingested_at: 'integer not null' }),
  logging_activity_state: Object.freeze({ id: 'text primary key', cursor: 'integer not null', version: 'integer not null' }),
  logging_activity_evidence: Object.freeze({ id: 'text primary key', activity_id: 'text not null', event_ref: 'text not null', ordinal: 'integer not null', linked_at: 'integer not null' }),
  logging_activity_retirements: Object.freeze({ id: 'text primary key', through: 'integer not null', revision: 'integer not null', stream: 'text not null', scope_kind: 'text not null', tenant_id: 'text' }),
  logging_activity_cleanup: Object.freeze({ id: 'text primary key', through: 'integer not null', stage: 'integer not null', generation: 'integer not null' }),
  logging_change_fields: Object.freeze({ id: 'text primary key', event_ref: 'text not null', field: 'text not null' }),
});
