/** Registered017 appointment LocalDate metadata and frozen occupancy authority.
 * Appointment-only: holds/blocks retain their historical timed constraints.
 * Earlier maps/functions remain immutable checksum inputs. No semantic backfill.
 */
import type { Database, Statement } from 'bun:sqlite';
import type { Migration } from '../migrations/migrator';
import { inspectDatabaseSchema } from '../migrations/schema-inspector';
import { diffSchemaSnapshots } from '../migrations/schema-diff';
import { snapshotDeclaredTables } from '../migrations/schema-snapshot';
import type { TableSchema } from '../sync/types';
import { CALENDAR_APPOINTMENT_UPDATE_TABLES } from './realm-appointment-update-migration';
import { CALENDAR_APPOINTMENT_TIME_CURRENT as current, CALENDAR_APPOINTMENT_TIME_HISTORY as history,
  CALENDAR_APPOINTMENT_TIME_STATE as state } from './appointment-time-bindings';
import { CalendarError } from './error';

export const CALENDAR_APPOINTMENT_TIME_KIND_COLUMN = "TEXT NOT NULL DEFAULT 'timed-v1' CHECK(time_kind IN ('timed-v1','all-day-local-v1'))";
const branch = `CHECK((
  (kind='timed-v1' AND start_date IS NULL AND end_date IS NULL AND day_count IS NULL
    AND authored_time_zone IS NULL AND engine_json IS NULL AND end_ms-start_ms<=2678400000)
  OR (kind='all-day-local-v1' AND start_date IS NOT NULL AND end_date IS NOT NULL
    AND length(start_date)=10 AND length(end_date)=10
    AND start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND end_date>start_date
    AND typeof(day_count)='integer' AND day_count BETWEEN 1 AND 31
    AND authored_time_zone IS NOT NULL AND length(authored_time_zone) BETWEEN 1 AND 128
    AND buffer_before=0 AND buffer_after=0 AND end_ms-start_ms<=2851200000
    AND engine_json IS NOT NULL AND length(engine_json)<=2048
    AND CASE WHEN json_valid(engine_json) THEN
      json_type(engine_json) IS 'object' AND json_extract(engine_json,'$.name') IS 'temporal-all-day-v1'
      AND json_remove(engine_json,'$.name','$.runtime','$.icu')='{}'
      AND json_type(engine_json,'$.runtime') IS 'text' AND length(json_extract(engine_json,'$.runtime')) BETWEEN 1 AND 256
      AND json_type(engine_json,'$.icu') IS 'text' AND length(json_extract(engine_json,'$.icu')) BETWEEN 1 AND 256
      ELSE 0 END)
) IS 1)`;
export const CALENDAR_APPOINTMENT_ALL_DAY_ADDITIONS: Readonly<Record<string, TableSchema>> = Object.freeze({
  [state]: Object.freeze({ id: "TEXT PRIMARY KEY NOT NULL CHECK(id='application')", version: "INTEGER NOT NULL CHECK(typeof(version)='integer' AND version=17)" }),
  [history]: Object.freeze({ id: 'TEXT PRIMARY KEY NOT NULL', scope_id: 'TEXT NOT NULL', appointment_id: 'TEXT NOT NULL REFERENCES calendar_appointments(id)',
    appointment_revision: "INTEGER NOT NULL CHECK(typeof(appointment_revision)='integer' AND appointment_revision>0)",
    kind: "TEXT NOT NULL CHECK(kind IN ('timed-v1','all-day-local-v1'))", start_date: 'TEXT', end_date: 'TEXT', day_count: 'INTEGER', authored_time_zone: 'TEXT',
    start_at: 'TEXT NOT NULL', end_at: 'TEXT NOT NULL', start_ms: "INTEGER NOT NULL CHECK(typeof(start_ms)='integer')",
    end_ms: "INTEGER NOT NULL CHECK(typeof(end_ms)='integer' AND end_ms>start_ms)", time_zone: 'TEXT NOT NULL CHECK(length(time_zone) BETWEEN 1 AND 128)',
    buffer_before: "INTEGER NOT NULL CHECK(typeof(buffer_before)='integer' AND buffer_before BETWEEN 0 AND 1440)",
    buffer_after: "INTEGER NOT NULL CHECK(typeof(buffer_after)='integer' AND buffer_after BETWEEN 0 AND 1440)",
    occupied_start_ms: "INTEGER NOT NULL CHECK(typeof(occupied_start_ms)='integer' AND occupied_start_ms=start_ms-buffer_before*60000)",
    occupied_end_ms: "INTEGER NOT NULL CHECK(typeof(occupied_end_ms)='integer' AND occupied_end_ms=end_ms+buffer_after*60000 AND occupied_end_ms-occupied_start_ms<=2851200000)",
    engine_json: `TEXT ${branch}` }),
  [current]: Object.freeze({ id: 'TEXT PRIMARY KEY NOT NULL', scope_id: 'TEXT NOT NULL', appointment_id: 'TEXT NOT NULL REFERENCES calendar_appointments(id)',
    binding_id: `TEXT NOT NULL REFERENCES ${history}(id)`, kind: "TEXT NOT NULL CHECK(kind IN ('timed-v1','all-day-local-v1'))",
    start_date: 'TEXT', end_date: "TEXT CHECK(((kind='timed-v1' AND start_date IS NULL AND end_date IS NULL) OR (kind='all-day-local-v1' AND start_date IS NOT NULL AND end_date IS NOT NULL AND end_date>start_date)) IS 1)" }),
});
/** New map only. Never mutates any001–016 declaration. */
export function calendarAppointmentAllDayTables(): Readonly<Record<string, TableSchema>> {
  const retained = Object.fromEntries(Object.entries(CALENDAR_APPOINTMENT_UPDATE_TABLES).map(([name, declaration]) => [name, Object.freeze({ ...declaration })]));
  return Object.freeze({ ...retained,
    calendar_appointments: Object.freeze({ ...retained.calendar_appointments, time_kind: CALENDAR_APPOINTMENT_TIME_KIND_COLUMN }),
    ...CALENDAR_APPOINTMENT_ALL_DAY_ADDITIONS });
}
function schema(database: Parameters<Migration['up']>[0]) {
  const statements: Statement[] = [];
  try { return inspectDatabaseSchema({ prepare(sql: string) { const statement = database.prepare(sql); statements.push(statement); return statement; } } as Database); }
  finally { for (const statement of statements.reverse()) statement.finalize(); }
}
export function migrateCalendarAppointmentAllDay(database: Parameters<Migration['up']>[0]): void {
  const before = schema(database), hasKind = !!before.tables.calendar_appointments?.columns.time_kind;
  const base = hasKind ? { ...CALENDAR_APPOINTMENT_UPDATE_TABLES, calendar_appointments: calendarAppointmentAllDayTables().calendar_appointments! }
    : CALENDAR_APPOINTMENT_UPDATE_TABLES;
  const selected = { tables: Object.fromEntries(Object.keys(base).filter(name => before.tables[name]).map(name => [name, before.tables[name]!])) };
  if (diffSchemaSnapshots(snapshotDeclaredTables(base), selected).length) throw new CalendarError('CALENDAR_STATE_INVALID');
  if (!database.query("SELECT 1 WHERE (SELECT count(*) FROM _calendar_appointment_resource_state)=1 AND EXISTS(SELECT 1 FROM _calendar_appointment_resource_state WHERE id='application' AND version=16)").get()) throw new CalendarError('CALENDAR_STATE_INVALID');
  // Latest-map MEMORY setup may predeclare exact EMPTY additions. Never accept
  // populated partial017 metadata or silently fix a malformed pre-existing table.
  for (const [name, declaration] of Object.entries(CALENDAR_APPOINTMENT_ALL_DAY_ADDITIONS)) if (before.tables[name]) {
    if (diffSchemaSnapshots(snapshotDeclaredTables({ [name]: declaration }), { tables: { [name]: before.tables[name]! } }).length
      || database.query(`SELECT 1 FROM ${name} LIMIT 1`).get()
      || database.query("SELECT 1 FROM sqlite_schema WHERE tbl_name=? AND type IN ('trigger','index') AND name NOT LIKE 'sqlite_%' LIMIT 1").get(name)) throw new CalendarError('CALENDAR_STATE_INVALID');
  }
  if (hasKind && database.query("SELECT 1 FROM calendar_appointments WHERE time_kind IS NOT 'timed-v1' LIMIT 1").get()) throw new CalendarError('CALENDAR_STATE_INVALID');
  if (!hasKind) database.run(`ALTER TABLE calendar_appointments ADD COLUMN time_kind ${CALENDAR_APPOINTMENT_TIME_KIND_COLUMN}`);
  for (const [name, columns] of Object.entries(CALENDAR_APPOINTMENT_ALL_DAY_ADDITIONS)) database.run(`CREATE TABLE IF NOT EXISTS "${name}" (${Object.entries(columns).map(([column, definition]) => `"${column}" ${definition}`).join(', ')})`);
  database.run(`INSERT INTO ${state}(id,version) VALUES('application',17)`);
  database.run(`CREATE UNIQUE INDEX calendar_appointment_time_generation ON ${history}(scope_id,appointment_id,appointment_revision)`);
  database.run(`CREATE UNIQUE INDEX calendar_appointment_time_current_identity ON ${current}(scope_id,appointment_id)`);
  database.run(`CREATE INDEX calendar_appointment_time_current_dates ON ${current}(scope_id,kind,start_date,appointment_id)`);
  for (const operation of ['UPDATE', 'DELETE']) database.run(`CREATE TRIGGER ${state}_${operation.toLowerCase()} BEFORE ${operation} ON ${state} BEGIN SELECT RAISE(ABORT,'Private calendar version is immutable'); END`);
  database.run(`CREATE TRIGGER ${state}_no_replace BEFORE INSERT ON ${state} WHEN EXISTS(SELECT 1 FROM ${state}) BEGIN SELECT RAISE(ABORT,'Private calendar version is immutable'); END`);
  for (const table of [history, current]) {
    const duplicate = table === history ? 'scope_id=NEW.scope_id AND appointment_id=NEW.appointment_id AND appointment_revision=NEW.appointment_revision'
      : 'scope_id=NEW.scope_id AND appointment_id=NEW.appointment_id';
    database.run(`CREATE TRIGGER ${table}_no_replace BEFORE INSERT ON ${table} WHEN EXISTS(SELECT 1 FROM ${table} WHERE id=NEW.id OR (${duplicate})) BEGIN SELECT RAISE(ABORT,'Private calendar identity cannot be replaced'); END`);
    database.run(`CREATE TRIGGER ${table}_scope BEFORE INSERT ON ${table} WHEN NOT EXISTS(SELECT 1 FROM _calendar_owner WHERE id='application' AND scope_id=NEW.scope_id) BEGIN SELECT RAISE(ABORT,'Private calendar scope is inconsistent'); END`);
    database.run(`CREATE TRIGGER ${table}_retain BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Private calendar history must be retained'); END`);
  }
  database.run(`CREATE TRIGGER ${history}_update BEFORE UPDATE ON ${history} BEGIN SELECT RAISE(ABORT,'Private calendar evidence is immutable'); END`);
  database.run(`CREATE TRIGGER ${current}_identity BEFORE UPDATE OF id,scope_id,appointment_id ON ${current} WHEN OLD.id IS NOT NEW.id OR OLD.scope_id IS NOT NEW.scope_id OR OLD.appointment_id IS NOT NEW.appointment_id BEGIN SELECT RAISE(ABORT,'Private calendar identity is immutable'); END`);
  database.run(`CREATE TRIGGER calendar_appointment_time_parent_generation BEFORE UPDATE ON calendar_appointments WHEN
    (OLD.time_kind='all-day-local-v1' OR NEW.time_kind='all-day-local-v1' OR EXISTS(SELECT 1 FROM ${current} WHERE scope_id=OLD.scope_id AND appointment_id=OLD.id))
    AND (NEW.revision<>OLD.revision+1
      OR NOT EXISTS(SELECT 1 FROM _calendar_effect_intents WHERE scope_id=OLD.scope_id AND target_kind='appointment' AND target_id=OLD.id AND revision=OLD.revision)
      OR EXISTS(SELECT 1 FROM _calendar_effect_intents WHERE scope_id=NEW.scope_id AND target_kind='appointment' AND target_id=NEW.id AND revision=NEW.revision))
    BEGIN SELECT RAISE(ABORT,'Private appointment time parent generation is sealed'); END`);
  const unsealed = `NOT EXISTS(SELECT 1 FROM _calendar_effect_intents e WHERE e.scope_id=a.scope_id AND e.target_kind='appointment' AND e.target_id=a.id AND e.revision=a.revision)`;
  const equal = (a: string, h: string) => ['start_at', 'end_at', 'start_ms', 'end_ms', 'time_zone', 'buffer_before', 'buffer_after', 'occupied_start_ms', 'occupied_end_ms']
    .map(field => `${a}.${field} IS ${h}.${field}`).join(' AND ') + ` AND ${a}.time_kind IS ${h}.kind`;
  database.run(`CREATE TRIGGER ${history}_parent BEFORE INSERT ON ${history} WHEN
    NOT EXISTS(SELECT 1 FROM calendar_appointments a WHERE a.scope_id=NEW.scope_id AND a.id=NEW.appointment_id AND a.status='confirmed'
      AND a.revision=NEW.appointment_revision AND ${equal('a', 'NEW')} AND ${unsealed})
    OR EXISTS(SELECT 1 FROM ${history} WHERE scope_id=NEW.scope_id AND appointment_id=NEW.appointment_id AND appointment_revision>=NEW.appointment_revision)
    OR NOT EXISTS(SELECT 1 FROM ${state} WHERE id='application' AND version=17)
    BEGIN SELECT RAISE(ABORT,'Private appointment time generation is sealed'); END`);
  for (const operation of ['INSERT', 'UPDATE']) database.run(`CREATE TRIGGER ${current}_parent_${operation.toLowerCase()} BEFORE ${operation} ON ${current} WHEN NOT EXISTS(
    SELECT 1 FROM ${history} h JOIN calendar_appointments a ON a.scope_id=h.scope_id AND a.id=h.appointment_id
    WHERE h.id=NEW.binding_id AND h.scope_id=NEW.scope_id AND h.appointment_id=NEW.appointment_id AND a.status='confirmed'
      AND NEW.kind IS h.kind AND NEW.start_date IS h.start_date AND NEW.end_date IS h.end_date
      AND h.appointment_revision=a.revision AND ${equal('a', 'h')} AND ${unsealed}
      AND NOT EXISTS(SELECT 1 FROM ${history} later WHERE later.scope_id=h.scope_id AND later.appointment_id=h.appointment_id AND later.appointment_revision>h.appointment_revision))
    BEGIN SELECT RAISE(ABORT,'Private appointment time pointer is inconsistent'); END`);
  database.run(`CREATE TRIGGER ${current}_forward BEFORE UPDATE ON ${current} WHEN NOT EXISTS(
    SELECT 1 FROM ${history} prior JOIN ${history} next ON next.id=NEW.binding_id
    WHERE prior.id=OLD.binding_id AND next.appointment_revision>prior.appointment_revision)
    BEGIN SELECT RAISE(ABORT,'Private appointment time pointer must advance'); END`);
  for (const [image, revision] of [['before_json', 'prior_revision'], ['after_json', 'appointment_revision']]) {
    database.run(`CREATE TRIGGER calendar_appointment_update_time_${image} BEFORE INSERT ON _calendar_appointment_update_history WHEN EXISTS(
      SELECT 1 FROM ${history} h WHERE h.scope_id=NEW.scope_id AND h.appointment_id=NEW.appointment_id AND h.kind='all-day-local-v1'
        AND h.appointment_revision=(SELECT max(appointment_revision) FROM ${history} WHERE scope_id=NEW.scope_id AND appointment_id=NEW.appointment_id AND appointment_revision<=NEW.${revision})
        AND (json_type(NEW.${image},'$.interval') IS NOT 'object'
          OR json_extract(NEW.${image},'$.interval.kind') IS NOT h.kind
          OR json_extract(NEW.${image},'$.interval.startDate') IS NOT h.start_date
          OR json_extract(NEW.${image},'$.interval.endDate') IS NOT h.end_date
          OR json_extract(NEW.${image},'$.interval.timeZone') IS NOT h.authored_time_zone))
      BEGIN SELECT RAISE(ABORT,'Private appointment LocalDate update history is inconsistent'); END`);
  }
  database.run(`CREATE TRIGGER calendar_effect_current_time BEFORE INSERT ON _calendar_effect_intents WHEN NEW.target_kind='appointment' AND (
    NOT EXISTS(SELECT 1 FROM ${state} WHERE id='application' AND version=17)
    OR NOT EXISTS(SELECT 1 FROM calendar_appointments a WHERE a.scope_id=NEW.scope_id AND a.id=NEW.target_id AND a.revision=NEW.revision AND (
      (a.time_kind='timed-v1' AND NOT EXISTS(SELECT 1 FROM ${current} p WHERE p.scope_id=a.scope_id AND p.appointment_id=a.id)
        AND NOT EXISTS(SELECT 1 FROM ${history} h WHERE h.scope_id=a.scope_id AND h.appointment_id=a.id))
      OR EXISTS(SELECT 1 FROM ${current} p JOIN ${history} h ON h.id=p.binding_id AND h.scope_id=p.scope_id AND h.appointment_id=p.appointment_id
        WHERE p.scope_id=a.scope_id AND p.appointment_id=a.id AND h.appointment_revision<=a.revision AND ${equal('a', 'h')}
          AND p.kind IS h.kind AND p.start_date IS h.start_date AND p.end_date IS h.end_date
          AND NOT EXISTS(SELECT 1 FROM ${history} later WHERE later.scope_id=h.scope_id AND later.appointment_id=h.appointment_id AND later.appointment_revision>h.appointment_revision))))
    OR EXISTS(SELECT 1 FROM calendar_appointments a JOIN _calendar_appointment_type_current p ON p.scope_id=a.scope_id AND p.appointment_id=a.id
      JOIN _calendar_appointment_type_bindings b ON b.id=p.binding_id WHERE a.scope_id=NEW.scope_id AND a.id=NEW.target_id AND a.time_kind='all-day-local-v1' AND b.type_id IS NOT NULL)
    ) BEGIN SELECT RAISE(ABORT,'Private current appointment time is inconsistent'); END`);
  // Fresh consumption remains a timed-hold protocol. Do not compare a retained
  // already-confirmed hold against an appointment converted at a later revision.
  database.run(`CREATE TRIGGER calendar_hold_confirmation_time_kind BEFORE UPDATE ON calendar_holds
    WHEN OLD.status<>'confirmed' AND NEW.status='confirmed' AND NOT EXISTS(SELECT 1 FROM calendar_appointments a
      WHERE a.id=NEW.appointment_id AND a.scope_id=NEW.scope_id AND a.time_kind='timed-v1')
    BEGIN SELECT RAISE(ABORT,'Private hold confirmation requires timed appointment'); END`);
}
export const CALENDAR_APPOINTMENT_ALL_DAY_MIGRATION: Readonly<Migration> = Object.freeze({ version: '017',
  description: 'Private appointment LocalDate authority and frozen occupancy', up: migrateCalendarAppointmentAllDay });
