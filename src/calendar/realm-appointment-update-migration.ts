/** Additive 016. Earlier declarations/functions stay intact. Projection backfill is not fabricated semantic history. */
import type { Migration } from '../migrations/migrator';
import type { Database, Statement } from 'bun:sqlite';
import { inspectDatabaseSchema } from '../migrations/schema-inspector';
import { snapshotDeclaredTables } from '../migrations/schema-snapshot';
import { diffSchemaSnapshots } from '../migrations/schema-diff';
import type { TableSchema } from '../sync/types';
import { CALENDAR_INTEGRATION_OPERATOR_TABLES } from './realm-integration-operator-migration';
import { CALENDAR_APPOINTMENT_RESOURCE_CURRENT as current, CALENDAR_APPOINTMENT_UPDATE_HISTORY as history,
  CALENDAR_APPOINTMENT_RESOURCE_STATE as state } from './appointment-resource-bindings';
import { CalendarError } from './error';

export const CALENDAR_APPOINTMENT_UPDATE_ADDITIONS: Record<string, TableSchema> = {
  [state]: { id: "TEXT PRIMARY KEY CHECK(id='application')", version: 'INTEGER NOT NULL CHECK(version=16)' },
  [current]: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', appointment_id: 'TEXT NOT NULL REFERENCES calendar_appointments(id)',
    resource_id: 'TEXT NOT NULL REFERENCES calendar_resources(id)', binding_revision: 'INTEGER NOT NULL CHECK(binding_revision>0)' },
  [history]: { id: 'TEXT PRIMARY KEY', scope_id: 'TEXT NOT NULL', appointment_id: 'TEXT NOT NULL REFERENCES calendar_appointments(id)',
    appointment_revision: 'INTEGER NOT NULL CHECK(appointment_revision>1)', prior_revision: 'INTEGER NOT NULL CHECK(prior_revision=appointment_revision-1)',
    before_json: "TEXT NOT NULL CHECK(length(before_json)<=32768 AND json_valid(before_json) AND json_type(before_json)='object')",
    after_json: "TEXT NOT NULL CHECK(length(after_json)<=32768 AND json_valid(after_json) AND json_type(after_json)='object')" },
};
export const CALENDAR_APPOINTMENT_UPDATE_TABLES: Record<string, TableSchema> = { ...CALENDAR_INTEGRATION_OPERATOR_TABLES, ...CALENDAR_APPOINTMENT_UPDATE_ADDITIONS };
for (const schema of Object.values(CALENDAR_APPOINTMENT_UPDATE_ADDITIONS)) Object.freeze(schema);
Object.freeze(CALENDAR_APPOINTMENT_UPDATE_ADDITIONS); Object.freeze(CALENDAR_APPOINTMENT_UPDATE_TABLES);

export function migrateCalendarAppointmentUpdates(database: Parameters<Migration['up']>[0]): void {
  // File-mode DatabaseRuntime migrates before ReactiveDB defines its tables.
  // Own the additive DDL here; IF NOT EXISTS alone is not schema admission.
  for (const [table, columns] of Object.entries(CALENDAR_APPOINTMENT_UPDATE_ADDITIONS)) database.run(`CREATE TABLE IF NOT EXISTS "${table}" (${Object.entries(columns).map(([column, definition]) => `"${column}" ${definition}`).join(', ')})`);
  const statements: Statement[] = [];
  try {
    const actual = inspectDatabaseSchema({ prepare(sql: string) { const statement = database.prepare(sql); statements.push(statement); return statement; } } as Database);
    const selected = { tables: Object.fromEntries(Object.keys(CALENDAR_APPOINTMENT_UPDATE_ADDITIONS).filter(table => actual.tables[table]).map(table => [table, actual.tables[table]!])) };
    if (diffSchemaSnapshots(snapshotDeclaredTables(CALENDAR_APPOINTMENT_UPDATE_ADDITIONS), selected).length) throw new CalendarError('CALENDAR_STATE_INVALID');
  } finally { for (const statement of statements.reverse()) statement.finalize(); }
  // Legacy membership never changed: all retained rows are its exact current set, including cancelled parents.
  if (database.query(`SELECT 1 FROM calendar_appointments a WHERE
    (SELECT count(*) FROM _calendar_reservations r WHERE r.scope_id=a.scope_id AND r.appointment_id=a.id) NOT BETWEEN 1 AND 16
    OR EXISTS(SELECT 1 FROM _calendar_reservations r LEFT JOIN calendar_resources x ON x.id=r.resource_id AND x.scope_id=r.scope_id
      WHERE r.appointment_id=a.id AND (r.scope_id<>a.scope_id OR x.id IS NULL OR r.active<>(a.status='confirmed')
        OR r.occupied_start_ms<>a.occupied_start_ms OR r.occupied_end_ms<>a.occupied_end_ms)) LIMIT 1`).get()
    || database.query(`SELECT 1 FROM ${current} LIMIT 1`).get() || database.query(`SELECT 1 FROM ${history} LIMIT 1`).get()
    || database.query(`SELECT 1 FROM ${state} LIMIT 1`).get()) throw new CalendarError('CALENDAR_STATE_INVALID');
  database.run(`INSERT INTO ${current}(id,scope_id,appointment_id,resource_id,binding_revision)
    SELECT r.id,r.scope_id,r.appointment_id,r.resource_id,a.revision FROM _calendar_reservations r
    JOIN calendar_appointments a ON a.scope_id=r.scope_id AND a.id=r.appointment_id`);
  database.run(`INSERT INTO ${state}(id,version) VALUES('application',16)`);
  database.run(`CREATE UNIQUE INDEX calendar_appointment_current_resource_identity ON ${current}(scope_id,appointment_id,resource_id)`);
  database.run(`CREATE INDEX calendar_appointment_current_resource_selection ON ${current}(scope_id,resource_id,appointment_id)`);
  database.run(`CREATE UNIQUE INDEX calendar_appointment_update_generation ON ${history}(scope_id,appointment_id,appointment_revision)`);
  database.run(`CREATE TRIGGER calendar_appointment_resource_version_replace BEFORE INSERT ON ${state} WHEN EXISTS(SELECT 1 FROM ${state})
    BEGIN SELECT RAISE(ABORT,'Private calendar version is immutable'); END`);
  for (const operation of ['UPDATE', 'DELETE']) database.run(`CREATE TRIGGER calendar_appointment_resource_version_${operation.toLowerCase()} BEFORE ${operation} ON ${state}
    BEGIN SELECT RAISE(ABORT,'Private calendar version is immutable'); END`);
  for (const table of [current, history]) {
    const duplicate = table === current ? '(scope_id=NEW.scope_id AND appointment_id=NEW.appointment_id AND resource_id=NEW.resource_id)'
      : '(scope_id=NEW.scope_id AND appointment_id=NEW.appointment_id AND appointment_revision=NEW.appointment_revision)';
    database.run(`CREATE TRIGGER ${table}_no_replace BEFORE INSERT ON ${table} WHEN EXISTS(SELECT 1 FROM ${table} WHERE id=NEW.id OR ${duplicate})
      BEGIN SELECT RAISE(ABORT,'Private calendar identity cannot be replaced'); END`);
    database.run(`CREATE TRIGGER ${table}_scope BEFORE INSERT ON ${table} WHEN NOT EXISTS(SELECT 1 FROM _calendar_owner WHERE id='application' AND scope_id=NEW.scope_id)
      BEGIN SELECT RAISE(ABORT,'Private calendar scope is inconsistent'); END`);
    database.run(`CREATE TRIGGER ${table}_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'Private calendar evidence is immutable'); END`);
  }
  database.run(`CREATE TRIGGER ${history}_retain BEFORE DELETE ON ${history} BEGIN SELECT RAISE(ABORT,'Private calendar history must be retained'); END`);
  const unsealed = `NOT EXISTS(SELECT 1 FROM _calendar_effect_intents e WHERE e.scope_id=a.scope_id AND e.target_kind='appointment' AND e.target_id=a.id AND e.revision=a.revision)`;
  database.run(`CREATE TRIGGER ${current}_parent BEFORE INSERT ON ${current} WHEN
    (SELECT count(*) FROM ${current} WHERE scope_id=NEW.scope_id AND appointment_id=NEW.appointment_id)>=16
    OR NOT EXISTS(SELECT 1 FROM calendar_appointments a JOIN _calendar_reservations r ON r.scope_id=a.scope_id AND r.appointment_id=a.id
      JOIN calendar_resources x ON x.scope_id=r.scope_id AND x.id=r.resource_id
      WHERE a.scope_id=NEW.scope_id AND a.id=NEW.appointment_id AND a.status='confirmed' AND a.revision=NEW.binding_revision
        AND r.resource_id=NEW.resource_id AND r.active=1 AND r.occupied_start_ms=a.occupied_start_ms AND r.occupied_end_ms=a.occupied_end_ms AND ${unsealed})
    BEGIN SELECT RAISE(ABORT,'Private current resource membership is inconsistent'); END`);
  database.run(`CREATE TRIGGER ${current}_retire BEFORE DELETE ON ${current} WHEN NOT EXISTS(SELECT 1 FROM calendar_appointments a
    WHERE a.scope_id=OLD.scope_id AND a.id=OLD.appointment_id AND a.status='confirmed' AND ${unsealed})
    BEGIN SELECT RAISE(ABORT,'Private current resource membership is sealed'); END`);
  for (const image of ['before_json', 'after_json']) database.run(`CREATE TRIGGER ${history}_${image} BEFORE INSERT ON ${history} WHEN
    json_type(NEW.${image},'$.resourceIds') IS NOT 'array' OR json_array_length(NEW.${image},'$.resourceIds') NOT BETWEEN 1 AND 16
    OR json_extract(NEW.${image},'$.resourceIds')<>(SELECT json_group_array(value) FROM (SELECT DISTINCT value FROM json_each(NEW.${image},'$.resourceIds') ORDER BY value))
    OR EXISTS(SELECT 1 FROM json_each(NEW.${image},'$.resourceIds') r WHERE r.type<>'text'
      OR NOT EXISTS(SELECT 1 FROM calendar_resources x WHERE x.scope_id=NEW.scope_id AND x.id=r.value))
    BEGIN SELECT RAISE(ABORT,'Private resource history is inconsistent'); END`);
  database.run(`CREATE TRIGGER ${history}_parent BEFORE INSERT ON ${history} WHEN NOT EXISTS(SELECT 1 FROM calendar_appointments a
    WHERE a.scope_id=NEW.scope_id AND a.id=NEW.appointment_id AND a.status='confirmed' AND a.revision=NEW.appointment_revision AND ${unsealed}
      AND a.title=json_extract(NEW.after_json,'$.title') AND a.start_at=json_extract(NEW.after_json,'$.startAt') AND a.end_at=json_extract(NEW.after_json,'$.endAt')
      AND a.time_zone=json_extract(NEW.after_json,'$.timeZone') AND a.buffer_before=json_extract(NEW.after_json,'$.bufferBeforeMinutes') AND a.buffer_after=json_extract(NEW.after_json,'$.bufferAfterMinutes')
      AND json_extract(NEW.after_json,'$.resourceIds')=(SELECT json_group_array(resource_id) FROM (SELECT resource_id FROM ${current} WHERE scope_id=NEW.scope_id AND appointment_id=NEW.appointment_id ORDER BY resource_id)))
    OR EXISTS(SELECT 1 FROM ${history} WHERE scope_id=NEW.scope_id AND appointment_id=NEW.appointment_id AND appointment_revision>=NEW.appointment_revision)
    BEGIN SELECT RAISE(ABORT,'Private appointment update generation is sealed'); END`);
  // Reservation identity/history is retained. Only a new unsealed parent generation can change live occupancy.
  for (const operation of ['INSERT', 'UPDATE']) database.run(`CREATE TRIGGER calendar_reservation_generation_${operation.toLowerCase()} BEFORE ${operation} ON _calendar_reservations WHEN NOT EXISTS(
    SELECT 1 FROM calendar_appointments a WHERE a.scope_id=NEW.scope_id AND a.id=NEW.appointment_id AND ${unsealed}
      AND (NEW.active=0 OR a.status='confirmed' AND NEW.occupied_start_ms=a.occupied_start_ms AND NEW.occupied_end_ms=a.occupied_end_ms))
    BEGIN SELECT RAISE(ABORT,'Private reservation generation is sealed'); END`);
  database.run(`CREATE TRIGGER calendar_effect_current_resources BEFORE INSERT ON _calendar_effect_intents WHEN NEW.target_kind='appointment' AND (
    NOT EXISTS(SELECT 1 FROM calendar_appointments a WHERE a.id=NEW.target_id AND a.scope_id=NEW.scope_id AND a.revision=NEW.revision)
    OR (SELECT count(*) FROM ${current} WHERE scope_id=NEW.scope_id AND appointment_id=NEW.target_id) NOT BETWEEN 1 AND 16
    OR EXISTS(SELECT 1 FROM ${current} c JOIN calendar_appointments a ON a.scope_id=c.scope_id AND a.id=c.appointment_id
      WHERE c.scope_id=NEW.scope_id AND c.appointment_id=NEW.target_id AND NOT EXISTS(SELECT 1 FROM _calendar_reservations r
        WHERE r.scope_id=c.scope_id AND r.appointment_id=c.appointment_id AND r.resource_id=c.resource_id AND r.active=(a.status='confirmed')
          AND r.occupied_start_ms=a.occupied_start_ms AND r.occupied_end_ms=a.occupied_end_ms))
    OR EXISTS(SELECT 1 FROM _calendar_reservations r WHERE r.scope_id=NEW.scope_id AND r.appointment_id=NEW.target_id AND r.active=1
      AND NOT EXISTS(SELECT 1 FROM ${current} c WHERE c.scope_id=r.scope_id AND c.appointment_id=r.appointment_id AND c.resource_id=r.resource_id))
    OR NEW.operation='appointment.updated' AND NOT EXISTS(SELECT 1 FROM ${history} h WHERE h.scope_id=NEW.scope_id AND h.appointment_id=NEW.target_id AND h.appointment_revision=NEW.revision)
    ) BEGIN SELECT RAISE(ABORT,'Private current resource membership is inconsistent'); END`);
}
