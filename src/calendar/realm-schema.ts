/** Internal private conflict-domain state. None of these tables is a public Sync/API surface. */
import type { TableSchema } from '../sync/types';

export const CALENDAR_TABLES: Record<string, TableSchema> = {
  _calendar_owner: { id: "TEXT PRIMARY KEY CHECK(id='application')", owner_id: 'TEXT NOT NULL', scope_id: 'TEXT NOT NULL' },
  calendar_resources: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', label: 'TEXT NOT NULL', kind: "TEXT NOT NULL CHECK(kind IN ('person','room','equipment'))",
    owner_id: 'TEXT', time_zone: 'TEXT NOT NULL', revision: 'INTEGER NOT NULL CHECK(revision>0)', active: 'INTEGER NOT NULL CHECK(active IN (0,1))' },
  _calendar_grants: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', resource_id: 'TEXT NOT NULL REFERENCES calendar_resources(id)', user_id: 'TEXT NOT NULL',
    busy: 'INTEGER NOT NULL CHECK(busy IN (0,1))', details: 'INTEGER NOT NULL CHECK(details IN (0,1))', book: 'INTEGER NOT NULL CHECK(book IN (0,1))', manage: 'INTEGER NOT NULL CHECK(manage IN (0,1))' },
  calendar_appointments: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', title: 'TEXT NOT NULL', start_at: 'TEXT NOT NULL', end_at: 'TEXT NOT NULL', start_ms: 'INTEGER NOT NULL', end_ms: 'INTEGER NOT NULL CHECK(end_ms>start_ms)',
    time_zone: 'TEXT NOT NULL', buffer_before: 'INTEGER NOT NULL CHECK(buffer_before BETWEEN 0 AND 1440)', buffer_after: 'INTEGER NOT NULL CHECK(buffer_after BETWEEN 0 AND 1440)',
    occupied_start_ms: 'INTEGER NOT NULL', occupied_end_ms: 'INTEGER NOT NULL CHECK(occupied_end_ms>occupied_start_ms)', status: "TEXT NOT NULL CHECK(status IN ('confirmed','cancelled'))", revision: 'INTEGER NOT NULL CHECK(revision>0)', created_by: 'TEXT NOT NULL' },
  _calendar_reservations: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', appointment_id: 'TEXT NOT NULL REFERENCES calendar_appointments(id)', resource_id: 'TEXT NOT NULL REFERENCES calendar_resources(id)',
    occupied_start_ms: 'INTEGER NOT NULL', occupied_end_ms: 'INTEGER NOT NULL CHECK(occupied_end_ms>occupied_start_ms)', active: 'INTEGER NOT NULL CHECK(active IN (0,1))' },
  _calendar_receipts: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', principal: 'TEXT NOT NULL', request_id: 'TEXT NOT NULL', digest: 'TEXT NOT NULL', result_json: 'TEXT NOT NULL',
    target_kind: "TEXT NOT NULL CHECK(target_kind IN ('resource','appointment'))", target_id: 'TEXT NOT NULL', required_right: "TEXT NOT NULL CHECK(required_right IN ('book','manage'))" },
  // Integration handoff groundwork only: opaque source references, not audit records, schedules or provider payloads.
  _calendar_effect_intents: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', receipt_id: 'TEXT NOT NULL REFERENCES _calendar_receipts(id)',
    operation: 'TEXT NOT NULL', target_kind: "TEXT NOT NULL CHECK(target_kind IN ('resource','appointment'))", target_id: 'TEXT NOT NULL', revision: 'INTEGER NOT NULL CHECK(revision>0)' },
  _calendar_usage: { id: 'TEXT PRIMARY KEY', count: 'INTEGER NOT NULL CHECK(count>=0)' },
};
