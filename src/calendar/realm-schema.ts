/** Internal private conflict-domain state. None of these tables is a public Sync/API surface. */
import type { TableSchema } from '../sync/types';
import { CALENDAR_TYPE_BINDING_TABLES } from './realm-type-bindings-migration';

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

/**
 * Current declaration. Keep CALENDAR_TABLES above frozen at the 001 generation:
 * that migration closes over its exact keys when installing identity guards.
 * An absent availability pointer means unrestricted; no default policy is seeded.
 */
export const CALENDAR_SCHEDULING_TABLES: Record<string, TableSchema> = {
  ...CALENDAR_TABLES,
  _calendar_availability_history: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', resource_id: 'TEXT NOT NULL REFERENCES calendar_resources(id)',
    policy_revision: 'INTEGER NOT NULL CHECK(policy_revision>0)', mode: "TEXT NOT NULL CHECK(mode IN ('unrestricted','windows'))", windows_json: 'TEXT NOT NULL' },
  _calendar_availability: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', resource_id: 'TEXT NOT NULL REFERENCES calendar_resources(id) CHECK(id=resource_id)',
    policy_revision: 'INTEGER NOT NULL CHECK(policy_revision>0)' },
  calendar_blocks: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', title: 'TEXT NOT NULL', start_at: 'TEXT NOT NULL', end_at: 'TEXT NOT NULL', start_ms: 'INTEGER NOT NULL',
    end_ms: 'INTEGER NOT NULL CHECK(end_ms>start_ms AND end_ms-start_ms<=2678400000)', time_zone: 'TEXT NOT NULL', status: "TEXT NOT NULL CHECK(status IN ('active','cancelled'))",
    revision: 'INTEGER NOT NULL CHECK(revision>0)', created_by: 'TEXT NOT NULL' },
  _calendar_block_reservations: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', block_id: 'TEXT NOT NULL REFERENCES calendar_blocks(id)', resource_id: 'TEXT NOT NULL REFERENCES calendar_resources(id)',
    occupied_start_ms: 'INTEGER NOT NULL', occupied_end_ms: 'INTEGER NOT NULL CHECK(occupied_end_ms>occupied_start_ms AND occupied_end_ms-occupied_start_ms<=2678400000)',
    active: 'INTEGER NOT NULL CHECK(active IN (0,1))' },
  // Separate evidence preserves 001 receipt constraints and true block target identity.
  _calendar_block_receipts: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', principal: 'TEXT NOT NULL', request_id: 'TEXT NOT NULL', digest: 'TEXT NOT NULL', result_json: 'TEXT NOT NULL',
    target_kind: "TEXT NOT NULL CHECK(target_kind='block')", target_id: 'TEXT NOT NULL', required_right: "TEXT NOT NULL CHECK(required_right='manage')" },
  _calendar_block_effect_intents: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', receipt_id: 'TEXT NOT NULL REFERENCES _calendar_block_receipts(id)',
    operation: 'TEXT NOT NULL', target_kind: "TEXT NOT NULL CHECK(target_kind='block')", target_id: 'TEXT NOT NULL', revision: 'INTEGER NOT NULL CHECK(revision>0)' },
};

/** Generation 003 is additive. The 001/002 declarations above are migration identity inputs. */
export const CALENDAR_HOLD_TABLES: Record<string, TableSchema> = {
  ...CALENDAR_SCHEDULING_TABLES,
  calendar_holds: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', principal: 'TEXT NOT NULL', created_by: 'TEXT NOT NULL',
    status: "TEXT NOT NULL CHECK(status IN ('held','released','confirmed'))", revision: 'INTEGER NOT NULL CHECK(revision>0)',
    start_at: 'TEXT NOT NULL', end_at: 'TEXT NOT NULL', start_ms: 'INTEGER NOT NULL', end_ms: 'INTEGER NOT NULL CHECK(end_ms>start_ms AND end_ms-start_ms<=2678400000)',
    time_zone: 'TEXT NOT NULL', buffer_before: 'INTEGER NOT NULL CHECK(buffer_before BETWEEN 0 AND 1440)', buffer_after: 'INTEGER NOT NULL CHECK(buffer_after BETWEEN 0 AND 1440)',
    occupied_start_ms: 'INTEGER NOT NULL CHECK(occupied_start_ms=start_ms-buffer_before*60000)',
    occupied_end_ms: 'INTEGER NOT NULL CHECK(occupied_end_ms=end_ms+buffer_after*60000)',
    created_ms: 'INTEGER NOT NULL', expires_ms: 'INTEGER NOT NULL CHECK(expires_ms>created_ms AND expires_ms<=start_ms AND expires_ms-created_ms<=900000)',
    appointment_id: "TEXT REFERENCES calendar_appointments(id) CHECK((status='confirmed')=(appointment_id IS NOT NULL))" },
  _calendar_hold_reservations: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', hold_id: 'TEXT NOT NULL REFERENCES calendar_holds(id)',
    resource_id: 'TEXT NOT NULL REFERENCES calendar_resources(id)', resource_revision: 'INTEGER NOT NULL CHECK(resource_revision>0)',
    occupied_start_ms: 'INTEGER NOT NULL', occupied_end_ms: 'INTEGER NOT NULL CHECK(occupied_end_ms>occupied_start_ms AND occupied_end_ms-occupied_start_ms<=2851200000)',
    expires_ms: 'INTEGER NOT NULL', active: 'INTEGER NOT NULL CHECK(active IN (0,1))' },
  _calendar_hold_receipts: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', principal: 'TEXT NOT NULL', request_id: 'TEXT NOT NULL', digest: 'TEXT NOT NULL', result_json: 'TEXT NOT NULL',
    target_kind: "TEXT NOT NULL CHECK(target_kind='hold')", target_id: 'TEXT NOT NULL REFERENCES calendar_holds(id)', required_right: "TEXT NOT NULL CHECK(required_right IN ('book','manage'))" },
  _calendar_hold_effect_intents: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', receipt_id: 'TEXT NOT NULL REFERENCES _calendar_hold_receipts(id)',
    operation: 'TEXT NOT NULL', target_kind: "TEXT NOT NULL CHECK(target_kind='hold')", target_id: 'TEXT NOT NULL', revision: 'INTEGER NOT NULL CHECK(revision>0)' },
};

/** Generation 004 is metadata-only. All earlier declarations remain checksum inputs. */
export const CALENDAR_LOCATION_TABLES: Record<string, TableSchema> = {
  ...CALENDAR_HOLD_TABLES,
  calendar_locations: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', revision: 'INTEGER NOT NULL CHECK(revision>0)' },
  _calendar_location_history: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', location_id: 'TEXT NOT NULL',
    location_revision: 'INTEGER NOT NULL CHECK(location_revision>0)', label: 'TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 256)',
    region: 'TEXT CHECK(region IS NULL OR length(region) BETWEEN 1 AND 64)', active: 'INTEGER NOT NULL CHECK(active IN (0,1))' },
  _calendar_resource_location_history: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', resource_id: 'TEXT NOT NULL REFERENCES calendar_resources(id)',
    resource_revision: 'INTEGER NOT NULL CHECK(resource_revision>0)', location_ids_json: "TEXT NOT NULL CHECK(json_valid(location_ids_json) AND json_type(location_ids_json)='array' AND json_array_length(location_ids_json)<=16)" },
  _calendar_resource_location_members: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', resource_id: 'TEXT NOT NULL REFERENCES calendar_resources(id)',
    resource_revision: 'INTEGER NOT NULL CHECK(resource_revision>0)', location_id: 'TEXT NOT NULL REFERENCES calendar_locations(id)' },
  // Small replaceable lookup projection; immutable members/history above retain every past assignment.
  _calendar_resource_location_current: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', resource_id: 'TEXT NOT NULL REFERENCES calendar_resources(id)',
    resource_revision: 'INTEGER NOT NULL CHECK(resource_revision>0)', location_id: 'TEXT NOT NULL REFERENCES calendar_locations(id)' },
  _calendar_resource_locations: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', resource_id: 'TEXT NOT NULL REFERENCES calendar_resources(id) CHECK(id=resource_id)',
    resource_revision: 'INTEGER NOT NULL CHECK(resource_revision>0)' },
  _calendar_location_receipts: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', principal: 'TEXT NOT NULL', request_id: 'TEXT NOT NULL', digest: 'TEXT NOT NULL', result_json: 'TEXT NOT NULL',
    target_kind: "TEXT NOT NULL CHECK(target_kind='location')", target_id: 'TEXT NOT NULL REFERENCES calendar_locations(id)', required_right: "TEXT NOT NULL CHECK(required_right='manage')" },
  _calendar_location_effect_intents: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', receipt_id: 'TEXT NOT NULL REFERENCES _calendar_location_receipts(id)',
    operation: 'TEXT NOT NULL', target_kind: "TEXT NOT NULL CHECK(target_kind='location')", target_id: 'TEXT NOT NULL', revision: 'INTEGER NOT NULL CHECK(revision>0)' },
};

/** Generation 005 is additive. Earlier maps remain immutable migration inputs. */
export const CALENDAR_TYPE_TABLES: Record<string, TableSchema> = {
  ...CALENDAR_LOCATION_TABLES,
  ...CALENDAR_TYPE_BINDING_TABLES,
  calendar_types: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', revision: 'INTEGER NOT NULL CHECK(revision>0)' },
  _calendar_type_history: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', type_id: 'TEXT NOT NULL', type_revision: 'INTEGER NOT NULL CHECK(type_revision>0)',
    label: 'TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 256)', duration_minutes: "INTEGER NOT NULL CHECK(typeof(duration_minutes)='integer' AND duration_minutes BETWEEN 1 AND 44640)",
    buffer_before: "INTEGER NOT NULL CHECK(typeof(buffer_before)='integer' AND buffer_before BETWEEN 0 AND 1440)", buffer_after: "INTEGER NOT NULL CHECK(typeof(buffer_after)='integer' AND buffer_after BETWEEN 0 AND 1440)",
    color_key: "TEXT CHECK(color_key IS NULL OR (length(color_key) BETWEEN 1 AND 64 AND color_key NOT GLOB '*[^A-Za-z0-9_.:-]*' AND substr(color_key,1,1) GLOB '[A-Za-z0-9]'))",
    active: 'INTEGER NOT NULL CHECK(active IN (0,1))' },
  _calendar_resource_type_history: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', resource_id: 'TEXT NOT NULL REFERENCES calendar_resources(id)',
    resource_revision: 'INTEGER NOT NULL CHECK(resource_revision>1)', mode: "TEXT NOT NULL CHECK(mode IN ('unrestricted','optional','required'))",
    type_ids_json: "TEXT NOT NULL CHECK(json_valid(type_ids_json) AND json_type(type_ids_json)='array' AND json_array_length(type_ids_json)<=16 AND (mode<>'unrestricted' OR json_array_length(type_ids_json)=0))" },
  _calendar_resource_type_members: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', resource_id: 'TEXT NOT NULL REFERENCES calendar_resources(id)',
    resource_revision: 'INTEGER NOT NULL CHECK(resource_revision>1)', type_id: 'TEXT NOT NULL REFERENCES calendar_types(id)' },
  _calendar_resource_types: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', resource_id: 'TEXT NOT NULL REFERENCES calendar_resources(id) CHECK(id=resource_id)',
    resource_revision: 'INTEGER NOT NULL CHECK(resource_revision>1)' },
  _calendar_type_receipts: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', principal: 'TEXT NOT NULL', request_id: 'TEXT NOT NULL', digest: 'TEXT NOT NULL', result_json: 'TEXT NOT NULL',
    target_kind: "TEXT NOT NULL CHECK(target_kind='type')", target_id: 'TEXT NOT NULL REFERENCES calendar_types(id)', required_right: "TEXT NOT NULL CHECK(required_right='manage')" },
  _calendar_type_effect_intents: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', receipt_id: 'TEXT NOT NULL REFERENCES _calendar_type_receipts(id)',
    operation: 'TEXT NOT NULL', target_kind: "TEXT NOT NULL CHECK(target_kind='type')", target_id: 'TEXT NOT NULL', revision: 'INTEGER NOT NULL CHECK(revision>0)' },
};
