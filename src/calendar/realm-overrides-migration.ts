/** Additive019. No old declarations/functions or accepted facts are rewritten. */
import { randomBytes } from 'node:crypto';
import type { Database, Statement } from 'bun:sqlite';
import type { Migration } from '../migrations/migrator';
import type { TableSchema } from '../sync/types';
import { inspectDatabaseSchema } from '../migrations/schema-inspector';
import { snapshotDeclaredTables } from '../migrations/schema-snapshot';
import { diffSchemaSnapshots } from '../migrations/schema-diff';
import { calendarResourceLocationPolicyTables } from './realm-location-policy-migration';
import { CalendarError } from './error';
import { CALENDAR_OVERRIDE_STATE as state, CALENDAR_OVERRIDE_GRANT_CURRENT as current, CALENDAR_OVERRIDE_GRANT_HISTORY as grants,
  CALENDAR_OVERRIDE_ADMISSIONS as admissions, CALENDAR_OVERRIDE_HISTORY as history, CALENDAR_OVERRIDE_WITNESSES as witnesses } from './override-model';
const integer = "INTEGER NOT NULL CHECK(typeof(resource_revision)='integer' AND resource_revision>1)";
const hash = (field: string) => `TEXT NOT NULL CHECK(length(${field})=64 AND ${field} NOT GLOB '*[^a-f0-9]*')`;
export const CALENDAR_OVERRIDE_ADDITIONS: Readonly<Record<string, TableSchema>> = Object.freeze({
  [state]: Object.freeze({ id: "TEXT PRIMARY KEY NOT NULL CHECK(id='application')", version: "INTEGER NOT NULL CHECK(typeof(version)='integer' AND version=19)", review_key: hash('review_key') }),
  [grants]: Object.freeze({ id: 'TEXT PRIMARY KEY NOT NULL', scope_id: 'TEXT NOT NULL', resource_id: 'TEXT NOT NULL REFERENCES calendar_resources(id)', user_id: 'TEXT NOT NULL',
    resource_revision: integer, enabled: "INTEGER NOT NULL CHECK(typeof(enabled)='integer' AND enabled IN (0,1))" }),
  [current]: Object.freeze({ id: 'TEXT PRIMARY KEY NOT NULL', scope_id: 'TEXT NOT NULL', resource_id: 'TEXT NOT NULL REFERENCES calendar_resources(id)', user_id: 'TEXT NOT NULL',
    resource_revision: integer, history_id: `TEXT NOT NULL REFERENCES ${grants}(id)` }),
  [admissions]: Object.freeze({ id: 'TEXT PRIMARY KEY NOT NULL REFERENCES _calendar_receipts(id) DEFERRABLE INITIALLY DEFERRED', scope_id: 'TEXT NOT NULL', principal: 'TEXT NOT NULL', request_id: 'TEXT NOT NULL', owner_id: 'TEXT NOT NULL',
    appointment_id: 'TEXT NOT NULL', action: "TEXT NOT NULL CHECK(action IN ('create','update'))", base_revision: "INTEGER NOT NULL CHECK(typeof(base_revision)='integer' AND base_revision>=0)",
    appointment_revision: "INTEGER NOT NULL CHECK(typeof(appointment_revision)='integer' AND appointment_revision=base_revision+1)",
    policy_version: "TEXT NOT NULL CHECK(policy_version='appointment-overlap-v1')", policy_hash: hash('policy_hash'), input_hash: hash('input_hash'), candidate_hash: hash('candidate_hash'), decision_hash: hash('decision_hash'),
    reason: "TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 1024 AND length(trim(reason))>0)",
    witness_count: "INTEGER NOT NULL CHECK(typeof(witness_count)='integer' AND witness_count BETWEEN 1 AND 64)",
    resource_ids_json: "TEXT NOT NULL CHECK(CASE WHEN json_valid(resource_ids_json) THEN json_type(resource_ids_json)='array' AND json_array_length(resource_ids_json) BETWEEN 1 AND 16 ELSE 0 END)",
    issued_ms: "INTEGER NOT NULL CHECK(typeof(issued_ms)='integer' AND issued_ms>=0)", expires_ms: "INTEGER NOT NULL CHECK(typeof(expires_ms)='integer' AND expires_ms>issued_ms AND expires_ms-issued_ms<=300000)",
    nonce: "TEXT NOT NULL CHECK(length(nonce)=32 AND nonce NOT GLOB '*[^a-f0-9]*')" }),
  [history]: Object.freeze({ id: 'TEXT PRIMARY KEY NOT NULL', scope_id: 'TEXT NOT NULL', appointment_id: 'TEXT NOT NULL REFERENCES calendar_appointments(id)',
    appointment_revision: "INTEGER NOT NULL CHECK(typeof(appointment_revision)='integer' AND appointment_revision>0)", admission_id: `TEXT NOT NULL REFERENCES ${admissions}(id)` }),
  [witnesses]: Object.freeze({ id: 'TEXT PRIMARY KEY NOT NULL', scope_id: 'TEXT NOT NULL', admission_id: `TEXT NOT NULL REFERENCES ${admissions}(id)`,
    ordinal: "INTEGER NOT NULL CHECK(typeof(ordinal)='integer' AND ordinal BETWEEN 0 AND 63)", resource_id: 'TEXT NOT NULL REFERENCES calendar_resources(id)',
    reservation_id: 'TEXT NOT NULL REFERENCES _calendar_reservations(id)', appointment_id: 'TEXT NOT NULL REFERENCES calendar_appointments(id)',
    parent_revision: "INTEGER NOT NULL CHECK(typeof(parent_revision)='integer' AND parent_revision>0)", binding_revision: "INTEGER NOT NULL CHECK(typeof(binding_revision)='integer' AND binding_revision BETWEEN 1 AND parent_revision)", occupied_start_ms: "INTEGER NOT NULL CHECK(typeof(occupied_start_ms)='integer')",
    occupied_end_ms: "INTEGER NOT NULL CHECK(typeof(occupied_end_ms)='integer' AND occupied_end_ms>occupied_start_ms)", descriptor_hash: hash('descriptor_hash') }),
});
export function calendarOverrideTables(): Readonly<Record<string, TableSchema>> {
  return Object.freeze({ ...Object.fromEntries(Object.entries(calendarResourceLocationPolicyTables()).map(([name, table]) => [name, Object.freeze({ ...table })])), ...CALENDAR_OVERRIDE_ADDITIONS });
}
function schema(database: Parameters<Migration['up']>[0]) {
  const statements: Statement[] = [];
  try { return inspectDatabaseSchema({ prepare(sql: string) { const statement = database.prepare(sql); statements.push(statement); return statement; } } as Database); }
  finally { for (const statement of statements.reverse()) statement.finalize(); }
}
export function migrateCalendarOverrides(database: Parameters<Migration['up']>[0]): void {
  const before = schema(database), retained = calendarResourceLocationPolicyTables();
  if (diffSchemaSnapshots(snapshotDeclaredTables(retained), { tables: Object.fromEntries(Object.keys(retained).filter(name => before.tables[name]).map(name => [name, before.tables[name]!])) }).length
    || !database.query("SELECT 1 FROM _calendar_resource_location_policy_state WHERE id='application' AND version=18").get()
    || !database.query("SELECT 1 FROM _calendar_usage WHERE id='locationPolicyVersion' AND count=18").get()
    || database.query("SELECT 1 FROM _calendar_usage WHERE id='overrideVersion'").get()) throw new CalendarError('CALENDAR_STATE_INVALID');
  for (const [name, table] of Object.entries(CALENDAR_OVERRIDE_ADDITIONS)) if (before.tables[name]
    && (diffSchemaSnapshots(snapshotDeclaredTables({ [name]: table }), { tables: { [name]: before.tables[name]! } }).length
      || database.query(`SELECT 1 FROM ${name} LIMIT 1`).get()
      || database.query("SELECT 1 FROM sqlite_schema WHERE tbl_name=? AND type IN ('index','trigger') AND name NOT LIKE 'sqlite_%' LIMIT 1").get(name))) throw new CalendarError('CALENDAR_STATE_INVALID');
  for (const [name, table] of Object.entries(CALENDAR_OVERRIDE_ADDITIONS)) database.run(`CREATE TABLE IF NOT EXISTS "${name}" (${Object.entries(table).map(([column, declaration]) => `"${column}" ${declaration}`).join(',')})`);
  database.run(`INSERT INTO ${state}(id,version,review_key) VALUES('application',19,?)`, [randomBytes(32).toString('hex')]);
  database.run("INSERT INTO _calendar_usage(id,count) VALUES('overrideVersion',19)");
  database.run(`CREATE UNIQUE INDEX calendar_override_grant_generation ON ${grants}(scope_id,resource_id,user_id,resource_revision)`);
  database.run(`CREATE UNIQUE INDEX calendar_override_grant_identity ON ${current}(scope_id,resource_id,user_id)`);
  database.run(`CREATE UNIQUE INDEX calendar_override_admission_request ON ${admissions}(scope_id,principal,request_id)`);
  database.run(`CREATE UNIQUE INDEX calendar_override_appointment_generation ON ${history}(scope_id,appointment_id,appointment_revision)`);
  database.run(`CREATE UNIQUE INDEX calendar_override_witness_ordinal ON ${witnesses}(admission_id,ordinal)`);
  database.run(`CREATE UNIQUE INDEX calendar_override_witness_identity ON ${witnesses}(admission_id,reservation_id)`);
  for (const table of [state, grants, admissions, history, witnesses]) {
    for (const op of ['UPDATE', 'DELETE']) database.run(`CREATE TRIGGER ${table}_${op.toLowerCase()} BEFORE ${op} ON ${table} BEGIN SELECT RAISE(ABORT,'Private override evidence is immutable'); END`);
    database.run(`CREATE TRIGGER ${table}_replace BEFORE INSERT ON ${table} WHEN EXISTS(SELECT 1 FROM ${table} WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'Private override identity is immutable'); END`);
  }
  for (const op of ['UPDATE', 'DELETE']) database.run(`CREATE TRIGGER calendar_override_marker_${op.toLowerCase()} BEFORE ${op} ON _calendar_usage WHEN OLD.id='overrideVersion' BEGIN SELECT RAISE(ABORT,'Private override marker is immutable'); END`);
  database.run("CREATE TRIGGER calendar_override_marker_replace BEFORE INSERT ON _calendar_usage WHEN NEW.id='overrideVersion' BEGIN SELECT RAISE(ABORT,'Private override marker is immutable'); END");
  database.run(`CREATE TRIGGER calendar_override_state_replace BEFORE INSERT ON ${state} WHEN EXISTS(SELECT 1 FROM ${state}) BEGIN SELECT RAISE(ABORT,'Private override state is immutable'); END`);
  const unsealed = (scope: string, target: string, revision: string, kind: string) => `NOT EXISTS(SELECT 1 FROM _calendar_effect_intents e WHERE e.scope_id=${scope} AND e.target_kind='${kind}' AND e.target_id=${target} AND e.revision=${revision})`;
  database.run(`CREATE TRIGGER calendar_override_grant_parent BEFORE INSERT ON ${grants} WHEN NOT EXISTS(SELECT 1 FROM calendar_resources r JOIN _calendar_owner o ON o.scope_id=r.scope_id AND o.id='application' WHERE r.id=NEW.resource_id AND r.scope_id=NEW.scope_id AND r.revision=NEW.resource_revision)
    OR NOT ${unsealed('NEW.scope_id', 'NEW.resource_id', 'NEW.resource_revision', 'resource')} BEGIN SELECT RAISE(ABORT,'Private override grant generation is sealed'); END`);
  for (const op of ['INSERT', 'UPDATE']) database.run(`CREATE TRIGGER calendar_override_grant_current_${op.toLowerCase()} BEFORE ${op} ON ${current} WHEN NOT EXISTS(SELECT 1 FROM ${grants} g JOIN calendar_resources r ON r.id=g.resource_id AND r.scope_id=g.scope_id
    WHERE g.id=NEW.history_id AND g.scope_id=NEW.scope_id AND g.resource_id=NEW.resource_id AND g.user_id=NEW.user_id AND g.resource_revision=NEW.resource_revision AND r.revision=NEW.resource_revision)
    OR NOT ${unsealed('NEW.scope_id', 'NEW.resource_id', 'NEW.resource_revision', 'resource')} BEGIN SELECT RAISE(ABORT,'Private override grant selector is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_override_grant_current_identity BEFORE UPDATE ON ${current} WHEN NEW.id IS NOT OLD.id OR NEW.scope_id IS NOT OLD.scope_id OR NEW.resource_id IS NOT OLD.resource_id OR NEW.user_id IS NOT OLD.user_id OR NEW.resource_revision<=OLD.resource_revision BEGIN SELECT RAISE(ABORT,'Private override selector must advance'); END`);
  database.run(`CREATE TRIGGER calendar_override_grant_current_retain BEFORE DELETE ON ${current} BEGIN SELECT RAISE(ABORT,'Private override grants are retained'); END`);
  database.run(`CREATE TRIGGER calendar_override_grant_current_replace BEFORE INSERT ON ${current} WHEN EXISTS(SELECT 1 FROM ${current} WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'Private override selector identity is immutable'); END`);
  database.run(`CREATE TRIGGER calendar_override_admission_parent BEFORE INSERT ON ${admissions} WHEN NOT EXISTS(SELECT 1 FROM _calendar_owner WHERE id='application' AND scope_id=NEW.scope_id AND owner_id=NEW.owner_id)
    OR NOT EXISTS(SELECT 1 FROM ${state} WHERE id='application' AND version=19)
    OR EXISTS(SELECT 1 FROM _calendar_receipts WHERE id=NEW.id)
    OR NOT ${unsealed('NEW.scope_id', 'NEW.appointment_id', 'NEW.appointment_revision', 'appointment')}
    OR (NEW.action='create' AND (NEW.base_revision<>0 OR EXISTS(SELECT 1 FROM calendar_appointments WHERE id=NEW.appointment_id)))
    OR (NEW.action='update' AND NOT EXISTS(SELECT 1 FROM calendar_appointments WHERE id=NEW.appointment_id AND scope_id=NEW.scope_id AND revision=NEW.base_revision AND status='confirmed'))
    OR NEW.resource_ids_json IS NOT (SELECT json_group_array(value) FROM (SELECT DISTINCT value FROM json_each(NEW.resource_ids_json) ORDER BY value))
    OR EXISTS(SELECT 1 FROM json_each(NEW.resource_ids_json) x WHERE x.type<>'text' OR NOT EXISTS(SELECT 1 FROM calendar_resources r WHERE r.id=x.value AND r.scope_id=NEW.scope_id))
    BEGIN SELECT RAISE(ABORT,'Private override admission is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_override_witness_parent BEFORE INSERT ON ${witnesses} WHEN NOT EXISTS(SELECT 1 FROM ${admissions} d JOIN _calendar_reservations r ON r.id=NEW.reservation_id AND r.scope_id=d.scope_id JOIN calendar_appointments a ON a.id=r.appointment_id AND a.scope_id=r.scope_id
    JOIN _calendar_appointment_resource_current m ON m.scope_id=r.scope_id AND m.appointment_id=r.appointment_id AND m.resource_id=r.resource_id
    WHERE d.id=NEW.admission_id AND d.scope_id=NEW.scope_id AND NEW.ordinal<d.witness_count AND r.resource_id=NEW.resource_id AND r.appointment_id=NEW.appointment_id AND r.active=1 AND a.status='confirmed'
      AND a.revision=NEW.parent_revision AND r.occupied_start_ms=NEW.occupied_start_ms AND r.occupied_end_ms=NEW.occupied_end_ms
      AND m.binding_revision=NEW.binding_revision
      AND a.occupied_start_ms=r.occupied_start_ms AND a.occupied_end_ms=r.occupied_end_ms
      AND EXISTS(SELECT 1 FROM json_each(d.resource_ids_json) WHERE value=r.resource_id)
      AND ${unsealed('d.scope_id', 'd.appointment_id', 'd.appointment_revision', 'appointment')})
    BEGIN SELECT RAISE(ABORT,'Private override witness is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_override_receipt_seal BEFORE INSERT ON _calendar_receipts WHEN EXISTS(SELECT 1 FROM ${admissions} WHERE id=NEW.id) AND NOT EXISTS(
    SELECT 1 FROM ${admissions} d JOIN ${history} h ON h.admission_id=d.id WHERE d.id=NEW.id AND d.scope_id=NEW.scope_id AND d.principal=NEW.principal AND d.request_id=NEW.request_id
      AND NEW.target_kind='appointment' AND NEW.target_id=d.appointment_id AND h.scope_id=d.scope_id AND h.appointment_id=d.appointment_id AND h.appointment_revision=d.appointment_revision
      AND json_extract(NEW.result_json,'$.changed') IS 1 AND json_extract(NEW.result_json,'$.revision') IS d.appointment_revision
      AND json_extract(NEW.result_json,'$.operation') IS (CASE d.action WHEN 'create' THEN 'appointment.created' ELSE 'appointment.updated' END)
      AND d.witness_count=(SELECT count(*) FROM ${witnesses} WHERE admission_id=d.id)) BEGIN SELECT RAISE(ABORT,'Private override receipt is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_override_history_parent BEFORE INSERT ON ${history} WHEN NOT EXISTS(SELECT 1 FROM ${admissions} d JOIN calendar_appointments a ON a.id=d.appointment_id AND a.scope_id=d.scope_id
    WHERE d.id=NEW.admission_id AND NEW.id=d.id AND d.scope_id=NEW.scope_id AND d.appointment_id=NEW.appointment_id AND d.appointment_revision=NEW.appointment_revision AND a.revision=NEW.appointment_revision AND a.status='confirmed'
      AND d.witness_count=(SELECT count(*) FROM ${witnesses} WHERE admission_id=d.id)
      AND ${unsealed('d.scope_id', 'd.appointment_id', 'd.appointment_revision', 'appointment')}) BEGIN SELECT RAISE(ABORT,'Private override history is inconsistent'); END`);
  database.run(`CREATE TRIGGER calendar_override_effect_seal BEFORE INSERT ON _calendar_effect_intents WHEN (
    NEW.operation='resource.override-grant-changed' AND NOT EXISTS(SELECT 1 FROM ${grants} g JOIN ${current} c ON c.history_id=g.id WHERE g.scope_id=NEW.scope_id AND g.resource_id=NEW.target_id AND g.resource_revision=NEW.revision)
    ) OR (EXISTS(SELECT 1 FROM ${admissions} d WHERE d.id=NEW.receipt_id) AND NOT EXISTS(SELECT 1 FROM ${admissions} d JOIN ${history} h ON h.admission_id=d.id JOIN _calendar_receipts r ON r.id=d.id
      WHERE d.id=NEW.receipt_id AND d.scope_id=NEW.scope_id AND d.appointment_id=NEW.target_id AND NEW.target_kind='appointment' AND d.appointment_revision=NEW.revision
        AND h.scope_id=d.scope_id AND h.appointment_id=d.appointment_id AND h.appointment_revision=d.appointment_revision
        AND r.scope_id=d.scope_id AND r.principal=d.principal AND r.request_id=d.request_id AND r.target_kind='appointment' AND r.target_id=d.appointment_id
        AND NEW.operation=(CASE d.action WHEN 'create' THEN 'appointment.created' ELSE 'appointment.updated' END)
        AND d.witness_count=(SELECT count(*) FROM ${witnesses} WHERE admission_id=d.id))) BEGIN SELECT RAISE(ABORT,'Private override evidence is incomplete'); END`);
}
export const CALENDAR_OVERRIDES_MIGRATION: Readonly<Migration> = Object.freeze({ version: '019', description: 'Independent one-off appointment overlap grants and sealed admission', up: migrateCalendarOverrides });
